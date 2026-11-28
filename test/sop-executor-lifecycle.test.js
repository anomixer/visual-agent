'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const { test } = require('node:test');
const plain = (value) => JSON.parse(JSON.stringify(value));

function createPowerShellHarness(options = {}) {
    const files = new Map();
    const removedDirs = [];
    const reads = [];
    const timers = new Map();
    let nextTimerId = 1;
    let tempDir = '';
    let child = null;
    let nowMs = 1000;

    const fakeFs = {
        mkdtempSync(prefix) {
            tempDir = `${prefix}${nextTimerId++}`;
            return tempDir;
        },
        writeFileSync(filePath, contents) {
            if (options.writeError) throw options.writeError;
            files.set(filePath, String(contents));
        },
        existsSync(filePath) {
            return files.has(filePath);
        },
        readFileSync(filePath) {
            reads.push(filePath);
            if (options.readError && options.readError(filePath)) throw options.readErrorReason;
            if (!files.has(filePath)) {
                const error = new Error(`ENOENT: ${filePath}`);
                error.code = 'ENOENT';
                throw error;
            }
            return files.get(filePath);
        },
        rmSync(dirPath) {
            removedDirs.push(dirPath);
            for (const filePath of [...files.keys()]) {
                if (filePath === dirPath || filePath.startsWith(`${dirPath}${path.sep}`)) files.delete(filePath);
            }
        },
    };

    function spawn() {
        if (options.spawnError) throw options.spawnError;
        child = new EventEmitter();
        child.pid = 0;
        child.stdout = new EventEmitter();
        child.stdout.setEncoding = () => {};
        child.stderr = new EventEmitter();
        child.stderr.setEncoding = () => {};
        child.kill = () => { child.killed = true; return true; };
        return child;
    }

    const module = { exports: {} };
    const sourcePath = require.resolve('../src/sop-executor');
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
        module,
        exports: module.exports,
        require(id) {
            if (id === 'fs') return fakeFs;
            if (id === 'os') return { tmpdir: () => 'C:\\Temp' };
            if (id === 'path') return path;
            if (id === 'child_process') return { spawn };
            if (id === 'events') return EventEmitter;
            if (id === './pure') return require('../src/pure');
            throw new Error(`Unexpected require: ${id}`);
        },
        process,
        Date: class extends Date {
            static now() { return nowMs; }
        },
        setTimeout(callback) {
            const id = nextTimerId++;
            timers.set(id, callback);
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
    }, { filename: sourcePath });

    return {
        executor: new module.exports.SOPExecutor({ timeoutMs: 1800000 }),
        files,
        reads,
        removedDirs,
        get child() { return child; },
        get tempDir() { return tempDir; },
        get timerCount() { return timers.size; },
        setNow(value) { nowMs = value; },
        fireTimeout() {
            const callbacks = [...timers.values()];
            timers.clear();
            callbacks.forEach((callback) => callback());
        },
        seedResult(stdout = '', exitCode = '0') {
            files.set(path.join(tempDir, 'combined.log'), stdout);
            files.set(path.join(tempDir, 'exitcode.txt'), exitCode);
        },
    };
}

