// CLI 入口測試 — 只讀 bundled sops/ 並印出清單，不執行任何 PowerShell。
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const CLI = path.join(__dirname, '..', 'src', 'index.js');

function run(args) {
    return spawnSync(process.execPath, [CLI, ...args], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        timeout: 20000,
        windowsHide: true,
    });
}

test('no arguments lists SOPs instead of crashing', () => {
    const result = run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Visual Agent — SOP 清單/);
    assert.match(result.stdout, /📦 rec_backup/);
    assert.doesNotMatch(result.stdout, /listSkills is not defined/);
});

test('--help prints usage and exits cleanly', () => {
    const result = run(['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Visual Agent — SOP 執行工具/);
    assert.match(result.stdout, /--dry-run-all/);
});
