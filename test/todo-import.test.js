'use strict';
// 任務匯入端點 — 走真實 HTTP 與隔離 harness，不讀寫使用者 APPDATA、不執行子程序。
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
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

const IMPORTED_TASK = {
    id: 'imported-fixture-task',
    title: 'Synthetic imported task',
    skillId: 'import_fixture_sop',
    action: 'install',
    category: 'Test',
    status: 'pending',
    progress: 0,
    logs: [],
    createdAt: '2026-10-29T00:00:00.000Z',
};

test('import replaces the task list and returns it to the caller', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([{
        id: 'preexisting-task', title: 'Pre-existing', skillId: 'pre_sop', action: 'install',
        category: 'Test', status: 'pending', progress: 0, logs: [],
        createdAt: '2026-10-28T00:00:00.000Z',
    }]);

    const response = await request(port, 'POST', '/api/todo/import', {
        token,
        body: { tasks: [IMPORTED_TASK] },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.todoList.length, 1);
    assert.equal(response.body.todoList[0].id, 'imported-fixture-task');

    const list = await request(port, 'GET', '/api/todo', { token });
    assert.equal(list.body.todoList.map((task) => task.id).join(','), 'imported-fixture-task');
    assert.equal(harness.getState().todoList.map((task) => task.id).join(','), 'imported-fixture-task');
});

test('import rejects a payload that does not carry an array of tasks', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([IMPORTED_TASK]);

    const response = await request(port, 'POST', '/api/todo/import', {
        token,
        body: { tasks: { exportedAt: '2026-10-29T00:00:00.000Z' } },
    });
    assert.equal(response.body.success, false);
    assert.match(response.body.error, /Invalid format/);
    assert.equal(harness.getState().todoList.map((task) => task.id).join(','), 'imported-fixture-task');
});

test('import is refused while a task is running', async (t) => {
    const { harness, port, token } = await startHarness(t);
    const runningTask = { ...IMPORTED_TASK, id: 'running-task', status: 'running' };
    harness.setTasks([runningTask], 'running-task');

    const response = await request(port, 'POST', '/api/todo/import', {
        token,
        body: { tasks: [{ ...IMPORTED_TASK, id: 'blocked-task' }] },
    });
    assert.equal(response.body.success, false);
    assert.match(response.body.error, /running/);
    assert.equal(harness.getState().todoList.map((task) => task.id).join(','), 'running-task');
});

const TASKS_RELATIVE = path.join('appdata', 'visual-agent', 'tasks.json');

function tasksFile(harness) {
    return harness.getFiles()[path.join(harness.sandboxRoot, TASKS_RELATIVE)];
}

// 不良元素一旦落地，publicTodoList() 的解構會在每次輪詢拋錯，工作清單永久 500 且重啟也救不回來。
const MALFORMED_IMPORTS = [
    ['a null element', [null], /expected an object/],
    ['a string element', ['oops'], /expected an object/],
    ['an array element', [[]], /expected an object/],
    ['a task without an id', [{ title: 'no id' }], /missing a task id/],
    ['duplicate task ids', [IMPORTED_TASK, { ...IMPORTED_TASK }], /Duplicate task id/],
    ['logs that are not an array', [{ ...IMPORTED_TASK, logs: 'broken' }], /logs must be an array/],
    ['an unknown status', [{ ...IMPORTED_TASK, status: 'paused' }], /unknown status/],
];

for (const [label, tasks, expectedError] of MALFORMED_IMPORTS) {
    test(`import rejects ${label} without touching the stored list`, async (t) => {
        const { harness, port, token } = await startHarness(t);
        harness.setTasks([IMPORTED_TASK]);
        const before = tasksFile(harness);

        const response = await request(port, 'POST', '/api/todo/import', { token, body: { tasks } });
        assert.equal(response.status, 200);
        assert.equal(response.body.success, false);
        assert.match(response.body.error, expectedError);

        assert.equal(tasksFile(harness), before, 'a rejected import must not rewrite tasks.json');
        assert.deepEqual(Array.from(harness.getState().todoList.map((task) => task.id)), ['imported-fixture-task']);

        const list = await request(port, 'GET', '/api/todo', { token });
        assert.equal(list.status, 200, 'the work list must keep polling after a rejected import');
        assert.equal(list.body.todoList.length, 1);

        const detail = await request(port, 'GET', '/api/task/imported-fixture-task/status', { token });
        assert.equal(detail.status, 200);
        assert.equal(detail.body.task.id, 'imported-fixture-task');
    });
}

test('an imported running task is reconciled instead of staying stuck', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([]);

    const response = await request(port, 'POST', '/api/todo/import', {
        token,
        body: { tasks: [{ ...IMPORTED_TASK, id: 'interrupted-import', status: 'running', progress: 40 }] },
    });
    assert.equal(response.body.success, true);
    assert.equal(response.body.todoList[0].status, 'failed', 'nothing is running in this process');
    assert.equal(response.body.todoList[0].progress, 40);

    const detail = await request(port, 'GET', '/api/task/interrupted-import/status', { token });
    const logs = detail.body.task.logs;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].message, /interrupted/i);

    const exported = await request(port, 'GET', '/api/todo/export', { token });
    assert.equal(exported.body.tasks[0].status, 'failed', 'the reconciliation must be persisted');
    assert.equal(JSON.parse(tasksFile(harness)).todoList[0].status, 'failed');
});

test('a well-formed export payload round-trips through import', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([{ ...IMPORTED_TASK, status: 'success', progress: 100, logs: [{ level: 'success', message: 'done', timestamp: '2026-10-29T00:00:09.000Z' }] }]);

    const exported = await request(port, 'GET', '/api/todo/export', { token });
    const response = await request(port, 'POST', '/api/todo/import', { token, body: exported.body });
    assert.equal(response.body.success, true);
    assert.equal(response.body.count, 1);

    const detail = await request(port, 'GET', '/api/task/imported-fixture-task/status', { token });
    assert.equal(detail.body.task.logs.length, 1, 'a valid export must keep its execution history');
    assert.equal(detail.body.task.status, 'success');
});
