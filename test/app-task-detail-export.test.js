'use strict';
// 詳情視窗與匯出 fallback — 擷取 public/app.js 的真實函式與 I18N，以最小 fake DOM 執行。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractFunction(name) {
    const pattern = new RegExp(`^function ${name}\\([^)]*\\) \\{[^]*?^\\}\\r?$`, 'gm');
    const match = [...source.matchAll(pattern)];
    assert.equal(match.length, 1, `Expected one actual declaration of ${name}`);
    return match[0];
}

function readBlock(startIndex) {
    let depth = 0;
    for (let i = startIndex; i < source.length; i++) {
        const char = source[i];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) return source.slice(startIndex, i + 1);
        }
    }
    throw new Error('Unbalanced block while reading the locale dictionary');
}

function loadLocalePacks(locale) {
    const literalStart = source.indexOf('const I18N = {');
    assert.ok(literalStart >= 0, 'Expected to find the I18N literal');
    const chunks = ['I18N = ' + readBlock(source.indexOf('{', literalStart))];
    for (const packLocale of ['zh-TW', 'en-US']) {
        const marker = `Object.assign(I18N['${packLocale}'].remote, `;
        const markerIndex = source.indexOf(marker);
        assert.ok(markerIndex >= 0, `Expected the post-literal Object.assign for ${packLocale}`);
        chunks.push(`${marker}${readBlock(source.indexOf('{', markerIndex))});`);
    }
    // 字典本身有幾處直接讀 currentLocale，載入時必須先給值。
    return vm.runInNewContext(`${chunks.join('\n')}\nI18N;`, { currentLocale: locale }, { filename: sourcePath });
}

const DECLARATIONS = [
    'getLocalePack', 'formatI18n', 't', 'escapeHtml', 'localizeStatus', 'localizeCategory', 'getActionLabel',
    'renderTaskModalBody', 'showExpDetail', 'exportExps', 'exportTasks',
].map(extractFunction).join('\n');

const CREATED_AT = '2026-11-12T02:03:04.000Z';
const TASK_LOGS = [
    { level: 'info', message: 'check phase started', timestamp: CREATED_AT },
    { level: 'warn', message: 'download retried', timestamp: CREATED_AT },
    { level: 'error', message: 'verify returned false', timestamp: CREATED_AT },
    { level: 'ui', message: 'installing component', timestamp: CREATED_AT },
    { level: 'success', message: 'task finished', timestamp: CREATED_AT },
];
// 清單輪詢拿到的任務沒有 logs；完整記錄只存在伺服器端。
const LISTED_TASK = {
    id: 'detail-task', title: 'Synthetic task', skillId: null, action: 'uninstall',
    category: 'Test', status: 'failed', progress: 100, createdAt: CREATED_AT, completedAt: null,
};
const FULL_TASK = { ...LISTED_TASK, skillId: 'synthetic_sop', logs: TASK_LOGS };
const EXPORT_PAYLOAD = {
    exportedAt: '2026-11-12T03:00:00.000Z',
    agentVersion: '2026.8.7',
    tasks: [FULL_TASK],
};

function createContext({ locale = 'zh-TW', responses = {}, expsEntries = [] } = {}) {
    const calls = [];
    const downloads = [];
    const logs = [];
    const bubbles = [];
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        todoList: [LISTED_TASK],
        expsEntries,
        modalTitle: { textContent: '' },
        modalBody: { innerHTML: '' },
        modalOverlay: { classes: [], classList: { add(name) { context.modalOverlay.classes.push(name); } } },
        renderMarkdown: (text) => `<p>${text}</p>`,
        addUILog(message, level) { logs.push({ message, level }); },
        appendChatBubble(role, message) { bubbles.push({ role, message }); },
        api: async (endpoint, options) => {
            calls.push({ endpoint, options });
            const response = responses[endpoint];
            assert.ok(response, `Unexpected request: ${endpoint}`);
            return typeof response === 'function' ? response() : response;
        },
        Blob: class {
            constructor(parts, options) { this.parts = parts; this.options = options; }
        },
        URL: {
            createObjectURL(blob) { downloads.push(blob); return 'blob:fake'; },
            revokeObjectURL() {},
        },
        document: { createElement: () => ({ href: '', download: '', click() {} }) },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    return { context, calls, downloads, logs, bubbles };
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 20));
}

