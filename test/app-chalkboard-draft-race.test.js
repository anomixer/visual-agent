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

function optionalDeclaration(pattern) {
    const text = source.match(pattern)?.[0];
    return text ? new vm.Script(text, { filename: sourcePath }) : null;
}

const declarations = [
    optionalDeclaration(/^let agentChalkboardDraftGeneration = \d+;\r?$/m),
    optionalDeclaration(/^function invalidateAgentChalkboardDrafts\([^)]*\) \{[^]*?^\}\r?$/m),
    ...[
        'applyAgentChalkboardDraft',
        'clearChalkboard',
        'switchChalkboardPage',
        'createChalkboardPage',
        'undoChalkAction',
        'redoChalkAction',
        'startChalkStroke',
        'startTextBoxManipulation',
        'commitPendingTextPlacement',
        'copySelectionToClipboard',
        'applyRemoteChalkboardState',
    ].map(extractFunction),
];

function harness() {
    const requests = [];
    const frames = [];
    const timers = [];
    const openedTabs = [];
    const errors = [];
    const board = [];
    const chalkboardState = {
        ctx: {
            drawImage: (image) => board.push(`image:${image?._src || image}`),
            clearRect: () => board.push('cleared'),
        },
        cssWidth: 1000,
        cssHeight: 800,
        hasInteracted: true,
        hasUserContent: false,
        history: [],
        future: [],
        pages: [
            { snapshot: 'page-0', hasInteracted: true, hasUserContent: true, history: [], future: [] },
            { snapshot: 'page-1', hasInteracted: true, hasUserContent: true, history: [], future: [] },
        ],
        activePageIndex: 0,
        tool: 'chalk',
        drawing: false,
    };
    let remoteSession = { id: 'remote-a', status: 'active' };
    let invalidateDuringResize = false;
    const context = vm.createContext({
        console: { error: (...args) => errors.push(args), warn() {}, log() {} },
        currentLocale: 'en-US',
        selectedRemoteSessionId: 'remote-a',
        chalkboardState,
        chalkboardCanvas: { setPointerCapture() {} },
        chalkTextBox: { setPointerCapture() {}, releasePointerCapture() {} },
        HTMLElement: class {},
        getActiveRemoteSession: () => remoteSession,
        appliedRemoteChalkboardMessageIds: new Set(),
        loadingRemoteChalkboardMessageIds: new Set(),
        appliedRemoteChalkboardRevisions: new Map(),
        remoteChalkboardLoadToken: 0,
        remoteChalkboardLoadTokens: new Map(),
        queuedRemoteChalkboardMessage: null,
        suppressRemoteChalkboardSync: false,
        isChalkboardInteractionBusy: () => false,
        scheduleQueuedRemoteChalkboardApply() {},
        normalizeImageDataUrl: (value) => value,
        Image: class {
            set src(value) {
                this._src = value;
                this.onload?.();
            }
        },
        cancelPendingChalkPreview() {},
        hidePendingTextBox() {},
        clearSelectionBox() {},
        syncChalkboardUI() {},
        normalizeCollaborativeChalkboardDraft: (draft) => ({ ...draft, position: 'full' }),
        normalizeChalkboardTextForCanvas: (text) => String(text || ''),
        normalizeChalkboardBulletsForCanvas: (bullets) => bullets.map((line) => String(line)),
        getChalkboardLayoutLimits: () => ({ maxBullets: 8, maxChars: 96 }),
        api: (route, options) => {
            const request = { route, options };
            requests.push(request);
            return new Promise((resolve, reject) => Object.assign(request, { resolve, reject }));
        },
        openTab: (tab) => openedTabs.push(tab),
        requestAnimationFrame: (callback) => frames.push(callback),
        setTimeout: (callback, delay) => timers.push({ callback, delay }),
        resizeChalkboardCanvas() {
            if (invalidateDuringResize) context.invalidateAgentChalkboardDrafts();
        },
        activateChalkboard: () => false,
        persistActiveChalkboardPage() {},
        restoreChalkboardPage(page) {
            board.length = 0;
            if (page.snapshot) board.push(page.snapshot);
        },
        showChalkboardFloatHint() {},
        resetPendingChalkState() {},
        pushChalkHistory() {},
        pushChalkFuture() {},
        createCanvasSnapshot: () => 'current',
        restoreCanvasSnapshot: (snapshot) => board.push(`image:${snapshot}`),
        getSelectionCanvas: () => ({}),
        writeCanvasToClipboard: async () => true,
        drawPlacedText: () => board.push('text:placed'),
        clearChalkboardSurface: () => { board.length = 0; },
        clearChalkboardLane() {},
        markChalkboardUserContent: (value) => { chalkboardState.hasUserContent = value; },
        drawChalkText: (text) => board.push(`title:${text}`),
        drawWrappedChalkText: (text) => {
            board.push(`bullet:${text}`);
            return Math.max(1, Math.ceil(text.length / 20));
        },
        drawChalkDot: () => board.push('dot'),
        drawChalkStroke() {},
        getChalkPoint: () => ({ x: 10, y: 10 }),
        addUILog() {},
    });
    for (const declaration of declarations) {
        if (declaration) declaration.runInContext(context, { timeout: 1000 });
    }

    async function resolveAt(index, draft) {
        assert.ok(requests[index], `Expected a pending request at ${index}`);
        requests[index].resolve({ success: true, draft });
        await tick();
    }
    function flushFrames() {
        while (frames.length) frames.shift()();
    }
    function flushTimers() {
        let count = 0;
        while (timers.length) {
            assert.ok(count++ < 20, 'readiness retries must be bounded');
            timers.shift().callback();
        }
    }
    return {
        context,
        requests,
        frames,
        timers,
        openedTabs,
        errors,
        board,
        chalkboardState,
        resolveAt,
        flushFrames,
        flushTimers,
        setRemoteSession(session) {
            remoteSession = session;
            context.selectedRemoteSessionId = session?.id || '';
        },
        invalidateOnResize() {
            invalidateDuringResize = true;
        },
    };
}

