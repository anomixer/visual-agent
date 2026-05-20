const net = require('net');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_PORT = 19168;
const PENDING_SESSION_TIMEOUT_MS = 60 * 1000;
const REJECT_BAN_WINDOW_MS = 10 * 60 * 1000;
const REJECT_BAN_COUNT = 3;

function createId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeIp(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.startsWith('::ffff:')) return text.slice(7);
    return text === '::1' ? '127.0.0.1' : text;
}

function getLocalIPv4List() {
    const interfaces = os.networkInterfaces();
    const results = [];
    Object.values(interfaces).forEach((items) => {
        (items || []).forEach((item) => {
            const family = typeof item.family === 'string' ? item.family : String(item.family);
            if (family !== 'IPv4' || item.internal) return;
            results.push(item.address);
        });
    });
    return [...new Set(results)];
}

function buildIdleModelShare() {
    return {
        status: 'idle',
        role: 'none',
        proxyToken: '',
        expiresAt: '',
        requestedAt: '',
        requestedBy: '',
        respondedAt: '',
        respondedBy: '',
        cancelledAt: '',
        cancelledBy: '',
        provider: null,
        consumer: null,
        modelInfo: null,
        note: '',
        lastStatus: '',
    };
}

function buildIdleAiStatus() {
    return {
        localAi: 'idle',
        localAiLabel: '',
        remoteAi: 'idle',
        remoteAiLabel: '',
        updatedAt: '',
    };
}

class RemoteAgentService {
    constructor(options = {}) {
        this.port = Number(options.port) || DEFAULT_PORT;
        this.onStateChanged = typeof options.onStateChanged === 'function' ? options.onStateChanged : () => {};
        this.onMessage = typeof options.onMessage === 'function' ? options.onMessage : () => {};
        this.onError = typeof options.onError === 'function' ? options.onError : () => {};
        this.server = null;
        this.sessions = new Map();
        this.socketToSessionId = new WeakMap();
        this.rejectHistory = new Map();
        this.banList = new Map();
    }

    start() {
        if (this.server) return;
        this.server = net.createServer((socket) => this.handleIncomingSocket(socket));
        this.server.on('error', (error) => this.onError(error));
        this.server.listen(this.port, '0.0.0.0');
    }

    handleIncomingSocket(socket) {
        socket.setEncoding('utf8');
        socket._remoteAgentBuffer = '';
        socket.on('data', (chunk) => this.handleSocketData(socket, chunk));
        socket.on('error', (error) => {
            const session = this.getSessionBySocket(socket);
            if (session) {
                session.lastError = error.message;
                this.markDisconnected(session, 'error');
            }
            this.onError(error);
        });
        socket.on('close', () => {
            const session = this.getSessionBySocket(socket);
            if (session && session.status !== 'rejected' && session.status !== 'disconnected') {
                this.markDisconnected(session, 'socket_closed');
            }
        });
    }

