'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

async function setup(t) {
    const harness = createChatHarness();
    let server;
    t.after(async () => {
        try {
            if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } finally {
            harness.dispose();
            harness.assertSafe();
        }
    });
    server = harness.app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
    });
    let token = '';
    async function request(method, route, body) {
        const payload = body === undefined ? null : JSON.stringify(body);
        return new Promise((resolve, reject) => {
            const req = http.request({
                host: '127.0.0.1', port: server.address().port, path: route, method,
                agent: false,
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
                    catch { reject(new Error(`Non-JSON ${res.statusCode} from ${route}: ${raw.slice(0, 300)}`)); }
                });
            });
            req.setTimeout(5000, () => req.destroy(new Error(`Timed out: ${route}`)));
            req.on('error', reject);
            req.end(payload);
        });
    }
    const meta = await request('GET', '/api/meta');
    assert.equal(meta.status, 200);
    token = meta.body.localApiToken;
    assert.ok(token);
    return { request };
}

test('remote state replies in full when no tick is supplied', async (t) => {
    const { request } = await setup(t);
    const response = await request('GET', '/api/remote/state');
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.ok(Number.isInteger(response.body.tick) && response.body.tick > 0);
    assert.ok(Array.isArray(response.body.sessions));
    assert.ok(response.body.profile && typeof response.body.profile.userName === 'string');
});

test('an unchanged tick returns only the revision marker', async (t) => {
    const { request } = await setup(t);
    const full = await request('GET', '/api/remote/state');
    const cached = await request('GET', `/api/remote/state?since=${full.body.tick}`);
    assert.equal(cached.status, 200);
    assert.deepEqual(cached.body, { success: true, tick: full.body.tick, unchanged: true });
});

test('state mutations bump the tick and force a full reply', async (t) => {
    const { request } = await setup(t);
    const first = await request('GET', '/api/remote/state');

    const saved = await request('POST', '/api/remote/profile', { userName: 'Fixture User' });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.success, true);

    const stale = await request('GET', `/api/remote/state?since=${first.body.tick}`);
    assert.equal(stale.status, 200);
    assert.equal(stale.body.unchanged, undefined);
    assert.equal(stale.body.tick, first.body.tick + 1);
    assert.ok(Array.isArray(stale.body.sessions));
    assert.equal(stale.body.profile.userName, 'Fixture User');

    const fresh = await request('GET', `/api/remote/state?since=${stale.body.tick}`);
    assert.deepEqual(fresh.body, { success: true, tick: stale.body.tick, unchanged: true });
});

test('a non-numeric since value falls back to the full payload', async (t) => {
    const { request } = await setup(t);
    const response = await request('GET', '/api/remote/state?since=abc');
    assert.equal(response.status, 200);
    assert.equal(response.body.unchanged, undefined);
    assert.ok(Array.isArray(response.body.sessions));
});
