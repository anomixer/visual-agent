'use strict';

const DEFAULT_TIMEOUT_MS = 190000;
const DEFAULT_TIMEOUT_MESSAGE = 'Remote AI reply timed out before completion.';
const DEFAULT_CANCEL_MESSAGE = 'Remote AI reply cancelled.';

function toError(reason, fallback) {
    if (reason && typeof reason.message === 'string') return reason;
    return new Error(reason ? String(reason) : fallback);
}

function createRemoteAiQueue(options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutMessage = options.timeoutMessage || DEFAULT_TIMEOUT_MESSAGE;
    const queues = new Map();

    function cleanup(sessionId, queue) {
        if (queues.get(sessionId) === queue) queues.delete(sessionId);
    }

    function enqueue(sessionId, task) {
        let queue = queues.get(sessionId);
        if (!queue) {
            queue = {
                cancelled: false,
                cancelReason: null,
                controller: null,
                interrupt: null,
                tail: Promise.resolve(),
            };
            queues.set(sessionId, queue);
        }

        if (queue.cancelled) {
            const rejected = Promise.reject(queue.cancelReason);
            rejected.catch(() => {});
            return rejected;
        }

        const result = queue.tail.then(async () => {
            if (queue.cancelled) throw queue.cancelReason;

            const controller = new AbortController();
            queue.controller = controller;
            let timer = null;
            let rejectInterrupted = null;
            const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
            queue.interrupt = rejectInterrupted;
            const timeout = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const error = new Error(timeoutMessage);
                    controller.abort(error);
                    reject(error);
                }, timeoutMs);
            });
            const execution = Promise.resolve().then(() => task(controller.signal));

            try {
                return await Promise.race([execution, timeout, interrupted]);
            } finally {
                clearTimeout(timer);
                queue.controller = null;
                queue.interrupt = null;
            }
        });

        const tail = result.then(
            () => { if (queue.tail === tail) cleanup(sessionId, queue); },
            () => { if (queue.tail === tail) cleanup(sessionId, queue); }
        );
        queue.tail = tail;
        return result;
    }

    function cancel(sessionId, reason) {
        const queue = queues.get(sessionId);
        if (!queue || queue.cancelled) return false;
        queue.cancelled = true;
        queue.cancelReason = toError(reason, DEFAULT_CANCEL_MESSAGE);
        queue.controller?.abort(queue.cancelReason);
        queue.interrupt?.(queue.cancelReason);
        return true;
    }

    function cancelInactive(isActive) {
        let count = 0;
        for (const sessionId of queues.keys()) {
            if (!isActive(sessionId)) {
                if (cancel(sessionId, new Error('Remote session is no longer active.'))) count += 1;
            }
        }
        return count;
    }

    return { enqueue, cancel, cancelInactive };
}

module.exports = { createRemoteAiQueue, DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MESSAGE };