    handleSocketData(socket, chunk) {
        socket._remoteAgentBuffer += chunk;
        const parts = socket._remoteAgentBuffer.split('\n');
        socket._remoteAgentBuffer = parts.pop();
        parts.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed) return;
            try {
                const payload = JSON.parse(trimmed);
                this.handlePayload(socket, payload);
            } catch (error) {
                this.onError(new Error(`Remote payload parse failed: ${error.message}`));
            }
        });
    }

    handlePayload(socket, payload) {
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'hello') {
            this.handleHello(socket, payload);
            return;
        }

        const session = this.getSessionBySocket(socket);
        if (!session) return;

        if (payload.type === 'hello_ack') {
            this.clearPendingTimeout(session);
            session.peer = { ...(session.peer || {}), ...(payload.profile || {}) };
            session.local = { ...(session.local || {}), ...(payload.acceptedBy || {}) };
            session.capabilities = {
                ...(session.capabilities || {}),
                modelShareEnabled: Boolean(payload.capabilities?.modelShareEnabled),
            };
            session.status = 'active';
            session.connectedAt = new Date().toISOString();
            session.lastEventAt = session.connectedAt;
            this.emitSystemMessage(session, 'system', `${session.peer.agentName || session.peer.machineName || 'Remote peer'} accepted the connection.`);
            this.onStateChanged();
            return;
        }

        if (payload.type === 'hello_reject') {
            this.clearPendingTimeout(session);
            session.status = 'rejected';
            session.lastEventAt = new Date().toISOString();
            this.emitSystemMessage(session, 'system', payload.reason || 'Remote peer rejected the connection.');
            socket.end();
            this.onStateChanged();
            return;
        }

        if (payload.type === 'hello_cancel') {
            this.clearPendingTimeout(session);
            this.emitSystemMessage(session, 'system', payload.reason || 'Peer cancelled the connection invitation.');
            this.markDisconnected(session, 'remote_cancelled');
            return;
        }

        if (payload.type === 'hello_timeout') {
            this.clearPendingTimeout(session);
            this.emitSystemMessage(session, 'system', payload.reason || 'Connection invitation timed out.');
            this.markDisconnected(session, 'timed_out');
            return;
        }

        if (payload.type === 'model_share_request') {
            session.modelShare = {
                ...buildIdleModelShare(),
                status: 'pending',
                role: 'consumer',
                requestedAt: payload.createdAt || new Date().toISOString(),
                requestedBy: payload.requestedBy || session.peer?.agentName || session.peer?.machineName || 'Remote peer',
                expiresAt: payload.expiresAt || '',
                proxyToken: payload.proxyToken || '',
                provider: payload.provider || session.peer || null,
                consumer: payload.consumer || session.local || null,
                modelInfo: payload.modelInfo || payload.provider?.modelInfo || null,
                note: payload.note || '',
            };
            this.emitSystemMessage(session, 'system', `${session.modelShare.requestedBy} wants to share ${session.peer?.agentName || session.peer?.machineName || 'their AI'} with this machine.`);
            this.onStateChanged();
            return;
        }

        if (payload.type === 'model_share_response') {
            session.modelShare = {
                ...buildIdleModelShare(),
                ...(session.modelShare || {}),
                status: payload.accept ? 'active' : 'rejected',
                role: payload.accept ? 'provider' : 'none',
                respondedAt: payload.createdAt || new Date().toISOString(),
                respondedBy: payload.respondedBy || session.peer?.agentName || session.peer?.machineName || 'Remote peer',
                proxyToken: payload.accept ? (payload.proxyToken || session.modelShare?.proxyToken || '') : '',
                expiresAt: payload.accept ? (payload.expiresAt || session.modelShare?.expiresAt || '') : '',
                provider: payload.provider || session.local || session.modelShare?.provider || null,
                consumer: payload.accept ? (payload.consumer || session.peer || session.modelShare?.consumer || null) : null,
                modelInfo: payload.modelInfo || session.modelShare?.modelInfo || null,
            };
            this.emitSystemMessage(session, 'system', payload.accept
                ? `${session.modelShare.respondedBy} accepted your shared model.`
                : `${session.modelShare.respondedBy} rejected your shared model.`);
            this.onStateChanged();
            return;
        }

        if (payload.type === 'model_share_cancel') {
            const previousStatus = session.modelShare?.status || 'idle';
            session.modelShare = {
                ...buildIdleModelShare(),
                status: 'idle',
                cancelledAt: payload.createdAt || new Date().toISOString(),
                cancelledBy: payload.cancelledBy || session.peer?.agentName || session.peer?.machineName || 'Remote peer',
                lastStatus: previousStatus,
            };
            this.emitSystemMessage(
                session,
                'system',
                payload.reason || `${session.modelShare.cancelledBy} stopped model sharing.`
            );
            this.onStateChanged();
            return;
        }

        if (payload.type === 'ai_status') {
            session.aiStatus = {
                ...(session.aiStatus || buildIdleAiStatus()),
                remoteAi: payload.status === 'thinking' ? 'thinking' : 'idle',
                remoteAiLabel: payload.senderLabel || session.peer?.agentName || session.peer?.machineName || 'Remote AI',
                updatedAt: payload.createdAt || new Date().toISOString(),
            };
            session.lastEventAt = new Date().toISOString();
            this.onStateChanged();
            return;
        }

        if (payload.type === 'chat_message' || payload.type === 'screen_share' || payload.type === 'system_message' || payload.type === 'chalkboard_state') {
            const message = {
                id: payload.id || createId('msg'),
                type: payload.type,
                direction: 'incoming',
                senderType: payload.senderType || 'user',
                senderLabel: payload.senderLabel || '',
                text: payload.text || '',
                imageDataUrl: payload.imageDataUrl || '',
                caption: payload.caption || '',
                width: Number(payload.width) || 0,
                height: Number(payload.height) || 0,
                hasContent: payload.hasContent !== false,
                target: payload.target || 'remote-user',
                createdAt: payload.createdAt || new Date().toISOString(),
            };
            session.lastEventAt = new Date().toISOString();
            if (payload.type === 'chat_message' && message.senderType === 'ai') {
                session.aiStatus = {
                    ...(session.aiStatus || buildIdleAiStatus()),
                    remoteAi: 'idle',
                    remoteAiLabel: message.senderLabel || session.peer?.agentName || session.peer?.machineName || 'Remote AI',
                    updatedAt: message.createdAt,
                };
            }
            session.messages.push(message);
            this.onMessage(session, message, payload);
            this.onStateChanged();
            return;
        }

        if (payload.type === 'disconnect') {
            this.emitSystemMessage(session, 'system', payload.reason || 'Remote peer disconnected.');
            this.markDisconnected(session, 'remote_disconnect');
        }
    }

    handleHello(socket, payload) {
        this.pruneRejectHistory();
        const sessionId = payload.sessionId || createId('session');
        const host = normalizeIp(socket.remoteAddress);
        const bannedUntil = this.banList.get(host) || 0;
        if (bannedUntil > Date.now()) {
            this.sendRaw(socket, {
                type: 'hello_reject',
                reason: 'Connection temporarily blocked due to repeated rejected invitations. Try again later.',
            });
            socket.end();
            return;
        }
        const session = {
            id: sessionId,
            direction: 'incoming',
            status: 'pending_approval',
            createdAt: new Date().toISOString(),
            lastEventAt: new Date().toISOString(),
            socket,
            host,
            port: socket.remotePort || this.port,
            local: null,
            peer: {
                machineName: payload.machineName || payload.profile?.machineName || '',
                userName: payload.userName || payload.profile?.userName || '',
                agentName: payload.agentName || payload.profile?.agentName || '',
                ip: payload.ip || payload.profile?.ip || normalizeIp(socket.remoteAddress),
                locale: payload.locale || payload.profile?.locale || 'zh-TW',
            },
            capabilities: {
                modelShareEnabled: false,
            },
            modelShare: buildIdleModelShare(),
            aiStatus: buildIdleAiStatus(),
            messages: [],
        };
        this.sessions.set(sessionId, session);
        this.socketToSessionId.set(socket, sessionId);
        this.schedulePendingTimeout(session);
        this.onStateChanged();
    }

    connect(host, localProfile = {}, port = DEFAULT_PORT) {
        return new Promise((resolve, reject) => {
            const sessionId = createId('session');
            const socket = net.createConnection({ host, port }, () => {
                const session = {
                    id: sessionId,
                    direction: 'outgoing',
                    status: 'pending_approval',
                    createdAt: new Date().toISOString(),
                    lastEventAt: new Date().toISOString(),
                    socket,
                    host,
                    port,
                    local: localProfile,
                    peer: { ip: host },
                    capabilities: {
                        modelShareEnabled: false,
                    },
                    modelShare: buildIdleModelShare(),
                    aiStatus: buildIdleAiStatus(),
                    messages: [],
                };
                this.sessions.set(sessionId, session);
                this.socketToSessionId.set(socket, sessionId);
                this.attachOutgoingSocket(socket);
                this.schedulePendingTimeout(session);
                this.sendRaw(socket, {
                    type: 'hello',
                    sessionId,
                    protocolVersion: 1,
                    ...localProfile,
                    profile: localProfile,
                    capabilities: {
                        modelShareEnabled: false,
                    },
                });
                this.emitSystemMessage(session, 'system', `Connecting to ${host}:${port}. Waiting for response...`);
                this.onStateChanged();
                resolve(this.toClientSession(session));
            });

            socket.once('error', (error) => {
                reject(error);
            });
        });
    }

    attachOutgoingSocket(socket) {
        socket.setEncoding('utf8');
        socket._remoteAgentBuffer = '';
        socket.on('data', (chunk) => this.handleSocketData(socket, chunk));
        socket.on('error', (error) => {
            const session = this.getSessionBySocket(socket);
            if (session) {
                session.lastError = error.message;
                this.markDisconnected(session, 'error');
            }
            this.onError(error);
        });
        socket.on('close', () => {
            const session = this.getSessionBySocket(socket);
            if (session && session.status !== 'rejected' && session.status !== 'disconnected') {
                this.markDisconnected(session, 'socket_closed');
            }
        });
    }

    respondToSession(sessionId, accept, localProfile = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found');
        if (session.status !== 'pending_approval') throw new Error('Session is no longer pending');
        this.clearPendingTimeout(session);

        session.local = localProfile;
        if (!accept) {
            this.recordRejectedInvitation(session.host);
            session.status = 'rejected';
            this.sendRaw(session.socket, { type: 'hello_reject', reason: 'Connection rejected by remote user.' });
            session.socket.end();
            this.onStateChanged();
            return this.toClientSession(session);
        }

        session.status = 'active';
        session.connectedAt = new Date().toISOString();
        session.lastEventAt = session.connectedAt;
        this.sendRaw(session.socket, {
            type: 'hello_ack',
            profile: localProfile,
            acceptedBy: localProfile,
            capabilities: {
                modelShareEnabled: session.modelShare?.status === 'active',
            },
        });
        this.emitSystemMessage(session, 'system', 'Connection accepted. Start chatting or supporting the remote machine.');
        this.onStateChanged();
        return this.toClientSession(session);
    }

    sendChatMessage(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const createdAt = new Date().toISOString();
        const message = {
            id: createId('msg'),
            type: 'chat_message',
            direction: 'outgoing',
            senderType: payload.senderType || 'user',
            senderLabel: payload.senderLabel || '',
            text: payload.text || '',
            imageDataUrl: '',
            caption: '',
            target: payload.target || 'remote-user',
            createdAt,
        };
        if (message.senderType === 'ai') {
            session.aiStatus = {
                ...(session.aiStatus || buildIdleAiStatus()),
                localAi: 'idle',
                localAiLabel: message.senderLabel || session.local?.agentName || 'Local AI',
                updatedAt: createdAt,
            };
        }
        session.messages.push(message);
        session.lastEventAt = message.createdAt;
        this.sendRaw(session.socket, message);
        this.onStateChanged();
        return message;
    }

    appendLocalChatMessage(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const message = {
            id: createId('msg'),
            type: 'chat_message',
            direction: 'local',
            senderType: payload.senderType || 'user',
            senderLabel: payload.senderLabel || '',
            text: payload.text || '',
            imageDataUrl: '',
            caption: '',
            target: payload.target || 'remote-user',
            createdAt: new Date().toISOString(),
        };
        session.messages.push(message);
        session.lastEventAt = message.createdAt;
        this.onStateChanged();
        return message;
    }

    sendScreenShare(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const message = {
            id: createId('msg'),
            type: 'screen_share',
            direction: 'outgoing',
            senderType: payload.senderType || 'user',
            senderLabel: payload.senderLabel || '',
            text: '',
            imageDataUrl: payload.imageDataUrl || '',
            caption: payload.caption || '',
            target: payload.target || 'remote-user',
            createdAt: new Date().toISOString(),
        };
        session.messages.push(message);
        session.lastEventAt = message.createdAt;
        this.sendRaw(session.socket, message);
        this.onStateChanged();
        return message;
    }

    sendSystemMessage(sessionId, text = '') {
        const session = this.requireActiveSession(sessionId);
        const message = {
            id: createId('msg'),
            type: 'system_message',
            direction: 'outgoing',
            senderType: 'system',
            senderLabel: 'System',
            text,
            imageDataUrl: '',
            caption: '',
            target: 'remote-user',
            createdAt: new Date().toISOString(),
        };
        session.messages.push(message);
        session.lastEventAt = message.createdAt;
        this.sendRaw(session.socket, message);
        this.onStateChanged();
        return message;
    }

    sendChalkboardState(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const message = {
            id: createId('chalk'),
            type: 'chalkboard_state',
            direction: 'outgoing',
            senderType: payload.senderType || 'user',
            senderLabel: payload.senderLabel || '',
            text: '',
            imageDataUrl: payload.imageDataUrl || '',
            caption: payload.caption || '',
            width: Number(payload.width) || 0,
            height: Number(payload.height) || 0,
            hasContent: payload.hasContent !== false,
            target: 'remote-user',
            createdAt: new Date().toISOString(),
        };
        session.messages.push(message);
        session.lastEventAt = message.createdAt;
        this.sendRaw(session.socket, message);
        this.onStateChanged();
        return message;
    }

    sendAiStatus(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const status = payload.status === 'thinking' ? 'thinking' : 'idle';
        const createdAt = new Date().toISOString();
        session.aiStatus = {
            ...(session.aiStatus || buildIdleAiStatus()),
            localAi: status,
            localAiLabel: payload.senderLabel || session.local?.agentName || 'Local AI',
            updatedAt: createdAt,
        };
        this.sendRaw(session.socket, {
            type: 'ai_status',
            status,
            senderLabel: payload.senderLabel || session.local?.agentName || 'Local AI',
            createdAt,
        });
        this.onStateChanged();
        return this.toClientSession(session);
    }

    requestModelShare(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const proxyToken = crypto.randomBytes(24).toString('hex');
        const expiresAt = new Date(Date.now() + ((Number(payload.ttlMs) || (15 * 60 * 1000)))).toISOString();
        session.modelShare = {
            ...buildIdleModelShare(),
            ...(session.modelShare || {}),
            status: 'pending',
            role: 'provider',
            requestedAt: new Date().toISOString(),
            requestedBy: payload.requestedBy || 'Local user',
            proxyToken,
            expiresAt,
            provider: payload.provider || session.local || null,
            consumer: payload.consumer || session.peer || null,
            modelInfo: payload.modelInfo || null,
            note: payload.note || '',
        };
        this.sendRaw(session.socket, {
            type: 'model_share_request',
            createdAt: session.modelShare.requestedAt,
            requestedBy: session.modelShare.requestedBy,
            proxyToken: session.modelShare.proxyToken,
            expiresAt: session.modelShare.expiresAt,
            provider: session.modelShare.provider,
            consumer: session.modelShare.consumer,
            modelInfo: session.modelShare.modelInfo,
            note: session.modelShare.note,
        });
        this.onStateChanged();
        return this.toClientSession(session);
    }

    respondModelShare(sessionId, accept, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        session.modelShare = {
            ...buildIdleModelShare(),
            ...(session.modelShare || {}),
            status: accept ? 'active' : 'rejected',
            role: accept ? 'consumer' : 'none',
            respondedAt: new Date().toISOString(),
            respondedBy: payload.respondedBy || 'Local user',
            proxyToken: accept ? (session.modelShare?.proxyToken || '') : '',
            expiresAt: accept ? (session.modelShare?.expiresAt || '') : '',
            consumer: accept ? (session.local || null) : null,
        };
        this.sendRaw(session.socket, {
            type: 'model_share_response',
            accept: !!accept,
            createdAt: session.modelShare.respondedAt,
            respondedBy: session.modelShare.respondedBy,
            proxyToken: accept ? (session.modelShare.proxyToken || '') : '',
            expiresAt: accept ? (session.modelShare.expiresAt || '') : '',
            provider: session.modelShare.provider || session.peer || null,
            consumer: accept ? (session.local || null) : null,
            modelInfo: session.modelShare.modelInfo || null,
        });
        this.onStateChanged();
        return this.toClientSession(session);
    }

    cancelModelShare(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const currentStatus = session.modelShare?.status || 'idle';
        session.modelShare = {
            ...buildIdleModelShare(),
            status: 'idle',
            cancelledAt: new Date().toISOString(),
            cancelledBy: payload.cancelledBy || 'Local user',
            lastStatus: currentStatus,
        };
        this.sendRaw(session.socket, {
            type: 'model_share_cancel',
            createdAt: session.modelShare.cancelledAt,
            cancelledBy: session.modelShare.cancelledBy,
            reason: payload.reason || 'Model sharing stopped by local user.',
        });
        this.onStateChanged();
        return this.toClientSession(session);
    }

    disconnectSession(sessionId, reason = 'Disconnected by local user.') {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        this.clearPendingTimeout(session);
        if (session.socket && !session.socket.destroyed) {
            if (session.status === 'pending_approval') {
                this.sendRaw(session.socket, {
                    type: 'hello_cancel',
                    reason: session.direction === 'outgoing'
                        ? 'Peer cancelled the connection invitation.'
                        : 'Connection invitation cancelled.',
                });
            } else {
                this.sendRaw(session.socket, { type: 'disconnect', reason });
            }
            session.socket.end();
        }
        this.markDisconnected(session, session.status === 'pending_approval' ? 'local_cancelled' : 'local_disconnect');
    }

    forgetSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return { success: true };
        if (session.status === 'active') {
            throw new Error('Active remote session cannot be deleted. Disconnect it first.');
        }
        if (session.socket && !session.socket.destroyed) {
            session.socket.destroy();
        }
        this.sessions.delete(sessionId);
        this.onStateChanged();
        return { success: true };
    }

    requireActiveSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error('Session not found');
        if (session.status !== 'active') throw new Error('Session is not active');
        return session;
    }

    markDisconnected(session, reason = 'disconnected') {
        this.clearPendingTimeout(session);
        session.status = 'disconnected';
        session.disconnectedAt = new Date().toISOString();
        session.lastEventAt = session.disconnectedAt;
        session.disconnectReason = reason;
        session.modelShare = {
            ...buildIdleModelShare(),
            lastStatus: session.modelShare?.status || 'idle',
            cancelledAt: session.disconnectedAt,
            cancelledBy: 'System',
        };
        this.onStateChanged();
    }

    schedulePendingTimeout(session) {
        this.clearPendingTimeout(session);
        session.pendingExpiresAt = new Date(Date.now() + PENDING_SESSION_TIMEOUT_MS).toISOString();
        session.pendingTimer = setTimeout(() => {
            if (!this.sessions.has(session.id) || session.status !== 'pending_approval') return;
            try {
                if (session.socket && !session.socket.destroyed) {
                    this.sendRaw(session.socket, {
                        type: 'hello_timeout',
                        reason: 'Connection invitation timed out.',
                    });
                    session.socket.end();
                }
            } catch {
                // ignore
            }
            this.emitSystemMessage(session, 'system', 'Connection invitation timed out.');
            this.markDisconnected(session, 'timed_out');
        }, PENDING_SESSION_TIMEOUT_MS);
    }

    clearPendingTimeout(session) {
        if (session?.pendingTimer) {
            clearTimeout(session.pendingTimer);
            session.pendingTimer = null;
        }
        if (session) {
            session.pendingExpiresAt = '';
        }
    }

    pruneRejectHistory() {
        const now = Date.now();
        for (const [host, timestamps] of this.rejectHistory.entries()) {
            const fresh = timestamps.filter((ts) => now - ts < REJECT_BAN_WINDOW_MS);
            if (fresh.length) {
                this.rejectHistory.set(host, fresh);
            } else {
                this.rejectHistory.delete(host);
            }
        }
        for (const [host, bannedUntil] of this.banList.entries()) {
            if (bannedUntil <= now) {
                this.banList.delete(host);
            }
        }
    }

    recordRejectedInvitation(host = '') {
        const key = normalizeIp(host);
        if (!key) return;
        this.pruneRejectHistory();
        const now = Date.now();
        const timestamps = [...(this.rejectHistory.get(key) || []), now]
            .filter((ts) => now - ts < REJECT_BAN_WINDOW_MS);
        this.rejectHistory.set(key, timestamps);
        if (timestamps.length >= REJECT_BAN_COUNT) {
            this.banList.set(key, now + REJECT_BAN_WINDOW_MS);
        }
    }

    emitSystemMessage(session, senderType, text) {
        session.messages.push({
            id: createId('msg'),
            type: 'system_message',
            direction: 'local',
            senderType,
            senderLabel: 'System',
            text,
            imageDataUrl: '',
            caption: '',
            target: 'remote-user',
            createdAt: new Date().toISOString(),
        });
    }

    sendRaw(socket, payload) {
        if (!socket || socket.destroyed) return;
        socket.write(`${JSON.stringify(payload)}\n`);
    }

    getSessionBySocket(socket) {
        const sessionId = this.socketToSessionId.get(socket);
        return sessionId ? this.sessions.get(sessionId) : null;
    }

    getState() {
        return {
            port: this.port,
            localIps: getLocalIPv4List(),
            sessions: [...this.sessions.values()].map((session) => this.toClientSession(session)),
            pendingApprovals: [...this.sessions.values()]
                .filter((session) => session.status === 'pending_approval' && session.direction === 'incoming')
                .map((session) => this.toClientSession(session)),
        };
    }

    getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    toClientSession(session) {
        return {
            id: session.id,
            direction: session.direction,
            status: session.status,
            createdAt: session.createdAt,
            connectedAt: session.connectedAt || null,
            disconnectedAt: session.disconnectedAt || null,
            lastEventAt: session.lastEventAt || session.createdAt,
            disconnectReason: session.disconnectReason || '',
            host: session.host,
            port: session.port,
            local: session.local || null,
            peer: session.peer || null,
            capabilities: session.capabilities || { modelShareEnabled: false },
            modelShare: session.modelShare || { status: 'idle' },
            aiStatus: session.aiStatus || buildIdleAiStatus(),
            messages: session.messages.slice(-120),
        };
    }
}

module.exports = {
    DEFAULT_REMOTE_PORT: DEFAULT_PORT,
    RemoteAgentService,
    getLocalIPv4List,
    normalizeIp,
};
