'use strict';
// 執行狀態只存在記憶體；重啟後仍標為 running 的任務必須被 reconciled，否則會永久卡住刪除與清空。
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

const TASKS_RELATIVE = path.join('appdata', 'visual-agent', 'tasks.json');

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

async function startHarness(t, tasks) {
    const seeded = JSON.stringify({ todoList: tasks, exportedAt: '2026-10-29T00:00:00.000Z' }, null, 2);
    const harness = createChatHarness({ seedFiles: { [TASKS_RELATIVE]: seeded } });
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
    return { harness, port, token: meta.body.localApiToken, seeded };
}

const PRIOR_LOGS = [
    { level: 'info', message: 'check phase started', timestamp: '2026-10-29T00:00:01.000Z' },
    { level: 'info', message: 'install phase started', timestamp: '2026-10-29T00:00:02.000Z' },
];

const INTERRUPTED = {
    id: 'interrupted-task',
    title: 'Synthetic interrupted task',
    skillId: 'interrupted_fixture_sop',
    action: 'install',
    category: 'Test',
    status: 'running',
    progress: 40,
    logs: PRIOR_LOGS,
    createdAt: '2026-10-29T00:00:00.000Z',
    completedAt: null,
};

const PENDING = { ...INTERRUPTED, id: 'pending-task', status: 'pending', progress: 0, logs: [] };
const DONE_LOGS = [{ level: 'success', message: 'finished before the restart', timestamp: '2026-10-29T00:00:09.000Z' }];
const DONE = { ...INTERRUPTED, id: 'done-task', status: 'success', progress: 100, logs: DONE_LOGS, completedAt: '2026-10-29T00:00:09.000Z' };

test('a task persisted as running is reconciled to failed on startup', async (t) => {
    const { port, token } = await startHarness(t, [INTERRUPTED, PENDING, DONE]);

    const list = await request(port, 'GET', '/api/todo', { token });
    assert.equal(list.status, 200);
    const byId = Object.fromEntries(list.body.todoList.map((task) => [task.id, task]));
    assert.equal(byId['interrupted-task'].status, 'failed', 'a restart cannot leave a task running');
    assert.equal(byId['interrupted-task'].progress, 40, 'progress must still show where it stopped');
    assert.equal(byId['pending-task'].status, 'pending');
    assert.equal(byId['done-task'].status, 'success');

    const detail = await request(port, 'GET', '/api/task/interrupted-task/status', { token });
    assert.equal(detail.status, 200);
    const logs = detail.body.task.logs;
    assert.equal(logs.length, PRIOR_LOGS.length + 1, 'prior history must survive and gain one interruption entry');
    assert.deepEqual(logs.slice(0, PRIOR_LOGS.length), PRIOR_LOGS);
    assert.equal(logs[logs.length - 1].level, 'error');
    assert.match(logs[logs.length - 1].message, /interrupted/i);
    assert.ok(!Number.isNaN(Date.parse(logs[logs.length - 1].timestamp)));
    assert.equal(detail.body.task.completedAt, null, 'do not fabricate a completion time');
});

test('the reconciled task is deletable and no longer exported as running', async (t) => {
    const { port, token } = await startHarness(t, [INTERRUPTED]);

    const exported = await request(port, 'GET', '/api/todo/export', { token });
    assert.equal(exported.body.tasks[0].status, 'failed');

    const removed = await request(port, 'DELETE', '/api/todo/interrupted-task', { token });
    assert.equal(removed.body.success, true);
    assert.equal(removed.body.todoList.length, 0);
});

test('a task file without running tasks is left untouched', async (t) => {
    const { harness, port, token, seeded } = await startHarness(t, [PENDING, DONE]);

    const list = await request(port, 'GET', '/api/todo', { token });
    assert.deepEqual(list.body.todoList.map((task) => task.status), ['pending', 'success']);

    const detail = await request(port, 'GET', '/api/task/done-task/status', { token });
    assert.deepEqual(detail.body.task.logs, DONE_LOGS, 'no interruption entry may be added to a healthy task');

    const onDisk = harness.getFiles()[path.join(harness.sandboxRoot, TASKS_RELATIVE)];
    assert.equal(onDisk, seeded, 'startup must not rewrite a healthy task file');
});