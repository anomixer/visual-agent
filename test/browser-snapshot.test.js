'use strict';
// Browser 分頁快照：session 開啟不重疊、畫面沒變不重送 base64 — 走真實 HTTP 與假 Playwright。
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const { test } = require('node:test');
const { createChatHarness } = require('./helpers/chat-harness');

const BROWSER_EXE_RELATIVE = path.join('appdata', 'visual-agent', 'playwright-browsers', 'chromium-1217', 'chrome-headless-shell.exe');
const PNG_V1 = 'fixture-png-bytes-v1';

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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await delay(5);
    }
    return predicate();
}

// 只實作 server 真正呼叫到的 Playwright 表面；不啟動任何真實瀏覽器。
function createFakePlaywright({ gateLaunch = false, gateContext = false, gatePage = false } = {}) {
    const stats = {
        launches: 0, contexts: 0, pages: 0, screenshots: 0, navigations: 0,
        browserCloses: 0, contextCloses: 0, pageCloses: 0,
    };
    let png = Buffer.from(PNG_V1);
    const gates = {
        launch: { enabled: gateLaunch, release: null, promise: null },
        context: { enabled: gateContext, release: null, promise: null },
        page: { enabled: gatePage, release: null, promise: null },
    };
    for (const gate of Object.values(gates)) {
        gate.promise = new Promise((resolve) => { gate.release = resolve; });
    }
    const waitForGate = (name) => gates[name].enabled ? gates[name].promise : Promise.resolve();
    const releaseGate = (name) => {
        gates[name].enabled = false;
        gates[name].release();
    };

    const makePage = () => ({
        isClosed: () => false,
        title: async () => 'Fixture page',
        url: () => 'https://example.com/fixture',
        screenshot: async () => { stats.screenshots += 1; return png; },
        goto: async () => { stats.navigations += 1; },
        goBack: async () => null,
        goForward: async () => null,
        reload: async () => null,
        close: async () => { stats.pageCloses += 1; },
    });
    const browser = {
        newContext: async () => {
            stats.contexts += 1;
            await waitForGate('context');
            return {
                newPage: async () => {
                    stats.pages += 1;
                    await waitForGate('page');
                    return makePage();
                },
                close: async () => { stats.contextCloses += 1; },
            };
        },
        close: async () => { stats.browserCloses += 1; },
    };

    return {
        stats,
        setPng: (next) => { png = Buffer.from(next); },
        releaseLaunch: () => releaseGate('launch'),
        releaseContext: () => releaseGate('context'),
        releasePage: () => releaseGate('page'),
        chromium: {
            launch: async () => {
                stats.launches += 1;
                await waitForGate('launch');
                return browser;
            },
        },
    };
}

async function startHarness(t, playwright) {
    const harness = createChatHarness({
        playwright,
        seedFiles: { [BROWSER_EXE_RELATIVE]: 'fixture executable placeholder' },
    });
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

function decodeSnapshot(dataUrl) {
    assert.match(dataUrl, /^data:image\/png;base64,/);
    return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64').toString('utf8');
}

test('concurrent session starts share one launch, context and page', async (t) => {
    const fake = createFakePlaywright({ gateLaunch: true });
    const { port, token } = await startHarness(t, fake);

    const first = request(port, 'POST', '/api/browser/session/start', { token, body: {} });
    const second = request(port, 'POST', '/api/browser/session/start', { token, body: {} });
    assert.ok(await waitUntil(() => fake.stats.launches >= 1), 'first start should reach chromium.launch');
    await delay(50);
    fake.releaseLaunch();

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.body.success, true);
    assert.equal(b.body.success, true);
    assert.equal(fake.stats.launches, 1, 'overlapping starts must not launch twice');
    assert.equal(fake.stats.contexts, 1, 'overlapping starts must not leak a context');
    assert.equal(fake.stats.pages, 1);
});

for (const stage of ['launch', 'context', 'page']) {
    test(`stop during a pending browser ${stage} closes late-created resources`, async (t) => {
        const gateKey = `gate${stage[0].toUpperCase()}${stage.slice(1)}`;
        const fake = createFakePlaywright({ [gateKey]: true });
        const { port, token } = await startHarness(t, fake);

        const starting = request(port, 'POST', '/api/browser/session/start', { token, body: {} });
        assert.ok(await waitUntil(() => stage === 'launch' ? fake.stats.launches >= 1
            : stage === 'context' ? fake.stats.contexts >= 1
                : fake.stats.pages >= 1), `start should reach the gated ${stage}`);
        const stopping = request(port, 'POST', '/api/browser/session/stop', { token, body: {} });
        await delay(30);
        if (stage === 'launch') fake.releaseLaunch();
        else if (stage === 'context') fake.releaseContext();
        else fake.releasePage();

        const [startResult, stopResult] = await Promise.all([starting, stopping]);
        assert.equal(stopResult.body.success, true);
        assert.equal(startResult.body.success, false, 'a start invalidated by Stop must not publish a session');
        assert.equal(fake.stats.browserCloses, 1, 'the late browser must be closed');
        assert.equal(fake.stats.contextCloses, stage === 'launch' ? 0 : 1);
        assert.equal(fake.stats.pageCloses, stage === 'page' ? 1 : 0);

        const restarted = await request(port, 'POST', '/api/browser/session/start', { token, body: {} });
        assert.equal(restarted.body.success, true, 'a fresh start must work after Stop finishes');
        assert.equal(fake.stats.launches, 2, 'restart must create a new browser rather than reuse late state');
    });
}

