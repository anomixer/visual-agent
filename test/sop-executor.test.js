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
    const markerPath = path.join(tempDir, 'grandchild-finished.txt');
    const childPath = path.join(tempDir, 'child.ps1');
    const quote = (value) => value.replace(/'/g, "''");
    fs.writeFileSync(childPath, `Start-Sleep -Seconds 2\nSet-Content -LiteralPath '${quote(markerPath)}' -Value 'done'`, 'utf8');

    const timeoutExecutor = new SOPExecutor({ timeoutMs: 200 });
    const command = [
        `Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', '${quote(childPath)}')`,
        'Start-Sleep -Seconds 30',
    ].join('\n');
    await assert.rejects(() => timeoutExecutor.runPowerShell(command), /timed out after 200ms/);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(fs.existsSync(markerPath), false);
    fs.rmSync(tempDir, { recursive: true, force: true });
    passed++;

    console.log(`\n[sop-executor.test] ${passed} passed`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
