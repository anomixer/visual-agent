'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function extractFunction(name) {
    const pattern = new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[^]*?^\\}\\r?$`, 'gm');
    const matches = [...source.matchAll(pattern)];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${name}`);
    return new vm.Script(matches[0][0], {
        filename: sourcePath,
        lineOffset: source.slice(0, matches[0].index).split('\n').length - 1,
    });
}

function extractDeclaration(pattern) {
    const text = source.match(pattern)?.[0];
    assert.ok(text, `Expected declaration matching ${pattern}`);
    return new vm.Script(text, { filename: sourcePath });
}

const declarations = [
    extractDeclaration(/^let remoteState = \{[^\n]+\r?$/m),
    extractDeclaration(/^let lastRemoteStateTick = \d+;\r?$/m),
    extractDeclaration(/^let remoteStateRequestSeq = \d+;\r?$/m),
    extractDeclaration(/^let selectedRemoteSessionId = [^\n]+\r?$/m),
    extractDeclaration(/^let remoteChalkboardApplyTimer = null;\r?$/m),
    extractDeclaration(/^let queuedRemoteChalkboardMessage = null;\r?$/m),
    extractDeclaration(/^let remoteChalkboardLoadToken = \d+;\r?$/m),
    extractDeclaration(/^const loadingRemoteChalkboardMessageIds = new (?:Set|Map)\(\);\r?$/m),
    extractDeclaration(/^const appliedRemoteChalkboardMessageIds = new (?:Set|Map)\(\);\r?$/m),
    extractDeclaration(/^const appliedRemoteChalkboardRevisions = new Map\(\);\r?$/m),
    extractDeclaration(/^const remoteChalkboardLoadTokens = new Map\(\);\r?$/m),
    extractDeclaration(/^const remoteSessionsOpenedOnChalkboard = new Set\(\);\r?$/m),
    extractDeclaration(/^const notifiedRemoteDisconnectSessionIds = new Set\(\);\r?$/m),
    ...[
        'loadRemoteProfileAndState',
        'pruneRemovedRemoteChalkboardSessions',
        'getRemoteChalkboardMessageIds',
        'deleteRemoteChalkboardMessageId',
        'applyRemoteChalkboardState',
        'scheduleQueuedRemoteChalkboardApply',
    ].map(extractFunction),
];

function harness(initialSessions = []) {
    const requests = [];
    const images = [];
    const timers = [];
    const board = [];
    let nextResponse = null;
    let busy = false;
    const context = vm.createContext({
        console: { error() {}, warn() {}, log() {} },
        currentLocale: 'en-US',
        activeChatMode: 'remote',
        remoteProfile: null,
        remoteProfileDirty: false,
        remoteAgentNameInput: null,
        remoteUserNameInput: null,
        remoteChatMessages: null,
        chatMessages: null,
        chalkboardState: {
            ctx: { drawImage: (image) => board.push(image?._src || image) },
            cssWidth: 1000,
            cssHeight: 800,
            hasUserContent: false,
            drawing: false,
            pendingShapePreview: false,
            textManipulation: false,
            pendingText: null,
            pendingImage: null,
        },
        localStorage: { getItem: () => '', setItem() {} },
        api: (route) => {
            const request = { route };
            requests.push(request);
            return Promise.resolve(nextResponse);
        },
        getActiveRemoteSession: () => null,
        isRemoteProfileEditing: () => false,
        syncRemoteProfileDirty() {},
        renderRemoteSessionControls() {},
        renderRemotePopup() {},
        appendChatBubble() {},
        t: (key) => key,
        openTab() {},
        scheduleRemoteChalkboardSync() {},
        isChalkboardInteractionBusy: () => busy,
        normalizeImageDataUrl: (value) => value,
        Image: class {
            set src(value) {
                this._src = value;
                images.push(this);
            }
        },
        invalidateAgentChalkboardDrafts() {},
        cancelPendingChalkPreview() {},
        hidePendingTextBox() {},
        clearSelectionBox() {},
        syncChalkboardUI() {},
        showChalkboardFloatHint() {},
        pushChalkHistory() {},
        clearChalkboardSurface() { board.length = 0; },
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            if (timer) timer.cleared = true;
        },
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    vm.runInContext(`remoteState = ${JSON.stringify({ sessions: initialSessions, pendingApprovals: [], localIps: [], port: 19168 })};`, context);

    return {
        context,
        requests,
        images,
        timers,
        board,
        evaluate: (expression) => vm.runInContext(expression, context),
        setBusy(value) { busy = value; },
        respond(data) {
            nextResponse = data;
            return context.loadRemoteProfileAndState();
        },
    };
}

const image = 'data:image/png;base64,QUEUE';

test('a removed remote session drops its Chalkboard revision and load-token bookkeeping', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }]);
    h.evaluate('appliedRemoteChalkboardRevisions.set("remote-a", 7); remoteChalkboardLoadTokens.set("remote-a", 3);');

    await h.respond({ success: true, tick: 2, profile: {}, sessions: [], pendingApprovals: [], localIps: [], port: 19168 });

    assert.equal(h.evaluate('appliedRemoteChalkboardRevisions.size'), 0);
    assert.equal(h.evaluate('remoteChalkboardLoadTokens.size'), 0);
});

