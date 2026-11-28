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
    extract(/^let llmStatusRequestSeq = 0;\r?$/gm, 'llmStatusRequestSeq'),
    extract(/^(?:async )?function checkLLMStatus\([^]*?^\}\r?$/gm, 'checkLLMStatus'),
];

function harness(response, overrides = {}) {
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
        currentLocale: 'zh-TW',
        t: (key) => key,
        window: {},
        ...overrides,
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    return { context, applied };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function deferredHarness(overrides = {}) {
    const requests = [];
    const applied = [];
    const deleted = [];
    const bubbles = [];
    const logs = [];
    const errors = [];
    const { context } = harness(null, {
        console: { error: (...args) => errors.push(args), warn: () => {}, log: () => {} },
        recommendList: [{ id: 'rec_install_ollama' }, { id: 'rec_pull_llm_model' }],
        todoList: [
            { id: 'ollama-task', skillId: 'rec_install_ollama', status: 'pending' },
            { id: 'model-task', skillId: 'rec_pull_llm_model', status: 'pending' },
        ],
        currentLocale: 'zh-TW',
        api: () => {
            const request = deferred();
            requests.push(request);
            return request.promise;
        },
        updateLLMIndicator: (value) => applied.push(value),
        appendChatBubble: (...args) => bubbles.push(args),
        addUILog: (...args) => logs.push(args),
        deleteTask: (id) => deleted.push(id),
        window: {},
        ...overrides,
    });
    return { context, requests, applied, deleted, bubbles, logs, errors };
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

test('an older ready response cannot overwrite a newer unavailable status', async () => {
    const { context, requests, applied } = deferredHarness();
    const older = context.checkLLMStatus();
    const newer = context.checkLLMStatus();
    assert.equal(requests.length, 2);

    requests[1].resolve(status({ available: false, modelReady: false }));
    await newer;
    const newerSignature = context.lastLLMStatusSignature;
    assert.equal(applied.length, 1);
    assert.equal(applied[0].available, false);

    requests[0].resolve(status());
    await older;

    assert.equal(applied.length, 1, 'Stale ready status must not revive the indicator');
    assert.equal(context.lastLLMStatusSignature, newerSignature);
});

test('an older ready response cannot delete bootstrap tasks after a newer failure', async () => {
    const { context, requests, deleted, bubbles, logs } = deferredHarness();
    const older = context.checkLLMStatus();
    const newer = context.checkLLMStatus();

    requests[1].resolve({ success: false, available: false, modelReady: false, error: 'offline' });
    await newer;
    requests[0].resolve(status());
    await older;

    assert.deepEqual(deleted, [], 'Stale readiness must not remove tasks required by the newer failed status');
    assert.deepEqual(bubbles, [], 'Stale readiness must not show welcome messages');
    assert.deepEqual(logs, [], 'Stale readiness must not report the engine ready');
});

test('an older rejection cannot overwrite a newer successful status', async () => {
    const { context, requests, applied, errors } = deferredHarness({ recommendList: [], todoList: [] });
    const older = context.checkLLMStatus();
    const newer = context.checkLLMStatus();

    requests[1].resolve(status());
    await newer;
    const newerSignature = context.lastLLMStatusSignature;
    assert.equal(applied.length, 1);
    assert.equal(applied[0].available, true);

    requests[0].reject(new Error('late offline'));
    await older;

    assert.equal(applied.length, 1, 'Stale failure must not mark a newer successful status offline');
    assert.equal(context.lastLLMStatusSignature, newerSignature);
    assert.equal(errors.length, 0, 'Stale failure must not be reported as the current poll failure');
});

test('a newer failure suppresses an older successful response and its side effects', async () => {
    const { context, requests, applied, deleted, errors } = deferredHarness();
    const older = context.checkLLMStatus();
    const newer = context.checkLLMStatus();

    requests[1].reject(new Error('current offline'));
    await newer;
    assert.equal(applied.length, 1);
    assert.equal(applied[0].available, false);
    assert.equal(errors.length, 1);

    requests[0].resolve(status());
    await older;

    assert.equal(applied.length, 1, 'The latest-started failed request must win over an older success');
    assert.deepEqual(deleted, []);
    assert.equal(errors.length, 1);
});
