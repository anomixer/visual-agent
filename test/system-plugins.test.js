// 硬體外掛排序測試 — 只驗證 src/system.js 的純排序函式，不執行任何外掛或子程序。
// 用法：node test/system-plugins.test.js（或經 scripts/check.js 的測試段呼叫）
'use strict';
const path = require('node:path');
const { sortPluginFiles } = require(path.join(__dirname, '..', 'src', 'system.js'));

let pass = 0, fail = 0;
const failures = [];

function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; }
    else { fail++; failures.push(`${name} — got ${a}, want ${e}`); }
}

eq('temperature-monitor 先於 hardware-info',
    sortPluginFiles(['hardware-info.js', 'temperature-monitor.js']),
    ['temperature-monitor.js', 'hardware-info.js']);

eq('未列名的外掛維持字母序並排在後面',
    sortPluginFiles(['zeta.js', 'hardware-info.js', 'alpha.js', 'temperature-monitor.js']),
    ['temperature-monitor.js', 'hardware-info.js', 'alpha.js', 'zeta.js']);

eq('未知檔案按名稱排序',
    sortPluginFiles(['b.js', 'a.js']),
    ['a.js', 'b.js']);

eq('空清單', sortPluginFiles([]), []);

const input = ['hardware-info.js', 'temperature-monitor.js'];
sortPluginFiles(input);
eq('不修改傳入陣列', input, ['hardware-info.js', 'temperature-monitor.js']);

console.log(`\n[system-plugins.test] ${pass} passed, ${fail} failed`);
if (fail) {
    console.log('失敗：');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
