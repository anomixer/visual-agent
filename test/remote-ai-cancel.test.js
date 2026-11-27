'use strict';
const assert = require('node:assert/strict');
const { createChatHarness } = require('./helpers/chat-harness');

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function withGuard(promise, label) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 1000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function waitFor(predicate, label) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await tick();
    }
    assert.fail(`Timed out waiting for ${label}`);
}

function remoteSession(sessionId = 'remote-ai-session') {
    return {
        id: sessionId,
        status: 'active',
        host: '192.0.2.20',
        peer: {
            machineName: 'PEER-PC',
            userName: 'peer-user',
            agentName: 'Peer AI',
            ip: '192.0.2.20',
            locale: 'zh-TW',
        },
        messages: [{
            id: 'incoming-1',
            type: 'chat_message',
            direction: 'incoming',
            senderType: 'user',
            senderLabel: 'peer-user',
            text: 'Please answer this remote question.',
        }],
    };
}

function remoteMessage(text = 'Please answer this remote question.') {
    return {
        id: `incoming-${text}`,
        type: 'chat_message',
        target: 'remote-ai',
        senderType: 'user',
        senderLabel: 'peer-user',
        text,
    };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('forwards the queue signal and sends a successful reply', async () => {
    const harness = createChatHarness();
    try {
        harness.setRemoteSession(remoteSession());
        harness.setReplies(['Remote answer']);
        await harness.emitRemoteMessage('remote-ai-session', remoteMessage());

        assert.equal(harness.llmCalls.length, 1);
        const messages = harness.getRemoteMessages();
        assert.deepEqual(messages.map((entry) => [entry.method, entry.payload.status || entry.payload.text]), [
            ['sendAiStatus', 'thinking'],
            ['sendChatMessage', 'Remote answer'],
            ['sendAiStatus', 'idle'],
        ]);
        assert.equal(messages[1].payload.target, 'remote-user');
        assert.equal(messages.some((entry) => entry.method === 'sendSystemMessage'), false);
        harness.assertSafe();
    } finally {
        harness.dispose();
    }
});

test('disconnect aborts the LLM signal and skips queued or late replies', async () => {
    const harness = createChatHarness();
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
        harness.setRemoteSession(remoteSession());
        let resolveLlm = null;
        let receivedSignal = null;
        harness.setChatHook(({ signal }) => {
            receivedSignal = signal;
            return new Promise((resolve) => { resolveLlm = resolve; });
        });

        const first = harness.emitRemoteMessage('remote-ai-session', remoteMessage('first question'));
        const second = harness.emitRemoteMessage('remote-ai-session', remoteMessage('second question'));
        await waitFor(() => harness.llmCalls.length === 1, 'the first LLM call');
        assert.equal(receivedSignal.aborted, false);
        assert.equal(typeof receivedSignal.addEventListener, 'function');

        harness.disconnectRemoteSession('remote-ai-session', 'peer disconnected');
        assert.equal(receivedSignal.aborted, true);
        assert.match(receivedSignal.reason.message, /no longer active/);
        await withGuard(Promise.all([first, second]), 'cancelled remote replies to settle');
        assert.equal(harness.llmCalls.length, 1);

        harness.setReplies(['late answer']);
        resolveLlm('late answer');
        await tick();
        await tick();
        const messages = harness.getRemoteMessages();
        assert.deepEqual(messages.map((entry) => entry.method), ['sendAiStatus']);
        assert.equal(messages[0].payload.status, 'thinking');
        assert.deepEqual(unhandled, []);
        harness.assertSafe();
    } finally {
        process.removeListener('unhandledRejection', onUnhandled);
        harness.dispose();
    }
});

test('LLM failures still produce a visible remote error and idle status', async () => {
    const harness = createChatHarness();
    try {
        harness.setRemoteSession(remoteSession());
        harness.setChatHook(() => { throw new Error('probe LLM failure'); });
        await harness.emitRemoteMessage('remote-ai-session', remoteMessage());

        const messages = harness.getRemoteMessages();
        assert.deepEqual(messages.map((entry) => entry.method), [
            'sendAiStatus', 'sendSystemMessage', 'sendAiStatus',
        ]);
        assert.match(messages[1].payload.text, /Remote AI failed to reply: probe LLM failure/);
        assert.equal(messages[2].payload.status, 'idle');
        harness.assertSafe();
    } finally {
        harness.dispose();
    }
});

test('messages for other targets do not start remote AI work', async () => {
    const harness = createChatHarness();
    try {
        harness.setRemoteSession(remoteSession());
        await harness.emitRemoteMessage('remote-ai-session', {
            ...remoteMessage(),
            target: 'remote-user',
        });
        assert.equal(harness.llmCalls.length, 0);
        assert.deepEqual(harness.getRemoteMessages(), []);
        harness.assertSafe();
    } finally {
        harness.dispose();
    }
});

(async () => {
    try {
        for (const { run } of tests) await run();
        console.log(`\n[remote-ai-cancel.test] ${tests.length} passed`);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();
