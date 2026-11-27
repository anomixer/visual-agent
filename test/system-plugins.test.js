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

async function withGuard(promise, label) {
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 1000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function waitFor(predicate, label) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${label}`);
}

async function expectAbort(promise, label) {
    let error = null;
    try {
        await withGuard(promise, label);
    } catch (caught) {
        error = caught;
    }
    ok(`${label} rejects with AbortError`, error?.name === 'AbortError');
    return error;
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

    const cancelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-system-cancel-'));
    try {
        fs.writeFileSync(path.join(cancelDir, 'cancellable-fixture.js'), [
            'module.exports = async function (health, options) {',
            '    globalThis.__vaCancelSignal = options && options.signal;',
            '    globalThis.__vaCancelStarted = true;',
            '    await new Promise((resolve, reject) => {',
            '        const timer = setTimeout(() => {',
            '            globalThis.__vaCancelTimedOut = true;',
            '            resolve();',
            '        }, 200);',
            '        if (options && options.signal) {',
            '            options.signal.addEventListener("abort", () => {',
            '                clearTimeout(timer);',
            '                reject(options.signal.reason);',
            '            }, { once: true });',
            '        }',
            '    });',
            '};',
            '',
        ].join('\n'));

        globalThis.__vaCancelSignal = null;
        globalThis.__vaCancelStarted = false;
        globalThis.__vaCancelTimedOut = false;
        const controller = new AbortController();
        const pluginErrors = [];
        const originalConsoleError = console.error;
        console.error = (...args) => pluginErrors.push(args.join(' '));
        try {
            const probe = getSystemHealth({ pluginDirs: [cancelDir], signal: controller.signal });
            await waitFor(() => globalThis.__vaCancelStarted, 'cancellable plugin start');
            ok('外掛收到尚未取消的 AbortSignal', globalThis.__vaCancelSignal instanceof AbortSignal && !globalThis.__vaCancelSignal.aborted);
            controller.abort();
            await expectAbort(probe, '取消中的硬體探測');
            ok('取消會傳到外掛的 AbortSignal', globalThis.__vaCancelSignal.aborted);
        } finally {
            console.error = originalConsoleError;
        }
        eq('取消後外掛不會繼續等待自己的 timeout', globalThis.__vaCancelTimedOut, false);
        eq('取消不會被記成一般外掛錯誤', pluginErrors.length, 0);
    } finally {
        delete globalThis.__vaCancelSignal;
        delete globalThis.__vaCancelStarted;
        delete globalThis.__vaCancelTimedOut;
        fs.rmSync(cancelDir, { recursive: true, force: true });
    }

    const abortedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-system-aborted-'));
    try {
        fs.writeFileSync(path.join(abortedDir, 'must-not-run.js'), [
            'module.exports = async function () {',
            '    globalThis.__vaAbortedRun = (globalThis.__vaAbortedRun || 0) + 1;',
            '};',
            '',
        ].join('\n'));
        globalThis.__vaAbortedRun = 0;
        const controller = new AbortController();
        controller.abort();
        await expectAbort(
            getSystemHealth({ pluginDirs: [abortedDir], signal: controller.signal }),
            '已取消的硬體探測'
        );
        eq('已取消的訊號不會啟動任何外掛', globalThis.__vaAbortedRun, 0);
    } finally {
        delete globalThis.__vaAbortedRun;
        fs.rmSync(abortedDir, { recursive: true, force: true });
    }

    const betweenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-system-between-'));
    try {
        fs.writeFileSync(path.join(betweenDir, 'a-abort.js'), [
            'module.exports = async function () {',
            '    globalThis.__vaBetweenController.abort();',
            '};',
            '',
        ].join('\n'));
        fs.writeFileSync(path.join(betweenDir, 'b-must-not-run.js'), [
            'module.exports = async function () {',
            '    globalThis.__vaBetweenSecond = true;',
            '};',
            '',
        ].join('\n'));
        globalThis.__vaBetweenController = new AbortController();
        globalThis.__vaBetweenSecond = false;
        await expectAbort(
            getSystemHealth({ pluginDirs: [betweenDir], signal: globalThis.__vaBetweenController.signal }),
            '外掛之間取消的硬體探測'
        );
        eq('取消後不會執行下一個外掛', globalThis.__vaBetweenSecond, false);
    } finally {
        delete globalThis.__vaBetweenController;
        delete globalThis.__vaBetweenSecond;
        fs.rmSync(betweenDir, { recursive: true, force: true });
    }

    const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-system-shared-cancel-'));
    try {
        fs.writeFileSync(path.join(sharedDir, 'slow-fixture.js'), [
            'module.exports = async function (health) {',
            '    globalThis.__vaSharedRuns = (globalThis.__vaSharedRuns || 0) + 1;',
            '    globalThis.__vaSharedStarted = true;',
            '    await new Promise((resolve) => setTimeout(resolve, 40));',
            '    globalThis.__vaSharedCompleted = true;',
            '    health.ram.usage = 61;',
            '};',
            '',
        ].join('\n'));
        globalThis.__vaSharedRuns = 0;
        globalThis.__vaSharedStarted = false;
        globalThis.__vaSharedCompleted = false;
        const uiProbe = getSystemHealth({ pluginDirs: [sharedDir] });
        const remoteController = new AbortController();
        const remoteProbe = getSystemHealth({ pluginDirs: [sharedDir], signal: remoteController.signal });
        await waitFor(() => globalThis.__vaSharedStarted, 'shared probe start');
        remoteController.abort();
        await expectAbort(remoteProbe, '共享探測中的可取消呼叫端');
        const uiHealth = await withGuard(uiProbe, 'non-cancellable UI probe');
        eq('遠端取消不會取消 UI 共用的探測', globalThis.__vaSharedCompleted, true);
        eq('UI 與遠端仍共用同一次外掛執行', globalThis.__vaSharedRuns, 1);
        eq('UI 仍取得完整探測結果', uiHealth.ram.usage, 61);
    } finally {
        delete globalThis.__vaSharedRuns;
        delete globalThis.__vaSharedStarted;
        delete globalThis.__vaSharedCompleted;
        fs.rmSync(sharedDir, { recursive: true, force: true });
    }

    const subscribersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-system-subscribers-'));
    try {
        fs.writeFileSync(path.join(subscribersDir, 'slow-fixture.js'), [
            'module.exports = async function (health) {',
            '    globalThis.__vaSubscriberRuns = (globalThis.__vaSubscriberRuns || 0) + 1;',
            '    globalThis.__vaSubscriberStarted = true;',
            '    await new Promise((resolve) => setTimeout(resolve, 40));',
            '    health.ram.usage = 62;',
            '};',
            '',
        ].join('\n'));
        globalThis.__vaSubscriberRuns = 0;
        globalThis.__vaSubscriberStarted = false;
        const firstController = new AbortController();
        const secondController = new AbortController();
        const firstProbe = getSystemHealth({ pluginDirs: [subscribersDir], signal: firstController.signal });
        const secondProbe = getSystemHealth({ pluginDirs: [subscribersDir], signal: secondController.signal });
        await waitFor(() => globalThis.__vaSubscriberStarted, 'two-subscriber probe start');
        firstController.abort();
        await expectAbort(firstProbe, '第一個可取消訂閱者');
        const secondHealth = await withGuard(secondProbe, 'second signal subscriber');
        eq('一個訂閱者取消不會取消其他訂閱者', secondHealth.ram.usage, 62);
        eq('多個訂閱者仍共用同一次外掛執行', globalThis.__vaSubscriberRuns, 1);
    } finally {
        delete globalThis.__vaSubscriberRuns;
        delete globalThis.__vaSubscriberStarted;
        fs.rmSync(subscribersDir, { recursive: true, force: true });
    }

    const lastDir = fs.mkdtempSync(path.join(os.tmpdir(), 'va-system-last-cancel-'));
    const unhandled = [];
    const onUnhandled = (error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
        fs.writeFileSync(path.join(lastDir, 'cooperative-fixture.js'), [
            'module.exports = async function () {',
            '    globalThis.__vaLastRuns = (globalThis.__vaLastRuns || 0) + 1;',
            '    globalThis.__vaLastStarted = true;',
            '    if (globalThis.__vaLastRuns > 1) return;',
            '    if (!arguments[1] || !arguments[1].signal) return;',
            '    await new Promise((resolve, reject) => {',
            '        arguments[1].signal.addEventListener("abort", () => reject(arguments[1].signal.reason), { once: true });',
            '    });',
            '};',
            '',
        ].join('\n'));
        globalThis.__vaLastRuns = 0;
        globalThis.__vaLastStarted = false;
        const controller = new AbortController();
        const probe = getSystemHealth({ pluginDirs: [lastDir], signal: controller.signal });
        await waitFor(() => globalThis.__vaLastStarted, 'last-subscriber probe start');
        controller.abort();
        await expectAbort(probe, '最後一個可取消訂閱者');
        await new Promise((resolve) => setImmediate(resolve));
        eq('最後訂閱者取消不會留下未處理拒絕', unhandled.length, 0);

        const nextHealth = await withGuard(getSystemHealth({ pluginDirs: [lastDir] }), 'probe after cancellation');
        ok('取消後的新探測取得新結果', nextHealth && typeof nextHealth === 'object');
        eq('取消後 Map 不會沿用已取消的探測', globalThis.__vaLastRuns, 2);
    } finally {
        process.removeListener('unhandledRejection', onUnhandled);
        delete globalThis.__vaLastRuns;
        delete globalThis.__vaLastStarted;
        fs.rmSync(lastDir, { recursive: true, force: true });
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
