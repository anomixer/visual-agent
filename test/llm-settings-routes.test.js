'use strict';
// LLM 設定寫檔失敗時，端點不得宣稱已儲存，chat 的 SWITCH_MODEL 也不得讓整段回覆變成 500。
// llm.js 自身的回滾行為由 test/llm-config-save.test.js 以真實模組覆蓋；這裡走真實 HTTP 與隔離 harness。
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

const SESSION = 'llm-settings-session-38';
const SWITCH = 'SWITCH_MODEL name="probe-model"';
const tag = (action) => `[ACTION:${action}]`;
const WRITE_ERROR = 'EISDIR: illegal operation on a directory, open config.json';

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
    const token = meta.body.localApiToken;
    const chat = (body = {}) => request(port, 'POST', '/api/chat', {
        token,
        body: { message: 'Review the synthetic fixture.', locale: 'en-US', localChatSessionId: SESSION, ...body },
    });
    return { harness, port, token, chat };
}

function assertJsonFailure(response, label) {
    assert.equal(response.status, 500, `${label}: ${response.raw}`);
    assert.match(response.contentType, /application\/json/);
    assert.equal(response.body.success, false);
    assert.match(response.body.error, /EISDIR/);
    assert.doesNotMatch(response.raw, /<!DOCTYPE|<html/i);
    assert.doesNotMatch(response.raw, /at .*\.js:\d+/);
}

const SETTINGS_BODY = {
    provider: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    authConfig: { type: 'api_key', apiKey: 'sk-route-test' },
    model: 'gpt-4o-mini',
    visionModel: '',
};

test('a failed settings save reports the real cause instead of Settings saved', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.failSettings(new Error(WRITE_ERROR));
    const response = await request(port, 'POST', '/api/llm/config', { token, body: SETTINGS_BODY });
    assertJsonFailure(response, 'POST /api/llm/config');
    assert.doesNotMatch(response.raw, /Settings saved/);
});

test('a failed model switch reports the real cause', async (t) => {
    const { harness, port, token } = await startHarness(t);
    harness.failSettings(new Error(WRITE_ERROR));
    const response = await request(port, 'POST', '/api/llm/model', { token, body: { modelName: 'probe-model' } });
    assertJsonFailure(response, 'POST /api/llm/model');
    assert.deepEqual(harness.modelSwitches, ['probe-model']);
});

test('both settings endpoints still succeed when the write works', async (t) => {
    const { harness, port, token } = await startHarness(t);
    const config = await request(port, 'POST', '/api/llm/config', { token, body: SETTINGS_BODY });
    assert.equal(config.status, 200, config.raw);
    assert.equal(config.body.success, true);
    assert.equal(config.body.message, 'Settings saved');
    const model = await request(port, 'POST', '/api/llm/model', { token, body: { modelName: 'probe-model' } });
    assert.equal(model.status, 200, model.raw);
    assert.equal(model.body.success, true);
    assert.deepEqual(harness.modelSwitches, ['probe-model']);
    harness.failSettings(new Error(WRITE_ERROR));
    const blocked = await request(port, 'POST', '/api/llm/model', { token, body: { modelName: 'probe-model' } });
    assertJsonFailure(blocked, 'POST /api/llm/model after the disk became unwritable');
    harness.failSettings(null);
    const recovered = await request(port, 'POST', '/api/llm/model', { token, body: { modelName: 'probe-model' } });
    assert.equal(recovered.status, 200, recovered.raw);
});

async function proposeSwitch(client) {
    client.harness.setReplies([tag(SWITCH)]);
    const proposed = await client.chat();
    assert.equal(proposed.status, 200, proposed.raw);
    const pending = (proposed.body.pendingActions || []).filter((action) => action.action === 'switch_model');
    assert.equal(pending.length, 1, `Expected one pending SWITCH_MODEL: ${proposed.raw}`);
    assert.deepEqual(client.harness.modelSwitches, [], 'No model switch before consent');
    return pending[0];
}

test('an approved SWITCH_MODEL that cannot be saved still answers the chat', async (t) => {
    const client = await startHarness(t);
    const approval = await proposeSwitch(client);
    client.harness.failSettings(new Error(WRITE_ERROR));
    const confirmed = await client.chat({ message: 'Confirm the proposed action.', approvedActionId: approval.id });
    assert.equal(confirmed.status, 200, confirmed.raw);
    assert.equal(confirmed.body.success, true);
    const reply = String(confirmed.body.reply || '');
    assert.match(reply, /Could not switch model to probe-model/);
    assert.match(reply, /EISDIR/);
    assert.doesNotMatch(reply, /Switched model to/);
    assert.deepEqual(client.harness.modelSwitches, ['probe-model']);
});

test('an approved SWITCH_MODEL that saves reports the switch', async (t) => {
    const client = await startHarness(t);
    const approval = await proposeSwitch(client);
    const confirmed = await client.chat({ message: 'Confirm the proposed action.', approvedActionId: approval.id });
    assert.equal(confirmed.status, 200, confirmed.raw);
    assert.equal(confirmed.body.success, true);
    assert.match(String(confirmed.body.reply || ''), /Switched model to: probe-model/);
    assert.deepEqual(client.harness.modelSwitches, ['probe-model']);
});

console.log('[llm-settings-routes.test] settings failures stay visible without killing the chat reply');