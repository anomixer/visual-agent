'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { cleanupStaleAtomicTempFiles } = require('../src/atomic-temp');

function tempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-agent-atomic-temp-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('cleanup removes only exact temp files whose PID is no longer alive', (t) => {
    const dir = tempDir(t);
    const names = [
        'config.json.999999.tmp',
        'config.json.999998.tmp',
        'remote-profile.json.999999.tmp',
        'config.json.not-a-pid.tmp',
        'config.json.0.tmp',
        'config.json.-1.tmp',
        'config.json.999999.tmp.bak',
        'other.json.999999.tmp',
    ];
    for (const name of names) fs.writeFileSync(path.join(dir, name), 'fixture');

    const removed = cleanupStaleAtomicTempFiles(dir, 'config.json', {
        currentPid: 123,
        isProcessAlive: () => false,
    });

    assert.deepEqual(removed.sort(), ['config.json.999998.tmp', 'config.json.999999.tmp']);
    for (const name of names) {
        assert.equal(fs.existsSync(path.join(dir, name)), !removed.includes(name), name);
    }
});

test('cleanup preserves temp files owned by a live or current process', (t) => {
    const dir = tempDir(t);
    const names = ['config.json.123.tmp', 'config.json.456.tmp'];
    for (const name of names) fs.writeFileSync(path.join(dir, name), 'fixture');

    const removed = cleanupStaleAtomicTempFiles(dir, 'config.json', {
        currentPid: 123,
        isProcessAlive: (pid) => pid === 456,
    });

    assert.deepEqual(removed, []);
    assert.deepEqual(fs.readdirSync(dir).sort(), names.sort());
});

test('cleanup is conservative when liveness cannot be determined', (t) => {
    const dir = tempDir(t);
    const file = path.join(dir, 'config.json.999999.tmp');
    fs.writeFileSync(file, 'fixture');

    const removed = cleanupStaleAtomicTempFiles(dir, 'config.json', {
        currentPid: 123,
        isProcessAlive: () => { throw new Error('probe unavailable'); },
    });

    assert.deepEqual(removed, []);
    assert.equal(fs.readFileSync(file, 'utf8'), 'fixture');
});

test('cleanup ignores missing directories and non-file entries', (t) => {
    const dir = tempDir(t);
    assert.deepEqual(cleanupStaleAtomicTempFiles(path.join(dir, 'missing'), 'config.json', {
        isProcessAlive: () => false,
    }), []);

    fs.mkdirSync(path.join(dir, 'config.json.999999.tmp'));
    assert.deepEqual(cleanupStaleAtomicTempFiles(dir, 'config.json', {
        isProcessAlive: () => false,
    }), []);
    assert.equal(fs.statSync(path.join(dir, 'config.json.999999.tmp')).isDirectory(), true);
});
