'use strict';
// Browser 分頁快照輪詢：不重疊、帶 since、unchanged 不重繪、晚到的舊畫面不覆蓋新畫面。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extract(pattern, label) {
    const matches = [...source.matchAll(pattern)];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${label}`);
    return new vm.Script(matches[0][0], {
        filename: sourcePath,
        lineOffset: source.slice(0, matches[0].index).split('\n').length - 1,
    });
}

const declarations = [
    extract(/^let browserTabState = \{[^]*?^\};\r?$/gm, 'browserTabState'),
    extract(/^function updateBrowserSnapshot\([^]*?^\}\r?$/gm, 'updateBrowserSnapshot'),
    extract(/^function applyBrowserSnapshotResponse\([^]*?^\}\r?$/gm, 'applyBrowserSnapshotResponse'),
    extract(/^async function ensureBrowserSessionStarted\([^]*?^\}\r?$/gm, 'ensureBrowserSessionStarted'),
    extract(/^async function refreshBrowserSnapshot\([^]*?^\}\r?$/gm, 'refreshBrowserSnapshot'),
    extract(/^async function browserNavigate\([^]*?^\}\r?$/gm, 'browserNavigate'),
    extract(/^async function browserAction\([^]*?^\}\r?$/gm, 'browserAction'),
];

const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness() {
    const routes = [];
    const pending = [];
    const statuses = [];
    const srcWrites = [];
    const image = {
        style: {},
        get src() { return this._src || ''; },
        set src(value) { this._src = value; srcWrites.push(value); },
        removeAttribute(name) { if (name === 'src') { this._src = ''; srcWrites.push(''); } },
    };
    const title = { textContent: '' };
    const emptyState = { style: {} };
    const urlInput = { value: '' };
    const context = vm.createContext({
        console: { error: () => {}, warn: () => {}, log: () => {} },
        document: { activeElement: null },
        browserSnapshotImage: image,
        browserPageTitle: title,
        browserEmptyState: emptyState,
        browserUrlInput: urlInput,
        setBrowserStatus: (text) => statuses.push(text),
        api: (route) => {
            routes.push(route);
            return new Promise((resolve) => pending.push(resolve));
        },
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    vm.runInContext('browserTabState.started = true;', context);

    const state = () => vm.runInContext('browserTabState', context);
    async function resolveAt(index, payload) {
        assert.ok(pending[index], `Expected a pending request at ${index}`);
        pending[index](payload);
        await tick();
    }
    return { context, routes, pending, statuses, srcWrites, image, title, urlInput, state, resolveAt };
}

const IMAGE_A = 'data:image/png;base64,AAAA';
const IMAGE_B = 'data:image/png;base64,BBBB';

test('an in-flight snapshot suppresses the overlapping poll and releases afterwards', async () => {
    const { context, routes, resolveAt } = harness();

    const first = context.refreshBrowserSnapshot();
    const second = context.refreshBrowserSnapshot();
    assert.deepEqual(routes, ['/api/browser/session/snapshot'], 'overlapping poll must not issue another request');

    await resolveAt(0, { success: true, snapshotDataUrl: IMAGE_A, snapshotHash: 'h1', title: 'A', url: 'https://a' });
    await Promise.all([first, second]);

    const third = context.refreshBrowserSnapshot();
    assert.equal(routes.length, 2, 'guard must be released once the response settles');
    await resolveAt(1, { success: true, unchanged: true, snapshotHash: 'h1', title: 'A', url: 'https://a' });
    await third;
});

test('the poll sends the last hash and an unchanged response keeps the current image', async () => {
    const { context, routes, srcWrites, image, title, urlInput, state, resolveAt } = harness();

    const first = context.refreshBrowserSnapshot();
    assert.equal(routes[0], '/api/browser/session/snapshot', 'first poll has no hash to send');
    await resolveAt(0, { success: true, snapshotDataUrl: IMAGE_A, snapshotHash: 'h1', title: 'A', url: 'https://a' });
    await first;
    assert.equal(image.src, IMAGE_A);
    assert.equal(state().snapshotHash, 'h1');

    const second = context.refreshBrowserSnapshot();
    assert.equal(routes[1], '/api/browser/session/snapshot?since=h1');
    await resolveAt(1, { success: true, unchanged: true, snapshotHash: 'h1', title: 'A renamed', url: 'https://a#x' });
    await second;

    assert.deepEqual(srcWrites, [IMAGE_A], 'unchanged must not rewrite the image src');
    assert.equal(title.textContent, 'A renamed');
    assert.equal(urlInput.value, 'https://a#x');
    assert.equal(state().snapshotHash, 'h1');

    const third = context.refreshBrowserSnapshot();
    assert.equal(routes[2], '/api/browser/session/snapshot?since=h1');
    await resolveAt(2, { success: true, snapshotDataUrl: IMAGE_B, snapshotHash: 'h2', title: 'B', url: 'https://b' });
    await third;
    assert.equal(image.src, IMAGE_B);
    assert.equal(state().snapshotHash, 'h2');
});

test('a stale poll response cannot overwrite a newer navigation', async () => {
    const { context, routes, image, state, resolveAt } = harness();

    const poll = context.refreshBrowserSnapshot();
    const nav = context.browserNavigate('example.com/next');
    await tick();
    assert.equal(routes.length, 2);
    assert.equal(routes[1], '/api/browser/session/navigate');

    await resolveAt(1, { success: true, snapshotDataUrl: IMAGE_B, snapshotHash: 'h2', title: 'Next', url: 'https://next' });
    await nav;
    assert.equal(image.src, IMAGE_B);

    await resolveAt(0, { success: true, snapshotDataUrl: IMAGE_A, snapshotHash: 'h1', title: 'Old', url: 'https://old' });
    await poll;

    assert.equal(image.src, IMAGE_B, 'the older snapshot must be discarded');
    assert.equal(state().snapshotHash, 'h2');
    assert.equal(state().currentUrl, 'https://next');
    assert.equal(state().snapshotInFlight, false);
});

test('a failed poll keeps the hash and releases the guard', async () => {
    const { context, routes, statuses, srcWrites, state, resolveAt } = harness();

    const first = context.refreshBrowserSnapshot();
    await resolveAt(0, { success: true, snapshotDataUrl: IMAGE_A, snapshotHash: 'h1', title: 'A', url: 'https://a' });
    await first;

    const failed = context.refreshBrowserSnapshot();
    await resolveAt(1, { success: false, error: 'offline' });
    await failed;
    assert.equal(state().snapshotInFlight, false);
    assert.equal(state().snapshotHash, 'h1');
    assert.deepEqual(srcWrites, [IMAGE_A]);
    assert.ok(statuses.some((text) => /Snapshot failed: offline/.test(text)));

    const retried = context.refreshBrowserSnapshot();
    assert.equal(routes[2], '/api/browser/session/snapshot?since=h1');
    await resolveAt(2, { success: true, unchanged: true, snapshotHash: 'h1', title: 'A', url: 'https://a' });
    await retried;
});

test('a browser action stores the hash the next poll reuses', async () => {
    const { context, routes, image, state, resolveAt } = harness();

    const action = context.browserAction('reload');
    await tick();
    assert.equal(routes[0], '/api/browser/session/action');
    await resolveAt(0, { success: true, snapshotDataUrl: IMAGE_B, snapshotHash: 'h9', title: 'B', url: 'https://b' });
    await action;
    assert.equal(image.src, IMAGE_B);
    assert.equal(state().snapshotHash, 'h9');
    assert.equal(state().snapshotActionsInFlight, 0);

    const poll = context.refreshBrowserSnapshot();
    assert.equal(routes[1], '/api/browser/session/snapshot?since=h9');
    await resolveAt(1, { success: true, unchanged: true, snapshotHash: 'h9', title: 'B', url: 'https://b' });
    await poll;
});

test('polling is suspended while a navigation is in flight and resumes afterwards', async () => {
    const { context, routes, image, state, resolveAt } = harness();

    const nav = context.browserNavigate('example.com/next');
    await tick();
    assert.equal(routes.length, 1);
    assert.equal(state().snapshotActionsInFlight, 1);

    const skipped = context.refreshBrowserSnapshot();
    await skipped;
    assert.equal(routes.length, 1, 'a poll during navigation would capture the old page and waste a fullPage screenshot');

    await resolveAt(0, { success: true, snapshotDataUrl: IMAGE_B, snapshotHash: 'h2', title: 'Next', url: 'https://next' });
    await nav;
    assert.equal(image.src, IMAGE_B, 'the navigation result must survive later polls');
    assert.equal(state().snapshotActionsInFlight, 0);
    assert.equal(state().snapshotSeq, 1, 'polls must not advance the sequence');

    const poll = context.refreshBrowserSnapshot();
    assert.equal(routes[1], '/api/browser/session/snapshot?since=h2');
    await resolveAt(1, { success: true, unchanged: true, snapshotHash: 'h2', title: 'Next', url: 'https://next' });
    await poll;
    assert.equal(image.src, IMAGE_B);
});

test('overlapping navigations keep only the newest result and release the counter', async () => {
    const { context, routes, image, state, resolveAt } = harness();

    const first = context.browserNavigate('example.com/one');
    await tick();
    const second = context.browserNavigate('example.com/two');
    await tick();
    assert.equal(routes.length, 2);
    assert.equal(state().snapshotActionsInFlight, 2);

    await resolveAt(1, { success: true, snapshotDataUrl: IMAGE_B, snapshotHash: 'h2', title: 'Two', url: 'https://two' });
    await second;
    assert.equal(state().snapshotActionsInFlight, 1);

    await resolveAt(0, { success: true, snapshotDataUrl: IMAGE_A, snapshotHash: 'h1', title: 'One', url: 'https://one' });
    await first;

    assert.equal(image.src, IMAGE_B);
    assert.equal(state().snapshotHash, 'h2');
    assert.equal(state().snapshotActionsInFlight, 0);
});