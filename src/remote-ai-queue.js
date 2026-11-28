'use strict';

const DEFAULT_TIMEOUT_MS = 190000;
const DEFAULT_MAX_PENDING = 4;
const DEFAULT_TIMEOUT_MESSAGE = 'Remote AI reply timed out before completion.';
const DEFAULT_CANCEL_MESSAGE = 'Remote AI reply cancelled.';

function toError(reason, fallback) {
    if (reason && typeof reason.message === 'string') return reason;
    return new Error(reason ? String(reason) : fallback);
}

function createRemoteAiQueue(options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxPending = Math.max(1, options.maxPending ?? DEFAULT_MAX_PENDING);
    const timeoutMessage = options.timeoutMessage || DEFAULT_TIMEOUT_MESSAGE;
    const queues = new Map();

    function cleanup(sessionId, queue) {
        if (!queue.active && queue.pending.length === 0 && queues.get(sessionId) === queue) {
            queues.delete(sessionId);
        }
    }

    function settle(sessionId, queue, entry, method, value) {
        if (entry.settled) return;
        entry.settled = true;
        clearTimeout(entry.timer);
        if (queue.active === entry) queue.active = null;
        entry[method](value);
        startNext(sessionId, queue);
        cleanup(sessionId, queue);
    }

    function startNext(sessionId, queue) {
        if (queue.active || queue.cancelled) return;
        while (queue.pending.length > 0) {
            const entry = queue.pending.shift();
            if (entry.settled) continue;
            if (entry.deadline <= Date.now()) {
                settle(sessionId, queue, entry, 'reject', entry.timeoutError);
                // settle() 可能已遞迴啟動下一項；外層不得再使用舊的迴圈狀態。
                return;
            }

            queue.active = entry;
            const controller = new AbortController();
            entry.controller = controller;
            Promise.resolve()
                .then(() => entry.task(controller.signal))
                .then(
                    (value) => settle(sessionId, queue, entry, 'resolve', value),
                    (error) => settle(sessionId, queue, entry, 'reject', error),
                );
            return;
        }
        cleanup(sessionId, queue);
    }

    function enqueue(sessionId, task) {
        let queue = queues.get(sessionId);
        if (!queue) {
            queue = {
                cancelled: false,
                cancelReason: null,
                active: null,
                pending: [],
            };
            queues.set(sessionId, queue);
        }

        if (queue.cancelled) {
            const rejected = Promise.reject(queue.cancelReason);
            rejected.catch(() => {});
            return rejected;
        }
        if (queue.pending.length + (queue.active ? 1 : 0) >= maxPending) {
            const error = new Error(
                `Remote AI reply queue is full (${maxPending} entries). Please wait for the current replies to finish.`
            );
            error.code = 'REMOTE_AI_QUEUE_FULL';
            const rejected = Promise.reject(error);
            rejected.catch(() => {});
            return rejected;
        }

        let resolve;
        let reject;
        const result = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        result.catch(() => {});

        const timeoutError = new Error(timeoutMessage);
        timeoutError.code = 'REMOTE_AI_TIMEOUT';
        const entry = {
            task,
            resolve,
            reject,
            timeoutError,
            deadline: Date.now() + timeoutMs,
            timer: null,
            controller: null,
            settled: false,
        };
        entry.timer = setTimeout(() => {
            const pendingIndex = queue.pending.indexOf(entry);
            if (pendingIndex !== -1) queue.pending.splice(pendingIndex, 1);
            if (queue.active === entry) queue.active = null;
            if (entry.settled) return;
            entry.controller?.abort(timeoutError);
            settle(sessionId, queue, entry, 'reject', timeoutError);
        }, timeoutMs);
        queue.pending.push(entry);
        startNext(sessionId, queue);
        return result;
    }

    function cancel(sessionId, reason) {
        const queue = queues.get(sessionId);
        if (!queue || queue.cancelled) return false;
        queue.cancelled = true;
        queue.cancelReason = toError(reason, DEFAULT_CANCEL_MESSAGE);
        const entries = [...queue.pending];
        if (queue.active) entries.push(queue.active);
        queue.pending = [];
        queue.active = null;
        for (const entry of entries) {
            if (entry.settled) continue;
            entry.settled = true;
            clearTimeout(entry.timer);
            entry.controller?.abort(queue.cancelReason);
            entry.reject(queue.cancelReason);
        }
        Promise.resolve().then(() => cleanup(sessionId, queue));
        return true;
    }

    function cancelInactive(isActive) {
        let count = 0;
        for (const sessionId of queues.keys()) {
            if (!isActive(sessionId)) {
                if (cancel(sessionId, new Error('Remote session is no longer active.'))) {
                    count += 1;
                }
            }
        }
        return count;
    }

    function isBusy(sessionId) {
        const queue = queues.get(sessionId);
        return !!queue && !queue.cancelled && (!!queue.active || queue.pending.length > 0);
    }

    return { enqueue, cancel, cancelInactive, isBusy };
}

module.exports = {
    createRemoteAiQueue,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_MAX_PENDING,
    DEFAULT_TIMEOUT_MESSAGE,
};
