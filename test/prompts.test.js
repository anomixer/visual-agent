// src/agent/prompts.js 单元测试 — 软件推荐 prompt 注解。
'use strict';
const path = require('node:path');
const { buildRecommendationPromptNotes } =
    require(path.join(__dirname, '..', 'src', 'agent', 'prompts.js'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
    if (cond) pass++;
    else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// 无推荐 → 三段皆空
let r = buildRecommendationPromptNotes({});
check('空推荐 winget 空', r.wingetPromptNote === '');
check('空推荐 msstore 空', r.microsoftStorePromptNote === '');
check('空推荐 github 空', r.githubPromptNote === '');

// winget 有候選 → 含標題 + query + 套件行
r = buildRecommendationPromptNotes({
    wingetRecommendation: { query: 'browser', packages: [{ name: 'Google Chrome', id: 'Google.Chrome', version: '126' }] },
});
check('winget 含標題', r.wingetPromptNote.includes('[[winget 商店候選軟體]]'));
check('winget 含 query', r.wingetPromptNote.includes('Query: browser'));
check('winget 含套件', r.wingetPromptNote.includes('Google.Chrome'));
check('winget 含 ACTION', r.wingetPromptNote.includes('CREATE_WINGET_SOP'));

// msstore
r = buildRecommendationPromptNotes({
    microsoftStoreRecommendation: { query: 'photo', packages: [{ name: 'Photos App', id: '9WZDNCRF', version: '1.0' }] },
});
check('msstore 含標題', r.microsoftStorePromptNote.includes('[[Microsoft Store 候選軟體]]'));
check('msstore 含 ACTION', r.microsoftStorePromptNote.includes('CREATE_MSSTORE_SOP'));

// github（含 repo/tag/asset 欄位）
r = buildRecommendationPromptNotes({
    githubRecommendation: { query: 'terminal', packages: [{ name: 'Warp', fullName: 'warpdotdev/Warp', tagName: 'v1.2', assetName: 'warp.exe' }] },
});
check('github 含標題', r.githubPromptNote.includes('[[GitHub Releases 候選軟體]]'));
check('github 含 repo', r.githubPromptNote.includes('repo=warpdotdev/Warp'));
check('github 含 asset', r.githubPromptNote.includes('asset=warp.exe'));
check('github 含 ACTION', r.githubPromptNote.includes('CREATE_GITHUB_RELEASE_SOP'));

// 只有 winget 有 → 其餘兩段仍空
r = buildRecommendationPromptNotes({
    wingetRecommendation: { query: 'x', packages: [{ name: 'A', id: 'A.B', version: '1' }] },
});
check('其餘來源仍空', r.microsoftStorePromptNote === '' && r.githubPromptNote === '');

console.log(`\n[prompts.test] ${pass} passed, ${fail} failed`);
if (fail) { failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
process.exit(0);
