'use strict';
// saveTasks() 失敗時不得回 HTML，也不得留下「記憶體有、磁碟沒有」的任務 — 走真實 HTTP 與隔離 harness。
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

function request(port, method, route, { token, body } = {}) {
    const payload = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
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
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch { /* 保留 raw 供斷言 */ }
                resolve({ status: res.statusCode, contentType: res.headers['content-type'] || '', raw, body: parsed });
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

const TASK = {
    id: 'save-failure-fixture',
    title: 'Synthetic persisted task',
    skillId: null,
    action: 'install',
    category: 'Test',
    status: 'pending',
    progress: 0,
    logs: [],
    createdAt: '2026-11-12T00:00:00.000Z',
    completedAt: null,
};

function tasksFilePath(harness) {
    const target = Object.keys(harness.getFiles()).find((file) => path.basename(file) === 'tasks.json');
    assert.ok(target, 'expected the harness to have persisted tasks.json');
    return target;
}

function siblingFilePath(harness, name) {
    return path.join(path.dirname(tasksFilePath(harness)), name);
}

// 只讓 tasks.json 的寫入失敗，其他檔案（debug.log、SOP）照常，重現磁碟滿或檔案被鎖住的情境。
// saveTasks() 先寫 tasks.json.<pid>.tmp 再 rename；harness 的 process.pid 是假值，因此用前綴比對。
function failTaskWrites(harness) {
    const target = tasksFilePath(harness);
    const enospc = () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    harness.failWrites((file) => (file.startsWith(target) ? enospc() : null));
}

function assertJsonFailure(res, label) {
    assert.ok(res.body, `${label}: expected JSON, got ${res.contentType} :: ${res.raw.slice(0, 160)}`);
    assert.equal(res.body.success, false, `${label}: success must be false`);
    assert.equal(typeof res.body.error, 'string', `${label}: error must be a string`);
    assert.match(res.body.error, /ENOSPC/, `${label}: error must name the real cause, got ${res.body.error}`);
    assert.doesNotMatch(res.raw, /at .*\.js:\d+/, `${label}: must not leak a stack trace`);
    assert.doesNotMatch(res.raw, /<!DOCTYPE|<html/i, `${label}: must not be an HTML error page`);
}

test('a failed task save reports JSON and does not invent a task', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([TASK]);
    failTaskWrites(harness);

    const created = await request(port, 'POST', '/api/todo', {
        token,
        body: { title: 'Cannot be persisted', description: 'synthetic', action: 'install', category: 'Test' },
    });
    assertJsonFailure(created, 'POST /api/todo');

    const list = await request(port, 'GET', '/api/todo', { token });
    assert.deepEqual(list.body.todoList.map((task) => task.id), [TASK.id],
        'the unsaved task must not survive in the in-memory list');
    // harness 在 vm realm 建立物件，跨 realm 的 deepEqual 會因原型不同而失敗，先 JSON 往返。
    assert.deepEqual(JSON.parse(JSON.stringify(harness.getState().todoList.map((task) => task.id))), [TASK.id]);
});

test('a failed delete keeps the task and reports JSON', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([TASK]);
    failTaskWrites(harness);

    const removed = await request(port, 'DELETE', `/api/todo/${TASK.id}`, { token });
    assertJsonFailure(removed, 'DELETE /api/todo/:id');

    const list = await request(port, 'GET', '/api/todo', { token });
    assert.deepEqual(list.body.todoList.map((task) => task.id), [TASK.id],
        'a delete that could not be persisted must be rolled back');
});

test('task writes recover once the disk is writable again', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([TASK]);
    failTaskWrites(harness);

    const failed = await request(port, 'POST', '/api/todo', { token, body: { title: 'Blocked', action: 'install' } });
    assertJsonFailure(failed, 'blocked POST');

    harness.failWrites(null);
    const created = await request(port, 'POST', '/api/todo', { token, body: { title: 'Now persisted', action: 'install' } });
    assert.equal(created.body.success, true);
    assert.equal(created.body.todoList.length, 2);
    assert.ok(harness.getFiles()[tasksFilePath(harness)].includes('Now persisted'));
});

