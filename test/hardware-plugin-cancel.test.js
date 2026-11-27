'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadPlugin(fileName, execFile, consoleOverrides = {}) {
    const filePath = path.join(__dirname, '..', 'plugins', fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    const module = { exports: {} };
    const context = {
        module,
        exports: module.exports,
        require: (specifier) => {
            if (specifier === 'child_process') return { execFile };
            if (specifier === 'path') return path;
            throw new Error(`Unexpected require: ${specifier}`);
        },
        Buffer,
        process: { env: {} },
        console: { log() {}, warn() {}, error() {}, ...consoleOverrides },
        setTimeout,
        clearTimeout,
    };
    vm.runInNewContext(source, context, { filename: filePath });
    return module.exports;
}

function createExecFileProbe() {
    const calls = [];
    const execFile = (file, args, options, callback) => {
        calls.push({ file, args, options });
        const signal = options.signal;
        if (signal?.aborted) {
            queueMicrotask(() => callback(signal.reason));
            return;
        }
        if (signal) {
            signal.addEventListener('abort', () => callback(signal.reason), { once: true });
            return;
        }
        setTimeout(() => {
            callback(Object.assign(new Error('fixture probe finished'), { code: 'ENOENT' }));
        }, 20);
    };
    return { calls, execFile };
}

async function waitFor(predicate, label) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail(`Timed out waiting for ${label}`);
}

function fixtureHealth() {
    return {
        cpu: { load: 0 },
        gpu: { name: 'N/A', load: 0, temp: null, details: null },
        disk: { status: 'OK', drives: [], volumes: [] },
    };
}

test('temperature-monitor forwards AbortSignal and stops trying other executables', async () => {
    const { calls, execFile } = createExecFileProbe();
    const plugin = loadPlugin('temperature-monitor.js', execFile);
    const controller = new AbortController();

    const probe = plugin(fixtureHealth(), { signal: controller.signal });
    await waitFor(() => calls.length === 1, 'first nvidia-smi attempt');
    assert.equal(calls[0].options.signal, controller.signal);

    controller.abort();
    await assert.rejects(probe, { name: 'AbortError' });
    assert.equal(calls.length, 1, 'cancellation must not try the remaining nvidia-smi paths');
});

test('hardware-info forwards AbortSignal to the baseline probe and skips the GPU fallback', async () => {
    const { calls, execFile } = createExecFileProbe();
    const warnings = [];
    const plugin = loadPlugin('hardware-info.js', execFile, {
        warn: (...args) => warnings.push(args.join(' ')),
    });
    const controller = new AbortController();

    const probe = plugin(fixtureHealth(), { signal: controller.signal });
    await waitFor(() => calls.length === 1, 'baseline PowerShell probe');
    assert.equal(calls[0].options.signal, controller.signal);

    controller.abort();
    await assert.rejects(probe, { name: 'AbortError' });
    assert.equal(calls.length, 1, 'cancellation must not start the GPU fallback probe');
    assert.deepEqual(warnings, [], 'cancellation must not be logged as a baseline failure');
});

test('hardware-info also forwards AbortSignal to the GPU fallback probe', async () => {
    const calls = [];
    const execFile = (file, args, options, callback) => {
        calls.push({ file, args, options });
        if (calls.length === 1) {
            queueMicrotask(() => callback(null, JSON.stringify({
                cpuLoad: 12,
                gpuName: 'Fixture GPU',
                disks: [],
                logicalDisks: [],
                smart: [],
            })));
            return;
        }
        const signal = options.signal;
        if (signal?.aborted) {
            queueMicrotask(() => callback(signal.reason));
            return;
        }
        if (signal) {
            signal.addEventListener('abort', () => callback(signal.reason), { once: true });
            return;
        }
        setTimeout(() => callback(null, '0'), 20);
    };
    const plugin = loadPlugin('hardware-info.js', execFile);
    const controller = new AbortController();
    const health = fixtureHealth();

    const probe = plugin(health, { signal: controller.signal });
    await waitFor(() => calls.length === 2, 'GPU fallback PowerShell probe');
    assert.equal(calls[0].options.signal, controller.signal);
    assert.equal(calls[1].options.signal, controller.signal);

    controller.abort();
    await assert.rejects(probe, { name: 'AbortError' });
    assert.equal(calls.length, 2);
});
