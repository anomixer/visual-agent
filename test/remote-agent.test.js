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

// 對方接受後，發起端要保留自己的 local profile；acceptedBy 是對方的資料，不能覆寫本機身分，
// 否則 AI 交接文字會把本機 AI 講成對方機器。
const identityService = createService();
const identitySocket = createSocket();
const localProfile = { machineName: 'LOCAL-PC', userName: 'alice', agentName: 'local-ai' };
identityService.sessions.set('identity', {
    id: 'identity',
    direction: 'outgoing',
    status: 'pending_approval',
    socket: identitySocket,
    peer: { ip: '192.0.2.10' },
    local: { ...localProfile },
    messages: [],
});
identityService.socketToSessionId.set(identitySocket, 'identity');
identityService.handlePayload(identitySocket, {
    type: 'hello_ack',
    profile: { machineName: 'REMOTE-PC', userName: 'bob', agentName: 'remote-ai' },
    acceptedBy: { machineName: 'REMOTE-PC', userName: 'bob', agentName: 'remote-ai' },
});
assert.equal(identityService.getSession('identity').status, 'active');
assert.deepEqual(identityService.getSession('identity').local, localProfile);
assert.equal(identityService.getSession('identity').peer.machineName, 'REMOTE-PC');
assert.deepEqual(identityService.toClientSession(identityService.getSession('identity')).local, localProfile);
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

// 產品已移除 model share，但舊版 peer 仍可能送來這幾種封包；狀態需維持可解讀且不拋錯。
outgoingService.handlePayload(outgoingSocket, {
    type: 'model_share_request',
    createdAt: '2026-10-29T00:00:00.000Z',
    requestedBy: 'peer-user',
    proxyToken: 'token-1',
});
assert.equal(outgoingService.getSession('outgoing-session').modelShare.status, 'pending');
assert.equal(outgoingService.getSession('outgoing-session').modelShare.role, 'consumer');
assert.equal(outgoingService.getSession('outgoing-session').messages.at(-1).type, 'system_message');
passed++;

outgoingService.handlePayload(outgoingSocket, {
    type: 'model_share_response',
    accept: true,
    proxyToken: 'token-1',
});
assert.equal(outgoingService.getSession('outgoing-session').modelShare.status, 'active');
passed++;

outgoingService.handlePayload(outgoingSocket, {
    type: 'model_share_cancel',
    reason: 'stop',
});
assert.equal(outgoingService.getSession('outgoing-session').modelShare.status, 'idle');
assert.equal(outgoingService.getSession('outgoing-session').modelShare.lastStatus, 'active');
passed++;

// 同一個 sessionId 再次 hello 不得覆蓋既有 session：否則使用中的對話與歷史會被清空，
// 舊 socket 的後續封包也會被解讀成新 session 的訊息。
const duplicateService = createService();
const duplicateSocket1 = createSocket();
duplicateService.sessions.set('dup', {
    id: 'dup',
    direction: 'incoming',
    status: 'active',
    socket: duplicateSocket1,
    peer: { machineName: 'peer-one' },
    local: { machineName: 'me' },
    messages: [{ id: 'm1', text: 'history' }],
});
duplicateService.socketToSessionId.set(duplicateSocket1, 'dup');
const duplicateSocket2 = createSocket();
duplicateService.handleHello(duplicateSocket2, {
    sessionId: 'dup',
    profile: { machineName: 'peer-two' },
});
const survivingSession = duplicateService.getSession('dup');
assert.equal(survivingSession.status, 'active');
assert.equal(survivingSession.socket, duplicateSocket1);
assert.equal(survivingSession.messages.length, 1);
assert.equal(survivingSession.peer.machineName, 'peer-one');
assert.equal(duplicateSocket2.frames.at(-1).type, 'hello_reject');
assert.equal(duplicateSocket2.ended, true);
assert.equal(duplicateService.socketToSessionId.has(duplicateSocket2), false);
passed++;

// 對方提供的 sessionId 會直接當成 Map key。非字串（JSON number / object）建立的 session
// 無法用路由傳來的字串 id 定址，UI 同意視窗永遠得到 400、也無法刪除，只能等重啟。
const invalidIdService = createService();
const numericIdSocket = createSocket();
invalidIdService.handleHello(numericIdSocket, { sessionId: 12345, profile: { machineName: 'numeric-peer' } });
assert.equal(numericIdSocket.frames.at(-1).type, 'hello_reject');
assert.equal(numericIdSocket.ended, true);
assert.equal(invalidIdService.sessions.size, 0);
const objectIdSocket = createSocket();
invalidIdService.handleHello(objectIdSocket, { sessionId: { evil: true } });
assert.equal(objectIdSocket.frames.at(-1).type, 'hello_reject');
assert.equal(invalidIdService.sessions.size, 0);
const longIdSocket = createSocket();
invalidIdService.handleHello(longIdSocket, { sessionId: 's'.repeat(129) });
assert.equal(longIdSocket.frames.at(-1).type, 'hello_reject');
assert.equal(invalidIdService.sessions.size, 0);
const maxLengthId = 's'.repeat(128);
const maxIdSocket = createSocket();
invalidIdService.handleHello(maxIdSocket, { sessionId: maxLengthId });
assert.equal(invalidIdService.getSession(maxLengthId)?.status, 'pending_approval');
passed++;

// 對方宣告 disconnect 後本機也必須結束 socket，否則半開的連線會一直佔著直到對方行程被回收。
const disconnectService = createService();
const disconnectSocket = createSocket();
disconnectService.handleHello(disconnectSocket, { sessionId: 'bye', profile: { machineName: 'bye-peer' } });
disconnectService.respondToSession('bye', true, { machineName: 'me' });
disconnectService.handlePayload(disconnectSocket, { type: 'disconnect', reason: 'done' });
assert.equal(disconnectService.getSession('bye').status, 'disconnected');
assert.equal(disconnectSocket.ended, true);
disconnectService.handlePayload(disconnectSocket, { id: 'late-message', type: 'chat_message', text: 'late' });
assert.equal(disconnectService.getSession('bye').messages.some((item) => item.id === 'late-message'), false);
passed++;

const floodService = createService();
const floodSocket = createSocket();
floodSocket.setEncoding = () => {};
floodService.attachSocketHandlers(floodSocket);
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
