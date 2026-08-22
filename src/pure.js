/**
 * 純函式集 — 自 server.js 抽出，供單元測試與跨模組複用。
 * 無 I/O、無 module 狀態依賴，可獨立 require（server.js 自啟、不可被 require 測試）。
 * 行為與原 server.js 內版本一致；修改時請以本檔為準並同步 server.js。
 */

function tokenizeForMatch(text = '') {
    return String(text || '')
        .toLowerCase()
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 2);
}

function scoreByTokenSet(tokenSet = new Set(), queryTokens = []) {
    if (!queryTokens.length) return 0;
    let score = 0;
    queryTokens.forEach((token) => {
        if (tokenSet.has(token)) {
            score += 3;
            return;
        }
        if (Array.from(tokenSet).some((item) => item.includes(token) || token.includes(item))) {
            score += 1;
        }
    });
    return score;
}

function escapeMarkdown(text = '') {
    return String(text)
        .replace(/\r/g, '')
        .replace(/\n/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
}

function redactSensitiveText(text = '') {
    let value = String(text || '');
    if (!value) return value;
    const rules = [
        {
            pattern: /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|bearer|password|passwd|pwd|secret|client[_-]?secret)\b\s*([:=])\s*("[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi,
            replacer: (_, key, sep) => `${key}${sep} [REDACTED]`,
        },
        {
            pattern: /((?:--?|\/)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|bearer|password|passwd|pwd|secret|client[_-]?secret))\s+("[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi,
            replacer: (_, key) => `${key} [REDACTED]`,
        },
        {
            pattern: /\b(Bearer)\s+[A-Za-z0-9._~+\/=-]{8,}\b/gi,
            replacer: '$1 [REDACTED]',
        },
        {
            pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
            replacer: '$1[REDACTED]:[REDACTED]@',
        },
        {
            pattern: /\b[A-Za-z]:(\\[^<>:"|?*\r\n]+)+/g,
            replacer: '[PATH]',
        },
        {
            pattern: /(^|[\s(])\\\\[^\\\s]+\\[^ \r\n\t)]+/g,
            replacer: '$1[PATH]',
        },
        {
            pattern: /\b(cd[\s-]?key|license[\s-]?key|product[\s-]?key|serial(?:\s+number)?|activation[\s-]?key)\b([^\r\n]{0,24}?)([A-Z0-9]{4,}(?:-[A-Z0-9]{4,}){2,})/gi,
            replacer: (_, label, between) => `${label}${between}[REDACTED]`,
        },
    ];
    rules.forEach(({ pattern, replacer }) => {
        value = value.replace(pattern, replacer);
    });
    return value;
}

function compactMarkdownSnippet(content = '', maxChars = 620) {
    return String(content || '')
        .replace(/^#.*$/gm, '')
        .replace(/^```[\s\S]*?```/gm, '')
        .replace(/[*_`>#-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
}

function buildChatHistoryForRequest(history, hasChalkboardAttachment) {
    if (!hasChalkboardAttachment || !Array.isArray(history) || history.length === 0) {
        return Array.isArray(history) ? history : [];
    }


    const filtered = [];
    let skipAssistantReplyForImageTurn = false;
    history.forEach(entry => {
        const content = String(entry?.content || '');
        if (entry?.role === 'user' && content.includes('[User attached a Chalkboard sketch]')) {
            skipAssistantReplyForImageTurn = true;
            return;
        }


        if (skipAssistantReplyForImageTurn && entry?.role === 'assistant') {
            skipAssistantReplyForImageTurn = false;
            return;
        }


        filtered.push(entry);
    });
    return filtered;
}

function normalizeChalkboardAttachment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl.trim() : '';
    const mimeType = typeof raw.mimeType === 'string' ? raw.mimeType.trim() : 'image/png';
    if (!dataUrl.startsWith('data:image/')) return null;
    // Avoid forwarding malformed or unexpectedly huge visual payloads to a model.
    if (dataUrl.length > 14 * 1024 * 1024) return null;
    return {
        dataUrl,
        mimeType,
        width: Number(raw.width) || 0,
        height: Number(raw.height) || 0
    };
}

function getTaskDurationText(task) {
    if (!task?.createdAt || !task?.completedAt) return 'N/A';
    const start = new Date(task.createdAt).getTime();
    const end = new Date(task.completedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'N/A';
    const seconds = Math.max(1, Math.round((end - start) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return remainSeconds ? `${minutes}m ${remainSeconds}s` : `${minutes}m`;
}

function pickExperienceHighlights(task) {
    const sourceLogs = Array.isArray(task?.logs) ? task.logs : [];
    const interesting = [];
    const seen = new Set();
    sourceLogs.forEach(log => {
        const level = String(log?.level || '').toLowerCase();
        const message = redactSensitiveText(escapeMarkdown(log?.message || ''));
        if (!message) return;
        const isInterestingLevel = ['error', 'warn', 'success', 'ui'].includes(level);
        const hasSignalWord = /(失敗|錯誤|成功|完成|略過|跳過|uac|權限|denied|timeout|下載|安裝|verify|驗證|修復|retry|重試|already|exists)/i.test(message);
        if (!isInterestingLevel && !hasSignalWord) return;
        const dedupeKey = `${level}:${message}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        interesting.push(message);
    });
    return interesting.slice(-6);
}

function buildExperienceAdvice(task, highlights) {
    const text = highlights.join('\n').toLowerCase();
    if (task.status === 'success') {
        return 'This run can be reused as the main reference for the next similar setup. Verify version, source, and permissions before repeating it.';
    }


    if (task.status === 'skipped') {
        return 'The target already appeared to exist. Run the check phase first next time to avoid duplicate installation or unnecessary actions.';
    }


    if (/uac|cancelled by user|canceled by user|權限|denied/.test(text)) {
        return 'This failure is related to permissions or UAC. Explain the need for administrator approval before the next run.';
    }


    if (/download|下載|timeout|network|連線/.test(text)) {
        return 'This failure is likely related to networking or the download phase. Check connectivity, source endpoints, and firewall rules first.';
    }


    if (/verify|經驗證/.test(text)) {
        return 'The install flow may have completed, but verification did not pass. Review whether the final verify condition actually matches the current machine.';
    }


    return 'Review the failure highlights before the next similar run, explain the risk to the user, and adjust the SOP or prerequisite checks if needed.';
}

function buildExperienceMarkdown(task, sop) {
    const completedAt = task?.completedAt ? new Date(task.completedAt) : new Date();
    const highlights = pickExperienceHighlights(task);
    const advice = redactSensitiveText(buildExperienceAdvice(task, highlights));
    const summary = task.status === 'success'
        ? 'This task completed successfully and can serve as a reference for similar future setup flows.'
        : task.status === 'skipped'
            ? 'This task was skipped because the target already existed or did not need to be repeated.'
            : 'This task did not complete successfully. Record the failure cause and pitfalls to avoid repeating them.';
    const lines = [
        `## ${completedAt.toISOString()} - ${redactSensitiveText(escapeMarkdown(task.title || sop?.name || task.id))}`,
        '',
        `- Task ID: \`${redactSensitiveText(escapeMarkdown(task.id || ''))}\``,
        `- SOP ID: \`${redactSensitiveText(escapeMarkdown(task.skillId || sop?.id || 'dynamic'))}\``,
        `- Status: \`${redactSensitiveText(escapeMarkdown(task.status || 'unknown'))}\``,
        `- Duration: ${getTaskDurationText(task)}`,
        `- Summary: ${redactSensitiveText(summary)}`,
        `- Advice: ${advice}`,
        ''
    ];
    if (highlights.length > 0) {
        lines.push('### Highlights', '');
        highlights.forEach(item => lines.push(`- ${item}`));
        lines.push('');
    }


    return lines.join('\n');
}

function detectAgentFinanceIntent(message = '') {
    const text = String(message || '');
    const hasWorkbook = /\.xlsx\b/i.test(text);
    const hasFinance = /(財報|earnings|financial report|quarterly results|季報|年報)/i.test(text);
    const hasUpdateAction = /(更新|update|填入|填寫|整理|refresh|sync)/i.test(text);
    return hasWorkbook && hasFinance && hasUpdateAction;
}

function detectGameResearchIntent(message = '') {
    const text = String(message || '');
    return /(攻略|教學|打法|build|walkthrough|guide|影片|youtube|video)/i.test(text)
        && /(遊戲|game|steam|boss|關卡|任務|角色|配裝)/i.test(text);
}

function extractWingetSearchQuery(message = '') {
    const text = String(message || '').toLowerCase();
    const keywordMap = [
        { pattern: /(繪圖|畫圖|畫畫|插畫|繪畫|drawing|paint|sketch)/i, query: 'drawing' },
        { pattern: /(修圖|影像|圖片編輯|image|photo|edit)/i, query: 'image editor' },
        { pattern: /(影片|剪輯|video|editor)/i, query: 'video editor' },
        { pattern: /(筆記|note|markdown)/i, query: 'notes' },
        { pattern: /(瀏覽器|browser)/i, query: 'browser' },
        { pattern: /(解壓縮|壓縮|zip|rar|archive)/i, query: 'archive' },
        { pattern: /(遠端|remote desktop|rdp)/i, query: 'remote desktop' },
    ];
    const mapped = keywordMap.find(entry => entry.pattern.test(text));
    if (mapped) return mapped.query;
    const cleaned = text
        .replace(/請|幫我|想找|想要|推薦|建議|值得|有什麼|有哪些|可以|軟體|app|工具|程式|應用|下載|安裝/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'software';
}

function parseWingetSearchOutput(output = '') {
    const lines = String(output || '').split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
    const packages = [];
    let tableStarted = false;
    for (const line of lines) {
        if (/^-{3,}/.test(line.replace(/\s/g, ''))) {
            tableStarted = true;
            continue;
        }


        if (!tableStarted) continue;
        if (/^The following packages/i.test(line) || /^No package found/i.test(line)) continue;
        const match = line.match(/^(.*?)\s{2,}([A-Za-z0-9][A-Za-z0-9._-]+)\s{2,}(\S+)\s{2,}(\S+)(?:\s{2,}(\S+))?$/);
        if (!match) continue;
        const [, name, id, version, matchType, source] = match;
        packages.push({
            name: name.trim(),
            id: id.trim(),
            version: version.trim(),
            matchType: matchType.trim(),
            source: (source || '').trim() || 'winget',
        });
    }


    return packages;
}

function slugifyWingetPackage(input = '') {
    return String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'package';
}

function escapeRegExp(text = '') {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatUsdBillions(value = 0) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 'N/A';
    return `$${(amount / 1_000_000_000).toFixed(2)}B`;
}

function buildNvidiaSnapshotLines(snapshot = {}) {
    const periodLabel = snapshot.periodEnd || 'N/A';
    const filedLabel = snapshot.filedAt || 'N/A';
    return [
        `Period End: ${periodLabel}`,
        `Filed Date: ${filedLabel}`,
        `Revenue: ${formatUsdBillions(snapshot.revenue)}`,
        `Net Income: ${formatUsdBillions(snapshot.netIncome)}`,
        `Diluted EPS: ${snapshot.epsDiluted === null ? 'N/A' : snapshot.epsDiluted}`,
        `Source: ${snapshot.source || 'N/A'}`,
    ];
}

module.exports = {
    tokenizeForMatch,
    scoreByTokenSet,
    escapeMarkdown,
    redactSensitiveText,
    compactMarkdownSnippet,
    buildChatHistoryForRequest,
    normalizeChalkboardAttachment,
    getTaskDurationText,
    pickExperienceHighlights,
    buildExperienceAdvice,
    buildExperienceMarkdown,
    detectAgentFinanceIntent,
    detectGameResearchIntent,
    extractWingetSearchQuery,
    parseWingetSearchOutput,
    slugifyWingetPackage,
    escapeRegExp,
    formatUsdBillions,
    buildNvidiaSnapshotLines,
};
