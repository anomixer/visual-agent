'use strict';

class AgentLoopBudget {
    constructor({
        maxTurns = 8,
        maxToolCalls = 12,
        deadlineMs = 180000,
        initialActions = [],
        now = Date.now,
    } = {}) {
        this.maxTurns = maxTurns;
        this.maxToolCalls = maxToolCalls;
        this.now = now;
        this.deadline = now() + deadlineMs;
        this.turns = 0;
        this.toolCalls = 0;
        this.seenActions = new Set();
        this.takeActions(initialActions);
    }

    remainingMs() {
        return Math.max(0, this.deadline - this.now());
    }

    canStartTurn() {
        return this.turns < this.maxTurns && this.remainingMs() > 0;
    }

    startTurn() {
        if (!this.canStartTurn()) return false;
        this.turns += 1;
        return true;
    }

    takeActions(actions) {
        const accepted = [];
        let duplicates = 0;
        let overflow = 0;

        for (const rawAction of Array.isArray(actions) ? actions : []) {
            const action = String(rawAction || '').trim();
            if (!action) continue;
            if (this.seenActions.has(action)) {
                duplicates += 1;
                continue;
            }
            if (this.toolCalls >= this.maxToolCalls) {
                overflow += 1;
                continue;
            }
            this.seenActions.add(action);
            this.toolCalls += 1;
            accepted.push(action);
        }

        return { accepted, duplicates, overflow };
    }
}

module.exports = { AgentLoopBudget };
