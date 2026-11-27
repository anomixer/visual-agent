'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { test } = require('node:test');
const {
    RemoteAgentService,
    MAX_SESSION_MESSAGE_BYTES,
} = require(path.join(__dirname, '..', 'src', 'remote-agent.js'));

function createSocket() {
    const socket = new EventEmitter();
    socket.remoteAddress = '192.0.2.10';
    socket.remotePort = 50000;
    socket.destroyed = false;
    socket.ended = false;
    socket.write = () => true;
    socket.end = () => { socket.ended = true; };
    socket.destroy = () => { socket.destroyed = true; };
    return socket;
}

function createActiveService(options = {}) {
    const service = new RemoteAgentService(options);
    const socket = createSocket();
    service.handleHello(socket, { sessionId: 'message-budget', profile: { machineName: 'peer' } });
    service.respondToSession('message-budget', true, { machineName: 'local' });
    return { service, socket };
}

function messageStringBytes(message) {
    return Object.values(message).reduce(
        (total, value) => total + (typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0),
        0,
    );
}

function retainedBytes(messages) {
    return messages.reduce((total, message) => total + messageStringBytes(message), 0);
}

test('incoming image history evicts oldest messages when the byte budget is exceeded', () => {
    const { service, socket } = createActiveService();
    const imageDataUrl = `data:image/png;base64,${'A'.repeat(8 * 1024 * 1024)}`;

    for (let index = 0; index < 4; index += 1) {
        service.handlePayload(socket, {
            type: 'screen_share',
            id: `image-${index}`,
            imageDataUrl,
        });
    }

    const session = service.getSession('message-budget');
    assert.deepEqual(session.messages.map((message) => message.id), ['image-1', 'image-2', 'image-3']);
    assert.equal(session.messages.length, 3);
    assert.equal(session.messageBytes, retainedBytes(session.messages));
    assert.ok(session.messageBytes <= MAX_SESSION_MESSAGE_BYTES);
    assert.deepEqual(service.getState().sessions[0].messages.map((message) => message.id), ['image-1', 'image-2', 'image-3']);
});

test('outgoing image history uses the same byte budget', () => {
    const { service } = createActiveService();
    const imageDataUrl = `data:image/png;base64,${'B'.repeat(8 * 1024 * 1024)}`;

    for (let index = 0; index < 4; index += 1) {
        service.sendScreenShare('message-budget', { imageDataUrl, caption: `shot-${index}` });
    }

    const session = service.getSession('message-budget');
    assert.deepEqual(session.messages.map((message) => message.caption), ['shot-1', 'shot-2', 'shot-3']);
    assert.equal(session.messageBytes, retainedBytes(session.messages));
    assert.ok(session.messageBytes <= MAX_SESSION_MESSAGE_BYTES);
});

test('message-count eviction keeps byte accounting exact', () => {
    const { service } = createActiveService();

    for (let index = 0; index < 130; index += 1) {
        const suffix = index === 129 ? '繁體中文🙂' : '';
        service.sendChatMessage('message-budget', { text: `message-${index}-${'x'.repeat(index % 17)}${suffix}` });
    }

    const session = service.getSession('message-budget');
    assert.equal(session.messages.length, 120);
    assert.equal(session.messages[0].text.startsWith('message-10-'), true);
    assert.equal(session.messages.at(-1).text.startsWith('message-129-'), true);
    assert.equal(session.messageBytes, retainedBytes(session.messages));
});
