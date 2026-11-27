'use strict';
const assert = require('node:assert/strict');
const { createRemoteAiQueue } = require('../src/remote-ai-queue');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('serializes a session and keeps later work in the same queue', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 1000 });
    const firstGate = deferred();
    const secondGate = deferred();
    const order = [];
    const first = queue.enqueue('session-a', async (signal) => {
        assert.equal(signal.aborted, false);
        order.push('first:start');
        await firstGate.promise;
        order.push('first:end');
        return 'first';
    });
    const second = queue.enqueue('session-a', async () => {
        order.push('second:start');
        await secondGate.promise;
        order.push('second:end');
        return 'second';
    });

    await tick();
    assert.deepEqual(order, ['first:start']);
    firstGate.resolve();
    assert.equal(await first, 'first');
    await tick();
    assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);

    const third = queue.enqueue('session-a', () => {
        order.push('third:start');
        return 'third';
    });
    await tick();
    assert.equal(order.includes('third:start'), false);
    secondGate.resolve();
    assert.equal(await second, 'second');
    assert.equal(await third, 'third');
    assert.deepEqual(order, [
        'first:start', 'first:end', 'second:start', 'second:end', 'third:start',
    ]);
});

test('runs different sessions in parallel', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 1000 });
    const gate = deferred();
    const started = [];
    const first = queue.enqueue('session-a', async () => {
        started.push('a');
        await gate.promise;
        return 'a';
    });
    const second = queue.enqueue('session-b', async () => {
        started.push('b');
        await gate.promise;
        return 'b';
    });

    await tick();
    assert.deepEqual(started, ['a', 'b']);
    gate.resolve();
    assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
});

test('aborts the active task when its reply times out', async () => {
    const queue = createRemoteAiQueue({
        timeoutMs: 20,
        timeoutMessage: 'probe timeout',
    });
    let receivedSignal = null;
    const result = queue.enqueue('session-a', async (signal) => {
        receivedSignal = signal;
        await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
        throw new Error('unreachable');
    });

    await assert.rejects(result, /probe timeout/);
    assert.equal(receivedSignal.aborted, true);
    assert.match(receivedSignal.reason.message, /probe timeout/);
});

test('continues with new work after a timeout and ignores the late result', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 20, timeoutMessage: 'probe timeout' });
    const lateGate = deferred();
    let lateSignal = null;
    const first = queue.enqueue('session-a', (signal) => {
        lateSignal = signal;
        return lateGate.promise;
    });

    await assert.rejects(first, /probe timeout/);
    const second = queue.enqueue('session-a', () => 'next reply');
    assert.equal(await second, 'next reply');
    assert.equal(lateSignal.aborted, true);
    lateGate.resolve('stale reply');
    await tick();
    await assert.rejects(first, /probe timeout/);
});

test('cancels active and queued work without running stale tasks', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 1000 });
    const gate = deferred();
    const reason = new Error('peer disconnected');
    let activeSignal = null;
    let queuedRan = false;
    const active = queue.enqueue('session-a', (signal) => {
        activeSignal = signal;
        return gate.promise;
    });
    const queued = queue.enqueue('session-a', () => {
        queuedRan = true;
        return 'stale';
    });
    await tick();

    assert.equal(queue.cancel('session-a', reason), true);
    assert.equal(activeSignal.aborted, true);
    assert.equal(activeSignal.reason, reason);
    let afterCancelRan = false;
    const afterCancel = queue.enqueue('session-a', () => {
        afterCancelRan = true;
        return 'stale';
    });
    await assert.rejects(active, (error) => error === reason);
    await assert.rejects(queued, (error) => error === reason);
    await assert.rejects(afterCancel, (error) => error === reason);
    assert.equal(queuedRan, false);
    assert.equal(afterCancelRan, false);
    assert.equal(queue.cancel('session-a', reason), false);

    gate.resolve('late reply');
    await tick();
});

