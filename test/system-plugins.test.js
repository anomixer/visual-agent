// 硬體外掛測試 — 只驗證 src/system.js 的排序與探測共用邏輯，不執行任何真實外掛或子程序。
// 用法：node test/system-plugins.test.js（或經 scripts/check.js 的測試段呼叫）
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sortPluginFiles, getSystemHealth } = require(path.join(__dirname, '..', 'src', 'system.js'));

let pass = 0, fail = 0;
const failures = [];

function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { pass++; }
    else { fail++; failures.push(`${name} — got ${a}, want ${e}`); }
}

function ok(name, condition) {
    if (condition) { pass++; }
    else { fail++; failures.push(`${name} — condition was false`); }
}

async function main() {
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

    // 以暫存目錄的假外掛驗證重疊探測共用同一次執行，不載入 repo 內的真實硬體外掛。
    const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-system-probe-'));
    try {
        fs.writeFileSync(path.join(pluginDir, 'slow-fixture.js'), [
            'module.exports = async function (health) {',
            '    globalThis.__vaProbeRuns = (globalThis.__vaProbeRuns || 0) + 1;',
            '    await new Promise((resolve) => setTimeout(resolve, 30));',
            '    health.ram.usage = 54;',
            '};',
            '',
        ].join('\n'));

        globalThis.__vaProbeRuns = 0;
        const [first, second] = await Promise.all([
            getSystemHealth({ pluginDirs: [pluginDir] }),
            getSystemHealth({ pluginDirs: [pluginDir] }),
        ]);
        eq('重疊呼叫只執行一次外掛', globalThis.__vaProbeRuns, 1);
        ok('重疊呼叫取得同一份結果', first === second);
        eq('外掛結果保留在共用回應', first.ram.usage, 54);

        const third = await getSystemHealth({ pluginDirs: [pluginDir] });
        eq('探測結束後再呼叫會重新執行', globalThis.__vaProbeRuns, 2);
        ok('新探測回傳新的結果物件', third !== first);
    } finally {
        delete globalThis.__vaProbeRuns;
        fs.rmSync(pluginDir, { recursive: true, force: true });
    }

    console.log(`\n[system-plugins.test] ${pass} passed, ${fail} failed`);
    if (fail) {
        console.log('失敗：');
        failures.forEach((f) => console.log('  ✗ ' + f));
        process.exit(1);
    }
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
