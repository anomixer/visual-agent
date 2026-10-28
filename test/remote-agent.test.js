'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { RemoteAgentService } = require(path.join(__dirname, '..', 'src', 'remote-agent.js'));

let passed = 0;

function createSocket() {
    const socket = new EventEmitter();
    socket.remoteAddress = '192.0.2.10';
    socket.remotePort = 50000;
    socket.destroyed = false;
    socket.frames = [];
    socket.write = (text) => {
        socket.frames.push(JSON.parse(text));
        return true;
    };
    socket.end = () => { socket.ended = true; };
    socket.destroy = () => { socket.destroyed = true; };
    return socket;
}

function createService() {
    return new RemoteAgentService({ onError: () => {} });
}

const incomingService = createService();
const incomingSocket = createSocket();
incomingService.handleHello(incomingSocket, {
    sessionId: 'incoming-session',
    profile: { machineName: 'peer', agentName: 'peer-ai' },
});
incomingService.handlePayload(incomingSocket, {
    type: 'hello_ack',
    profile: { machineName: 'attacker' },
});
assert.equal(incomingService.getSession('incoming-session').status, 'pending_approval');
passed++;

incomingService.handlePayload(incomingSocket, {
    id: 'before-approval',
    type: 'chat_message',
    text: 'must not be accepted',
});
assert.equal(incomingService.getSession('incoming-session').messages.some((item) => item.id === 'before-approval'), false);
passed++;

incomingService.respondToSession('incoming-session', true, { machineName: 'local' });
assert.equal(incomingService.getSession('incoming-session').status, 'active');
incomingService.handlePayload(incomingSocket, {
    id: 'after-approval',
    type: 'chat_message',
    text: 'accepted',
});
assert.equal(incomingService.getSession('incoming-session').messages.some((item) => item.id === 'after-approval'), true);
passed++;

const outgoingService = createService();
const outgoingSocket = createSocket();
outgoingService.sessions.set('outgoing-session', {
    id: 'outgoing-session',
    direction: 'outgoing',
    status: 'pending_approval',
    socket: outgoingSocket,
    peer: {},
    local: {},
    messages: [],
});
outgoingService.socketToSessionId.set(outgoingSocket, 'outgoing-session');
outgoingService.handlePayload(outgoingSocket, {
    type: 'hello_ack',
    profile: { machineName: 'peer' },
});
assert.equal(outgoingService.getSession('outgoing-session').status, 'active');
passed++;

outgoingService.sendChalkboardState('outgoing-session', { imageDataUrl: 'first' });
outgoingService.sendChalkboardState('outgoing-session', { imageDataUrl: 'second' });
assert.equal(outgoingSocket.frames.at(-1).revision, 2);
outgoingService.handlePayload(outgoingSocket, {
    id: 'remote-chalkboard',
    type: 'chalkboard_state',
    imageDataUrl: 'remote',
    revision: 7,
});
assert.equal(outgoingService.getSession('outgoing-session').messages.at(-1).revision, 7);
passed++;

const floodService = createService();
const floodSocket = createSocket();
floodSocket.setEncoding = () => {};
floodService.handleIncomingSocket(floodSocket);
floodService.handleSocketData(floodSocket, 'x'.repeat(17 * 1024 * 1024));
assert.equal(floodSocket.destroyed, true);
passed++;

const boundedService = createService();
const boundedSocket = createSocket();
boundedService.sessions.set('bounded', {
    id: 'bounded',
    direction: 'outgoing',
    status: 'active',
    socket: boundedSocket,
    peer: {},
    local: {},
    messages: [],
});
for (let index = 0; index < 130; index++) {
    boundedService.sendChatMessage('bounded', { text: String(index) });
}
assert.equal(boundedService.getSession('bounded').messages.length, 120);
assert.equal(boundedService.getSession('bounded').messages[0].text, '10');
passed++;

console.log(`\n[remote-agent.test] ${passed} passed`);
