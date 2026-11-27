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
    const pattern = new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[^]*?^\\}\\r?$`, 'gm');
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

const activeDetailModalMatch = source.match(/^let activeDetailModal = null;\r?$/m);
assert.ok(activeDetailModalMatch, 'Expected the active detail modal state declaration');

const DECLARATIONS = [
    activeDetailModalMatch[0],
    'getLocalePack', 'formatI18n', 't', 'escapeHtml', 'localizeStatus', 'localizeCategory', 'getDisplayAction', 'getActionLabel',
    'renderTaskModalBody', 'fetchTaskDetail', 'showExpDetail', 'showTaskModal', 'refreshActiveDetailModal', 'closeSharedModal',
    'renderDiagnosticsModal', 'openDiagnosticsModal', 'exportExps', 'exportTasks',
].map((name) => name.startsWith('let ') ? name : extractFunction(name)).join('\n');

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
const DIAGNOSTICS_PAYLOAD = {
    success: true,
    app: { version: '2026.8.7', pid: 4242, node: 'v24.22.1', platform: 'win32' },
    ports: { http: {}, remote: {} },
    llm: { provider: 'Ollama', modelName: 'synthetic-model', available: true, modelReady: true },
    browser: { playwrightModuleAvailable: true, browserAvailable: false },
    paths: { appData: 'C:\\synthetic\\visual-agent', debugLog: 'C:\\synthetic\\debug.log' },
    data: { taskCount: 0, pendingTaskCount: 0, runningTaskCount: 0, sopCount: 1, skillCount: 2 },
    debugLog: { lines: [] },
};
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
    const listeners = [];
    const copies = [];
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        todoList: [LISTED_TASK],
        expsEntries,
        modalTitle: { textContent: '' },
        modalBody: { innerHTML: '' },
        modalOverlay: {
            classes: [],
            classList: {
                add(name) { if (!context.modalOverlay.classes.includes(name)) context.modalOverlay.classes.push(name); },
                remove(name) {
                    const index = context.modalOverlay.classes.indexOf(name);
                    if (index >= 0) context.modalOverlay.classes.splice(index, 1);
                },
                contains(name) { return context.modalOverlay.classes.includes(name); },
            },
        },
        renderMarkdown: (text) => `<p>${text}</p>`,
        renderDiagnosticRows: (rows) => rows.map(([label, value]) => `<div>${label}: ${value}</div>`).join(''),
        copyDiagnosticsSummary(data) { copies.push(data); },
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
        document: {
            createElement: () => ({ href: '', download: '', click() {} }),
            getElementById: (id) => id === 'btnCopyDiagnostics' ? {
                addEventListener(type, listener) { listeners.push({ id, type, listener }); },
            } : null,
        },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    context.getActiveDetailModal = () => vm.runInContext('activeDetailModal', context);
    return { context, calls, downloads, logs, bubbles, listeners, copies };
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 20));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
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

test('task details tolerate corrupt persisted log data and render legacy string entries', () => {
    const { context } = createContext();
    const corruptLogs = [null, 'legacy <line>', { level: 'warn', message: 'still visible' }, undefined];
    context.renderTaskModalBody({ ...FULL_TASK, logs: corruptLogs });
    const html = context.modalBody.innerHTML;
    assert.equal(html.split('task-log-item').length - 1, 2, 'nullish entries must not be rendered');
    assert.match(html, /log-entry info[^]*?legacy &lt;line&gt;/);
    assert.match(html, /log-entry warn[^]*?still visible/);

    context.renderTaskModalBody({ ...FULL_TASK, logs: 'not-an-array' });
    assert.ok(!context.modalBody.innerHTML.includes('task-log-item'));
    assert.ok(!context.modalBody.innerHTML.includes(context.t('task.detailLogs')));
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

test('open task and experience details refresh immediately when the locale changes', async () => {
    const taskView = createContext({ locale: 'zh-TW' });
    await taskView.context.showTaskModal(FULL_TASK);
    assert.ok(taskView.context.modalOverlay.classList.contains('visible'));
    assert.match(taskView.context.modalBody.innerHTML, /狀態/);

    taskView.context.currentLocale = 'en-US';
    taskView.context.refreshActiveDetailModal();
    const taskHtml = taskView.context.modalBody.innerHTML;
    for (const label of ['Status', 'Category', 'Action', 'SOP ID', 'Created', 'Execution log']) {
        assert.ok(taskHtml.includes(label), `en-US task detail missing ${label}`);
    }
    for (const label of ['狀態', '分類', '動作', '建立時間', '執行記錄']) {
        assert.ok(!taskHtml.includes(label), `en-US task detail still contains ${label}`);
    }

    const entry = {
        title: 'Synthetic experience', fileName: 'exp-20261112.md', sopId: 'synthetic_sop',
        updatedAt: CREATED_AT, content: 'body text',
    };
    const expView = createContext({ locale: 'zh-TW' });
    expView.context.showExpDetail(entry);
    assert.match(expView.context.modalBody.innerHTML, /來源/);

    expView.context.currentLocale = 'en-US';
    expView.context.refreshActiveDetailModal();
    const expHtml = expView.context.modalBody.innerHTML;
    assert.ok(expHtml.includes('Source'));
    assert.ok(expHtml.includes('Updated'));
    assert.ok(!expHtml.includes('來源'));
    assert.ok(!expHtml.includes('更新時間'));
});

test('diagnostics redraw from the retained response when the locale changes', async () => {
    const { context, calls, listeners, copies } = createContext({
        locale: 'zh-TW',
        responses: { '/api/diagnostics': DIAGNOSTICS_PAYLOAD },
    });

    await context.openDiagnosticsModal();
    assert.equal(context.modalTitle.textContent, '診斷資訊');
    assert.match(context.modalBody.innerHTML, /應用程式/);
    assert.match(context.modalBody.innerHTML, /未監聽/);

    context.currentLocale = 'en-US';
    context.refreshActiveDetailModal();
    const html = context.modalBody.innerHTML;
    assert.equal(calls.length, 1, 'a locale redraw must not fetch diagnostics again');
    assert.equal(context.modalTitle.textContent, 'Diagnostics');
    for (const label of ['Application', 'Version', 'Ports', 'AI Engine', 'Browser Use', 'Data State']) {
        assert.ok(html.includes(label), `en-US diagnostics missing ${label}`);
    }
    for (const label of ['診斷資訊', '應用程式', '版本', '連接埠', 'AI 引擎', '資料狀態', '未監聽']) {
        assert.ok(!html.includes(label), `en-US diagnostics still contains ${label}`);
    }
    assert.match(html, /not listening/);
    assert.match(html, /\(0 pending, 0 running\)/);
    assert.ok(html.includes('(empty)'), 'the empty debug-log placeholder must be localized');
    assert.ok(!html.includes('（空白）'), 'en-US diagnostics must not retain the Chinese empty placeholder');

    assert.equal(listeners.length, 2, 'each render must reconnect the copy button');
    listeners.at(-1).listener();
    assert.equal(copies.at(-1), DIAGNOSTICS_PAYLOAD, 'the copy action must retain the original diagnostics data');
});

test('diagnostics loading and failure states follow a locale change without refetching', async () => {
    const response = deferred();
    const loading = createContext({
        locale: 'zh-TW',
        responses: { '/api/diagnostics': () => response.promise },
    });
    const opening = loading.context.openDiagnosticsModal();
    assert.match(loading.context.modalBody.innerHTML, /正在收集診斷資訊/);

    loading.context.currentLocale = 'en-US';
    loading.context.refreshActiveDetailModal();
    assert.equal(loading.context.modalTitle.textContent, 'Diagnostics');
    assert.match(loading.context.modalBody.innerHTML, /Collecting diagnostics/);
    assert.equal(loading.calls.length, 1);

    response.resolve(DIAGNOSTICS_PAYLOAD);
    await opening;
    assert.match(loading.context.modalBody.innerHTML, /Application/);

    const failed = createContext({
        locale: 'zh-TW',
        responses: { '/api/diagnostics': { success: false, error: 'offline' } },
    });
    await failed.context.openDiagnosticsModal();
    assert.match(failed.context.modalBody.innerHTML, /診斷資訊讀取失敗/);

    failed.context.currentLocale = 'en-US';
    failed.context.refreshActiveDetailModal();
    assert.equal(failed.context.modalTitle.textContent, 'Diagnostics');
    assert.match(failed.context.modalBody.innerHTML, /Failed to load diagnostics: offline/);
    assert.ok(!failed.context.modalBody.innerHTML.includes('診斷資訊讀取失敗'));
    assert.equal(failed.calls.length, 1, 'a failed response must also be retained across redraws');
});

test('hidden or closed detail modals are not refreshed', async () => {
    const { context } = createContext({ locale: 'zh-TW' });
    await context.showTaskModal(FULL_TASK);
    context.modalOverlay.classList.remove('visible');
    const hiddenHtml = context.modalBody.innerHTML;

    context.currentLocale = 'en-US';
    context.refreshActiveDetailModal();
    assert.equal(context.modalBody.innerHTML, hiddenHtml, 'a hidden modal must not be re-rendered');

    context.closeSharedModal();
    assert.equal(context.modalOverlay.classList.contains('visible'), false);
    context.modalOverlay.classList.add('visible');
    context.refreshActiveDetailModal();
    assert.equal(context.modalBody.innerHTML, hiddenHtml, 'closing must clear the active detail state');
    context.modalOverlay.classList.remove('visible');
});

test('a late task detail response cannot replace a newer task request', async () => {
    const first = deferred();
    const second = deferred();
    const firstTask = { ...LISTED_TASK, id: 'first-task', title: 'First task' };
    const secondTask = { ...LISTED_TASK, id: 'second-task', title: 'Second task' };
    const { context } = createContext({
        responses: {
            '/api/task/first-task/status': () => first.promise,
            '/api/task/second-task/status': () => second.promise,
        },
    });

    const firstOpen = context.showTaskModal(firstTask);
    const secondOpen = context.showTaskModal(secondTask);
    second.resolve({ success: false, error: 'not found' });
    await secondOpen;
    assert.equal(context.modalTitle.textContent, secondTask.title, 'the newest request must own the modal');

    first.resolve({ success: true, task: { ...firstTask, logs: TASK_LOGS } });
    await firstOpen;
    assert.equal(context.modalTitle.textContent, secondTask.title, 'an older response must not overwrite the newest task');
    assert.equal(context.getActiveDetailModal().task.id, secondTask.id);
});

test('closing the shared modal invalidates an in-flight task detail request', async () => {
    const response = deferred();
    const { context } = createContext({
        responses: { '/api/task/detail-task/status': () => response.promise },
    });

    const opening = context.showTaskModal(LISTED_TASK);
    context.closeSharedModal();
    response.resolve({ success: true, task: FULL_TASK });
    await opening;

    assert.equal(context.getActiveDetailModal(), null);
    assert.equal(context.modalOverlay.classList.contains('visible'), false, 'a late response must not reopen a closed modal');
});

test('opening diagnostics invalidates an in-flight task detail request', async () => {
    const response = deferred();
    const { context } = createContext({
        responses: {
            '/api/task/detail-task/status': () => response.promise,
            '/api/diagnostics': { success: false, error: 'diagnostics offline' },
        },
    });

    const opening = context.showTaskModal(LISTED_TASK);
    await context.openDiagnosticsModal();
    const diagnosticsHtml = context.modalBody.innerHTML;
    response.resolve({ success: true, task: FULL_TASK });
    await opening;

    assert.equal(context.getActiveDetailModal().type, 'diagnostics');
    assert.equal(context.modalBody.innerHTML, diagnosticsHtml, 'a late task response must not replace diagnostics');
});

test('opening an experience invalidates an in-flight task detail request', async () => {
    const response = deferred();
    const entry = {
        title: 'Synthetic experience', fileName: 'exp-20261112.md', sopId: 'synthetic_sop',
        updatedAt: CREATED_AT, content: 'body text',
    };
    const { context } = createContext({
        responses: { '/api/task/detail-task/status': () => response.promise },
    });

    const opening = context.showTaskModal(LISTED_TASK);
    context.showExpDetail(entry);
    const experienceHtml = context.modalBody.innerHTML;
    response.resolve({ success: true, task: FULL_TASK });
    await opening;

    assert.equal(context.getActiveDetailModal().type, 'exp');
    assert.equal(context.modalBody.innerHTML, experienceHtml, 'a late task response must not replace an experience');
});

test('a late diagnostics response cannot replace a newer task detail', async () => {
    const diagnostics = deferred();
    const { context } = createContext({
        responses: { '/api/diagnostics': () => diagnostics.promise },
    });

    const openingDiagnostics = context.openDiagnosticsModal();
    await context.showTaskModal(FULL_TASK);
    const taskHtml = context.modalBody.innerHTML;
    diagnostics.resolve({ success: true, data: {}, paths: {}, llm: {}, browser: {}, ports: {}, debugLog: {} });
    await openingDiagnostics;

    assert.equal(context.getActiveDetailModal().type, 'task');
    assert.equal(context.modalTitle.textContent, FULL_TASK.title);
    assert.equal(context.modalBody.innerHTML, taskHtml, 'a late diagnostics response must not replace a task detail');
});

test('a late diagnostics failure cannot replace a newer task detail', async () => {
    const diagnostics = deferred();
    const { context } = createContext({
        responses: { '/api/diagnostics': () => diagnostics.promise },
    });

    const openingDiagnostics = context.openDiagnosticsModal();
    await context.showTaskModal(FULL_TASK);
    const taskHtml = context.modalBody.innerHTML;
    diagnostics.resolve({ success: false, error: 'late diagnostics failure' });
    await openingDiagnostics;

    assert.equal(context.getActiveDetailModal().type, 'task');
    assert.equal(context.modalBody.innerHTML, taskHtml, 'a late diagnostics error must not replace a task detail');
});

test('a late diagnostics network error cannot replace a newer task detail', async () => {
    const diagnostics = deferred();
    const { context } = createContext({
        responses: { '/api/diagnostics': () => diagnostics.promise },
    });

    const openingDiagnostics = context.openDiagnosticsModal();
    await context.showTaskModal(FULL_TASK);
    const taskHtml = context.modalBody.innerHTML;
    diagnostics.reject(new Error('late network failure'));
    await openingDiagnostics;

    assert.equal(context.getActiveDetailModal().type, 'task');
    assert.equal(context.modalBody.innerHTML, taskHtml, 'a late diagnostics exception must not replace a task detail');
});

test('opening diagnostics discards the active detail modal state', async () => {
    const { context } = createContext({
        locale: 'zh-TW',
        responses: { '/api/diagnostics': { success: false, error: 'offline' } },
    });
    context.showExpDetail({
        title: 'Synthetic experience', fileName: 'exp-20261112.md', sopId: 'synthetic_sop',
        updatedAt: CREATED_AT, content: 'body text',
    });
    await context.openDiagnosticsModal();
    const diagnosticsHtml = context.modalBody.innerHTML;
    assert.match(diagnosticsHtml, /offline/);

    context.currentLocale = 'en-US';
    context.refreshActiveDetailModal();
    assert.match(context.modalBody.innerHTML, /Failed to load diagnostics: offline/);
    assert.ok(!context.modalBody.innerHTML.includes('診斷資訊讀取失敗'), 'diagnostics must redraw without reviving the stale detail modal');
    assert.notEqual(context.modalBody.innerHTML, diagnosticsHtml, 'the diagnostics locale change must take effect immediately');
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