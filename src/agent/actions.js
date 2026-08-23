/**
 * Agent 回覆解析 — ACTION / SUGGEST 標籤。
 * 純函式，無 I/O、無 module 狀態，可獨立測試。
 * 自 server.js /api/chat handler 抽出（行為一致）。
 */
'use strict';

// 把一個 ACTION 標籤的內容正規化為 `COMMAND rest...`。
// 例: `Browser_Use mode="search"` -> `BROWSER_USE mode="search"`
function normalizeActionString(action = '') {
    const raw = String(action || '').trim();
    if (!raw) return '';
    const commandMatch = raw.match(/^([A-Za-z_]+)([\s(][\s\S]*)?$/);
    const commandPart = commandMatch ? commandMatch[1] : raw;
    const restPart = commandMatch ? (commandMatch[2] || '') : '';
    const command = commandPart
        .replace(/[^a-z0-9_]/gi, '')
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toUpperCase();
    const rest = restPart.trim().replace(/^\((.*)\)$/s, '$1');
    return [command, rest].filter(Boolean).join(' ');
}

// 從一則 LLM 回覆抽出所有 ACTION（正規化後），並算出「純文字」與「是否含 SUGGEST」。
// proseForConsent 已剝除 ACTION / SUGGEST 標籤，供「徵詢同意」判定使用（避免
// query="...?" 裡的問號誤觸發同意攔截）。
function extractActionsFromReply(reply = '') {
    const text = String(reply || '');
    const actions = [];

    const actionRegex = /\[(?:ACTION\s*[:=]\s*|Action\s*=\s*)(.*?)\]/gi;
    let match;
    while ((match = actionRegex.exec(text)) !== null) {
        actions.push(normalizeActionString(match[1]));
    }
    const bareActionRegex = /(?:^|\n)\s*Action\s*=\s*([A-Za-z_]+[^\r\n]*)/gi;
    while ((match = bareActionRegex.exec(text)) !== null) {
        actions.push(normalizeActionString(match[1]));
    }

    const proseForConsent = text
        .replace(/\[(?:ACTION\s*[:=]\s*|Action\s*=\s*).*?\]/gi, ' ')
        .replace(/\[SUGGEST:.*?\]/gi, ' ');
    const hasSuggestions = actions.length > 0 && text.includes('[SUGGEST:');

    return { actions, proseForConsent, hasSuggestions };
}

module.exports = { normalizeActionString, extractActionsFromReply };
