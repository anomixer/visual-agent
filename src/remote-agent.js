const net = require('net');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_PORT = 19168;
const PENDING_SESSION_TIMEOUT_MS = 60 * 1000;
const REJECT_BAN_WINDOW_MS = 10 * 60 * 1000;
const REJECT_BAN_COUNT = 3;
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_PENDING_WRITE_BYTES = 16 * 1024 * 1024;
const MAX_SESSION_MESSAGES = 120;
const MAX_SESSION_MESSAGE_BYTES = 32 * 1024 * 1024;
const MAX_SESSIONS = 32;
const MAX_TERMINAL_SESSIONS = 32;
const MAX_SESSION_ID_LENGTH = 128;
const CONNECT_TIMEOUT_MS = 10 * 1000;

function createId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function isTerminalSessionStatus(status) {
    return status === 'disconnected' || status === 'rejected';
}

function normalizeIp(value = '') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.startsWith('::ffff:')) return text.slice(7);
    return text === '::1' ? '127.0.0.1' : text;
}

function normalizeRemoteString(value) {
    return typeof value === 'string' ? value : '';
}

function remoteMessageStringBytes(message) {
    let bytes = 0;
    for (const value of Object.values(message)) {
        if (typeof value === 'string') bytes += Buffer.byteLength(value, 'utf8');
    }
    return bytes;
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

function peerLabel(session, fallback = 'Remote peer') {
    return session?.peer?.agentName || session?.peer?.machineName || fallback;
}

class RemoteAgentService {
    constructor(options = {}) {
        this.port = Number(options.port) || DEFAULT_PORT;
        this.connectTimeoutMs = Number(options.connectTimeoutMs) || CONNECT_TIMEOUT_MS;
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
        this.server = net.createServer((socket) => this.attachSocketHandlers(socket));
        this.server.on('error', (error) => this.onError(error));
        this.server.listen(this.port, '0.0.0.0');
    }

    attachSocketHandlers(socket) {
        this.resetRemoteFrameBuffer(socket);
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
            this.resetRemoteFrameBuffer(socket);
            const session = this.getSessionBySocket(socket);
            if (session && session.status !== 'rejected' && session.status !== 'disconnected') {
                this.markDisconnected(session, 'socket_closed');
            }
        });
    }

    resetRemoteFrameBuffer(socket) {
        socket._remoteAgentBuffer = Buffer.alloc(0);
        socket._remoteAgentBufferLength = 0;
    }

    appendRemoteFrameBytes(socket, segment) {
        const length = socket._remoteAgentBufferLength;
        const required = length + segment.length;
        if (required > MAX_FRAME_BYTES) return false;
        let buffer = socket._remoteAgentBuffer;
        if (buffer.length < required) {
            const capacity = Math.min(MAX_FRAME_BYTES, Math.max(required, buffer.length ? buffer.length * 2 : 4096));
            const grown = Buffer.allocUnsafe(capacity);
            if (length) buffer.copy(grown, 0, 0, length);
            socket._remoteAgentBuffer = grown;
            buffer = grown;
        }
        segment.copy(buffer, length);
        socket._remoteAgentBufferLength = required;
        return true;
    }

    rejectRemoteFrame(socket) {
        this.resetRemoteFrameBuffer(socket);
        this.onError(new Error('Remote frame exceeded the 16 MiB limit.'));
        socket.destroy();
    }

    shrinkRemoteFrameBuffer(socket) {
        const length = socket._remoteAgentBufferLength;
        if (length === 0) {
            this.resetRemoteFrameBuffer(socket);
            return;
        }
        const buffer = socket._remoteAgentBuffer;
        if (buffer.length <= Math.max(4096, length * 2)) return;
        const capacity = Math.min(MAX_FRAME_BYTES, Math.max(4096, length * 2));
        const shrunk = Buffer.allocUnsafe(capacity);
        buffer.copy(shrunk, 0, 0, length);
        socket._remoteAgentBuffer = shrunk;
    }

    processRemoteFrame(socket) {
        const frame = socket._remoteAgentBuffer.subarray(0, socket._remoteAgentBufferLength);
        socket._remoteAgentBufferLength = 0;
        const trimmed = frame.toString('utf8').trim();
        if (!trimmed) return;
        try {
            const payload = JSON.parse(trimmed);
            this.handlePayload(socket, payload);
        } catch (error) {
            this.onError(new Error(`Remote payload parse failed: ${error.message}`));
        }
    }

    handleSocketData(socket, chunk) {
        if (!Buffer.isBuffer(socket._remoteAgentBuffer)) this.resetRemoteFrameBuffer(socket);
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
        let start = 0;
        for (let index = 0; index < data.length; index += 1) {
            if (data[index] !== 0x0a) continue;
            if (!this.appendRemoteFrameBytes(socket, data.subarray(start, index))) {
                this.rejectRemoteFrame(socket);
                return;
            }
            this.processRemoteFrame(socket);
            start = index + 1;
        }
        if (!this.appendRemoteFrameBytes(socket, data.subarray(start))) {
            this.rejectRemoteFrame(socket);
            return;
        }
        this.shrinkRemoteFrameBuffer(socket);
    }

    handlePayload(socket, payload) {
        if (!payload || typeof payload !== 'object') return;
        const existingSession = this.getSessionBySocket(socket);
        if (payload.type === 'hello') {
            if (!existingSession) this.handleHello(socket, payload);
            return;
        }

        const session = existingSession;
        if (!session) return;

        if (payload.type === 'hello_ack') {
            if (session.direction !== 'outgoing' || session.status !== 'pending_approval') return;
            this.clearPendingTimeout(session);
            session.peer = { ...(session.peer || {}), ...(payload.profile || {}) };
            session.capabilities = {
                ...(session.capabilities || {}),
                modelShareEnabled: Boolean(payload.capabilities?.modelShareEnabled),
            };
            session.status = 'active';
            session.connectedAt = new Date().toISOString();
            session.lastEventAt = session.connectedAt;
            this.emitSystemMessage(session, 'system', `${peerLabel(session)} accepted the connection.`);
            this.onStateChanged();
            return;
        }

        if (payload.type === 'hello_reject') {
            if (session.direction !== 'outgoing' || session.status !== 'pending_approval') return;
            this.clearPendingTimeout(session);
            session.status = 'rejected';
            session.lastEventAt = new Date().toISOString();
            session.bannedUntil = payload.bannedUntil || '';
            this.emitSystemMessage(session, 'system', payload.reason || 'Remote peer rejected the connection.');
            socket.end();
            this.onStateChanged();
            return;
        }

        if (payload.type === 'hello_cancel') {
            if (session.status !== 'pending_approval') return;
            this.clearPendingTimeout(session);
            this.emitSystemMessage(session, 'system', payload.reason || 'Peer cancelled the connection invitation.');
            this.markDisconnected(session, 'remote_cancelled');
            if (session.socket && !session.socket.destroyed) session.socket.end();
            return;
        }

        if (payload.type === 'hello_timeout') {
            if (session.status !== 'pending_approval') return;
            this.clearPendingTimeout(session);
            this.emitSystemMessage(session, 'system', payload.reason || 'Connection invitation timed out.');
            this.markDisconnected(session, 'timed_out');
            if (session.socket && !session.socket.destroyed) session.socket.end();
            return;
        }

        if (session.status !== 'active') return;

        if (payload.type === 'model_share_request') {
            session.modelShare = {
                ...buildIdleModelShare(),
                status: 'pending',
                role: 'consumer',
                requestedAt: payload.createdAt || new Date().toISOString(),
                requestedBy: payload.requestedBy || peerLabel(session),
                expiresAt: payload.expiresAt || '',
                proxyToken: payload.proxyToken || '',
                provider: payload.provider || session.peer || null,
                consumer: payload.consumer || session.local || null,
                modelInfo: payload.modelInfo || payload.provider?.modelInfo || null,
                note: payload.note || '',
            };
            this.emitSystemMessage(session, 'system', `${session.modelShare.requestedBy} wants to share ${peerLabel(session, 'their AI')} with this machine.`);
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
                respondedBy: payload.respondedBy || peerLabel(session),
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
                cancelledBy: payload.cancelledBy || peerLabel(session),
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
                remoteAiLabel: payload.senderLabel || peerLabel(session, 'Remote AI'),
                updatedAt: payload.createdAt || new Date().toISOString(),
            };
            session.lastEventAt = new Date().toISOString();
            this.onStateChanged();
            return;
        }

        if (payload.type === 'chat_message' || payload.type === 'screen_share' || payload.type === 'system_message' || payload.type === 'chalkboard_state') {
            const message = {
                id: normalizeRemoteString(payload.id) || createId('msg'),
                type: payload.type,
                direction: 'incoming',
                senderType: normalizeRemoteString(payload.senderType) || 'user',
                senderLabel: normalizeRemoteString(payload.senderLabel),
                text: normalizeRemoteString(payload.text),
                imageDataUrl: normalizeRemoteString(payload.imageDataUrl),
                caption: normalizeRemoteString(payload.caption),
                width: Number(payload.width) || 0,
                height: Number(payload.height) || 0,
                hasContent: payload.hasContent !== false,
                revision: Number(payload.revision) || 0,
                target: normalizeRemoteString(payload.target) || 'remote-user',
                locale: normalizeRemoteString(payload.locale),
                createdAt: normalizeRemoteString(payload.createdAt) || new Date().toISOString(),
            };
            session.lastEventAt = new Date().toISOString();
            if (payload.type === 'chat_message' && message.senderType === 'ai') {
                session.aiStatus = {
                    ...(session.aiStatus || buildIdleAiStatus()),
                    remoteAi: 'idle',
                    remoteAiLabel: message.senderLabel || peerLabel(session, 'Remote AI'),
                    updatedAt: message.createdAt,
                };
            }
            this.appendSessionMessage(session, message);
            this.onMessage(session, message, { ...payload, ...message });
            this.onStateChanged();
            return;
        }

        if (payload.type === 'disconnect') {
            this.emitSystemMessage(session, 'system', payload.reason || 'Remote peer disconnected.');
            this.markDisconnected(session, 'remote_disconnect');
            if (session.socket && !session.socket.destroyed) session.socket.end();
        }
    }

    handleHello(socket, payload) {
        const providedSessionId = payload.sessionId;
        if (providedSessionId !== undefined && providedSessionId !== null && providedSessionId !== '') {
            const invalidId = typeof providedSessionId !== 'string'
                || providedSessionId.length > MAX_SESSION_ID_LENGTH
                || /[\u0000-\u001f\u007f]/.test(providedSessionId);
            if (invalidId) {
                this.sendRaw(socket, {
                    type: 'hello_reject',
                    reason: 'Session ID must be a string of at most 128 characters without control characters.',
                });
                socket.end();
                return;
            }
        }
        this.pruneRejectHistory();
        this.pruneTerminalSessions();
        if (this.liveSessionCount() >= MAX_SESSIONS) {
            this.sendRaw(socket, { type: 'hello_reject', reason: 'Too many remote sessions. Disconnect an existing session first.' });
            socket.end();
            return;
        }
        const sessionId = payload.sessionId || createId('session');
        if (this.sessions.has(sessionId)) {
            this.sendRaw(socket, {
                type: 'hello_reject',
                reason: 'Session ID is already in use. Use a new session ID for this connection.',
            });
            socket.end();
            return;
        }
        const host = normalizeIp(socket.remoteAddress);
        const bannedUntil = this.banList.get(host) || 0;
        if (bannedUntil > Date.now()) {
            this.sendRaw(socket, {
                type: 'hello_reject',
                reason: 'Connection temporarily blocked due to repeated rejected invitations. Try again later.',
                bannedUntil: new Date(bannedUntil).toISOString(),
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
            messageBytes: 0,
        };
        this.sessions.set(sessionId, session);
        this.socketToSessionId.set(socket, sessionId);
        this.schedulePendingTimeout(session);
        this.onStateChanged();
    }

    connect(host, localProfile = {}, port = DEFAULT_PORT) {
        return new Promise((resolve, reject) => {
            const sessionId = createId('session');
            const socket = net.createConnection({ host, port });
            let settled = false;
            const connectTimer = setTimeout(() => {
                if (settled) return;
                settled = true;
                socket.destroy();
                reject(new Error(`Connection to ${host}:${port} timed out after ${Math.round(this.connectTimeoutMs / 1000)} seconds.`));
            }, this.connectTimeoutMs);
            const failConnect = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(connectTimer);
                socket.destroy();
                reject(error);
            };
            socket.once('error', failConnect);
            socket.once('connect', () => {
                if (settled) return;
                settled = true;
                clearTimeout(connectTimer);
                socket.removeListener('error', failConnect);
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
                    messageBytes: 0,
                };
                this.sessions.set(sessionId, session);
                this.socketToSessionId.set(socket, sessionId);
                this.attachSocketHandlers(socket);
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
            senderType: normalizeRemoteString(payload.senderType) || 'user',
            senderLabel: normalizeRemoteString(payload.senderLabel),
            text: normalizeRemoteString(payload.text),
            imageDataUrl: '',
            caption: '',
            target: normalizeRemoteString(payload.target) || 'remote-user',
            locale: normalizeRemoteString(payload.locale),
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
        this.appendSessionMessage(session, message);
        session.lastEventAt = message.createdAt;
        this.sendRaw(session.socket, message);
        this.onStateChanged();
        return message;
    }

    sendScreenShare(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const message = {
            id: createId('msg'),
            type: 'screen_share',
            direction: 'outgoing',
            senderType: normalizeRemoteString(payload.senderType) || 'user',
            senderLabel: normalizeRemoteString(payload.senderLabel),
            text: '',
            imageDataUrl: normalizeRemoteString(payload.imageDataUrl),
            caption: normalizeRemoteString(payload.caption),
            target: normalizeRemoteString(payload.target) || 'remote-user',
            createdAt: new Date().toISOString(),
        };
        this.appendSessionMessage(session, message);
        session.lastEventAt = message.createdAt;
        this.sendRaw(session.socket, message);
        this.onStateChanged();
        return message;
    }

    sendSystemMessage(sessionId, text = '', options = {}) {
        const session = this.requireActiveSession(sessionId);
        const normalizedText = normalizeRemoteString(text);
        const localText = normalizeRemoteString(options.localText) || normalizedText;
        const message = {
            id: createId('msg'),
            type: 'system_message',
            direction: 'outgoing',
            senderType: 'system',
            senderLabel: 'System',
            text: localText,
            imageDataUrl: '',
            caption: '',
            target: 'remote-user',
            createdAt: new Date().toISOString(),
        };
        this.appendSessionMessage(session, message);
        session.lastEventAt = message.createdAt;
        this.sendRaw(session.socket, {
            ...message,
            text: normalizedText,
        });
        this.onStateChanged();
        return message;
    }

    sendChalkboardState(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        session.localChalkboardRevision = (Number(session.localChalkboardRevision) || 0) + 1;
        const message = {
            id: createId('chalk'),
            type: 'chalkboard_state',
            direction: 'outgoing',
            senderType: normalizeRemoteString(payload.senderType) || 'user',
            senderLabel: normalizeRemoteString(payload.senderLabel),
            text: '',
            imageDataUrl: normalizeRemoteString(payload.imageDataUrl),
            caption: normalizeRemoteString(payload.caption),
            width: Number(payload.width) || 0,
            height: Number(payload.height) || 0,
            hasContent: payload.hasContent !== false,
            revision: session.localChalkboardRevision,
            target: 'remote-user',
            createdAt: new Date().toISOString(),
        };
        this.appendSessionMessage(session, message);
        session.lastEventAt = message.createdAt;
        this.sendRaw(session.socket, message);
        this.onStateChanged();
        return message;
    }

    sendAiStatus(sessionId, payload = {}) {
        const session = this.requireActiveSession(sessionId);
        const status = payload.status === 'thinking' ? 'thinking' : 'idle';
        const createdAt = new Date().toISOString();
        const senderLabel = normalizeRemoteString(payload.senderLabel) || normalizeRemoteString(session.local?.agentName) || 'Local AI';
        session.aiStatus = {
            ...(session.aiStatus || buildIdleAiStatus()),
            localAi: status,
            localAiLabel: senderLabel,
            updatedAt: createdAt,
        };
        this.sendRaw(session.socket, {
            type: 'ai_status',
            status,
            senderLabel,
            createdAt,
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
        this.clearPendingTimeout(session);
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

    liveSessionCount() {
        let count = 0;
        for (const session of this.sessions.values()) {
            if (!isTerminalSessionStatus(session.status)) count += 1;
        }
        return count;
    }

    pruneTerminalSessions() {
        const terminals = [...this.sessions.values()].filter((session) => isTerminalSessionStatus(session.status));
        if (terminals.length <= MAX_TERMINAL_SESSIONS) return;
        terminals
            .sort((a, b) => String(a.lastEventAt || a.createdAt || '').localeCompare(String(b.lastEventAt || b.createdAt || '')))
            .slice(0, terminals.length - MAX_TERMINAL_SESSIONS)
            .forEach((session) => this.sessions.delete(session.id));
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

    appendSessionMessage(session, message) {
        session.messages.push(message);
        session.messageBytes += remoteMessageStringBytes(message);
        while (
            session.messages.length > MAX_SESSION_MESSAGES
            || session.messageBytes > MAX_SESSION_MESSAGE_BYTES
        ) {
            const removed = session.messages.shift();
            session.messageBytes -= remoteMessageStringBytes(removed);
        }
    }

    emitSystemMessage(session, senderType, text) {
        this.appendSessionMessage(session, {
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
        if (socket.writableLength > MAX_PENDING_WRITE_BYTES) {
            this.onError(new Error('Remote socket write buffer exceeded the 16 MiB limit.'));
            socket.destroy();
            return;
        }
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
            pendingExpiresAt: session.pendingExpiresAt || '',
            bannedUntil: session.bannedUntil || '',
            host: session.host,
            port: session.port,
            local: session.local || null,
            peer: session.peer || null,
            capabilities: session.capabilities || { modelShareEnabled: false },
            modelShare: session.modelShare || { status: 'idle' },
            aiStatus: session.aiStatus || buildIdleAiStatus(),
            messages: session.messages.slice(-MAX_SESSION_MESSAGES),
        };
    }
}

module.exports = {
    DEFAULT_REMOTE_PORT: DEFAULT_PORT,
    MAX_SESSION_MESSAGE_BYTES,
    RemoteAgentService,
    getLocalIPv4List,
};
