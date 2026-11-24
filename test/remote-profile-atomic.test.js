'use strict';
// saveRemoteProfile() 先寫 remote-profile.json.<pid>.tmp 再 rename：寫入中途失敗不可截斷既有身份檔。
// 走真實 HTTP 與隔離 harness（in-memory fs），不觸碰使用者真實的 AppData。
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

function profileFilePath(harness) {
    const target = Object.keys(harness.getFiles())
        .find((file) => path.basename(file) === 'remote-profile.json' && !file.endsWith('.tmp'));
    assert.ok(target, 'expected the harness to have persisted remote-profile.json');
    return target;
}

function tempFiles(harness, profileFile) {
    const dir = path.dirname(profileFile);
    return Object.keys(harness.getFiles()).filter((file) => path.dirname(file) === dir
        && path.basename(file).startsWith('remote-profile.json.')
        && file.endsWith('.tmp'));
}

const ENOSPC = () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });

function assertJsonFailure(res, label) {
    assert.equal(res.status, 500, `${label}: must answer 500`);
    assert.ok(res.body, `${label}: expected JSON, got ${res.contentType} :: ${res.raw.slice(0, 160)}`);
    assert.equal(res.body.success, false, `${label}: success must be false`);
    assert.match(String(res.body.error), /ENOSPC/, `${label}: error must name the real cause`);
    assert.doesNotMatch(res.raw, /at .*\.js:\d+/, `${label}: must not leak a stack trace`);
    assert.doesNotMatch(res.raw, /<!DOCTYPE|<html/i, `${label}: must not be an HTML error page`);
}

test('a saved profile is written once and leaves no temp file behind', async (t) => {
    const { harness, port, token } = await startHarness(t);
    const saved = await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'Atomic User' } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.success, true);
    assert.equal(saved.body.profile.userName, 'Atomic User');

    const profileFile = profileFilePath(harness);
    const parsed = JSON.parse(harness.getFiles()[profileFile]);
    assert.equal(parsed.userName, 'Atomic User');
    assert.equal(typeof parsed.machineName, 'string');
    assert.equal(typeof parsed.agentName, 'string');
    assert.deepEqual(tempFiles(harness, profileFile), [], 'a successful save must not leave a .tmp file');
});

test('a failure while writing the temp file keeps the original profile intact', async (t) => {
    const { harness, port, token } = await startHarness(t);
    const first = await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'Original User' } });
    assert.equal(first.body.success, true);
    const profileFile = profileFilePath(harness);
    const original = harness.getFiles()[profileFile];

    harness.failWrites((file) => (path.basename(file).startsWith('remote-profile.json.') && file.endsWith('.tmp') ? ENOSPC() : null));
    const failed = await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'Should Not Stick' } });
    assertJsonFailure(failed, 'POST /api/remote/profile (temp write)');

    assert.equal(harness.getFiles()[profileFile], original, 'the original profile must not be truncated or rewritten');
    assert.deepEqual(tempFiles(harness, profileFile), [], 'the failed temp file must be cleaned up');
    const current = await request(port, 'GET', '/api/remote/profile', { token });
    assert.equal(current.body.profile.userName, 'Original User', 'the on-disk profile must still be the original');
});

test('a failure at the rename step keeps the original profile intact', async (t) => {
    const { harness, port, token } = await startHarness(t);
    const first = await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'Original User' } });
    assert.equal(first.body.success, true);
    const profileFile = profileFilePath(harness);
    const original = harness.getFiles()[profileFile];

    // 只讓「置換成遠端身份檔」這一步失敗：暫存檔已寫滿，但 rename 失敗（等同檔案被鎖住）。
    harness.failWrites((file) => (file === profileFile ? ENOSPC() : null));
    const failed = await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'Should Not Stick' } });
    assertJsonFailure(failed, 'POST /api/remote/profile (rename)');

    assert.equal(harness.getFiles()[profileFile], original, 'a failed rename must not touch the original profile');
    assert.deepEqual(tempFiles(harness, profileFile), [], 'the fully written temp file must be cleaned up');
});

test('saving recovers as soon as the disk is writable again', async (t) => {
    const { harness, port, token } = await startHarness(t);
    await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'Original User' } });
    const profileFile = profileFilePath(harness);

    harness.failWrites(() => ENOSPC());
    const failed = await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'Blocked' } });
    assertJsonFailure(failed, 'POST /api/remote/profile (full disk)');

    harness.failWrites(null);
    const saved = await request(port, 'POST', '/api/remote/profile', { token, body: { userName: 'Recovered User' } });
    assert.equal(saved.body.success, true);
    assert.equal(JSON.parse(harness.getFiles()[profileFile]).userName, 'Recovered User');
    assert.deepEqual(tempFiles(harness, profileFile), [], 'no temp file may remain after recovery');
});
