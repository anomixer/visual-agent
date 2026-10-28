// SOP 解析單元測試 — 覆蓋 src/sop-parser.js 的 parseSOPContent()。
// 只餵字串，不讀寫使用者目錄、不執行任何 PowerShell。
'use strict';
const path = require('node:path');
const { parseSOPContent } = require(path.join(__dirname, '..', 'src', 'sop-parser.js'));

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

const mixed = [
    '# Visual Agent SOP File v1',
    '',
    '## 基本資訊',
    'ID: test_sop',
    '名稱: 測試 SOP',
    'Name: Test SOP',
    '分類: 測試',
    'Category: Testing',
    '風險等級: 低',
    'Risk Level: High',
    '',
    '## 需求環境',
    'OS: Windows 11',
    '權限: Administrator',
    'Network: Internet',
    '',
    '## 執行流程',
    '',
    '### 第一階段：環境檢測 (Check)',
    '預期結果: 未安裝',
    'Expected Result: absent',
    '```powershell',
    '$installed = $false',
    'Write-Output $installed',
    '```',
    '',
    '### 第二階段：安裝 (Install)',
    '```powershell',
    "$path = 'C:\\Temp'",
    'UI 顯示: "安裝中"',
    'Write-Output $path',
    '```',
    '',
    '### 第三階段：解除安裝 (Uninstall)',
    'UI Message: "正在移除"',
    '```powershell',
    "Write-Output 'uninstall'",
    '```',
    '',
    '### 第四階段：驗證 (Verify)',
    'Expected Result: verified',
    '```powershell',
    'UI Message: "驗證完成"',
    'Write-Output $true',
    '```',
    '',
    '## 自動排錯',
    '錯誤代碼, 原因, 1. 重試 2. 檢查網路',
    'E100, 安裝失敗, 1. 重試 2. 檢查網路',
].join('\r\n');

const sop = parseSOPContent(mixed, 'SOP.md');

eq('sourceFile 保留', sop.sourceFile, 'SOP.md');
eq('ID', sop.id, 'test_sop');
eq('名稱：中文優先', sop.name, '測試 SOP');
eq('分類：中文優先', sop.category, '測試');
eq('風險等級：中文優先', sop.riskLevel, '低');
eq('OS', sop.prerequisites.os, 'Windows 11');
eq('權限：中文優先', sop.prerequisites.permissions, 'Administrator');
eq('網路：英文 fallback', sop.prerequisites.network, 'Internet');
eq('Check 預期結果：中文優先', sop.steps.check.expectedResult, '未安裝');
eq('Check 指令合併為單一區塊', sop.steps.check.commands, [
    '$installed = $false\nWrite-Output $installed',
]);
eq('Install 未提供預期結果時為 null', sop.steps.install.expectedResult, null);

const installCommands = sop.steps.install.commands;
eq('Install 指令只剩命令列', installCommands, [
    "$path = 'C:\\Temp'\nWrite-Output $path",
]);
check('Install 不把 UI 顯示寫入指令', !installCommands[0].includes('UI 顯示'));
eq('Install UI 訊息取自 code block', sop.steps.install.uiMessage, '安裝中');
eq('Uninstall UI 訊息取自外部行', sop.steps.uninstall.uiMessage, '正在移除');
eq('Uninstall 指令', sop.steps.uninstall.commands, ["Write-Output 'uninstall'"]);
eq('Verify 預期結果：英文 fallback', sop.steps.verify.expectedResult, 'verified');
eq('Verify UI 訊息取自 code block', sop.steps.verify.uiMessage, '驗證完成');
eq('Verify 指令', sop.steps.verify.commands, ['Write-Output $true']);
eq('排錯只收真實條目', sop.errorHandling, [
    { code: 'E100', cause: '安裝失敗', actions: ['重試', '檢查網路'] },
]);

const englishOnly = parseSOPContent([
    '## Metadata',
    'Name: Chrome Installer',
    'Category: Browser',
    'Risk Level: Medium',
    '## Prerequisites',
    'Permissions: Administrator',
    'Network: Internet',
    '## Execution Steps',
    '### Check',
    'Expected Result: not installed',
    '### Install',
    '```powershell',
    'Write-Output ok',
    '```',
].join('\n'));

eq('英文 Name fallback', englishOnly.name, 'Chrome Installer');
eq('英文 Category fallback', englishOnly.category, 'Browser');
eq('英文 Risk Level fallback', englishOnly.riskLevel, 'Medium');
eq('英文 Permissions fallback', englishOnly.prerequisites.permissions, 'Administrator');
eq('英文 Expected Result fallback', englishOnly.steps.check.expectedResult, 'not installed');
eq('英文 Install 指令', englishOnly.steps.install.commands, ['Write-Output ok']);
eq('未提供 ID 時為 null', englishOnly.id, null);

const unclosed = parseSOPContent([
    '## Execution Steps',
    '### Install',
    '```powershell',
    'Write-Output 1',
].join('\n'));
eq('未關閉的 code block 不產生指令', unclosed.steps.install.commands, []);

const empty = parseSOPContent('', 'empty.md');
eq('空內容保留來源檔名', empty.sourceFile, 'empty.md');
eq('空內容沒有步驟', empty.steps.check.commands, []);
check('空內容不是 null', empty !== null);

// ---- 結果 ----
console.log(`\n[sop-parser.test] ${pass} passed, ${fail} failed`);
if (fail) {
    console.log('失敗：');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