const draft = (title, extra = {}) => ({ title, bullets: ['summary'], clear: false, replaceLane: false, ...extra });
const renderedDraft = (title) => [`title:${title}`, 'bullet:summary'];

test('an older draft response cannot render over a newer draft', async () => {
    const h = harness();
    const older = h.context.applyAgentChalkboardDraft(draft('older'));
    const newer = h.context.applyAgentChalkboardDraft(draft('newer'));

    await h.resolveAt(1, draft('newer'));
    await newer;
    h.flushFrames();
    assert.deepEqual(h.board, renderedDraft('newer'));

    await h.resolveAt(0, draft('older'));
    await older;
    h.flushFrames();
    assert.deepEqual(h.board, renderedDraft('newer'));
});

test('clearing the board invalidates an already scheduled draft', async () => {
    const h = harness();
    h.chalkboardState.pages = [h.chalkboardState.pages[0]];
    const rendering = h.context.applyAgentChalkboardDraft(draft('late'));
    await h.resolveAt(0, draft('late'));
    await rendering;
    assert.equal(h.frames.length, 1);

    h.context.clearChalkboard();
    h.flushFrames();
    assert.deepEqual(h.board, []);
    assert.deepEqual(h.openedTabs, ['chalkboard']);
});

test('a readiness retry cannot render after the board is cleared', async () => {
    const h = harness();
    h.chalkboardState.pages = [h.chalkboardState.pages[0]];
    h.chalkboardState.cssWidth = 0;
    const rendering = h.context.applyAgentChalkboardDraft(draft('retry'));
    await h.resolveAt(0, draft('retry'));
    await rendering;
    h.flushFrames();
    assert.equal(h.timers.length, 1);

    h.context.clearChalkboard();
    h.chalkboardState.cssWidth = 1000;
    h.flushTimers();
    assert.deepEqual(h.board, []);
    assert.deepEqual(h.timers, []);
});

test('switching pages invalidates a pending draft', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('wrong page'));
    await h.resolveAt(0, draft('wrong page'));
    await rendering;

    h.context.switchChalkboardPage(1);
    h.flushFrames();
    assert.deepEqual(h.board, ['page-1']);
    assert.equal(h.chalkboardState.activePageIndex, 1);
});

