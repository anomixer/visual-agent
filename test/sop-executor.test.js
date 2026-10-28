'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SOPExecutor } = require(path.join(__dirname, '..', 'src', 'sop-executor.js'));

async function main() {
    let passed = 0;
    if (process.platform !== 'win32') {
        console.log('\n[sop-executor.test] skipped on non-Windows');
        return;
    }

    const executor = new SOPExecutor({ timeoutMs: 10000 });
    const result = await executor.runPowerShell("$value = '繁體中文'\nWrite-Output $value\ncmd.exe /c exit 7");
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout, '繁體中文');
    passed++;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-agent-executor-test-'));
    const startedPath = path.join(tempDir, 'grandchild-started.txt');
    const triggerPath = path.join(tempDir, 'trigger.txt');
    const markerPath = path.join(tempDir, 'grandchild-finished.txt');
    const childPath = path.join(tempDir, 'child.ps1');
    const quote = (value) => value.replace(/'/g, "''");
    // 孫行程先宣告已啟動，再等一個永遠不會在逾時前出現的 trigger；若它真的存活，就會把 marker 寫出來。
    fs.writeFileSync(childPath, [
        `Set-Content -LiteralPath '${quote(startedPath)}' -Value 'up'`,
        `while (-not (Test-Path -LiteralPath '${quote(triggerPath)}')) { Start-Sleep -Milliseconds 100 }`,
        `Set-Content -LiteralPath '${quote(markerPath)}' -Value 'done'`,
    ].join('\r\n'), 'utf8');

    // 先用 30 秒延遲把父行程留在樹上，並等孫行程真的啟動後才進入長睡眠，
    // 避免 200ms 等級的逾時落在「子行程正在建立」的競態窗口內。
    const timeoutExecutor = new SOPExecutor({ timeoutMs: 3000 });
    const command = [
        `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '${quote(childPath)}')`,
        `$deadline = (Get-Date).AddSeconds(4)`,
        `while (-not (Test-Path -LiteralPath '${quote(startedPath)}') -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }`,
        'Start-Sleep -Seconds 30',
    ].join('\n');
    await assert.rejects(() => timeoutExecutor.runPowerShell(command), /timed out after 3000ms/);
    assert.equal(fs.existsSync(startedPath), true, '孫行程應在逾時前啟動，否則此測試沒有測到 process tree 終止');
    fs.writeFileSync(triggerPath, 'go', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(fs.existsSync(markerPath), false, '逾時後孫行程仍存活並寫入 marker');
    fs.rmSync(tempDir, { recursive: true, force: true });
    passed++;

    console.log(`\n[sop-executor.test] ${passed} passed`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
