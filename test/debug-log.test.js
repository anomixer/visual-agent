'use strict';

// APPDATA debug.log 輪替與尾端讀取 — 只使用暫存目錄，不碰使用者真實設定檔。
// 用法：node test/debug-log.test.js（或經 scripts/check.js 的測試段呼叫）
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const {
    appendDebugLog,
    readDebugLogTail,
    dropPartialFirstLine,
} = require(path.join(__dirname, '..', 'src', 'debug-log.js'));

function tempLogPath(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-debug-log-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'debug.log');
}

test('append writes one timestamped line', (t) => {
    const logPath = tempLogPath(t);
    appendDebugLog(logPath, 'hello', { timestamp: '2026-10-29T00:00:00.000Z' });
    assert.equal(fs.readFileSync(logPath, 'utf8'), '[2026-10-29T00:00:00.000Z] hello\n');
});

test('the file stays under the cap and keeps the newest lines', (t) => {
    const logPath = tempLogPath(t);
    const maxBytes = 600;
    for (let i = 0; i < 200; i++) {
        appendDebugLog(logPath, `line-${i}`, { maxBytes, timestamp: '2026-10-29T00:00:00.000Z' });
    }
    const text = fs.readFileSync(logPath, 'utf8');
    assert.ok(fs.statSync(logPath).size <= maxBytes, 'Rotation must keep the file within the cap');
    assert.ok(text.includes('line-199'), 'Newest line must survive rotation');
    assert.ok(!text.includes('line-0\n'), 'Oldest lines must be dropped');
    assert.ok(text.startsWith('[2026-10-29T00:00:00.000Z] line-'), 'Rotation must start at a complete line');
    assert.ok(text.endsWith('\n'));
});

test('rotation does not leave broken multibyte characters', (t) => {
    const logPath = tempLogPath(t);
    for (let i = 0; i < 120; i++) {
        appendDebugLog(logPath, `安裝進度 ${i} 完成`, { maxBytes: 500, timestamp: '2026-10-29T00:00:00.000Z' });
    }
    const text = fs.readFileSync(logPath, 'utf8');
    assert.ok(!text.includes('\uFFFD'), 'A truncated UTF-8 sequence must be dropped with its partial line');
    assert.ok(text.includes('安裝進度 119 完成'));
});

test('the tail reader returns only the requested number of lines', (t) => {
    const logPath = tempLogPath(t);
    for (let i = 0; i < 50; i++) appendDebugLog(logPath, `line-${i}`, { timestamp: 'T' });
    const result = readDebugLogTail(logPath, 3);
    assert.equal(result.exists, true);
    assert.deepEqual(result.lines, ['[T] line-47', '[T] line-48', '[T] line-49']);
});

test('the tail reader works on a file far larger than its read window', (t) => {
    const logPath = tempLogPath(t);
    const filler = 'x'.repeat(4096);
    for (let i = 0; i < 200; i++) appendDebugLog(logPath, `${filler}-${i}`, { timestamp: 'T' });
    assert.ok(fs.statSync(logPath).size > 512 * 1024);

    const result = readDebugLogTail(logPath, 2, { tailBytes: 16 * 1024 });
    assert.deepEqual(result.lines, [`[T] ${filler}-198`, `[T] ${filler}-199`]);
});

test('a missing log file reports no lines', (t) => {
    const logPath = tempLogPath(t);
    assert.deepEqual(readDebugLogTail(logPath), { path: logPath, lines: [], exists: false });
});

test('dropPartialFirstLine removes an incomplete leading line', () => {
    assert.equal(dropPartialFirstLine('partial\nfull\n'), 'full\n');
    assert.equal(dropPartialFirstLine('no-break'), '');
});

test('the server writes and reads the debug log through this module', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    assert.match(server, /require\('\.\/debug-log'\)/);
    assert.match(server, /debugLogStore\.appendDebugLog\(path\.join\(visualAgentDir, 'debug\.log'\), msg\)/);
    assert.match(server, /debugLogStore\.readDebugLogTail\(path\.join\(visualAgentDir, 'debug\.log'\), maxLines\)/);
    assert.doesNotMatch(server, /fs\.appendFileSync\(logPath/, 'Raw appends would bypass rotation');
});
