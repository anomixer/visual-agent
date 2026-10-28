'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-agent-llm-test-'));
process.env.APPDATA = tempAppData;
const llm = require(path.join(__dirname, '..', 'src', 'llm.js'));
const originalFetch = global.fetch;

(async () => {
    try {
        global.fetch = async () => new Response('{"message":{"content":"tail"}}', {
            status: 200,
            headers: { 'Content-Type': 'application/x-ndjson' },
        });
        const tokens = [];
        const reply = await llm.chatWithLLM('test', [], {
            providerOverride: 'Ollama',
            baseUrlOverride: 'http://127.0.0.1:11434/v1',
            onDelta: (token) => tokens.push(token),
        });
        assert.equal(reply, 'tail');
        assert.deepEqual(tokens, ['tail']);

        global.fetch = async () => new Response('{"error":"model missing"}\n', { status: 200 });
        await assert.rejects(
            llm.chatWithLLM('test', [], {
                providerOverride: 'Ollama',
                baseUrlOverride: 'http://127.0.0.1:11434/v1',
                onDelta: () => {},
            }),
            /model missing/
        );

        let requestSignal = null;
        let cancelCalled = false;
        global.fetch = async (_url, options) => {
            requestSignal = options.signal;
            return {
                ok: true,
                body: {
                    getReader: () => ({
                        read: () => new Promise((_resolve, reject) => {
                            options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                        }),
                        cancel: async () => { cancelCalled = true; },
                    }),
                },
            };
        };
        const controller = new AbortController();
        const pending = llm.chatWithLLM('test', [], {
            providerOverride: 'Ollama',
            baseUrlOverride: 'http://127.0.0.1:11434/v1',
            onDelta: () => {},
            signal: controller.signal,
        });
        await new Promise((resolve) => setImmediate(resolve));
        controller.abort();
        await assert.rejects(pending, /aborted/);
        assert.equal(requestSignal.aborted, true);
        assert.equal(cancelCalled, true);

        console.log('\n[llm-stream.test] 3 passed');
    } finally {
        global.fetch = originalFetch;
        fs.rmSync(tempAppData, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