test('cancelInactive only cancels matching sessions', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 1000 });
    const activeGate = deferred();
    const inactiveGate = deferred();
    let activeSignal = null;
    let inactiveSignal = null;
    const active = queue.enqueue('active', (signal) => {
        activeSignal = signal;
        return activeGate.promise;
    });
    const inactive = queue.enqueue('inactive', (signal) => {
        inactiveSignal = signal;
        return inactiveGate.promise;
    });
    await tick();

    assert.equal(queue.cancelInactive((sessionId) => sessionId === 'active'), 1);
    assert.equal(activeSignal.aborted, false);
    assert.equal(inactiveSignal.aborted, true);
    await assert.rejects(inactive, /no longer active/);
    activeGate.resolve('done');
    inactiveGate.resolve('late');
    assert.equal(await active, 'done');
});

test('does not leave unhandled rejections after timeout or late failure', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 15, timeoutMessage: 'probe timeout' });
    const lateGate = deferred();
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
        const result = queue.enqueue('session-a', () => lateGate.promise);
        queue.enqueue('ignored-session', () => lateGate.promise);
        await assert.rejects(result, /probe timeout/);
        await new Promise((resolve) => setTimeout(resolve, 25));
        lateGate.reject(new Error('late task failure'));
        await tick();
        await tick();
        assert.deepEqual(unhandled, []);
    } finally {
        process.removeListener('unhandledRejection', onUnhandled);
    }
});

test('a rejected task does not poison the session queue', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 1000 });
    const first = queue.enqueue('session-a', () => { throw new Error('boom'); });
    const second = queue.enqueue('session-a', () => 'recovered');
    await assert.rejects(first, /boom/);
    assert.equal(await second, 'recovered');
});

test('caps pending work per session and rejects overflow without running it', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 1000, maxPending: 2 });
    const gate = deferred();
    const started = [];
    const first = queue.enqueue('session-a', async () => {
        started.push('first');
        await gate.promise;
        return 'first';
    });
    const second = queue.enqueue('session-a', () => {
        started.push('second');
        return 'second';
    });
    const third = queue.enqueue('session-a', () => {
        started.push('third');
        return 'third';
    });

    try {
        const outcome = await Promise.race([
            third.then(() => 'resolved', (error) => error.message),
            new Promise((resolve) => setTimeout(() => resolve('still pending'), 25)),
        ]);
        assert.match(outcome, /queue is full/i);
        assert.deepEqual(started, ['first']);
    } finally {
        gate.resolve();
        await Promise.allSettled([first, second, third]);
    }
    assert.deepEqual(started, ['first', 'second']);
});

test('reports busy until active and queued work settles', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 1000, maxPending: 2 });
    const gate = deferred();
    const first = queue.enqueue('session-a', () => gate.promise);
    const second = queue.enqueue('session-a', () => 'second');

    assert.equal(queue.isBusy('session-a'), true);
    gate.resolve('first');
    assert.equal(await first, 'first');
    assert.equal(await second, 'second');
    assert.equal(queue.isBusy('session-a'), false);
});

test('includes queue waiting time in the reply deadline', async () => {
    const queue = createRemoteAiQueue({ timeoutMs: 30, timeoutMessage: 'probe timeout' });
    const gate = deferred();
    let secondRan = false;
    const first = queue.enqueue('session-a', () => gate.promise);
    const second = queue.enqueue('session-a', () => {
        secondRan = true;
        return 'late reply';
    });

    try {
        await assert.rejects(first, /probe timeout/);
        await assert.rejects(second, /probe timeout/);
        assert.equal(secondRan, false, 'work that expired while queued must never start');
    } finally {
        gate.resolve('late first reply');
        await Promise.allSettled([first, second]);
    }
});

(async () => {
    try {
        for (const { name, run } of tests) await run();
        console.log(`\n[remote-ai-queue.test] ${tests.length} passed`);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();
