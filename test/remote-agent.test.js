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

function clearAllPendingTimers(service) {
    service.sessions.forEach((session) => service.clearPendingTimeout(session));
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
invalidIdService.clearPendingTimeout(invalidIdService.getSession(maxLengthId));
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

// 配額原本把 disconnected / rejected 也一併計入，使用者拒絕或逾時 32 次後合法連線永遠被拒，
// 只能重啟程式；配額應只計算仍在等待或連線中的 session。
const terminalQuotaService = createService();
for (let index = 0; index < 32; index++) {
    const socket = createSocket();
    terminalQuotaService.handleHello(socket, { sessionId: `terminal-${index}` });
    terminalQuotaService.handlePayload(socket, { type: 'hello_cancel' });
}
assert.equal(terminalQuotaService.sessions.size, 32);
assert.ok([...terminalQuotaService.sessions.values()].every((session) => session.status === 'disconnected'));
const afterTerminalsSocket = createSocket();
terminalQuotaService.handleHello(afterTerminalsSocket, { sessionId: 'after-terminals' });
assert.equal(terminalQuotaService.getSession('after-terminals').status, 'pending_approval');
clearAllPendingTimers(terminalQuotaService);
passed++;

// 進行中的 session 仍受限：32 個 pending / active 時，第 33 個 hello 必須被拒。
const liveQuotaService = createService();
for (let index = 0; index < 32; index++) {
    liveQuotaService.handleHello(createSocket(), { sessionId: `live-${index}` });
}
const liveOverflowSocket = createSocket();
liveQuotaService.handleHello(liveOverflowSocket, { sessionId: 'live-overflow' });
assert.equal(liveOverflowSocket.frames.at(-1).type, 'hello_reject');
assert.equal(liveOverflowSocket.ended, true);
assert.equal(liveQuotaService.getSession('live-overflow'), null);
assert.equal(liveQuotaService.sessions.size, 32);
clearAllPendingTimers(liveQuotaService);
passed++;

// 已結束的 session 需要保留給使用者回顧，但也不能無上限累積；超過上限時淘汰最舊的。
const pruneService = createService();
for (let index = 0; index < 33; index++) {
    const socket = createSocket();
    pruneService.handleHello(socket, { sessionId: `old-${index}` });
    pruneService.handlePayload(socket, { type: 'hello_cancel' });
}
assert.equal(pruneService.sessions.size, 33);
const afterPruneSocket = createSocket();
pruneService.handleHello(afterPruneSocket, { sessionId: 'after-prune' });
assert.equal(pruneService.getSession('old-0'), null);
assert.ok(pruneService.getSession('old-1'));
assert.equal(pruneService.getSession('after-prune').status, 'pending_approval');
assert.equal(pruneService.sessions.size, 33);
clearAllPendingTimers(pruneService);
passed++;

// 對方取消或逾時時同樣要結束 socket，不能只把狀態改成 disconnected。
const cancelService = createService();
const cancelSocket = createSocket();
cancelService.handleHello(cancelSocket, { sessionId: 'cancel-me' });
cancelService.handlePayload(cancelSocket, { type: 'hello_cancel' });
assert.equal(cancelService.getSession('cancel-me').status, 'disconnected');
assert.equal(cancelSocket.ended, true);
const peerTimeoutService = createService();
const peerTimeoutSocket = createSocket();
peerTimeoutService.handleHello(peerTimeoutSocket, { sessionId: 'timeout-me' });
peerTimeoutService.handlePayload(peerTimeoutSocket, { type: 'hello_timeout' });
assert.equal(peerTimeoutService.getSession('timeout-me').status, 'disconnected');
assert.equal(peerTimeoutSocket.ended, true);
passed++;

// 刪除尚未同意的邀請也必須清掉 60 秒 pending timer；只讓 callback 提早 return 仍會保留 closure 與 event-loop handle。
const forgetService = createService();
const forgetSocket = createSocket();
forgetService.handleHello(forgetSocket, { sessionId: 'forget-me', profile: { machineName: 'pending-peer' } });
const forgottenSession = forgetService.getSession('forget-me');
try {
    assert.ok(forgottenSession.pendingTimer);
    assert.ok(forgottenSession.pendingExpiresAt);
    assert.deepEqual(forgetService.forgetSession('forget-me'), { success: true });
    assert.equal(forgetService.getSession('forget-me'), null);
    assert.equal(forgottenSession.pendingTimer, null);
    assert.equal(forgottenSession.pendingExpiresAt, '');
    assert.equal(forgetSocket.destroyed, true);
    passed++;
} finally {
    forgetService.clearPendingTimeout(forgottenSession);
}

(async () => {
    const net = require('node:net');
    const originalCreateConnection = net.createConnection;
    // 若逾時機制被移除，connect() 會永遠不 settle；用保護計時器讓測試失敗而不是整支卡住。
    const withTestGuard = (promise, ms = 5000) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`test guard: connect() did not settle within ${ms} ms`)), ms);
        promise.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (error) => { clearTimeout(timer); reject(error); },
        );
    });

    // 連不上時原本要等 OS SYN 重試（約 21 秒）才失敗；connect() 必須有自己的逾時。
    const silentSocket = createSocket();
    net.createConnection = () => silentSocket;
    try {
        const timeoutService = new RemoteAgentService({ onError: () => {}, connectTimeoutMs: 30 });
        const startedAt = Date.now();
        let connectError = null;
        try {
            await withTestGuard(timeoutService.connect('192.0.2.1', { machineName: 'ME' }));
        } catch (error) {
            connectError = error;
        }
        assert.ok(connectError && /timed out/.test(connectError.message));
        assert.equal(silentSocket.destroyed, true);
        assert.ok(Date.now() - startedAt < 5000);
        assert.equal(timeoutService.sessions.size, 0);
    } finally {
        net.createConnection = originalCreateConnection;
    }
    passed++;

    // 正常連線仍必須建立 session 並送出 hello。
    const connectedSocket = createSocket();
    connectedSocket.setEncoding = () => {};
    net.createConnection = () => {
        setTimeout(() => connectedSocket.emit('connect'), 0);
        return connectedSocket;
    };
    try {
        const connectedService = new RemoteAgentService({ onError: () => {}, connectTimeoutMs: 2000 });
        const session = await connectedService.connect('192.0.2.2', { machineName: 'ME' });
        assert.equal(session.status, 'pending_approval');
        assert.equal(connectedSocket.frames[0].type, 'hello');
        assert.equal(connectedService.sessions.size, 1);
        clearAllPendingTimers(connectedService);
    } finally {
        net.createConnection = originalCreateConnection;
    }
    passed++;

    console.log(`\n[remote-agent.test] ${passed} passed`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