test('the browser export fallback keeps the full log history and export wrapper', async () => {
    const { context, calls, downloads, logs } = createContext({
        responses: {
            '/api/todo/export-file': { success: false, error: 'native dialog unavailable' },
            '/api/todo/export': EXPORT_PAYLOAD,
        },
    });

    context.exportTasks();
    await flush();

    assert.deepEqual(calls.map((call) => call.endpoint), ['/api/todo/export-file', '/api/todo/export']);
    assert.equal(downloads.length, 1, 'the fallback must still download a file');
    const downloaded = JSON.parse(downloads[0].parts[0]);
    assert.equal(Array.isArray(downloaded), false, 'the fallback must use the export payload, not a bare array');
    assert.equal(downloaded.agentVersion, EXPORT_PAYLOAD.agentVersion);
    assert.equal(downloaded.exportedAt, EXPORT_PAYLOAD.exportedAt);
    assert.deepEqual(downloaded.tasks[0].logs, TASK_LOGS, 'execution history must survive the fallback');
    assert.equal(logs.at(-1).level, 'warn');
    assert.match(logs.at(-1).message, /native dialog unavailable/);
});

test('the export fallback reports a failure instead of downloading a log-free list', async () => {
    const { context, calls, downloads, logs } = createContext({
        responses: {
            '/api/todo/export-file': { success: false, error: 'native dialog unavailable' },
            '/api/todo/export': { success: false, error: 'offline' },
        },
    });

    context.exportTasks();
    await flush();

    assert.equal(calls.length, 2);
    assert.equal(downloads.length, 0, 'a log-free file must not be passed off as an export');
    assert.equal(logs.at(-1).level, 'error');
    assert.match(logs.at(-1).message, /offline/);
});

test('a successful or cancelled native export never reaches the fallback', async () => {
    const succeeded = createContext({
        responses: { '/api/todo/export-file': { success: true, fileName: 'tasks.json' } },
    });
    succeeded.context.exportTasks();
    await flush();
    assert.deepEqual(succeeded.calls.map((call) => call.endpoint), ['/api/todo/export-file']);
    assert.equal(succeeded.downloads.length, 0);
    assert.equal(succeeded.logs.at(-1).level, 'success');
    assert.equal(succeeded.bubbles.length, 1);

    const cancelled = createContext({
        responses: { '/api/todo/export-file': { success: false, cancelled: true } },
    });
    cancelled.context.exportTasks();
    await flush();
    assert.deepEqual(cancelled.calls.map((call) => call.endpoint), ['/api/todo/export-file']);
    assert.equal(cancelled.downloads.length, 0);
    assert.equal(cancelled.logs.at(-1).level, 'info');
});

test('task detail log entries are coloured by level, not by a missing type field', () => {
    const { context } = createContext();
    context.renderTaskModalBody(FULL_TASK);
    const html = context.modalBody.innerHTML;

    for (const level of ['info', 'warn', 'error', 'ui', 'success']) {
        assert.equal(html.split(`log-entry ${level}"`).length - 1, 1, `expected exactly one ${level} entry`);
    }
    assert.match(html, /verify returned false/);
    assert.equal(context.modalTitle.textContent, FULL_TASK.title);
});

