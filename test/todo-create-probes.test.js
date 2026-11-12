'use strict';
// 新增任務端點 — 只探測被選到的那一支 SOP；走真實 HTTP 與隔離 harness，不執行子程序。
const assert = require('node:assert/strict');
const http = require('node:http');
const { once, EventEmitter } = require('node:events');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

const SOP_IDS = ['probe_fixture_alpha', 'probe_fixture_beta', 'probe_fixture_gamma'];

function probeSops() {
    return SOP_IDS.map((id, index) => ({
        id,
        name: `Probe fixture ${index + 1}`,
        description: 'Synthetic probe counting only; no real commands.',
        category: 'Test',
        steps: {
            check: { commands: [`Write-Output check-${index}`] },
            install: { commands: [`Write-Output install-${index}`] },
            uninstall: { commands: [`Write-Output uninstall-${index}`] },
        },
    }));
}

function countingExecutor(installed) {
    const calls = [];
    class Executor extends EventEmitter {
        async runPhaseCommands(commands, phase) {
            calls.push({ commands, phase });
            return { success: true, outputs: [{ stdout: installed ? 'True' : 'False' }] };
        }
        isCheckSatisfied() { return installed; }
        async execute() { throw new Error('Creating a task must not execute a SOP'); }
    }
    return { Executor, calls };
}

function request(port, method, route, { token, body } = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path: route, method, agent: false,
            headers: {
                Host: '127.0.0.1:3210',
                ...(token ? { 'X-Visual-Agent-Token': token } : {}),
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { raw += chunk; });
            res.on('error', reject);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { reject(new Error(`Non-JSON ${res.statusCode} from ${route}: ${raw.slice(0, 200)}`)); }
            });
        });
        req.setTimeout(5000, () => req.destroy(new Error(`Timed out: ${route}`)));
        req.on('error', reject);
        req.end(payload);
    });
}

async function startHarness(t, { installed = false } = {}) {
    const { Executor, calls } = countingExecutor(installed);
    const harness = createChatHarness({ sops: probeSops(), executor: Executor });
    const server = harness.app.listen(0, '127.0.0.1');
    t.after(async () => {
        try {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } finally {
            harness.dispose();
            harness.assertSafe();
        }
    });
    await once(server, 'listening');
    const port = server.address().port;
    const meta = await request(port, 'GET', '/api/meta');
    assert.ok(meta.body.localApiToken, 'local API token should be available');
    return { harness, port, token: meta.body.localApiToken, calls };
}

test('creating a SOP task probes only the selected SOP', async (t) => {
    const { port, token, calls } = await startHarness(t);

    const response = await request(port, 'POST', '/api/todo', {
        token, body: { skillId: 'probe_fixture_beta' },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(calls, [{ commands: ['Write-Output check-1'], phase: 'check' }]);
    assert.equal(response.body.task.skillId, 'probe_fixture_beta');
    assert.equal(response.body.task.action, 'install');
    assert.equal(response.body.task.title, '📦 Probe fixture 2');
    assert.equal(response.body.task.status, 'pending');
    assert.equal(response.body.todoList.length, 1);
    assert.equal(Object.hasOwn(response.body.todoList[0], 'logs'), false);
});

test('an explicit action skips the state probe entirely', async (t) => {
    const { port, token, calls } = await startHarness(t);

    const response = await request(port, 'POST', '/api/todo', {
        token, body: { skillId: 'probe_fixture_gamma', action: 'install' },
    });

    assert.equal(response.body.success, true);
    assert.deepEqual(calls, []);
    assert.equal(response.body.task.action, 'install');
});

test('a manual task without a SOP probes nothing', async (t) => {
    const { port, token, calls } = await startHarness(t);

    const response = await request(port, 'POST', '/api/todo', {
        token, body: { title: 'Manual task', description: 'Typed by the user' },
    });

    assert.equal(response.body.success, true);
    assert.deepEqual(calls, []);
    assert.equal(response.body.task.title, 'Manual task');
    assert.equal(response.body.task.description, 'Typed by the user');
    assert.equal(response.body.task.skillId, null);
});

test('an installed SOP still resolves to uninstall with a single probe', async (t) => {
    const { port, token, calls } = await startHarness(t, { installed: true });

    const response = await request(port, 'POST', '/api/todo', {
        token, body: { skillId: 'probe_fixture_alpha' },
    });

    assert.equal(response.body.success, true);
    assert.equal(calls.length, 1);
    assert.equal(response.body.task.action, 'uninstall');
    assert.equal(response.body.task.title, '🗑️ Uninstall Probe fixture 1');
});

test('a second task for the same SOP reuses the cached state', async (t) => {
    const { port, token, calls } = await startHarness(t);

    await request(port, 'POST', '/api/todo', { token, body: { skillId: 'probe_fixture_beta' } });
    const second = await request(port, 'POST', '/api/todo', { token, body: { skillId: 'probe_fixture_beta' } });

    assert.equal(second.body.success, true);
    assert.equal(second.body.todoList.length, 2);
    assert.equal(calls.length, 1, 'the 30s state cache should still absorb the repeat');
});

test('the SOP list endpoint still annotates every SOP', async (t) => {
    const { port, token, calls } = await startHarness(t);

    const response = await request(port, 'GET', '/api/sops', { token });

    assert.equal(response.status, 200);
    assert.equal(response.body.sops.length, SOP_IDS.length);
    assert.equal(calls.length, SOP_IDS.length);
    assert.ok(calls.every((call) => call.phase === 'check'));
    for (const sop of response.body.sops) {
        assert.equal(sop.installed, false);
        assert.equal(sop.recommendedAction, 'install');
        assert.equal(sop.supportsUninstall, true);
    }
});