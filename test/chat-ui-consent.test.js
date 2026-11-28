'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const persistLimitMatches = [...source.matchAll(/^const LOCAL_CHAT_PERSIST_LIMIT = [^;]+;\r?$/gm)];
assert.equal(persistLimitMatches.length, 1, 'Expected one actual declaration of LOCAL_CHAT_PERSIST_LIMIT');
const declarations = [
    new vm.Script(persistLimitMatches[0][0], {
        filename: sourcePath,
        lineOffset: source.slice(0, persistLimitMatches[0].index).split('\n').length - 1,
    }),
    ...[
        'createLocalChatSession', 'normalizeLocalChatSessions', 'saveLocalChatSessions',
        'buildLocalChatPersistPayload',
        'getActiveLocalChatSession', 'touchLocalChatSession',
        'getActiveAbortController', 'setActiveAbortController', 'isModePending',
        'getThinkingIdForMode', 'setThinkingIdForMode', 'updateSendButtonState',
        'addLocalSessionMessage', 'renderLocalChatMessages', 'invalidateLocalChatRequest', 'removeLocalChatSession',
        'appendChatBubble', 'appendAgentActionConsent', 'sendChat', 'clearChatMessages',
    ].map((name) => {
        // These top-level declarations end at an unindented closing brace.
        const matches = [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}\\r?$`, 'gm'))];
        assert.equal(matches.length, 1, `Expected one actual declaration of ${name}`);
        return new vm.Script(matches[0][0], {
            filename: sourcePath,
            lineOffset: source.slice(0, matches[0].index).split('\n').length - 1,
        });
    }),
];

const plain = (value) => JSON.parse(JSON.stringify(value));
const noop = () => {};

class Element {
    constructor(tagName = 'div', className = '') {
        this.tagName = tagName;
        this.className = className;
        this.children = [];
        this.listeners = new Map();
        this.disabled = false;
        this.textContent = '';
        this.scrollTop = 0;
        this.style = {};
        this.classList = {
            contains: (name) => this.className.split(/\s+/).includes(name),
            toggle: (name, force) => {
                const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                const enabled = force === undefined ? !classes.has(name) : force;
                if (enabled) classes.add(name);
                else classes.delete(name);
                this.className = [...classes].join(' ');
                return enabled;
            },
            add: (name) => this.classList.toggle(name, true),
            remove: (name) => this.classList.toggle(name, false),
        };
    }

    set innerHTML(html) {
        this.html = html;
        this.children = [];
        // Only materialize class-addressable slots; no HTML execution or layout.
        for (const match of html.matchAll(/<([a-z]+)\b[^>]*\bclass="([^"]+)"[^>]*>/g)) {
            this.appendChild(new Element(match[1], match[2]));
        }
    }

    get innerHTML() { return this.html || ''; }
    get scrollHeight() { return this.children.length * 100; }
    appendChild(child) { this.children.push(child); return child; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        assert.match(selector, /^\.[\w-]+$/);
        return this.children.flatMap((child) => [
            ...(child.classList.contains(selector.slice(1)) ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }
    addEventListener(event, listener) { this.listeners.set(event, listener); }
    async click() {
        if (!this.disabled) await this.listeners.get('click')?.();
    }
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function harness(respond = () => { throw new Error('Unexpected API request'); }) {
    const storage = new Map();
    const requests = [];
    const effects = { removedThinking: [], stoppedPolls: 0, uiLogs: [] };
    const btnSend = new Element('button');
    btnSend.appendChild(new Element('span', 'icon-send'));
    btnSend.appendChild(new Element('span', 'icon-stop hidden'));
    const context = vm.createContext({
        AbortController, console,
        localChatSessions: ['origin', 'other'].map((id) => ({
            id, title: id, messages: [], history: [{ role: 'user', content: `${id} history` }],
        })),
        selectedLocalChatSessionId: 'origin', activeChatMode: 'local', currentLocale: 'en-US',
        localChatAbortController: null, remoteChatAbortController: null, chatAbortController: null,
        localChatRequestContext: null,
        localThinkingId: '', remoteThinkingId: '',
        chatMessages: new Element(), remoteChatMessages: new Element(), btnSend,
        chatInput: { value: '', style: {} }, isChalkboardAttachmentEnabled: false,
        document: { createElement: (tag) => new Element(tag) },
        localStorage: { setItem: (key, value) => storage.set(key, value) },
        normalizeImageDataUrl: (value) => value || '',
        isContainerPinnedToBottom: () => true,
        renderLocalSessionControls: noop, updateChatModeBadges: noop, switchChatMode: noop,
        renderMarkdown: (text) => String(text), linkifyPlainUrls: (text) => text,
        highlightMentionsInHtml: (html) => html, getMentionHighlightNames: () => [],
        bindExternalLinks: noop, t: (key) => key,
        confirm: () => true,
        addUILog: (text, level) => effects.uiLogs.push({ text, level }),
        getActiveRemoteSession: () => null,
        appendThinking: () => 'thinking-fixture',
        removeThinking: (id) => effects.removedThinking.push(id),
        startAgentStatusPolling: () => () => { effects.stoppedPolls += 1; },
        extractChalkboardControlFromReply: (reply) => ({ displayText: reply }),
        buildAutoChalkboardDraft: () => null,
        $$: () => [],
        api: (route, options) => {
            requests.push({ route, ...options, body: plain(options.body) });
            return respond(route, options);
        },
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    return Object.assign(context, { requests, storage, effects });
}

function approval(id = 'approval-original', overrides = {}) {
    return {
        id, action: 'add_task', sopId: 'fixture-sop',
        description: 'Add the fixture task', expiresAt: '2999-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function session(h, id = 'origin') {
    return h.localChatSessions.find((item) => item.id === id);
}

function select(h, id) {
    h.selectedLocalChatSessionId = id;
    h.renderLocalChatMessages();
}

function propose(h, pending = approval()) {
    h.appendChatBubble('ai', 'Please confirm this task.', [], {
        localChatSessionId: 'origin', pendingActions: [pending],
    });
    return h.chatMessages.querySelectorAll('.btn-suggest').at(-1);
}

function persisted(h, id = 'origin') {
    return JSON.parse(h.storage.get('local_chat_sessions_v1')).find((item) => item.id === id);
}

function assertIdle(h) {
    assert.equal(h.isModePending('local'), false);
    assert.equal(h.isModePending('remote'), false);
    assert.equal(h.getActiveAbortController('local'), null);
    assert.equal(h.getActiveAbortController('remote'), null);
    assert.equal(h.chatAbortController, null);
    assert.equal(h.btnSend.classList.contains('stop'), false);
    assert.equal(h.btnSend.querySelector('.icon-send').classList.contains('hidden'), false);
    assert.equal(h.btnSend.querySelector('.icon-stop').classList.contains('hidden'), true);
}

function remoteHarness(respond) {
    const h = harness(async (route, options) => {
        assert.match(route, /^\/api\/remote\/session\/[^/]+\/message$/);
        return respond(route, options);
    });
    Object.assign(h, {
        activeChatMode: 'remote',
        selectedRemoteSessionId: 'session-a',
        remoteProfile: { userName: 'Local User', agentName: 'Local AI', machineName: 'LOCAL-PC' },
        remoteSendMode: { value: 'user' },
        remotePendingRoles: { local: false, remote: false },
        escapeHtml: (value) => String(value ?? ''),
        resolveRemoteTargets: () => ['local-ai', 'remote-ai'],
        setRemotePendingRoles: (roles) => { h.remotePendingRoles = roles; },
        updatePendingStatusRow: noop,
        addUILog: (text, level) => h.uiLogs.push({ text, level }),
        loadRemoteProfileAndState: async () => { h.stateLoads += 1; },
        getActiveRemoteSession: () => ({ id: h.selectedRemoteSessionId, status: 'active', aiStatus: {} }),
    });
    h.uiLogs = [];
    h.stateLoads = 0;
    return h;
}

function messageRequests(h) {
    return h.requests.filter((request) => request.route.endsWith('/message'));
}

function remoteBubbleHtml(h) {
    return h.remoteChatMessages.children.map((child) => child.innerHTML).join('\n');
}

function flushAsync() {
    return new Promise((resolve) => setImmediate(resolve));
}

function abortError() {
    return Object.assign(new Error('Cancelled'), { name: 'AbortError' });
}

test('pending actions stay on their messages and re-render when switching local tabs', () => {
    const h = harness();
    const first = approval();
    const second = approval('approval-second', { description: 'A separate task' });
    propose(h, first);
    propose(h, second);
    h.appendChatBubble('ai', 'Other tab only.', [], { localChatSessionId: 'other' });

    assert.equal(h.chatMessages.children.length, 2);
    assert.strictEqual(session(h).messages[0].pendingActions[0], first);
    assert.strictEqual(session(h).messages[1].pendingActions[0], second);
    assert.deepEqual(persisted(h).messages.map((m) => m.pendingActions), [[first], [second]]);
    select(h, 'other');
    assert.equal(h.chatMessages.children.length, 1);
    assert.equal(h.chatMessages.querySelectorAll('.btn-suggest').length, 0);
    select(h, 'origin');

    assert.equal(session(h).messages.length, 2, 'Rendering must not append duplicate history');
    assert.equal(session(h, 'other').messages.length, 1);
    for (const [index, pending] of [first, second].entries()) {
        const wrapper = h.chatMessages.children[index].querySelector('.msg-bubble-wrapper');
        const buttons = wrapper.querySelectorAll('.btn-suggest');
        assert.equal(buttons.length, 1);
        assert.equal(buttons[0].textContent, `Confirm ${pending.description}`);
        assert.equal(buttons[0].disabled, false);
    }
    assert.equal(h.requests.length, 0);
});

test('sendChat saves a deferred reply and its consent only in the originating session', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    h.appendChatBubble('ai', 'Other tab stays unchanged.', [], { localChatSessionId: 'other' });
    const otherBefore = plain(session(h, 'other'));
    h.chatInput.value = 'Please plan a fixture task';
    const sending = h.sendChat();

    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body.localChatSessionId, 'origin');
    assert.equal(h.isModePending('local'), true);
    select(h, 'other');
    const visible = [...h.chatMessages.children];
    const pending = approval();
    const history = [{ role: 'assistant', content: 'Proposed a fixture task.' }];
    response.resolve({ success: true, reply: 'Late proposal.', history, pendingActions: [pending] });
    await sending;

    assert.deepEqual(plain(session(h, 'other')), otherBefore);
    assert.deepEqual(h.chatMessages.children, visible, 'Late reply must not touch the selected tab DOM');
    assert.deepEqual(plain(session(h).messages.map((m) => m.text)), ['Please plan a fixture task', 'Late proposal.']);
    assert.strictEqual(session(h).history, history);
    assert.deepEqual(persisted(h).messages[1].pendingActions, [pending]);
    assert.equal(h.chatMessages.querySelectorAll('.btn-suggest').length, 0);
    select(h, 'origin');
    assert.equal(h.chatMessages.querySelectorAll('.btn-suggest').length, 1);
    assert.equal(session(h).messages.length, 2);
    assertIdle(h);
});

test('clearing a local chat invalidates a late success without disturbing its replacement request', async () => {
    const oldResponse = deferred();
    const replacementResponse = deferred();
    const h = harness((_route, options) => options.body.message === 'old request'
        ? oldResponse.promise
        : replacementResponse.promise);
    h.chatInput.value = 'old request';
    const oldSending = h.sendChat();
    const oldController = h.getActiveAbortController('local');

    h.clearChatMessages();

    assert.equal(oldController.signal.aborted, true);
    assert.deepEqual(plain(session(h).messages), []);
    assert.deepEqual(plain(session(h).history), []);
    assert.deepEqual(plain(persisted(h).messages), []);
    assert.deepEqual(plain(persisted(h).history), []);
    assert.equal(h.localThinkingId, '');
    assert.deepEqual(h.effects.removedThinking, ['thinking-fixture']);
    assert.equal(h.effects.stoppedPolls, 1);
    assertIdle(h);

    h.chatInput.value = 'replacement request';
    const replacementSending = h.sendChat();
    const replacementController = h.getActiveAbortController('local');
    assert.notStrictEqual(replacementController, oldController);
    oldResponse.resolve({ success: true, reply: 'Stale reply.', history: [{ role: 'assistant', content: 'stale' }] });
    await oldSending;

    assert.strictEqual(h.getActiveAbortController('local'), replacementController);
    assert.equal(h.isModePending('local'), true);
    assert.deepEqual(plain(session(h).messages.map((m) => m.text)), ['replacement request']);
    assert.deepEqual(plain(session(h).history), []);
    replacementResponse.resolve({ success: true, reply: 'Fresh reply.', history: [{ role: 'assistant', content: 'fresh' }] });
    await replacementSending;

    assert.deepEqual(plain(session(h).messages.map((m) => m.text)), ['replacement request', 'Fresh reply.']);
    assert.deepEqual(plain(session(h).history), [{ role: 'assistant', content: 'fresh' }]);
    assertIdle(h);
});

test('clearing suppresses late refusals, aborts, and network errors from the previous request', async () => {
    for (const outcome of ['refusal', 'abort', 'error']) {
        const response = deferred();
        const h = harness(() => response.promise);
        h.chatInput.value = `request-${outcome}`;
        const sending = h.sendChat();
        const controller = h.getActiveAbortController('local');
        h.clearChatMessages();
        assert.equal(controller.signal.aborted, true);

        if (outcome === 'refusal') response.resolve({ success: false, error: 'late refusal' });
        if (outcome === 'abort') response.reject(abortError());
        if (outcome === 'error') response.reject(new Error('late network error'));
        await sending;

        assert.deepEqual(plain(session(h).messages), [], outcome);
        assert.deepEqual(plain(session(h).history), [], outcome);
        assert.deepEqual(plain(persisted(h).messages), [], outcome);
        assert.equal(h.chatMessages.children.length, 0, outcome);
        assertIdle(h);
    }
});

test('clearing another local tab does not cancel the originating tab request', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    h.chatInput.value = 'origin request';
    const sending = h.sendChat();
    const controller = h.getActiveAbortController('local');
    select(h, 'other');

    h.clearChatMessages();

    assert.equal(controller.signal.aborted, false);
    assert.equal(h.isModePending('local'), true);
    assert.deepEqual(plain(session(h, 'other').messages), []);
    response.resolve({ success: true, reply: 'Origin reply.', history: [{ role: 'assistant', content: 'origin' }] });
    await sending;

    assert.deepEqual(plain(session(h).messages.map((m) => m.text)), ['origin request', 'Origin reply.']);
    assert.deepEqual(plain(session(h, 'other').messages), []);
    assert.equal(h.chatMessages.children.length, 0);
    assertIdle(h);
});

test('local request invalidation requires the originating session identity', () => {
    const h = harness();
    const controller = new AbortController();
    const context = { controller, sessionId: 'origin', invalidated: false };
    h.localChatRequestContext = context;
    h.setActiveAbortController(controller, 'local');

    assert.equal(h.invalidateLocalChatRequest('other'), false);
    assert.equal(context.invalidated, false);
    assert.equal(controller.signal.aborted, false);
    assert.equal(h.localChatRequestContext, context);
    assert.equal(h.getActiveAbortController('local'), controller);
});

test('local request invalidation requires the active controller identity', () => {
    const h = harness();
    const staleController = new AbortController();
    const activeController = new AbortController();
    const context = { controller: staleController, sessionId: 'origin', invalidated: false };
    h.localChatRequestContext = context;
    h.setActiveAbortController(activeController, 'local');

    assert.equal(h.invalidateLocalChatRequest('origin'), false);
    assert.equal(context.invalidated, false);
    assert.equal(staleController.signal.aborted, false);
    assert.equal(activeController.signal.aborted, false);
    assert.equal(h.localChatRequestContext, context);
    assert.equal(h.getActiveAbortController('local'), activeController);
});

test('closing the last local chat does not invalidate an ongoing request', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    h.removeLocalChatSession('other');
    h.chatInput.value = 'only request';
    const sending = h.sendChat();
    const controller = h.getActiveAbortController('local');
    const context = h.localChatRequestContext;

    h.removeLocalChatSession('origin');

    assert.equal(controller.signal.aborted, false);
    assert.equal(context.invalidated, false);
    assert.equal(h.isModePending('local'), true);
    assert.deepEqual(h.localChatSessions.map((item) => item.id), ['origin']);
    response.resolve({ success: true, reply: 'Still active.', history: [{ role: 'assistant', content: 'current' }] });
    await sending;
    assert.deepEqual(plain(session(h).messages.map((item) => item.text)), ['only request', 'Still active.']);
    assertIdle(h);
});

test('closing the originating local chat aborts its request and immediately releases the busy state', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    const removed = session(h);
    h.chatInput.value = 'origin request';
    const sending = h.sendChat();
    const controller = h.getActiveAbortController('local');
    const context = h.localChatRequestContext;

    h.removeLocalChatSession('origin');

    assert.equal(context.invalidated, true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(h.localChatRequestContext, null);
    assert.equal(h.localThinkingId, '');
    assert.deepEqual(h.effects.removedThinking, ['thinking-fixture']);
    assert.equal(h.effects.stoppedPolls, 1);
    assert.equal(session(h, 'origin'), undefined);
    assert.equal(h.selectedLocalChatSessionId, 'other');
    assert.deepEqual(persisted(h, 'other').messages, []);
    assertIdle(h);

    response.resolve({ success: true, reply: 'Too late.', history: [{ role: 'assistant', content: 'stale' }] });
    await sending;
    assert.deepEqual(plain(removed.messages.map((m) => m.text)), ['origin request']);
    assert.deepEqual(plain(removed.history), [{ role: 'user', content: 'origin history' }]);
    assertIdle(h);
});

test('closing suppresses late chat successes, refusals, aborts, and network errors from the removed session', async () => {
    for (const outcome of ['success', 'refusal', 'abort', 'error']) {
        const response = deferred();
        const h = harness(() => response.promise);
        h.console = { error: noop };
        const removed = session(h);
        h.chatInput.value = `request-${outcome}`;
        const sending = h.sendChat();
        const messagesBefore = plain(removed.messages);
        const historyBefore = plain(removed.history);
        h.removeLocalChatSession('origin');
        assertIdle(h);

        if (outcome === 'success') response.resolve({ success: true, reply: 'Stale reply.', history: [{ role: 'assistant', content: 'stale' }] });
        if (outcome === 'refusal') response.resolve({ success: false, error: 'late refusal' });
        if (outcome === 'abort') response.reject(abortError());
        if (outcome === 'error') response.reject(new Error('late network error'));
        await sending;

        assert.deepEqual(plain(removed.messages), messagesBefore, outcome);
        assert.deepEqual(plain(removed.history), historyBefore, outcome);
        assert.equal(h.chatMessages.children.length, 0, outcome);
        assertIdle(h);
    }
});

test('closing another local tab leaves the originating request active and able to finish', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    h.chatInput.value = 'origin request';
    const sending = h.sendChat();
    const controller = h.getActiveAbortController('local');
    select(h, 'other');

    h.removeLocalChatSession('other');

    assert.equal(controller.signal.aborted, false);
    assert.equal(h.isModePending('local'), true);
    assert.equal(h.localChatRequestContext.invalidated, false);
    assert.equal(h.selectedLocalChatSessionId, 'origin');
    response.resolve({ success: true, reply: 'Origin reply.', history: [{ role: 'assistant', content: 'origin' }] });
    await sending;

    assert.deepEqual(plain(session(h).messages.map((m) => m.text)), ['origin request', 'Origin reply.']);
    assert.deepEqual(plain(session(h).history), [{ role: 'assistant', content: 'origin' }]);
    assert.equal(h.chatMessages.querySelectorAll('.msg-bubble-wrapper').length, 2);
    assertIdle(h);
});

test('closing allows an immediate replacement request and stale cleanup cannot clear it', async () => {
    const oldResponse = deferred();
    const replacementResponse = deferred();
    const h = harness((_route, options) => options.body.message === 'old request'
        ? oldResponse.promise
        : replacementResponse.promise);
    const removed = session(h);
    h.chatInput.value = 'old request';
    const oldSending = h.sendChat();
    const oldController = h.getActiveAbortController('local');

    h.removeLocalChatSession('origin');
    assert.equal(oldController.signal.aborted, true);
    assertIdle(h);
    h.chatInput.value = 'replacement request';
    const replacementSending = h.sendChat();
    const replacementController = h.getActiveAbortController('local');
    assert.notStrictEqual(replacementController, oldController);

    oldResponse.resolve({ success: true, reply: 'Stale reply.', history: [{ role: 'assistant', content: 'stale' }] });
    await oldSending;

    assert.strictEqual(h.getActiveAbortController('local'), replacementController);
    assert.equal(h.isModePending('local'), true);
    assert.equal(h.localChatRequestContext.sessionId, 'other');
    assert.deepEqual(plain(session(h, 'other').messages.map((m) => m.text)), ['replacement request']);
    assert.deepEqual(plain(removed.messages.map((m) => m.text)), ['old request']);
    replacementResponse.resolve({ success: true, reply: 'Fresh reply.', history: [{ role: 'assistant', content: 'fresh' }] });
    await replacementSending;

    assert.deepEqual(plain(session(h, 'other').messages.map((m) => m.text)), ['replacement request', 'Fresh reply.']);
    assert.deepEqual(plain(session(h, 'other').history), [{ role: 'assistant', content: 'fresh' }]);
    assertIdle(h);
});

test('closing before a late task and Chalkboard response suppresses all post-response side effects', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    const removed = session(h);
    Object.assign(h, {
        todoList: [], todoLoads: 0, openedTabs: [], expansions: 0, executions: [],
        sidebarRefreshes: 0, chalkboardDrafts: [],
        loadTodo: async () => { h.todoLoads += 1; },
        openTab: (tab) => h.openedTabs.push(tab),
        expandLog: () => { h.expansions += 1; },
        executeTask: (id) => h.executions.push(id),
        refreshSidebarDataSoon: () => { h.sidebarRefreshes += 1; },
        applyAgentChalkboardDraft: (draft) => h.chalkboardDrafts.push(draft),
    });
    h.chatInput.value = 'queue a task';
    const sending = h.sendChat();
    h.removeLocalChatSession('origin');
    response.resolve({
        success: true, reply: 'Task queued.', task: true, executeTaskId: 'fixture-task',
        sopChanged: true, chalkboardDraft: { title: 'Stale draft' },
        history: [{ role: 'assistant', content: 'stale' }],
    });
    await sending;

    assert.equal(h.todoLoads, 0);
    assert.deepEqual(h.openedTabs, []);
    assert.equal(h.expansions, 0);
    assert.deepEqual(h.executions, []);
    assert.equal(h.sidebarRefreshes, 0);
    assert.deepEqual(h.chalkboardDrafts, []);
    assert.deepEqual(plain(removed.messages.map((m) => m.text)), ['queue a task']);
    assert.deepEqual(plain(removed.history), [{ role: 'user', content: 'origin history' }]);
    assertIdle(h);
});

test('closing during a chat task refresh prevents stale tab changes and execution', async () => {
    const response = deferred();
    const todoResponse = deferred();
    const h = harness(() => response.promise);
    Object.assign(h, {
        todoList: [], todoLoads: 0, openedTabs: [], expansions: 0, executions: [],
        loadTodo: async () => { h.todoLoads += 1; return todoResponse.promise; },
        openTab: (tab) => h.openedTabs.push(tab),
        expandLog: () => { h.expansions += 1; },
        executeTask: (id) => h.executions.push(id),
    });
    h.chatInput.value = 'queue a task';
    const sending = h.sendChat();
    response.resolve({ success: true, reply: 'Task queued.', task: true, executeTaskId: 'fixture-task' });
    await flushAsync();
    assert.equal(h.todoLoads, 1);

    h.removeLocalChatSession('origin');
    todoResponse.resolve();
    await sending;

    assert.deepEqual(h.openedTabs, []);
    assert.equal(h.expansions, 0);
    assert.deepEqual(h.executions, []);
    assertIdle(h);
});

test('closing suppresses late consent outcomes without mutating the removed session or approval', async () => {
    for (const outcome of ['success', 'refusal', 'abort', 'error']) {
        const response = deferred();
        const h = harness(() => response.promise);
        h.console = { error: noop };
        const pending = approval();
        const removed = session(h);
        const confirming = propose(h, pending).click();
        const messagesBefore = plain(removed.messages);
        const historyBefore = plain(removed.history);
        h.removeLocalChatSession('origin');
        assertIdle(h);

        if (outcome === 'success') response.resolve({ success: true, reply: 'Confirmed.', history: [{ role: 'assistant', content: 'late' }] });
        if (outcome === 'refusal') response.resolve({ success: false, error: 'late refusal' });
        if (outcome === 'abort') response.reject(abortError());
        if (outcome === 'error') response.reject(new Error('late network error'));
        await confirming;

        assert.equal(pending.status, undefined, outcome);
        assert.deepEqual(plain(removed.messages), messagesBefore, outcome);
        assert.deepEqual(plain(removed.history), historyBefore, outcome);
        assert.equal(h.chatMessages.children.length, 0, outcome);
        assertIdle(h);
    }
});

test('closing during a consent task refresh prevents stale tab changes, sidebar refresh, and execution', async () => {
    const response = deferred();
    const todoResponse = deferred();
    const h = harness(() => response.promise);
    Object.assign(h, {
        todoList: [], todoLoads: 0, openedTabs: [], executions: [], sidebarRefreshes: 0,
        loadTodo: async () => { h.todoLoads += 1; return todoResponse.promise; },
        openTab: (tab) => h.openedTabs.push(tab),
        executeTask: (id) => h.executions.push(id),
        refreshSidebarDataSoon: () => { h.sidebarRefreshes += 1; },
    });
    const pending = approval();
    const confirming = propose(h, pending).click();
    response.resolve({ success: true, reply: 'Confirmed.', task: true, executeTaskId: 'fixture-task', sopChanged: true });
    await flushAsync();
    assert.equal(h.todoLoads, 1);
    assert.equal(h.sidebarRefreshes, 0);

    h.removeLocalChatSession('origin');
    todoResponse.resolve();
    await confirming;

    assert.equal(pending.status, 'confirmed', 'The response was accepted before the tab closed');
    assert.deepEqual(h.openedTabs, []);
    assert.deepEqual(h.executions, []);
    assert.equal(h.sidebarRefreshes, 0);
    assertIdle(h);
});

test('clearing suppresses a late consent success and leaves the cleared session empty', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    const pending = approval();
    const button = propose(h, pending);
    const confirming = button.click();
    const controller = h.getActiveAbortController('local');

    h.clearChatMessages();
    assert.equal(controller.signal.aborted, true);
    assertIdle(h);
    response.resolve({
        success: true,
        reply: 'The task was confirmed.',
        history: [{ role: 'assistant', content: 'late confirmation' }],
        pendingActions: [approval('late-approval')],
    });
    await confirming;

    assert.equal(pending.status, undefined);
    assert.deepEqual(plain(session(h).messages), []);
    assert.deepEqual(plain(session(h).history), []);
    assert.deepEqual(plain(persisted(h).messages), []);
    assert.deepEqual(plain(persisted(h).history), []);
    assert.equal(h.chatMessages.querySelectorAll('.btn-suggest').length, 0);
    assertIdle(h);
});

test('clearing suppresses late consent refusals and errors without marking the approval failed', async () => {
    for (const outcome of ['refusal', 'abort', 'error']) {
        const response = deferred();
        const h = harness(() => response.promise);
        const pending = approval();
        const button = propose(h, pending);
        const confirming = button.click();
        h.clearChatMessages();
        assertIdle(h);

        if (outcome === 'refusal') response.resolve({ success: false, error: 'late refusal' });
        if (outcome === 'abort') response.reject(abortError());
        if (outcome === 'error') response.reject(new Error('late network error'));
        await confirming;

        assert.equal(pending.status, undefined, outcome);
        assert.deepEqual(plain(session(h).messages), [], outcome);
        assert.deepEqual(plain(session(h).history), [], outcome);
        assert.deepEqual(plain(persisted(h).messages), [], outcome);
        assert.equal(h.chatMessages.children.length, 0, outcome);
        assertIdle(h);
    }
});

test('clearing during a chat task refresh prevents stale tab changes and execution', async () => {
    const response = deferred();
    const todoResponse = deferred();
    const h = harness(() => response.promise);
    Object.assign(h, {
        todoList: [], todoLoads: 0, openedTabs: [], executions: [], expansions: 0,
        loadTodo: async () => { h.todoLoads += 1; return todoResponse.promise; },
        openTab: (tab) => h.openedTabs.push(tab),
        expandLog: () => { h.expansions += 1; },
        executeTask: (id) => h.executions.push(id),
    });
    h.chatInput.value = 'queue a task';
    const sending = h.sendChat();
    response.resolve({ success: true, reply: 'Task queued.', task: true, executeTaskId: 'fixture-task' });
    await flushAsync();
    assert.equal(h.todoLoads, 1);

    h.clearChatMessages();
    todoResponse.resolve();
    await sending;

    assert.deepEqual(h.openedTabs, []);
    assert.equal(h.expansions, 0);
    assert.deepEqual(h.executions, []);
    assert.deepEqual(plain(session(h).messages), []);
    assertIdle(h);
});

test('clearing during a consent task refresh prevents stale tab changes and execution', async () => {
    const response = deferred();
    const todoResponse = deferred();
    const h = harness(() => response.promise);
    Object.assign(h, {
        todoList: [], todoLoads: 0, openedTabs: [], executions: [],
        loadTodo: async () => { h.todoLoads += 1; return todoResponse.promise; },
        openTab: (tab) => h.openedTabs.push(tab),
        executeTask: (id) => h.executions.push(id),
    });
    const button = propose(h, approval());
    const confirming = button.click();
    response.resolve({ success: true, reply: 'Task confirmed.', task: true, executeTaskId: 'fixture-task' });
    await flushAsync();
    assert.equal(h.todoLoads, 1);

    h.clearChatMessages();
    todoResponse.resolve();
    await confirming;

    assert.deepEqual(h.openedTabs, []);
    assert.deepEqual(h.executions, []);
    assert.deepEqual(plain(session(h).messages), []);
    assertIdle(h);
});

test('confirmation captures its originating session and sends only the bound approval payload', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    const pending = approval();
    const button = propose(h, pending);
    const originHistory = plain(session(h).history);
    const otherBefore = plain(session(h, 'other'));
    h.chatInput.value = 'Edited message with a different action';
    select(h, 'other');
    const visible = [...h.chatMessages.children];
    const confirming = button.click();

    assert.equal(h.requests.length, 1);
    const request = h.requests[0];
    assert.equal(request.route, '/api/chat');
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, {
        approvedActionId: pending.id, localChatSessionId: 'origin',
        history: originHistory, locale: 'en-US',
    });
    assert.strictEqual(request.signal, h.getActiveAbortController('local').signal);
    assert.equal(request.signal.aborted, false);
    assert.equal(h.isModePending('local'), true);
    assert.equal(button.disabled, true);
    assert.equal(h.chatInput.value, 'Edited message with a different action');

    const history = [{ role: 'assistant', content: 'Fixture action confirmed.' }];
    const nextPending = approval('next-approval');
    response.resolve({ success: true, reply: 'Fixture action confirmed.', history, pendingActions: [nextPending] });
    await assert.doesNotReject(confirming);

    assert.equal(pending.status, 'confirmed');
    assert.strictEqual(session(h).history, history);
    assert.deepEqual(plain(session(h, 'other')), otherBefore);
    assert.deepEqual(h.chatMessages.children, visible);
    assert.equal(session(h).messages[1].forceSystem, true);
    assert.deepEqual(persisted(h).history, history);
    assert.equal(persisted(h).messages[0].pendingActions[0].status, 'confirmed');
    assert.deepEqual(persisted(h).messages[1].pendingActions, [nextPending]);
    select(h, 'origin');
    const [confirmedButton, nextButton] = h.chatMessages.querySelectorAll('.btn-suggest');
    assert.equal(confirmedButton.textContent, 'Confirmed');
    assert.equal(confirmedButton.disabled, true);
    assert.equal(nextButton.disabled, false);
    await confirmedButton.click();
    assert.equal(h.requests.length, 1);
    assertIdle(h);
});

for (const [label, respond, message] of [
    ['API refusal/expiry', () => ({ success: false, error: 'Approval expired', history: [] }), 'Approval expired'],
    ['rejected request', () => Promise.reject(new Error('Network unavailable')), 'Network unavailable'],
]) {
    test(`${label} leaves a failed, disabled consent without replacing history`, async () => {
        const h = harness(respond);
        const pending = approval();
        const before = plain(session(h).history);
        await assert.doesNotReject(propose(h, pending).click());

        assert.equal(pending.status, 'failed');
        assert.deepEqual(plain(session(h).history), before);
        assert.equal(session(h).messages[1].text, message);
        assert.equal(session(h).messages[1].forceSystem, true);
        assert.equal(persisted(h).messages[0].pendingActions[0].status, 'failed');
        select(h, 'other');
        select(h, 'origin');
        const button = h.chatMessages.querySelector('.btn-suggest');
        assert.equal(button.disabled, true);
        assert.match(button.textContent, /Confirmation failed/);
        await button.click();
        assert.equal(h.requests.length, 1);
        assertIdle(h);
    });
}

test('already expired consent is disabled initially and after re-render, with no API request', async () => {
    const h = harness();
    const pending = approval('expired', { expiresAt: '2000-01-01T00:00:00.000Z' });
    const button = propose(h, pending);
    assert.equal(button.disabled, true);
    assert.match(button.textContent, /Confirmation expired/);
    await button.click();
    select(h, 'other');
    select(h, 'origin');
    const restored = h.chatMessages.querySelector('.btn-suggest');
    assert.equal(restored.disabled, true);
    assert.match(restored.textContent, /Confirmation expired/);
    await restored.click();
    assert.equal(h.requests.length, 0);
});

test('global local busy state blocks repeated and parallel confirmations after re-render', async () => {
    const response = deferred();
    const h = harness(() => response.promise);
    propose(h);
    propose(h, approval('different-approval'));
    const confirming = h.chatMessages.querySelector('.btn-suggest').click();
    h.renderLocalChatMessages();
    const [repeat, parallel] = h.chatMessages.querySelectorAll('.btn-suggest');
    assert.equal(repeat.disabled, false, 'Use a fresh button so the busy guard, not disabled, is tested');
    assert.equal(parallel.disabled, false);
    await repeat.click();
    await parallel.click();
    assert.equal(h.requests.length, 1);
    assert.equal(session(h).messages[1].pendingActions[0].status, undefined);
    response.resolve({ success: true, reply: 'Only the first action ran.' });
    await confirming;
    assert.equal(session(h).messages[0].pendingActions[0].status, 'confirmed');
    assert.equal(session(h).messages[1].pendingActions[0].status, undefined);
    assertIdle(h);
});

test('Stop aborts confirmation, catches cancellation in its origin, and releases global busy state', async () => {
    const response = deferred();
    const h = harness((route, { signal }) => {
        signal.addEventListener('abort', () => {
            response.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
        }, { once: true });
        return response.promise;
    });
    const pending = approval();
    const button = propose(h, pending);
    propose(h, approval('second-action'));
    const secondButton = h.chatMessages.querySelectorAll('.btn-suggest')[1];
    const before = plain(session(h).history);
    const confirming = button.click();
    const controller = h.getActiveAbortController('local');
    select(h, 'other');
    const visible = [...h.chatMessages.children];
    const stopping = h.sendChat();

    assert.equal(controller.signal.aborted, true);
    assert.equal(h.isModePending('local'), true, 'Keep the lock until the aborted request settles');
    const secondClick = secondButton.click();
    assert.equal(h.requests.length, 1);
    await stopping;
    await secondClick;
    await assert.doesNotReject(confirming);

    assert.equal(pending.status, 'failed');
    assert.deepEqual(plain(session(h).history), before);
    assert.match(session(h).messages.at(-1).text, /Confirmation interrupted.*Check the task list/);
    assert.equal(session(h).messages.at(-1).forceSystem, true);
    assert.equal(persisted(h).messages[0].pendingActions[0].status, 'failed');
    assert.equal(session(h, 'other').messages.length, 0);
    assert.deepEqual(h.chatMessages.children, visible);
    select(h, 'origin');
    assert.equal(h.chatMessages.querySelector('.btn-suggest').disabled, true);
    assertIdle(h);
});

test('Stop during post-confirmation task refresh leaves the task queued without executing it', async () => {
    const refreshing = deferred();
    const refresh = deferred();
    const executed = [];
    const h = harness(() => ({ success: true, reply: 'Task queued.', task: true, executeTaskId: 'fixture-task' }));
    h.loadTodo = () => { refreshing.resolve(); return refresh.promise; };
    h.openTab = noop;
    h.executeTask = (id) => executed.push(id);
    const confirming = propose(h).click();
    await refreshing.promise;
    await h.sendChat();
    refresh.resolve();
    await confirming;
    assert.deepEqual(executed, []);
    assert.match(session(h).messages.at(-1).text, /Stopped before execution.*remains queued/);
    assertIdle(h);
});

test('Double Agent sends the remote follow-up only after local AI succeeds with the same request snapshot', async () => {
    const localReply = deferred();
    const followUp = deferred();
    const h = remoteHarness((_route, { body }) => body.target === 'remote-ai' ? followUp.promise : localReply.promise);
    h.chatInput.value = 'Please compare both answers';
    const sending = h.sendChat();
    const initialTargets = messageRequests(h).map((request) => request.body.mode === 'local-ai' ? 'local-ai' : 'remote-ai');

    h.selectedRemoteSessionId = 'session-b';
    h.currentLocale = 'zh-TW';
    localReply.resolve({ success: true });
    await flushAsync();
    followUp.resolve({ success: true });
    await sending;

    assert.deepEqual(initialTargets, ['local-ai'], 'Remote AI must not start before the local answer');
    const requests = messageRequests(h);
    assert.deepEqual(requests.map((request) => request.body.mode === 'local-ai' ? 'local-ai' : 'remote-ai'), ['local-ai', 'remote-ai']);
    assert.match(requests[0].route, /\/session-a\/message$/);
    assert.match(requests[1].route, /\/session-a\/message$/);
    assert.equal(requests[1].body.text, 'Please compare both answers');
    assert.equal(requests[1].body.locale, 'en-US');
    assert.strictEqual(requests[1].signal, requests[0].signal);
    assert.equal(h.stateLoads, 1);
    assertIdle(h);
});

test('Stop during the local answer prevents the remote follow-up and suppresses its late failure', async () => {
    const localReply = deferred();
    const followUp = deferred();
    const h = remoteHarness((_route, { body, signal }) => {
        if (body.target === 'remote-ai') return followUp.promise;
        signal?.addEventListener('abort', () => localReply.reject(abortError()), { once: true });
        return localReply.promise;
    });
    h.chatInput.value = 'Please compare both answers';
    const sending = h.sendChat();
    await h.sendChat();
    await sending;
    if (messageRequests(h).some((request) => request.body.target === 'remote-ai')) {
        followUp.reject(new Error('late follow-up failure'));
        await flushAsync();
    }

    assert.deepEqual(messageRequests(h).map((request) => request.body.mode === 'local-ai' ? 'local-ai' : 'remote-ai'), ['local-ai']);
    assert.equal(h.uiLogs.filter((entry) => entry.level === 'error').length, 0);
    assert.doesNotMatch(remoteBubbleHtml(h), /Remote AI follow-up failed/);
    assert.equal((remoteBubbleHtml(h).match(/Cancelled by user/g) || []).length, 1);
    assertIdle(h);
});

test('Stop while the remote follow-up request is in flight aborts it without a duplicate failure', async () => {
    const followUp = deferred();
    const h = remoteHarness((_route, { body, signal }) => {
        if (body.target !== 'remote-ai') return Promise.resolve({ success: true });
        signal?.addEventListener('abort', () => followUp.reject(abortError()), { once: true });
        return followUp.promise;
    });
    h.chatInput.value = 'Please compare both answers';
    const sending = h.sendChat();
    await flushAsync();

    const requests = messageRequests(h);
    assert.deepEqual(requests.map((request) => request.body.mode === 'local-ai' ? 'local-ai' : 'remote-ai'), ['local-ai', 'remote-ai']);
    const controller = h.getActiveAbortController('remote');
    assert.ok(controller, 'Stop must remain available until the follow-up request settles');
    assert.strictEqual(requests[1].signal, controller.signal);
    await h.sendChat();
    await sending;

    assert.equal(controller.signal.aborted, true);
    assert.equal(h.uiLogs.filter((entry) => entry.level === 'error').length, 0);
    assert.doesNotMatch(remoteBubbleHtml(h), /Remote AI follow-up failed/);
    assert.equal((remoteBubbleHtml(h).match(/Cancelled by user/g) || []).length, 1);
    assertIdle(h);
});

test('a genuine remote follow-up failure remains visible without replacing the local success', async () => {
    const h = remoteHarness((_route, { body }) => body.target === 'remote-ai'
        ? Promise.reject(new Error('follow-up unavailable'))
        : Promise.resolve({ success: true }));
    h.chatInput.value = 'Please compare both answers';
    await h.sendChat();
    await flushAsync();

    assert.deepEqual(messageRequests(h).map((request) => request.body.mode === 'local-ai' ? 'local-ai' : 'remote-ai'), ['local-ai', 'remote-ai']);
    assert.equal(h.uiLogs.filter((entry) => entry.level === 'error').length, 1);
    assert.match(h.uiLogs.find((entry) => entry.level === 'error').text, /Remote AI follow-up failed: follow-up unavailable/);
    assert.match(remoteBubbleHtml(h), /Remote AI follow-up failed: follow-up unavailable/);
    assert.doesNotMatch(remoteBubbleHtml(h), /Cancelled by user|Sorry, that request failed/);
    assertIdle(h);
});

test('a remote follow-up API refusal is reported instead of silently looking successful', async () => {
    const h = remoteHarness((_route, { body }) => body.target === 'remote-ai'
        ? { success: false, error: 'follow-up refused' }
        : { success: true });
    h.chatInput.value = 'Please compare both answers';
    await h.sendChat();
    await flushAsync();

    assert.equal(h.uiLogs.filter((entry) => entry.level === 'error').length, 1);
    assert.match(h.uiLogs.find((entry) => entry.level === 'error').text, /Remote AI follow-up failed: follow-up refused/);
    assert.match(remoteBubbleHtml(h), /Remote AI follow-up failed: follow-up refused/);
    assert.doesNotMatch(remoteBubbleHtml(h), /Cancelled by user|Sorry, that request failed/);
    assertIdle(h);
});

test('Stop while refreshing remote state after the local answer prevents the follow-up', async () => {
    const refresh = deferred();
    const h = remoteHarness(() => ({ success: true }));
    h.loadRemoteProfileAndState = () => refresh.promise;
    h.chatInput.value = 'Please compare both answers';
    const sending = h.sendChat();
    await flushAsync();

    assert.deepEqual(messageRequests(h).map((request) => request.body.mode === 'local-ai' ? 'local-ai' : 'remote-ai'), ['local-ai']);
    const controller = h.getActiveAbortController('remote');
    assert.ok(controller);
    await h.sendChat();
    refresh.resolve();
    await sending;

    assert.equal(controller.signal.aborted, true);
    assert.deepEqual(messageRequests(h).map((request) => request.body.mode === 'local-ai' ? 'local-ai' : 'remote-ai'), ['local-ai']);
    assert.equal(h.uiLogs.filter((entry) => entry.level === 'error').length, 0);
    assert.equal((remoteBubbleHtml(h).match(/Cancelled by user/g) || []).length, 1);
    assertIdle(h);
});

test('single-target Remote AI requests keep their existing signal and Stop behavior', async () => {
    const reply = deferred();
    const h = remoteHarness((_route, { signal }) => {
        signal?.addEventListener('abort', () => reply.reject(abortError()), { once: true });
        return reply.promise;
    });
    h.resolveRemoteTargets = () => ['remote-ai'];
    h.chatInput.value = '@Remote AI please answer';
    const sending = h.sendChat();

    const requests = messageRequests(h);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.mode, 'user');
    assert.equal(requests[0].body.target, 'remote-ai');
    assert.strictEqual(requests[0].signal, h.getActiveAbortController('remote').signal);
    await h.sendChat();
    await sending;

    assert.equal((remoteBubbleHtml(h).match(/Cancelled by user/g) || []).length, 1);
    assert.doesNotMatch(remoteBubbleHtml(h), /Remote AI follow-up failed/);
    assertIdle(h);
});

test('a failed local answer does not start the remote follow-up', async () => {
    const followUp = deferred();
    const h = remoteHarness((_route, { body }) => body.target === 'remote-ai'
        ? followUp.promise
        : Promise.resolve({ success: false, error: 'local unavailable' }));
    h.chatInput.value = 'Please compare both answers';
    await h.sendChat();
    await flushAsync();

    assert.deepEqual(messageRequests(h).map((request) => request.body.mode === 'local-ai' ? 'local-ai' : 'remote-ai'), ['local-ai']);
    assert.match(remoteBubbleHtml(h), /Sorry, that request failed.*local unavailable/);
    assert.equal(h.uiLogs.filter((entry) => entry.level === 'error').length, 0);
    assertIdle(h);
});
