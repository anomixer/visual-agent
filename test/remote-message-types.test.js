'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { RemoteAgentService } = require(path.join(__dirname, '..', 'src', 'remote-agent.js'));

function createSocket() {
    const socket = new EventEmitter();
    socket.remoteAddress = '192.0.2.10';
    socket.remotePort = 50000;
    socket.destroyed = false;
    socket.ended = false;
    socket.frames = [];
    socket.write = (text) => {
        socket.frames.push(JSON.parse(text));
        return true;
    };
    socket.end = () => { socket.ended = true; };
    socket.destroy = () => { socket.destroyed = true; };
    return socket;
}

function createActiveService(options = {}) {
    const service = new RemoteAgentService(options);
    const socket = createSocket();
    service.handleHello(socket, { sessionId: 'message-types', profile: { machineName: 'peer' } });
    service.respondToSession('message-types', true, { machineName: 'local' });
    return { service, socket };
}

test('incoming remote message fields are normalized before entering session state', () => {
    let callbackPayload = null;
    const { service, socket } = createActiveService({
        onMessage: (_session, _message, payload) => { callbackPayload = payload; },
    });

    service.handlePayload(socket, {
        type: 'screen_share',
        id: { nested: true },
        senderType: { nested: true },
        senderLabel: 42,
        text: { nested: true },
        imageDataUrl: { nested: true },
        caption: { nested: true },
        width: '640',
        height: 'bad',
        hasContent: 0,
        revision: '9',
        target: { nested: true },
        locale: 7,
        createdAt: { nested: true },
    });

    const message = service.getSession('message-types').messages.at(-1);
    assert.match(message.id, /^msg_/);
    assert.equal(message.type, 'screen_share');
    assert.equal(message.direction, 'incoming');
    assert.equal(message.senderType, 'user');
    assert.equal(message.senderLabel, '');
    assert.equal(message.text, '');
    assert.equal(message.imageDataUrl, '');
    assert.equal(message.caption, '');
    assert.equal(message.width, 640);
    assert.equal(message.height, 0);
    assert.equal(message.hasContent, true);
    assert.equal(message.revision, 9);
    assert.equal(message.target, 'remote-user');
    assert.equal(message.locale, '');
    assert.equal(new Date(message.createdAt).toISOString(), message.createdAt);
    assert.equal(callbackPayload.caption, '');
    assert.equal(callbackPayload.locale, '');
});

test('valid incoming remote message fields remain unchanged', () => {
    const { service, socket } = createActiveService();
    const payload = {
        id: 'valid-message',
        type: 'chat_message',
        senderType: 'ai',
        senderLabel: 'Remote AI',
        text: 'hello',
        imageDataUrl: 'data:image/png;base64,AAAA',
        caption: 'caption',
        width: 800,
        height: 600,
        hasContent: false,
        revision: 4,
        target: 'remote-ai',
        locale: 'en-US',
        createdAt: '2026-11-27T12:00:00.000Z',
    };

    service.handlePayload(socket, payload);

    const message = service.getSession('message-types').messages.at(-1);
    for (const [key, value] of Object.entries(payload)) assert.equal(message[key], value, key);
});

test('outgoing remote messages keep the same string-field invariant', () => {
    const { service } = createActiveService();

    const chat = service.sendChatMessage('message-types', {
        senderType: 'ai',
        senderLabel: 9,
        text: { nested: true },
        target: { nested: true },
        locale: { nested: true },
    });
    assert.equal(chat.senderLabel, '');
    assert.equal(chat.text, '');
    assert.equal(chat.target, 'remote-user');
    assert.equal(chat.locale, '');

    const screen = service.sendScreenShare('message-types', {
        senderLabel: {},
        imageDataUrl: {},
        caption: { nested: true },
        target: {},
    });
    assert.equal(screen.senderLabel, '');
    assert.equal(screen.imageDataUrl, '');
    assert.equal(screen.caption, '');
    assert.equal(screen.target, 'remote-user');

    const system = service.sendSystemMessage('message-types', { nested: true });
    assert.equal(system.text, '');
});

function extractFunction(name) {
    const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const pattern = new RegExp(`^function ${name}\\([^)]*\\) \\{[^]*?^\\}\\r?$`, 'gm');
    const matches = [...source.matchAll(pattern)];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${name}`);
    return matches[0][0];
}

test('remote rendering tolerates malformed text and caption fields', () => {
    const bubbles = [];
    const session = {
        id: 'render-types',
        status: 'active',
        messages: [
            { id: 'bad-screen', type: 'screen_share', caption: { nested: true }, senderType: 'user', direction: 'incoming' },
            { id: 'numeric-screen', type: 'screen_share', caption: 42, senderType: 'user', direction: 'incoming' },
            { id: 'bad-system', type: 'system_message', text: { nested: true }, senderType: 'system', direction: 'incoming' },
            { id: 'good-screen', type: 'screen_share', caption: 'valid caption', senderType: 'user', direction: 'incoming' },
        ],
    };
    const context = {
        console,
        currentLocale: 'zh-TW',
        remoteChatMessages: {
            innerHTML: '',
            scrollTop: 0,
            scrollHeight: 100,
            appendChild() {},
        },
        isContainerPinnedToBottom: () => true,
        getActiveRemoteSession: () => session,
        getThinkingIdForMode: () => null,
        document: { createElement: () => ({ className: '', textContent: '' }) },
        t: (key) => key,
        extractChalkboardControlFromReply: (text) => ({ displayText: String(text || ''), draft: null }),
        extractSuggestionsFromReply: (text) => ({ displayText: String(text || ''), suggestions: [] }),
        extractActionDirectivesFromReply: () => [],
        buildAutoChalkboardDraft: () => null,
        appliedRemoteDraftMessageIds: new Set(),
        applyAgentChalkboardDraft() {},
        applyRemoteChalkboardState() {},
        appendRemoteDirectiveConsent() {},
        appendThinking() {},
        appendChatBubble: (_role, text) => bubbles.push(text),
    };
    vm.createContext(context);
    vm.runInContext(['formatRemoteSender', 'shouldRenderRemoteMessage', 'renderRemoteMessages'].map(extractFunction).join('\n'), context);

    assert.doesNotThrow(() => context.renderRemoteMessages());
    assert.deepEqual(bubbles, ['已傳送畫面', '已傳送畫面', '', 'valid caption']);
});