test('adding a page invalidates a pending draft', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('wrong page'));
    await h.resolveAt(0, draft('wrong page'));
    await rendering;

    h.context.createChalkboardPage();
    h.flushFrames();
    assert.deepEqual(h.board, []);
    assert.equal(h.chalkboardState.activePageIndex, 2);
});

test('undo and redo invalidate pending drafts', async () => {
    for (const action of ['undoChalkAction', 'redoChalkAction']) {
        const h = harness();
        h.chalkboardState.history = action === 'undoChalkAction' ? ['restored'] : [];
        h.chalkboardState.future = action === 'redoChalkAction' ? ['restored'] : [];
        const rendering = h.context.applyAgentChalkboardDraft(draft('late history edit'));
        await h.resolveAt(0, draft('late history edit'));
        await rendering;

        h.context[action]();
        h.flushFrames();
        assert.deepEqual(h.board, ['image:restored'], action);
    }
});

test('a stopped draft neither renders nor logs a late API failure', async () => {
    const h = harness();
    const controller = new AbortController();
    const rendering = h.context.applyAgentChalkboardDraft(draft('stopped'), { signal: controller.signal });
    assert.equal(h.requests[0].options.signal, controller.signal);

    controller.abort();
    h.requests[0].reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await rendering;
    h.flushFrames();
    assert.deepEqual(h.board, []);
    assert.deepEqual(h.openedTabs, []);
    assert.deepEqual(h.errors, []);
});

test('a draft aborted after its response cannot render from a scheduled frame', async () => {
    const h = harness();
    const controller = new AbortController();
    const rendering = h.context.applyAgentChalkboardDraft(draft('scheduled stop'), { signal: controller.signal });
    await h.resolveAt(0, draft('scheduled stop'));
    await rendering;
    assert.equal(h.frames.length, 1);

    controller.abort();
    h.flushFrames();
    assert.deepEqual(h.board, []);
});

test('a stale draft does not start readiness retries', async () => {
    const h = harness();
    h.chalkboardState.pages = [h.chalkboardState.pages[0]];
    h.chalkboardState.cssWidth = 0;
    const rendering = h.context.applyAgentChalkboardDraft(draft('stale retry'));
    await h.resolveAt(0, draft('stale retry'));
    await rendering;

    h.context.clearChalkboard();
    h.flushFrames();
    assert.deepEqual(h.timers, []);
    assert.deepEqual(h.board, []);
});

test('a remote draft cannot open the board after its session changes', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('remote a'), { remoteSessionId: 'remote-a' });
    h.setRemoteSession({ id: 'remote-b', status: 'active' });
    await h.resolveAt(0, draft('remote a'));
    await rendering;

    h.flushFrames();
    assert.deepEqual(h.board, []);
    assert.deepEqual(h.openedTabs, []);
});

test('a remote draft is suppressed when its session changes after the response', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('remote a'), { remoteSessionId: 'remote-a' });
    await h.resolveAt(0, draft('remote a'));
    await rendering;

    h.setRemoteSession({ id: 'remote-b', status: 'active' });
    h.flushFrames();
    assert.deepEqual(h.board, []);
});

test('starting a user stroke invalidates a pending draft', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('overwrites drawing'));
    await h.resolveAt(0, draft('overwrites drawing'));
    await rendering;

    h.context.startChalkStroke({ pointerId: 1 });
    h.flushFrames();
    assert.deepEqual(h.board, ['dot']);
});

test('draft pagination does not invalidate its own render', async () => {
    const h = harness();
    h.chalkboardState.cssHeight = 220;
    const payload = draft('long draft', {
        bullets: ['a'.repeat(90), 'b'.repeat(90), 'c'.repeat(90), 'd'.repeat(90)],
    });
    const rendering = h.context.applyAgentChalkboardDraft(payload);
    await h.resolveAt(0, payload);
    await rendering;
    const generation = vm.runInContext('agentChalkboardDraftGeneration', h.context);
    h.flushFrames();

    assert.equal(vm.runInContext('agentChalkboardDraftGeneration', h.context), generation);
    assert.ok(h.chalkboardState.pages.length > 2);
    assert.ok(h.board.some((entry) => /^title:long draft (?:\(p\.|（續 )/.test(entry)));
    assert.ok(h.board.includes(`bullet:${'d'.repeat(90)}`));
});

test('an invalidation during resize prevents the draft from drawing', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('resized away'));
    await h.resolveAt(0, draft('resized away'));
    await rendering;

    h.invalidateOnResize();
    h.flushFrames();
    assert.deepEqual(h.board, []);
});

