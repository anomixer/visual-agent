// 純函式單元測試 — 覆蓋 src/pure.js（自 server.js 抽出的 19 個純函式）。
// 不依賴 Ollama / 網路 / 顯示卡，可在乾淨 CI runner 跑。
// 用法：node test/pure.test.js（或經 scripts/check.js 的測試段呼叫）
'use strict';
const path = require('node:path');
const pure = require(path.join(__dirname, '..', 'src', 'pure.js'));

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

// tokenizeForMatch — 小寫、去標點、保留 CJK、丟 <2 字元 token
eq('tokenizeForMatch 基本', pure.tokenizeForMatch('Hello, World! AI'), ['hello', 'world', 'ai']);
eq('tokenizeForMatch CJK', pure.tokenizeForMatch('移除 Copilot 幫我'), ['移除', 'copilot', '幫我']);
check('tokenizeForMatch 丟短 token', !pure.tokenizeForMatch('a b cd').includes('a'));

// scoreByTokenSet — 精確 +3、部分 +1、空 query 0
eq('score 精確', pure.scoreByTokenSet(new Set(['chrome', 'google']), ['chrome']), 3);
eq('score 部分', pure.scoreByTokenSet(new Set(['goog']), ['google']), 1);
eq('score 無', pure.scoreByTokenSet(new Set(['chrome']), ['google']), 0);
eq('score 空 query', pure.scoreByTokenSet(new Set(['x']), []), 0);

// escapeMarkdown — 換行轉空格、pipe 轉義
eq('escapeMarkdown', pure.escapeMarkdown('a\nb | c'), 'a b \\| c');

// redactSensitiveText — 遮 apiKey / Bearer / URL 憑證 / Windows 路徑
check('redact apiKey', pure.redactSensitiveText('apiKey=sk-abc123xyz').includes('[REDACTED]'));
check('redact Bearer', pure.redactSensitiveText('Bearer abc123def456').includes('[REDACTED]'));
check('redact URL 憑證', pure.redactSensitiveText('http://user:pass@host/x').includes('[REDACTED]:[REDACTED]@'));
check('redact Windows 路徑', pure.redactSensitiveText('C:\\Users\\foo').includes('[PATH]'));
eq('redact 空字串', pure.redactSensitiveText(''), '');

// compactMarkdownSnippet — 去標題/圍欄、截長
check('compact 去標題', !pure.compactMarkdownSnippet('# Title\n\ntext here', 100).includes('Title'));
check('compact 截長', pure.compactMarkdownSnippet('x'.repeat(1000), 10).length <= 10);

// buildChatHistoryForRequest — 附圖後跳過該 assistant 回覆
const hist = [
    { role: 'user', content: 'hi' },
    { role: 'user', content: '[User attached a Chalkboard sketch]' },
    { role: 'assistant', content: 'I saw it' },
    { role: 'user', content: 'again' },
];
eq('chatHistory 去圖後 assistant', pure.buildChatHistoryForRequest(hist, true).length, 2);
eq('chatHistory 無附件原樣', pure.buildChatHistoryForRequest(hist, false).length, 4);

// normalizeChalkboardAttachment — 只收 data:image/、拒超大
check('chalk 有效', !!pure.normalizeChalkboardAttachment({ dataUrl: 'data:image/png;base64,AAA', width: 100, height: 50 }));
check('chalk 拒非圖片', pure.normalizeChalkboardAttachment({ dataUrl: 'data:text/plain,hi' }) === null);
check('chalk 拒超大', pure.normalizeChalkboardAttachment({ dataUrl: 'data:image/png;base64,' + 'A'.repeat(14 * 1024 * 1024 + 10) }) === null);
check('chalk 空', pure.normalizeChalkboardAttachment(null) === null);

// getTaskDurationText
eq('duration 30s', pure.getTaskDurationText({ createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:30Z' }), '30s');
eq('duration 1m', pure.getTaskDurationText({ createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' }), '1m');
eq('duration N/A', pure.getTaskDurationText({}), 'N/A');

// 意圖偵測
check('finance 正', pure.detectAgentFinanceIntent('幫我更新 NVIDIA 財報.xlsx') === true);
check('finance 負', pure.detectAgentFinanceIntent('安裝 Chrome') === false);
check('game 正', pure.detectGameResearchIntent('幫我找 遊戲 攻略') === true);
check('game 負', pure.detectGameResearchIntent('安裝 Steam') === false);

// winget 查詢/解析
eq('winget query 關鍵字', pure.extractWingetSearchQuery('我想找瀏覽器'), 'browser');
eq('winget query 畫圖', pure.extractWingetSearchQuery('幫我找 畫圖 軟體'), 'drawing');
const wingetOut = 'Name  Id  Version  Match  Source\n' +
    '--------------------------------------\n' +
    'Google Chrome    Google.Chrome    126.0.0.0    Exact    winget';
const parsed = pure.parseWingetSearchOutput(wingetOut);
check('winget parse 有筆', parsed.length >= 1, JSON.stringify(parsed));
if (parsed[0]) {
    eq('winget parse id', parsed[0].id, 'Google.Chrome');
    eq('winget parse version', parsed[0].version, '126.0.0.0');
}

// slugify / escapeRegExp
eq('slugify', pure.slugifyWingetPackage('Google Chrome 126'), 'google-chrome-126');
check('escapeRegExp 轉義', pure.escapeRegExp('a.b*c').includes('\\.'));

// 財報數字
eq('usd billions', pure.formatUsdBillions(26_000_000_000), '$26.00B');
check('nvidia lines', pure.buildNvidiaSnapshotLines({ revenue: 10_000_000_000 }).join('\n').includes('Revenue: $10.00B'));

// 經驗 markdown
const expMd = pure.buildExperienceMarkdown(
    { id: 't1', title: '安裝 Chrome', status: 'success', skillId: 'install-chrome', createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z', logs: [] },
    { id: 'install-chrome' }
);
check('exp 有 Status', expMd.includes('Status: `success`'));
check('exp 有 SOP', expMd.includes('SOP ID: `install-chrome`'));

// ---- 結果 ----
console.log(`\n[pure.test] ${pass} passed, ${fail} failed`);
if (fail) {
    console.log('失敗：');
    failures.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
}
process.exit(0);