test('deleting a busy session releases its queued image and retry timer', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }]);
    h.evaluate('selectedRemoteSessionId = "remote-a";');
    h.setBusy(true);
    h.context.applyRemoteChalkboardState({ id: 'chalk-a', revision: 1, imageDataUrl: image }, 'remote-a');
    assert.equal(h.evaluate('queuedRemoteChalkboardMessage.sessionId'), 'remote-a');
    assert.equal(h.timers.filter((timer) => !timer.cleared).length, 1);

    await h.respond({ success: true, tick: 2, profile: {}, sessions: [], pendingApprovals: [], localIps: [], port: 19168 });

    assert.equal(h.evaluate('queuedRemoteChalkboardMessage'), null);
    assert.equal(h.evaluate('remoteChalkboardApplyTimer'), null);
    assert.equal(h.timers.filter((timer) => !timer.cleared).length, 0);
});

test('a retained disconnected session keeps its applied-revision guard', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }]);
    h.evaluate('appliedRemoteChalkboardRevisions.set("remote-a", 7); remoteChalkboardLoadTokens.set("remote-a", 3);');

    await h.respond({
        success: true,
        tick: 2,
        profile: {},
        sessions: [{ id: 'remote-a', status: 'disconnected' }],
        pendingApprovals: [],
        localIps: [],
        port: 19168,
    });

    assert.equal(h.evaluate('appliedRemoteChalkboardRevisions.get("remote-a")'), 7);
    assert.equal(h.evaluate('remoteChalkboardLoadTokens.get("remote-a")'), 3);
});

test('an unchanged state response leaves live Chalkboard tracking intact', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }]);
    h.evaluate('appliedRemoteChalkboardRevisions.set("remote-a", 7);');

    await h.respond({ success: true, tick: 2, unchanged: true });

    assert.equal(h.evaluate('appliedRemoteChalkboardRevisions.get("remote-a")'), 7);
});

test('a stale full-state response cannot prune a newer session snapshot', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }]);
    h.evaluate('appliedRemoteChalkboardRevisions.set("remote-a", 7);');
    const pending = [];
    h.context.api = (route) => new Promise((resolve) => pending.push({ route, resolve }));

    const older = h.context.loadRemoteProfileAndState();
    const newer = h.context.loadRemoteProfileAndState();
    pending[1].resolve({ success: true, tick: 2, profile: {}, sessions: [{ id: 'remote-a', status: 'active' }], pendingApprovals: [], localIps: [], port: 19168 });
    await newer;
    pending[0].resolve({ success: true, tick: 1, profile: {}, sessions: [], pendingApprovals: [], localIps: [], port: 19168 });
    await older;

    assert.equal(h.evaluate('appliedRemoteChalkboardRevisions.get("remote-a")'), 7);
});