test('a newer draft invalidates an older draft that is already scheduled', async () => {
    const h = harness();
    const older = h.context.applyAgentChalkboardDraft(draft('older'));
    await h.resolveAt(0, draft('older'));
    await older;
    assert.equal(h.frames.length, 1);

    const newer = h.context.applyAgentChalkboardDraft(draft('newer'));
    h.flushFrames();
    assert.deepEqual(h.board, []);

    await h.resolveAt(1, draft('newer'));
    await newer;
    h.flushFrames();
    assert.deepEqual(h.board, renderedDraft('newer'));
});

test('clearing the board while the draft API is pending suppresses the late response', async () => {
    const h = harness();
    h.chalkboardState.pages = [h.chalkboardState.pages[0]];
    const rendering = h.context.applyAgentChalkboardDraft(draft('late response'));
    h.context.clearChalkboard();

    await h.resolveAt(0, draft('late response'));
    await rendering;
    h.flushFrames();
    assert.deepEqual(h.board, []);
    assert.deepEqual(h.openedTabs, []);
});

test('a stale API rejection neither renders a fallback nor logs an error', async () => {
    const h = harness();
    const older = h.context.applyAgentChalkboardDraft(draft('older failure'));
    const newer = h.context.applyAgentChalkboardDraft(draft('newer success'));
    await h.resolveAt(1, draft('newer success'));
    await newer;
    h.flushFrames();

    h.requests[0].reject(new Error('late offline failure'));
    await older;
    h.flushFrames();
    assert.deepEqual(h.board, renderedDraft('newer success'));
    assert.deepEqual(h.errors, []);
});

test('a render failure after invalidation is not logged as a current draft error', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('stale render failure', { clear: true }));
    await h.resolveAt(0, draft('stale render failure', { clear: true }));
    await rendering;
    h.context.clearChalkboardSurface = () => {
        h.context.invalidateAgentChalkboardDrafts();
        throw new Error('canvas failed after invalidation');
    };

    assert.doesNotThrow(() => h.flushFrames());
    assert.deepEqual(h.errors, []);
});

test('a current render failure is caught and logged once', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('current render failure', { clear: true }));
    await h.resolveAt(0, draft('current render failure', { clear: true }));
    await rendering;
    h.context.clearChalkboardSurface = () => {
        throw new Error('current canvas failed');
    };

    assert.doesNotThrow(() => h.flushFrames());
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0][0], '[Chalkboard Draft] failed:');
    assert.equal(h.errors[0][1].message, 'current canvas failed');
});

test('a readiness retry catches and logs a current render failure', async () => {
    const h = harness();
    h.chalkboardState.cssWidth = 0;
    const rendering = h.context.applyAgentChalkboardDraft(draft('retry render failure', { clear: true }));
    await h.resolveAt(0, draft('retry render failure', { clear: true }));
    await rendering;
    h.flushFrames();
    assert.equal(h.timers.length, 1);

    h.chalkboardState.cssWidth = 1000;
    h.context.clearChalkboardSurface = () => {
        throw new Error('retry canvas failed');
    };
    assert.doesNotThrow(() => h.flushTimers());
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0][1].message, 'retry canvas failed');
});

test('a current draft still falls back to local rendering when the API refuses', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('offline'));
    h.requests[0].resolve({ success: false, error: 'offline' });
    await rendering;
    h.flushFrames();

    assert.deepEqual(h.board, renderedDraft('offline'));
    assert.deepEqual(h.errors, []);
});

test('a pre-aborted draft does not start a request', { timeout: 1000 }, async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();

    await h.context.applyAgentChalkboardDraft(draft('never starts'), { signal: controller.signal });
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.openedTabs, []);
});

test('a remote draft is suppressed after its session disconnects', async () => {
    const h = harness();
    const rendering = h.context.applyAgentChalkboardDraft(draft('disconnected'), { remoteSessionId: 'remote-a' });
    h.setRemoteSession({ id: 'remote-a', status: 'disconnected' });
    await h.resolveAt(0, draft('disconnected'));
    await rendering;
    h.flushFrames();

    assert.deepEqual(h.board, []);
    assert.deepEqual(h.openedTabs, []);
});