test('a completely full disk still answers JSON even though debug logging fails too', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([TASK]);
    // 磁碟全滿：tasks.json 與 debug.log 都寫不進去。錯誤處理路徑自己也會拋錯，
    // 若 fileLog 不是 best-effort，真正的 ENOSPC 會被換成 HTML 500。
    harness.failWrites(() => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }));

    const created = await request(port, 'POST', '/api/todo', { token, body: { title: 'No space at all', action: 'install' } });
    assertJsonFailure(created, 'POST /api/todo with a full disk');

    const removed = await request(port, 'DELETE', `/api/todo/${TASK.id}`, { token });
    assertJsonFailure(removed, 'DELETE /api/todo/:id with a full disk');
    assert.equal(harness.getState().todoList.length, 1);
});

test('a malformed request body answers JSON with the parser status, not an HTML stack page', async (t) => {
    const { port, token } = await startHarness(t);
    // body-parser 拋錯後交給全域 error middleware；這是任何客戶端都觸發得到的路徑。
    const broken = await request(port, 'POST', '/api/llm/model', { token, body: '{"modelName": ' });
    assert.equal(broken.status, 400, 'the parser status must survive, not be flattened to 500');
    assert.ok(broken.body, `expected JSON, got ${broken.contentType} :: ${broken.raw.slice(0, 160)}`);
    assert.equal(broken.body.success, false);
    assert.equal(typeof broken.body.error, 'string');
    assert.doesNotMatch(broken.raw, /at .*\.js:\d+/, 'must not leak a stack trace');
    assert.doesNotMatch(broken.raw, /<!DOCTYPE|<html/i, 'must not be an HTML error page');
});

test('a route that throws without its own try/catch still answers JSON', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setTasks([TASK]);
    // POST /api/remote/profile 沒有自己的 try/catch，saveRemoteProfile() 的 writeFileSync
    // 一拋錯就直接落在路由 handler 外，這是真正「route 拋錯」的路徑（不是 body-parser）。
    const profileFile = siblingFilePath(harness, 'remote-profile.json');
    harness.failWrites((file) => (file === profileFile
        ? Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
        : null));

    const exploded = await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'probe' } });
    assert.equal(exploded.status, 500);
    assertJsonFailure(exploded, 'POST /api/remote/profile');
});

test('an unknown API endpoint answers JSON instead of an HTML 404 page', async (t) => {
    const { port, token } = await startHarness(t);
    // 舊版前端呼叫 /api/import（正確路徑是 /api/todo/import）就是踩到這條。
    const missing = await request(port, 'POST', '/api/import', { token, body: { tasks: [] } });
    assert.equal(missing.status, 404);
    assert.ok(missing.body, `expected JSON, got ${missing.contentType} :: ${missing.raw.slice(0, 160)}`);
    assert.equal(missing.body.success, false);
    assert.match(missing.body.error, /\/api\/import/, 'the error must name the endpoint that was not found');
    assert.doesNotMatch(missing.raw, /<!DOCTYPE|<html/i, 'must not be an HTML error page');
});

test('a non-string model name is rejected instead of being persisted', async (t) => {
    const { port, token } = await startHarness(t);
    for (const modelName of [{ nested: true }, 42, '', '   ', null]) {
        const res = await request(port, 'POST', '/api/llm/model', { token, body: { modelName } });
        assert.equal(res.status, 400, `modelName=${JSON.stringify(modelName)} must be rejected`);
        assert.ok(res.body, `expected JSON, got ${res.contentType}`);
        assert.equal(res.body.success, false);
        assert.equal(res.body.error, 'Missing modelName');
    }
});
