'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const declarations = [
    'createLocalChatSession', 'normalizeLocalChatSessions', 'saveLocalChatSessions',
    'getActiveLocalChatSession', 'touchLocalChatSession',
    'getActiveAbortController', 'setActiveAbortController', 'isModePending',
    'getThinkingIdForMode', 'setThinkingIdForMode', 'updateSendButtonState',
    'addLocalSessionMessage', 'renderLocalChatMessages',
    'appendChatBubble', 'appendAgentActionConsent', 'sendChat',
].map((name) => {
    // These top-level declarations end at an unindented closing brace.
    const matches = [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}\\r?$`, 'gm'))];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${name}`);
    return new vm.Script(matches[0][0], {
        filename: sourcePath,
        lineOffset: source.slice(0, matches[0].index).split('\n').length - 1,
    });
});

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
        localThinkingId: '', remoteThinkingId: '',
        chatMessages: new Element(), remoteChatMessages: new Element(), btnSend,
        chatInput: { value: '', style: {} }, isChalkboardAttachmentEnabled: false,
        document: { createElement: (tag) => new Element(tag) },
        localStorage: { setItem: (key, value) => storage.set(key, value) },
        normalizeImageDataUrl: (value) => value || '',
        isContainerPinnedToBottom: () => true,
        renderLocalSessionControls: noop, updateChatModeBadges: noop,
        renderMarkdown: (text) => String(text), linkifyPlainUrls: (text) => text,
        highlightMentionsInHtml: (html) => html, getMentionHighlightNames: () => [],
        bindExternalLinks: noop, t: (key) => key,
        getActiveRemoteSession: () => null,
        appendThinking: () => 'thinking-fixture', removeThinking: noop,
        startAgentStatusPolling: () => noop,
        extractChalkboardControlFromReply: (reply) => ({ displayText: reply }),
        buildAutoChalkboardDraft: () => null,
        $$: () => [],
        api: (route, options) => {
            requests.push({ route, ...options, body: plain(options.body) });
            return respond(route, options);
        },
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    return Object.assign(context, { requests, storage });
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
    assert.equal(h.getActiveAbortController('local'), null);
    assert.equal(h.chatAbortController, null);
    assert.equal(h.btnSend.classList.contains('stop'), false);
    assert.equal(h.btnSend.querySelector('.icon-send').classList.contains('hidden'), false);
    assert.equal(h.btnSend.querySelector('.icon-stop').classList.contains('hidden'), true);
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