test('a start requested while Stop is pending waits for cleanup and survives', async (t) => {
    const fake = createFakePlaywright({ gateLaunch: true });
    const { port, token } = await startHarness(t, fake);

    const first = request(port, 'POST', '/api/browser/session/start', { token, body: {} });
    assert.ok(await waitUntil(() => fake.stats.launches >= 1));
    const stopping = request(port, 'POST', '/api/browser/session/stop', { token, body: {} });
    const second = request(port, 'POST', '/api/browser/session/start', { token, body: {} });
    await delay(30);
    assert.equal(fake.stats.launches, 1, 'a new start must not join the invalidated launch');
    fake.releaseLaunch();

    const [firstResult, stopResult, secondResult] = await Promise.all([first, stopping, second]);
    assert.equal(firstResult.body.success, false);
    assert.equal(stopResult.body.success, true);
    assert.equal(secondResult.body.success, true);
    assert.equal(fake.stats.launches, 2);
    assert.equal(fake.stats.browserCloses, 1, 'Stop must not close the replacement session');
});

test('snapshot poll skips the image when the hash matches and resends when it changes', async (t) => {
    const fake = createFakePlaywright();
    const { port, token } = await startHarness(t, fake);
    await request(port, 'POST', '/api/browser/session/start', { token, body: {} });

    const first = await request(port, 'GET', '/api/browser/session/snapshot', { token });
    assert.equal(first.status, 200);
    assert.equal(decodeSnapshot(first.body.snapshotDataUrl), PNG_V1);
    assert.match(first.body.snapshotHash, /^[a-f0-9]{64}$/);
    assert.equal(first.body.unchanged, undefined);

    const shotsBefore = fake.stats.screenshots;
    const same = await request(port, 'GET', `/api/browser/session/snapshot?since=${first.body.snapshotHash}`, { token });
    assert.equal(same.status, 200);
    assert.equal(same.body.unchanged, true);
    assert.equal(Object.prototype.hasOwnProperty.call(same.body, 'snapshotDataUrl'), false, 'unchanged poll must not carry base64');
    assert.equal(same.body.snapshotHash, first.body.snapshotHash);
    assert.equal(same.body.title, 'Fixture page');
    assert.equal(same.body.url, 'https://example.com/fixture');
    assert.equal(fake.stats.screenshots, shotsBefore + 1, 'unchanged is decided from a fresh capture, not a cached image');

    fake.setPng('fixture-png-bytes-v2');
    const changed = await request(port, 'GET', `/api/browser/session/snapshot?since=${first.body.snapshotHash}`, { token });
    assert.equal(changed.body.unchanged, undefined);
    assert.equal(decodeSnapshot(changed.body.snapshotDataUrl), 'fixture-png-bytes-v2');
    assert.notEqual(changed.body.snapshotHash, first.body.snapshotHash);

    const noSince = await request(port, 'GET', '/api/browser/session/snapshot', { token });
    assert.ok(noSince.body.snapshotDataUrl, 'poll without since must return the full image');
    const bogus = await request(port, 'GET', '/api/browser/session/snapshot?since=not-a-hash', { token });
    assert.ok(bogus.body.snapshotDataUrl, 'unknown since must fall back to the full image');
});

test('navigate returns a fresh image whose hash the next poll can reuse', async (t) => {
    const fake = createFakePlaywright();
    const { port, token } = await startHarness(t, fake);
    await request(port, 'POST', '/api/browser/session/start', { token, body: {} });

    const nav = await request(port, 'POST', '/api/browser/session/navigate', { token, body: { url: 'example.com/next' } });
    assert.equal(nav.status, 200);
    assert.equal(nav.body.success, true);
    assert.equal(fake.stats.navigations, 1);
    assert.ok(nav.body.snapshotDataUrl, 'explicit navigation must always return the image');
    assert.match(nav.body.snapshotHash, /^[a-f0-9]{64}$/);

    const poll = await request(port, 'GET', `/api/browser/session/snapshot?since=${nav.body.snapshotHash}`, { token });
    assert.equal(poll.body.unchanged, true);

    const action = await request(port, 'POST', '/api/browser/session/action', { token, body: { action: 'reload' } });
    assert.equal(action.body.success, true);
    assert.ok(action.body.snapshotDataUrl);
    assert.equal(action.body.snapshotHash, nav.body.snapshotHash);
});