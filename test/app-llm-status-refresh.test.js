'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extract(pattern, label) {
    const matches = [...source.matchAll(pattern)];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${label}`);
    return new vm.Script(matches[0][0], {
        filename: sourcePath,
        lineOffset: source.slice(0, matches[0].index).split('\n').length - 1,
    });
}

const declarations = [
    extract(/^let lastLLMStatusSignature = '';\r?$/gm, 'lastLLMStatusSignature'),
    extract(/^(?:async )?function checkLLMStatus\([^]*?^\}\r?$/gm, 'checkLLMStatus'),
];

function harness(response) {
    const applied = [];
    const context = vm.createContext({
        console: { error: () => {}, warn: () => {}, log: () => {} },
        recommendList: [],
        todoList: [],
        api: async (route) => {
            assert.equal(route, '/api/llm/status');
            if (response instanceof Error) throw response;
            return response;
        },
        updateLLMIndicator: (status) => applied.push(status),
        appendChatBubble: () => {},
        addUILog: () => {},
        deleteTask: () => {},
        t: (key) => key,
        window: {},
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    return { context, applied };
}

const status = (overrides = {}) => ({
    success: true,
    available: true,
    modelReady: true,
    version: '0.30.6',
    modelName: 'gemma4:e2b-it-qat',
    currentModel: 'gemma4:e2b-it-qat',
    provider: 'Ollama',
    ...overrides,
});

test('unchanged LLM status payload does not touch the indicator again', async () => {
    const { context, applied } = harness(status());

    await context.checkLLMStatus();
    await context.checkLLMStatus();
    await context.checkLLMStatus();

    assert.equal(applied.length, 1, 'Identical status must not rewrite the indicator DOM');
});

test('changed LLM status reaches the indicator', async () => {
    const { context, applied } = harness(status());

    await context.checkLLMStatus();
    context.api = async () => status({ modelReady: false });
    await context.checkLLMStatus();

    assert.equal(applied.length, 2);
    assert.equal(applied[1].modelReady, false);
});

test('a failed poll resets the signature so the next success re-applies', async () => {
    const { context, applied } = harness(status());

    await context.checkLLMStatus();
    assert.equal(applied.length, 1);

    context.api = async () => { throw new Error('offline'); };
    await context.checkLLMStatus();
    assert.equal(applied.length, 2);
    assert.equal(applied[1].available, false);

    context.api = async () => status();
    await context.checkLLMStatus();
    assert.equal(applied.length, 3, 'Recovered status must be written even if it matches the pre-failure payload');
    assert.equal(applied[2].available, true);
});