test('an applied remote Chalkboard image invalidates an older scheduled draft', async () => {
    const h = harness();
    const image = 'data:image/png;base64,AA==';
    const rendering = h.context.applyAgentChalkboardDraft(draft('older remote draft'), { remoteSessionId: 'remote-a' });
    await h.resolveAt(0, draft('older remote draft'));
    await rendering;

    h.context.applyRemoteChalkboardState({ id: 'remote-image', revision: 1, imageDataUrl: image }, 'remote-a');
    h.flushFrames();
    assert.deepEqual(h.board, [`image:${image}`]);
});

test('a remote Chalkboard image applied after a draft remains the later canvas mutation', async () => {
    const h = harness();
    const image = 'data:image/png;base64,AA==';
    const rendering = h.context.applyAgentChalkboardDraft(draft('newer local draft'));
    await h.resolveAt(0, draft('newer local draft'));
    await rendering;
    h.flushFrames();
    assert.deepEqual(h.board, renderedDraft('newer local draft'));

    h.context.applyRemoteChalkboardState({ id: 'remote-image', revision: 1, imageDataUrl: image }, 'remote-a');
    assert.deepEqual(h.board, [`image:${image}`]);
});

test('cutting a selection invalidates a pending draft', async () => {
    const h = harness();
    h.chalkboardState.pages = [h.chalkboardState.pages[0]];
    h.chalkboardState.selectionRect = { left: 1, top: 2, width: 30, height: 40 };
    const rendering = h.context.applyAgentChalkboardDraft(draft('overwrites cut'));
    await h.resolveAt(0, draft('overwrites cut'));
    await rendering;

    await h.context.copySelectionToClipboard(true);
    h.flushFrames();
    assert.deepEqual(h.board, ['cleared']);
});

test('copying a selection does not invalidate a pending draft', async () => {
    const h = harness();
    h.chalkboardState.pages = [h.chalkboardState.pages[0]];
    h.chalkboardState.selectionRect = { left: 1, top: 2, width: 30, height: 40 };
    const rendering = h.context.applyAgentChalkboardDraft(draft('still current'));
    await h.resolveAt(0, draft('still current'));
    await rendering;

    await h.context.copySelectionToClipboard(false);
    h.flushFrames();
    assert.deepEqual(h.board, renderedDraft('still current'));
});

test('moving a pending text box invalidates a scheduled draft', async () => {
    const h = harness();
    h.chalkboardState.tool = 'text';
    h.chalkboardState.pendingTextRect = { left: 10, top: 20, width: 100, height: 60 };
    const rendering = h.context.applyAgentChalkboardDraft(draft('overwrites text edit'));
    await h.resolveAt(0, draft('overwrites text edit'));
    await rendering;

    h.context.startTextBoxManipulation({ target: {}, pointerId: 1, preventDefault() {}, stopPropagation() {} });
    h.flushFrames();
    assert.deepEqual(h.board, []);
    assert.equal(h.chalkboardState.textManipulation.mode, 'move');
});

test('committing pending text invalidates a scheduled draft', async () => {
    const h = harness();
    h.chalkboardState.pendingText = {};
    h.chalkboardState.pendingTextRect = { left: 10, top: 20, width: 100, height: 60 };
    h.chalkboardState.pendingTextSnapshot = 'text-before';
    const rendering = h.context.applyAgentChalkboardDraft(draft('overwrites committed text'));
    await h.resolveAt(0, draft('overwrites committed text'));
    await rendering;

    h.context.commitPendingTextPlacement();
    h.flushFrames();
    assert.deepEqual(h.board, ['image:text-before', 'text:placed']);
});

test('production draft callers pass cancellation and remote session identity', () => {
    assert.match(source, /applyAgentChalkboardDraft\(remoteAutoDraft,\s*\{\s*actorScope:[^\n]+\s*remoteSessionId:\s*session\.id,?\s*\}\);/s);
    assert.match(source, /applyAgentChalkboardDraft\(autoDraft,\s*\{\s*actorScope:\s*'local',\s*signal:\s*requestAbortController\.signal,?\s*\}\);/s);
});