test('elevated close reads results, resolves, clears its timer and cleans once', async () => {
    const harness = createPowerShellHarness();
    const resultPromise = harness.executor.runPowerShellElevated('Write-Output "ok"');
    harness.seedResult('  elevated output\r\n', '7');
    harness.child.stderr.emit('data', ' warning\r\n');

    harness.child.emit('close', 0);

    assert.deepEqual(plain(await resultPromise), {
        exitCode: 7,
        stdout: 'elevated output',
        stderr: 'warning',
    });
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('elevated close rejects and cleans when the output file cannot be read', async () => {
    const readError = Object.assign(new Error('EACCES: output locked'), { code: 'EACCES' });
    const harness = createPowerShellHarness({
        readError: (filePath) => filePath.endsWith('combined.log'),
        readErrorReason: readError,
    });
    const resultPromise = harness.executor.runPowerShellElevated('Write-Output "ok"');
    harness.seedResult('locked output', '0');

    assert.doesNotThrow(() => harness.child.emit('close', 0));

    await assert.rejects(resultPromise, (error) => error === readError);
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('elevated close rejects and cleans when the exit-code file cannot be read', async () => {
    const readError = Object.assign(new Error('EACCES: exit code locked'), { code: 'EACCES' });
    const harness = createPowerShellHarness({
        readError: (filePath) => filePath.endsWith('exitcode.txt'),
        readErrorReason: readError,
    });
    const resultPromise = harness.executor.runPowerShellElevated('Write-Output "ok"');
    harness.seedResult('output', '0');

    assert.doesNotThrow(() => harness.child.emit('close', 0));

    await assert.rejects(resultPromise, (error) => error === readError);
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('elevated child error settles once and a later close cannot throw or clean again', async () => {
    const spawnError = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
    const readError = new Error('late close must not read results');
    const harness = createPowerShellHarness({
        readError: () => true,
        readErrorReason: readError,
    });
    const resultPromise = harness.executor.runPowerShellElevated('Write-Output "ok"');
    harness.seedResult('output', '0');

    harness.child.emit('error', spawnError);
    await assert.rejects(resultPromise, (error) => error === spawnError);
    const readsAfterError = harness.reads.length;
    assert.doesNotThrow(() => harness.child.emit('close', 1));

    assert.equal(harness.reads.length, readsAfterError);
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('elevated timeout terminates the child, rejects on close and cleans once', async () => {
    const harness = createPowerShellHarness();
    const resultPromise = harness.executor.runPowerShellElevated('Start-Sleep 30');

    harness.fireTimeout();
    assert.equal(harness.child.killed, true);
    harness.child.emit('close', 1);

    await assert.rejects(resultPromise, /Elevated command timed out after 1800000ms/);
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('elevated missing result files fall back to the launcher exit code', async () => {
    const harness = createPowerShellHarness();
    const resultPromise = harness.executor.runPowerShellElevated('Write-Output "ok"');

    harness.child.emit('close', 1223);

    assert.deepEqual(plain(await resultPromise), { exitCode: 1223, stdout: '', stderr: '' });
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('elevated synchronous spawn failure rejects and removes the runner directory', async () => {
    const spawnError = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
    const harness = createPowerShellHarness({ spawnError });

    await assert.rejects(harness.executor.runPowerShellElevated('Write-Output "ok"'), (error) => error === spawnError);

    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('elevated runner write failure rejects and removes the partial directory', async () => {
    const writeError = Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' });
    const harness = createPowerShellHarness({ writeError });

    await assert.rejects(harness.executor.runPowerShellElevated('Write-Output "ok"'), (error) => error === writeError);

    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal close reads streams, resolves, clears its timer and cleans once', async () => {
    const harness = createPowerShellHarness();
    const resultPromise = harness.executor.runPowerShell('Write-Output "ok"');
    harness.child.stdout.emit('data', ' normal output\r\n');
    harness.child.stderr.emit('data', ' warning\r\n');

    harness.child.emit('close', 7);

    assert.deepEqual(plain(await resultPromise), {
        exitCode: 7,
        stdout: 'normal output',
        stderr: 'warning',
    });
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal stdout log listener failures do not escape or break settlement', async () => {
    const harness = createPowerShellHarness();
    let logCalls = 0;
    harness.executor.on('log', () => {
        logCalls++;
        throw new Error('stdout log listener failed');
    });
    const resultPromise = harness.executor.runPowerShell('Write-Output "ok"');

    assert.doesNotThrow(() => harness.child.stdout.emit('data', ' first\r\n'));
    harness.setNow(1100);
    assert.doesNotThrow(() => harness.child.stdout.emit('data', ' throttled\r\n'));
    assert.equal(logCalls, 1);
    harness.setNow(1601);
    assert.doesNotThrow(() => harness.child.stdout.emit('data', ' second\r\n'));
    assert.equal(logCalls, 2);

    harness.child.emit('close', 0);

    assert.deepEqual(plain(await resultPromise), {
        exitCode: 0,
        stdout: 'first\r\n throttled\r\n second',
        stderr: '',
    });
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal stderr log listener failures do not escape or break settlement', async () => {
    const harness = createPowerShellHarness();
    let logCalls = 0;
    harness.executor.on('log', () => {
        logCalls++;
        throw new Error('stderr log listener failed');
    });
    const resultPromise = harness.executor.runPowerShell('Write-Output "ok"');

    assert.doesNotThrow(() => harness.child.stderr.emit('data', ' first warning\r\n'));
    harness.setNow(1601);
    assert.doesNotThrow(() => harness.child.stderr.emit('data', ' second warning\r\n'));
    assert.equal(logCalls, 2);

    harness.child.emit('close', 1);

    assert.deepEqual(plain(await resultPromise), {
        exitCode: 1,
        stdout: '',
        stderr: 'first warning\r\n second warning',
    });
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal child error settles once and a later close cannot clean again', async () => {
    const spawnError = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
    const harness = createPowerShellHarness();
    const resultPromise = harness.executor.runPowerShell('Write-Output "ok"');

    harness.child.emit('error', spawnError);
    await assert.rejects(resultPromise, (error) => error === spawnError);
    harness.child.emit('close', 1);

    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal error without close still clears the timer and removes the runner directory', async () => {
    const spawnError = Object.assign(new Error('spawn failed'), { code: 'ENOENT' });
    const harness = createPowerShellHarness();
    const resultPromise = harness.executor.runPowerShell('Write-Output "ok"');

    harness.child.emit('error', spawnError);

    await assert.rejects(resultPromise, (error) => error === spawnError);
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal timeout terminates the child, rejects on close and cleans once', async () => {
    const harness = createPowerShellHarness();
    const resultPromise = harness.executor.runPowerShell('Start-Sleep 30');

    harness.fireTimeout();
    assert.equal(harness.child.killed, true);
    harness.child.emit('close', 1);

    await assert.rejects(resultPromise, /Command timed out after 1800000ms/);
    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal repeated close cannot settle or clean a completed command again', async () => {
    const harness = createPowerShellHarness();
    const resultPromise = harness.executor.runPowerShell('Write-Output "ok"');

    harness.child.emit('close', 0);
    await resultPromise;
    harness.child.emit('close', 1);

    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal synchronous spawn failure rejects and removes the runner directory', async () => {
    const spawnError = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
    const harness = createPowerShellHarness({ spawnError });

    await assert.rejects(harness.executor.runPowerShell('Write-Output "ok"'), (error) => error === spawnError);

    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});

test('normal runner write failure rejects and removes the partial directory', async () => {
    const writeError = Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' });
    const harness = createPowerShellHarness({ writeError });

    await assert.rejects(harness.executor.runPowerShell('Write-Output "ok"'), (error) => error === writeError);

    assert.equal(harness.timerCount, 0);
    assert.deepEqual(harness.removedDirs, [harness.tempDir]);
});
