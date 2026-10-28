// SOPExecutor 純方法測試 — 不啟動子程序、不執行 PowerShell。
'use strict';
const path = require('node:path');
const { SOPExecutor } = require(path.join(__dirname, '..', 'src', 'sop-executor.js'));

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail = '') {
    if (cond) { pass++; }
    else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    check(name, a === e, `got ${a}, want ${e}`);
}

const executor = new SOPExecutor();
eq('預設 dryRun', executor.dryRun, false);
eq('預設 maxRetries', executor.maxRetries, 2);
eq('預設 timeout', executor.timeoutMs, 1800_000);

// isCheckSatisfied — 任一獨立行 true 即視為已完成
check('check true', executor.isCheckSatisfied('true'));
check('check 提示後 true', executor.isCheckSatisfied('hint text\r\nTRUE'));
check('check 空輸出', !executor.isCheckSatisfied(''));
check('check false', !executor.isCheckSatisfied('false'));
check('check 子字串不算', !executor.isCheckSatisfied('not true at all'));

// isVerifyFailed — 明確 false 且沒有 true 才算失敗
check('verify false', executor.isVerifyFailed('false'));
check('verify 提示後 false', executor.isVerifyFailed('checking...\n false '));
check('verify false + true', !executor.isVerifyFailed('false\ntrue'));
check('verify true', !executor.isVerifyFailed('true'));
check('verify 空輸出', !executor.isVerifyFailed(''));

// matchError — 不分大小寫，取第一個命中
const handlers = [
    { code: 'E100', cause: '安裝失敗', actions: ['重試'] },
    { code: 'net_503', cause: '網路', actions: ['檢查網路'] },
];
eq('matchError 命中', executor.matchError('command failed with e100', handlers), handlers[0]);
eq('matchError 大小寫不敏感', executor.matchError('NET_503 timeout', handlers), handlers[1]);
eq('matchError 無命中', executor.matchError('unknown', handlers), null);
eq('matchError 空輸入', executor.matchError('', handlers), null);
eq('matchError 空表', executor.matchError('e100', []), null);
eq('matchError undefined', executor.matchError('e100', undefined), null);

// sopRequiresElevation — 權限字串比對
check('admin 需要提權', executor.sopRequiresElevation({ prerequisites: { permissions: 'Administrator' } }));
check('UAC 需要提權', executor.sopRequiresElevation({ prerequisites: { permissions: 'UAC' } }));
check('user 不需提權', !executor.sopRequiresElevation({ prerequisites: { permissions: 'User' } }));
check('缺欄位不需提權', !executor.sopRequiresElevation({}));
check('null 不需提權', !executor.sopRequiresElevation(null));

// buildPowerShellRunnerScript — 保留使用者指令並統一 exit code
const script = executor.buildPowerShellRunnerScript('Write-Output "hi"');
check('runner 含使用者指令', script.includes('Write-Output "hi"'));
check('runner 保留 LASTEXITCODE', script.includes('$LASTEXITCODE'));
check('runner 捕捉例外', script.includes('catch {'));
check('runner 使用 CRLF', script.includes('\r\n'));

// ---- 結果 ----
console.log(`\n[sop-executor-pure.test] ${pass} passed, ${fail} failed`);
if (fail) {
    console.log('失敗：');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
