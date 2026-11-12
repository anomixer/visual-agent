'use strict';

// 日誌面板節點上限 — 擷取 public/app.js 的真實上限常數與裁剪函式，以假容器驗證。
// 用法：node test/app-log-dom-cap.test.js（或經 scripts/check.js 的測試段呼叫）
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
    extract(/^const LOG_ENTRY_LIMIT = \d+;\r?$/gm, 'LOG_ENTRY_LIMIT'),
    extract(/^function trimLogEntries\([^]*?^\}\r?$/gm, 'trimLogEntries'),
];

function harness() {
    const children = [];
    const logEntries = {
        get childElementCount() { return children.length; },
        get firstElementChild() { return children[0] || null; },
    };
    const context = vm.createContext({ logEntries });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    // 頂層 const 是詞法宣告，不會變成 context 的屬性，需在 context 內取值。
    const limit = vm.runInContext('LOG_ENTRY_LIMIT', context);
    const append = (count) => {
        for (let i = 0; i < count; i++) {
            const node = { id: children.length + i, remove() { children.splice(children.indexOf(this), 1); } };
            children.push(node);
        }
    };
    return { context, children, append, limit };
}

test('addLogEntry trims the panel after appending', () => {
    assert.match(source, /logEntries\.appendChild\(el\);\s*trimLogEntries\(\);/, 'addLogEntry must enforce the node cap');
});

test('the panel keeps every entry while under the limit', () => {
    const { context, children, append, limit } = harness();
    append(limit);
    context.trimLogEntries();
    assert.equal(children.length, limit);
});

test('the oldest nodes are dropped once the limit is exceeded', () => {
    const { context, children, append, limit } = harness();
    append(limit + 3);
    const oldestSurvivor = children[3];
    context.trimLogEntries();

    assert.equal(children.length, limit);
    assert.equal(children[0], oldestSurvivor, 'Trimming must remove the oldest nodes first');
});
