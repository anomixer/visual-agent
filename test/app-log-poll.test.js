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
    extract(/^let currentLogIndex = 0;\r?$/gm, 'currentLogIndex'),
    extract(/^let logPollInFlight = false;\r?$/gm, 'logPollInFlight'),
    extract(/^async function pollLogs\([^]*?^\}\r?$/gm, 'pollLogs'),
];

function harness() {
    const routes = [];
    const added = [];
    const clears = [];
    const pending = [];
    const logEntries = {
        html: 'stale',
        get innerHTML() { return this.html; },
        set innerHTML(value) { this.html = value; clears.push(value); },
    };
    const context = vm.createContext({
        console: { error: () => {}, warn: () => {}, log: () => {} },
        logEntries,
        api: (route) => {
            routes.push(route);
            return new Promise((resolve) => pending.push(resolve));
        },
        addLogEntry: (entry) => added.push(entry.message),
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });

    async function resolveNext(payload) {
        assert.ok(pending.length, 'Expected a pending /api/logs request');
        pending.shift()(payload);
        await new Promise((resolve) => setImmediate(resolve));
    }

    return { context, routes, added, clears, logEntries, resolveNext, pending };
}

test('a poll that is still in flight suppresses the overlapping poll', async () => {
    const { context, routes, added, resolveNext } = harness();

    const first = context.pollLogs();
    const second = context.pollLogs();
    assert.deepEqual(routes, ['/api/logs?since=0'], 'Overlapping poll must not issue another request');

    await resolveNext({ success: true, logs: [{ message: 'one' }], total: 1 });
    await Promise.all([first, second]);

    assert.deepEqual(added, ['one']);
    assert.equal(routes.length, 1);
});

test('the next poll resumes from the reported total', async () => {
    const { context, routes, added, resolveNext } = harness();

    const first = context.pollLogs();
    await resolveNext({ success: true, logs: [{ message: 'one' }], total: 1 });
    await first;

    const second = context.pollLogs();
    assert.equal(routes[1], '/api/logs?since=1');
    await resolveNext({ success: true, logs: [{ message: 'two' }], total: 2 });
    await second;

    assert.deepEqual(added, ['one', 'two']);
});

test('a failed or malformed response releases the guard and keeps the cursor', async () => {
    const { context, routes, added, resolveNext } = harness();

    const failed = context.pollLogs();
    await resolveNext({ success: false, error: 'offline' });
    await failed;
    assert.deepEqual(added, []);

    const malformed = context.pollLogs();
    await resolveNext({ success: true, logs: 'not-an-array', total: 9 });
    await malformed;
    assert.deepEqual(added, []);

    const retried = context.pollLogs();
    assert.equal(routes[2], '/api/logs?since=0', 'Cursor must not advance on failure');
    await resolveNext({ success: true, logs: [{ message: 'three' }], total: 1 });
    await retried;
    assert.deepEqual(added, ['three']);
});

test('a reset response clears the stale panel before appending', async () => {
    const { context, routes, added, clears, resolveNext } = harness();

    const first = context.pollLogs();
    await resolveNext({ success: true, logs: [{ message: 'one' }], total: 5 });
    await first;

    const second = context.pollLogs();
    assert.equal(routes[1], '/api/logs?since=5');
    await resolveNext({ success: true, logs: [{ message: 'fresh' }], total: 1, reset: true });
    await second;

    assert.deepEqual(clears, [''], 'Reset must clear the panel so stale entries do not mix with the new buffer');
    assert.deepEqual(added, ['one', 'fresh']);

    const third = context.pollLogs();
    assert.equal(routes[2], '/api/logs?since=1');
    await resolveNext({ success: true, logs: [], total: 0, reset: true });
    await third;

    assert.equal(clears.length, 1, 'An empty reset must not wipe the panel');
});
