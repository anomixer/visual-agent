'use strict';

const crypto = require('node:crypto');
const { parseActionArg, parseBrowserUseMode } = require('./actions');

const SYSTEM_CHANGING_ACTION = /^(?:ADD_TASK|REMOVE_TASK|EXECUTE_TASK|INSTALL_SOP|CLEAR_ALL|SWITCH_MODEL|OPEN_FILE|OPEN_URL|COMPUTER_USE|CREATE_WINGET_SOP|CREATE_MSSTORE_SOP|CREATE_GITHUB_RELEASE_SOP)(?:\s|$)/;

function isSystemChangingAction(actionString = '') {
    const action = String(actionString || '').trim();
    if (/^BROWSER_USE(?:\s|$)/.test(action)) {
        return ['open', 'navigate'].includes(parseBrowserUseMode(action));
    }
    return SYSTEM_CHANGING_ACTION.test(action);
}

class AgentConsentStore {
    constructor(options = {}) {
        this.ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : 5 * 60 * 1000;
        this.maxEntries = Number(options.maxEntries) || 100;
        this.entries = new Map();
    }

    create(actionString, context = {}) {
        this.prune();
        const id = crypto.randomBytes(32).toString('base64url');
        const command = String(actionString || '').trim().split(/\s+/)[0].toLowerCase();
        const entry = {
            id,
            actionString: String(actionString || ''),
            sessionId: String(context.sessionId || ''),
            expiresAt: Date.now() + this.ttlMs,
            action: command,
            sopId: parseActionArg(actionString, 'sop_id'),
            sopAction: context.sopAction || '',
            taskId: parseActionArg(actionString, 'task_id'),
            mode: parseActionArg(actionString, 'mode'),
        };
        this.entries.set(id, entry);
        while (this.entries.size > this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
        return this.toClient(entry);
    }

    consume(id, sessionId = '') {
        this.prune();
        const entry = this.entries.get(String(id || ''));
        if (!entry || entry.sessionId !== String(sessionId || '')) return null;
        this.entries.delete(entry.id);
        return entry;
    }

    prune() {
        const now = Date.now();
        for (const [id, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(id);
        }
    }

    toClient(entry) {
        return {
            id: entry.id,
            action: entry.action,
            sopId: entry.sopId,
            taskId: entry.taskId,
            mode: entry.mode,
            description: entry.sopAction ? `${entry.actionString} [${entry.sopAction}]` : entry.actionString,
            expiresAt: new Date(entry.expiresAt).toISOString(),
        };
    }
}

module.exports = { AgentConsentStore, isSystemChangingAction };
