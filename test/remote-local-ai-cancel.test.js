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
    harness.setRemoteSession({
        id: 'local-ai-session',
        status: 'active',
        host: '192.0.2.40',
        peer: {
            machineName: 'PEER-PC', userName: 'peer-user', agentName: 'Peer AI',
            ip: '192.0.2.40', locale: 'zh-TW',
        },
        messages: [],
    });
    return { harness, port, token: meta.body.localApiToken };
}

async function waitFor(predicate, label) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(`Timed out waiting for ${label}`);
}

async function settleRoute() {
    for (let index = 0; index < 4; index += 1) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

function deferred() {
    let resolve;
    const promise = new Promise((yes) => { resolve = yes; });
    return { promise, resolve };
}

function requestBody(text = 'Please answer this question.') {
    return {
        mode: 'local-ai', target: 'remote-user', text, locale: 'en-US', skipUserEcho: true,
    };
}

test('successful local AI work shares the request signal and may invite a peer continuation', async (t) => {
    const { harness, port, token } = await startHarness(t);
    let healthSignal = null;
    let llmSignal = null;
    harness.setHealthHook(({ signal }) => { healthSignal = signal; });
    harness.setChatHook(({ signal }) => { llmSignal = signal; });
    harness.setReplies(['Your turn, please continue from here.']);

    const response = await apiRequest(port, '/api/remote/session/local-ai-session/message', {
        method: 'POST', token, body: requestBody(),
    });

    assert.equal(response.status, 200, response.raw);
    assert.equal(response.body.success, true);
    assert.deepEqual(harness.healthCalls, [{ hasSignal: true, aborted: false }]);
    assert.equal(harness.llmCalls.length, 1);
    assert.equal(harness.llmCalls[0].aborted, false);
    assert.ok(healthSignal, 'hardware probing must receive a server-side signal');
    assert.strictEqual(llmSignal, healthSignal, 'hardware and LLM work must share request cancellation');
    const messages = harness.getRemoteMessages();
    assert.deepEqual(messages.filter((entry) => entry.method === 'sendChatMessage').map((entry) => entry.payload.target), [
        'remote-user', 'remote-ai',
    ]);
    assert.deepEqual(messages.filter((entry) => entry.method === 'sendAiStatus').map((entry) => entry.payload.status), [
        'thinking', 'idle',
    ]);
    harness.assertSafe();
});

test('aborting during hardware probing cancels the signal and suppresses the local reply', async (t) => {
    const { harness, port, token } = await startHarness(t);
    const healthGate = deferred();
    let healthSignal = null;
    harness.setHealthHook(({ signal }) => {
        healthSignal = signal;
        return healthGate.promise;
    });

    const controller = new AbortController();
    const request = apiRequest(port, '/api/remote/session/local-ai-session/message', {
        method: 'POST', token, body: requestBody('硬碟剩多少空間？'), signal: controller.signal,
    });
    const rejection = assert.rejects(request, (error) => error.name === 'AbortError');
    try {
        await waitFor(() => harness.healthCalls.length === 1, 'remote local AI hardware probe start');
        controller.abort();
        await rejection;
        await waitFor(() => healthSignal?.aborted, 'server-side hardware probe cancellation');
        assert.equal(healthSignal.aborted, true);
        assert.equal(harness.llmCalls.length, 0, 'cancelled hardware work must not reach the LLM');
    } finally {
        healthGate.resolve();
        await settleRoute();
    }

    const messages = harness.getRemoteMessages();
    assert.equal(messages.some((entry) => entry.method === 'sendChatMessage'), false, 'a late hardware reply must not be sent');
    assert.deepEqual(messages.filter((entry) => entry.method === 'sendAiStatus').map((entry) => entry.payload.status), [
        'thinking', 'idle',
    ]);
    harness.assertSafe();
});

test('aborting a pending LLM suppresses a late reply and peer continuation even if the provider ignores abort', async (t) => {
    const { harness, port, token } = await startHarness(t);
    const llmGate = deferred();
    let llmSignal = null;
    harness.setChatHook(({ signal }) => {
        llmSignal = signal;
        return llmGate.promise;
    });
    harness.setReplies(['Your turn, please continue from here.']);

    const controller = new AbortController();
    const request = apiRequest(port, '/api/remote/session/local-ai-session/message', {
        method: 'POST', token, body: requestBody(), signal: controller.signal,
    });
    const rejection = assert.rejects(request, (error) => error.name === 'AbortError');
    try {
        await waitFor(() => harness.llmCalls.length === 1, 'remote local AI LLM start');
        controller.abort();
        await rejection;
        await waitFor(() => llmSignal?.aborted, 'server-side LLM cancellation');
        assert.equal(llmSignal.aborted, true);
    } finally {
        llmGate.resolve();
        await settleRoute();
    }

    const messages = harness.getRemoteMessages();
    assert.equal(messages.some((entry) => entry.method === 'sendChatMessage'), false, 'late AI output must not reach the peer');
    assert.equal(messages.some((entry) => entry.method === 'sendSystemMessage'), false, 'cancellation must not become a visible remote failure');
    assert.deepEqual(messages.filter((entry) => entry.method === 'sendAiStatus').map((entry) => entry.payload.status), [
        'thinking', 'idle',
    ]);
    harness.assertSafe();
});
