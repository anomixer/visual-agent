'use strict';
// dynamicCmd 任務的虛擬 SOP 必須符合 sop-parser 結構，否則 executor 一執行就 crash。
// 使用真實 SOPExecutor，但一律 dryRun：不 spawn PowerShell、不提權、不碰使用者 APPDATA。
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');
const { SOPExecutor } = require('../src/sop-executor');

const TASK_ID = 'dynamic-cmd-fixture-task';
const DYNAMIC_CMD = 'Write-Output "synthetic dynamic command"';

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

function dynamicTask(overrides = {}) {
    return {
        id: TASK_ID,
        title: 'Synthetic dynamic command task',
        description: 'fixture only',
        dynamicCmd: DYNAMIC_CMD,
        skillId: null,
        action: 'install',
        category: 'Maintenance',
        status: 'pending',
        progress: 0,
        logs: [],
        createdAt: '2026-11-12T02:00:00.000Z',
        completedAt: null,
        ...overrides,
    };
}

async function startHarness(t, { captureSop } = {}) {
    const seen = [];
    class CapturingExecutor extends SOPExecutor {
        async execute(sop, options) {
            seen.push(JSON.parse(JSON.stringify({ sop, options })));
            if (captureSop) return { status: 'success' };
            return super.execute(sop, options);
        }
    }
    const harness = createChatHarness({ executor: CapturingExecutor });
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
    return { harness, seen, port, token: meta.body.localApiToken };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

test('the virtual SOP matches the parser shape the executor consumes', async (t) => {
    const { harness, seen, port, token } = await startHarness(t, { captureSop: true });
    harness.setReplies(['synthetic veteran note']);
    harness.setTasks([dynamicTask()]);

    const started = await request(port, 'POST', `/api/execute/${TASK_ID}`, { token, body: { dryRun: true } });
    assert.equal(started.body.success, true);
    await settle();

    assert.equal(seen.length, 1);
    const { sop, options } = seen[0];
    assert.equal(sop.id, TASK_ID);
    assert.equal(sop.name, 'Synthetic dynamic command task');
    assert.deepEqual(Object.keys(sop.steps).sort(), ['check', 'install', 'uninstall', 'verify']);
    // executor 對每個 command 呼叫 cmd.trim()，因此必須是字串而非 { type, content } 物件。
    assert.deepEqual(sop.steps.install.commands, [DYNAMIC_CMD]);
    assert.equal(typeof sop.steps.install.uiMessage, 'string');
    assert.ok(sop.steps.install.uiMessage.includes(DYNAMIC_CMD));
    for (const phase of ['check', 'uninstall', 'verify']) {
        assert.deepEqual(sop.steps[phase].commands, [], `${phase} should be an explicit empty phase`);
    }
    assert.deepEqual(sop.errorHandling, []);
    assert.equal(options.action, 'install');
});

test('a dynamic command task completes instead of crashing on a missing check phase', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setReplies(['synthetic veteran note']);
    harness.setTasks([dynamicTask()]);

    await request(port, 'POST', `/api/execute/${TASK_ID}`, { token, body: { dryRun: true } });
    await settle();

    const [task] = harness.getState().todoList;
    assert.equal(task.status, 'success', `expected success, got ${task.status}: ${task.logs.map((l) => l.message).join(' | ')}`);
    assert.equal(task.progress, 100);
    const messages = Array.from(task.logs.map((l) => l.message));
    assert.ok(!messages.some((m) => /Cannot read properties|trim is not a function/.test(m)), messages.join(' | '));
    assert.ok(messages.some((m) => m.includes('[DRY-RUN]') && m.includes(DYNAMIC_CMD)), 'the command should reach the dry-run runner');
    assert.ok(messages.some((m) => m.includes('執行動態指令')), 'the UI notice should be emitted');
    assert.equal(harness.getState().runningSOP, null);
});

test('a dynamic command task without a command still reports a clear refusal', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([dynamicTask({ dynamicCmd: null, skillId: null })]);

    const started = await request(port, 'POST', `/api/execute/${TASK_ID}`, { token, body: { dryRun: true } });
    assert.equal(started.body.success, false);
    assert.match(started.body.error, /no associated SOP/);
    assert.equal(harness.getState().todoList[0].status, 'pending');
});