test('a failed state response does not prune sessions that are still displayed', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }]);
    h.evaluate('appliedRemoteChalkboardRevisions.set("remote-a", 7);');

    await h.respond({ success: false, error: 'offline' });

    assert.equal(h.evaluate('appliedRemoteChalkboardRevisions.get("remote-a")'), 7);
});

test('a removed session releases in-flight and legacy message-id ownership', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }]);
    h.evaluate(`
        selectedRemoteSessionId = "remote-a";
        getRemoteChalkboardMessageIds(loadingRemoteChalkboardMessageIds, "remote-a").add("loading-a");
        getRemoteChalkboardMessageIds(appliedRemoteChalkboardMessageIds, "remote-a").add("legacy-a");
        remoteSessionsOpenedOnChalkboard.add("remote-a");
        notifiedRemoteDisconnectSessionIds.add("remote-a");
    `);

    await h.respond({ success: true, tick: 2, profile: {}, sessions: [], pendingApprovals: [], localIps: [], port: 19168 });

    assert.equal(h.evaluate('loadingRemoteChalkboardMessageIds.size'), 0);
    assert.equal(h.evaluate('appliedRemoteChalkboardMessageIds.size'), 0);
    assert.equal(h.evaluate('remoteSessionsOpenedOnChalkboard.size'), 0);
    assert.equal(h.evaluate('notifiedRemoteDisconnectSessionIds.size'), 0);
});

test('an image that finishes loading after session removal cannot touch the board', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }]);
    h.evaluate('selectedRemoteSessionId = "remote-a";');
    h.context.applyRemoteChalkboardState({ id: 'chalk-a', revision: 4, imageDataUrl: image }, 'remote-a');
    assert.equal(h.images.length, 1);

    await h.respond({ success: true, tick: 2, profile: {}, sessions: [], pendingApprovals: [], localIps: [], port: 19168 });
    h.images[0].onload();

    assert.equal(h.board.length, 0);
    assert.equal(h.evaluate('appliedRemoteChalkboardRevisions.size'), 0);
    assert.equal(h.evaluate('remoteChalkboardLoadTokens.size'), 0);
    assert.equal(h.evaluate('loadingRemoteChalkboardMessageIds.size'), 0);
});

test('removing one session preserves a queued image owned by another session', async () => {
    const h = harness([{ id: 'remote-a', status: 'active' }, { id: 'remote-b', status: 'active' }]);
    h.setBusy(true);
    h.context.applyRemoteChalkboardState({ id: 'chalk-b', revision: 2, imageDataUrl: image }, 'remote-b');

    await h.respond({
        success: true,
        tick: 2,
        profile: {},
        sessions: [{ id: 'remote-b', status: 'active' }],
        pendingApprovals: [],
        localIps: [],
        port: 19168,
    });

    assert.equal(h.evaluate('queuedRemoteChalkboardMessage.sessionId'), 'remote-b');
    assert.equal(h.timers.filter((timer) => !timer.cleared).length, 1);
});

test('legacy message ids are scoped to their owning remote session', () => {
    const h = harness([{ id: 'remote-a', status: 'active' }, { id: 'remote-b', status: 'active' }]);
    const message = { id: 'shared-legacy-id', revision: 0, imageDataUrl: image };

    h.evaluate('selectedRemoteSessionId = "remote-a";');
    h.context.applyRemoteChalkboardState(message, 'remote-a');
    h.images[0].onload();
    h.evaluate('selectedRemoteSessionId = "remote-b";');
    h.context.applyRemoteChalkboardState(message, 'remote-b');
    h.images[1].onload();

    assert.equal(h.images.length, 2);
    assert.equal(h.board.length, 1);
    assert.equal(h.evaluate('appliedRemoteChalkboardMessageIds.size'), 2);
    assert.equal(h.evaluate('appliedRemoteChalkboardMessageIds.get("remote-a").has("shared-legacy-id")'), true);
    assert.equal(h.evaluate('appliedRemoteChalkboardMessageIds.get("remote-b").has("shared-legacy-id")'), true);
});
