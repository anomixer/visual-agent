'use strict';

// 全域 log 緩衝接線 — 靜態檢查 src/server.js 只透過 appendLogWithSeq 寫入，
// 避免又有人用 logs.push 繞過序號與上限。行為本身由 pure.test.js 覆蓋。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

test('the global log buffer is only written through appendLogWithSeq', () => {
    const rawPushes = [...source.matchAll(/(?<!task\.)\blogs\.push\(/g)];
    assert.equal(rawPushes.length, 0, 'Raw logs.push bypasses the sequence number and cap');
    const guarded = [...source.matchAll(/appendLogWithSeq\(logs, /g)];
    assert.equal(guarded.length, 4, 'Executor log, ui:message, completion and failure all need a sequence');
});

test('the route still hands the trimmed buffer to the shared selector', () => {
    assert.match(source, /selectLogsForClient\(logs, req\.query\.since\)/);
});