test('task detail labels and created date follow the active locale', () => {
    const zh = createContext({ locale: 'zh-TW' });
    zh.context.renderTaskModalBody(FULL_TASK);
    for (const label of ['狀態', '分類', '動作', '建立時間', '執行記錄']) {
        assert.ok(zh.context.modalBody.innerHTML.includes(label), `zh-TW missing ${label}`);
    }
    assert.ok(zh.context.modalBody.innerHTML.includes(new Date(CREATED_AT).toLocaleString('zh-TW')));

    const en = createContext({ locale: 'en-US' });
    en.context.renderTaskModalBody(FULL_TASK);
    const html = en.context.modalBody.innerHTML;
    for (const label of ['Status', 'Category', 'Action', 'Created', 'Execution log']) {
        assert.ok(html.includes(label), `en-US missing ${label}`);
    }
    for (const label of ['狀態', '分類', '動作', '建立時間', '執行記錄']) {
        assert.ok(!html.includes(label), `en-US must not render ${label}`);
    }
    assert.ok(html.includes(new Date(CREATED_AT).toLocaleString('en-US')));
    assert.ok(!html.includes(new Date(CREATED_AT).toLocaleString('zh-TW')));
    assert.ok(html.includes('Uninstall'), 'the action label must stay localized');
});

test('a task without a SOP shows the localized placeholder', () => {
    const zh = createContext({ locale: 'zh-TW' });
    zh.context.renderTaskModalBody({ ...FULL_TASK, skillId: null, logs: [] });
    assert.ok(zh.context.modalBody.innerHTML.includes('（無）'));
    assert.ok(!zh.context.modalBody.innerHTML.includes('執行記錄'), 'no log section without logs');

    const en = createContext({ locale: 'en-US' });
    en.context.renderTaskModalBody({ ...FULL_TASK, skillId: null, logs: [] });
    assert.ok(en.context.modalBody.innerHTML.includes('(none)'));
    assert.ok(!en.context.modalBody.innerHTML.includes('（無）'));
});

test('experience detail labels follow the active locale', () => {
    const entry = {
        title: 'Synthetic experience', fileName: 'exp-20261112.md', sopId: 'synthetic_sop',
        updatedAt: CREATED_AT, content: 'body text',
    };
    const zh = createContext({ locale: 'zh-TW' });
    zh.context.showExpDetail(entry);
    assert.ok(zh.context.modalBody.innerHTML.includes('來源'));
    assert.ok(zh.context.modalBody.innerHTML.includes('更新時間'));
    assert.equal(zh.context.modalOverlay.classes.length, 1);

    const en = createContext({ locale: 'en-US' });
    en.context.showExpDetail(entry);
    const html = en.context.modalBody.innerHTML;
    assert.ok(html.includes('Source'));
    assert.ok(html.includes('Updated'));
    assert.ok(!html.includes('來源'));
    assert.ok(!html.includes('更新時間'));
    assert.ok(html.includes('exp-20261112.md'));
});

test('the experience export uses the localized unnamed title and timestamp', async () => {
    const entry = { sopId: 'synthetic_sop', updatedAt: CREATED_AT, content: 'body text' };
    const zh = createContext({
        locale: 'zh-TW',
        expsEntries: [entry],
        responses: { '/api/exps/export-file': { success: true, fileName: 'exps.md' } },
    });
    zh.context.exportExps();
    await flush();
    const zhMarkdown = zh.calls[0].options.body.markdown;
    assert.ok(zhMarkdown.includes('未命名經驗'));
    assert.ok(zhMarkdown.includes(new Date(CREATED_AT).toLocaleString('zh-TW', { hour12: false })));

    const en = createContext({
        locale: 'en-US',
        expsEntries: [entry],
        responses: { '/api/exps/export-file': { success: true, fileName: 'exps.md' } },
    });
    en.context.exportExps();
    await flush();
    const enMarkdown = en.calls[0].options.body.markdown;
    assert.equal(en.calls[0].endpoint, '/api/exps/export-file');
    assert.ok(enMarkdown.includes('Unnamed Experience'));
    assert.ok(!enMarkdown.includes('未命名'));
    assert.ok(enMarkdown.includes(new Date(CREATED_AT).toLocaleString('en-US', { hour12: false })));
    assert.ok(enMarkdown.includes('body text'));
});