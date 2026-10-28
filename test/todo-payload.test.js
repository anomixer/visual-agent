'use strict';
// /api/todo 清單省略任務 logs；詳情與匯出仍保留 — 走真實 HTTP 與隔離 harness。
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

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

async function startHarness(t) {
    const harness = createChatHarness();
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
    return { harness, port, token: meta.body.localApiToken };
}

const LOG_ENTRIES = [
    { level: 'info', message: 'synthetic step one', timestamp: '2026-10-29T00:00:01.000Z', type: 'info' },
    { level: 'warn', message: 'synthetic step two', timestamp: '2026-10-29T00:00:02.000Z', type: 'warn' },
];

const TASK = {
    id: 'logs-fixture-task',
    title: 'Synthetic task with logs',
    skillId: 'logs_fixture_sop',
    action: 'install',
    category: 'Test',
    status: 'success',
    progress: 100,
    logs: LOG_ENTRIES,
    createdAt: '2026-10-29T00:00:00.000Z',
    completedAt: '2026-10-29T00:00:03.000Z',
};

test('todo list omits task logs while detail and export keep them', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([TASK]);

    const list = await request(port, 'GET', '/api/todo', { token });
    assert.equal(list.status, 200);
    assert.equal(list.body.todoList.length, 1);
    const listed = list.body.todoList[0];
    assert.equal(listed.id, TASK.id);
    assert.equal(listed.title, TASK.title);
    assert.equal(listed.status, TASK.status);
    assert.equal(Object.prototype.hasOwnProperty.call(listed, 'logs'), false, 'list payload must not carry logs');
    assert.doesNotMatch(JSON.stringify(list.body), /synthetic step/);

    const detail = await request(port, 'GET', `/api/task/${TASK.id}/status`, { token });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.task.logs, LOG_ENTRIES, 'task detail must still return the full log');

    const exported = await request(port, 'GET', '/api/todo/export', { token });
    assert.equal(exported.status, 200);
    assert.deepEqual(exported.body.tasks[0].logs, LOG_ENTRIES, 'export must still contain the log history');
});

test('delete and import responses use the same log-free list shape', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([TASK, { ...TASK, id: 'logs-fixture-second', title: 'Second task', logs: [] }]);

    const removed = await request(port, 'DELETE', '/api/todo/logs-fixture-second', { token });
    assert.equal(removed.body.success, true);
    assert.equal(removed.body.todoList.length, 1);
    assert.equal(removed.body.todoList[0].id, TASK.id);
    removed.body.todoList.forEach((task) => {
        assert.equal(Object.prototype.hasOwnProperty.call(task, 'logs'), false);
    });

    const imported = await request(port, 'POST', '/api/todo/import', {
        token,
        body: { tasks: [TASK] },
    });
    assert.equal(imported.body.success, true);
    assert.equal(Object.prototype.hasOwnProperty.call(imported.body.todoList[0], 'logs'), false);

    const detail = await request(port, 'GET', `/api/task/${TASK.id}/status`, { token });
    assert.deepEqual(detail.body.task.logs, LOG_ENTRIES, 'server must keep logs after list responses');
});
