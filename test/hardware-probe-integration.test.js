'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

function apiRequest(port, route, { method = 'GET', token, body, signal } = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path: route, method, agent: false, signal,
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
                resolve({ status: res.statusCode, raw, body: parsed });
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
    const meta = await apiRequest(port, '/api/meta');
    assert.equal(meta.status, 200, meta.raw);
    assert.ok(meta.body.localApiToken);
    return { harness, port, token: meta.body.localApiToken };
}

async function waitFor(predicate, label) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(`Timed out waiting for ${label}`);
}

function remoteSession() {
    return {
        id: 'hardware-session',
        status: 'active',
        host: '192.0.2.30',
        peer: { machineName: 'PEER-PC', userName: 'peer-user', agentName: 'Peer AI', locale: 'zh-TW' },
        messages: [],
    };
}

test('local AI remote hardware replies reuse the already collected health context', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setRemoteSession(remoteSession());

    const response = await apiRequest(port, '/api/remote/session/hardware-session/message', {
        method: 'POST', token, body: { mode: 'local-ai', text: '硬碟剩多少空間？', locale: 'zh-TW' },
    });
    const payload = response.body;

    assert.equal(response.status, 200, response.raw);
    assert.equal(payload.success, true);
    assert.deepEqual(harness.healthCalls, [{ hasSignal: false, aborted: false }]);
    assert.equal(harness.llmCalls.length, 0, 'hardware status is answered locally');
    const replies = harness.getRemoteMessages().filter((entry) => entry.method === 'sendChatMessage' && entry.payload.senderType === 'ai');
    assert.equal(replies.length, 1);
    assert.match(replies[0].payload.text, /CONSENT-FIXTURE-PC/);
});

test('local chat hardware probes receive the request abort signal', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.setReplies(['Fixture hardware summary']);

    const response = await apiRequest(port, '/api/chat', {
        method: 'POST', token, body: { message: '硬碟剩多少空間？', locale: 'zh-TW' },
    });
    const payload = response.body;

    assert.equal(response.status, 200, response.raw);
    assert.equal(payload.success, true);
    assert.deepEqual(harness.healthCalls, [{ hasSignal: true, aborted: false }]);
    assert.equal(harness.llmCalls.length, 1);
});

test('aborting local chat cancels the hardware probe before the LLM starts', async (t) => {
    const { harness, port, token } = await startHarness(t);
    let healthSignal = null;
    harness.setHealthHook(({ signal }) => {
        healthSignal = signal;
        return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
    });

    const controller = new AbortController();
    const request = apiRequest(port, '/api/chat', {
        method: 'POST', token, body: { message: '硬碟剩多少空間？', locale: 'zh-TW' }, signal: controller.signal,
    });
    const rejection = assert.rejects(request, (error) => error.name === 'AbortError');
    await waitFor(() => harness.healthCalls.length === 1, 'local hardware probe start');
    controller.abort();
    await rejection;
    await waitFor(() => healthSignal?.aborted, 'server-side hardware probe cancellation');

    assert.equal(healthSignal?.aborted, true);
    assert.equal(harness.llmCalls.length, 0, 'cancelled chat must not continue to the LLM');
});
