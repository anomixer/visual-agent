// src/agent/actions.js 單元測試 — ACTION / SUGGEST 標籤解析。
// 用法：node test/agent.test.js
'use strict';
const path = require('node:path');
const { normalizeActionString, extractActionsFromReply } =
    require(path.join(__dirname, '..', 'src', 'agent', 'actions.js'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
    if (cond) pass++;
    else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, actual, expected) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    check(name, a === e, `got ${a}, want ${e}`);
}

// normalizeActionString
eq('norm 基本', normalizeActionString('Browser_Use mode="search"'), 'BROWSER_USE mode="search"');
eq('norm 補 snake', normalizeActionString('BrowserUse'), 'BROWSER_USE');
eq('norm ADD_TASK', normalizeActionString('ADD_TASK sop_id="x"'), 'ADD_TASK sop_id="x"');
eq('norm 空', normalizeActionString(''), '');
eq('norm 去雜字', normalizeActionString('COMPUTER_USE!'), 'COMPUTER_USE');

// extractActionsFromReply
let r = extractActionsFromReply('好的 [ACTION:BROWSER_USE mode="search" url="https://x"] 完成');
eq('extract 1 個 action', r.actions, ['BROWSER_USE mode="search" url="https://x"']);
check('extract prose 剝除標籤', !r.proseForConsent.includes('BROWSER_USE'));

r = extractActionsFromReply('先這樣\nAction=ADD_TASK sop_id="install_chrome"');
eq('extract bare Action=', r.actions, ['ADD_TASK sop_id="install_chrome"']);

r = extractActionsFromReply('[SUGGEST: button_text="安裝" action="install_sop"] 和 [ACTION:ADD_TASK sop_id="x"]');
check('extract hasSuggestions', r.hasSuggestions === true);
eq('extract 含 SUGGEST 也抓 ACTION', r.actions, ['ADD_TASK sop_id="x"']);

r = extractActionsFromReply('今天天氣不錯，沒有動作');
eq('extract 無 action', r.actions, []);
check('extract 無 SUGGEST', r.hasSuggestions === false);

// 同意攔截語意：proseForConsent 保留一般文字、去掉標籤
r = extractActionsFromReply('是否要執行 [ACTION:INSTALL_SOP sop_id="x"]？');
check('extract prose 保留問句', r.proseForConsent.includes('是否要執行'));

console.log(`\n[agent.test] ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
process.exit(0);
