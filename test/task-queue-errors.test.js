'use strict';
// 加入 / 刪除任務的失敗回饋 — 擷取 public/app.js 的真實函式，以最小 fake DOM 與 scripted api 執行。
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
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
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
    return vm.runInNewContext(`${chunks.join('\n')}\nI18N;`, { currentLocale: locale }, { filename: sourcePath });
}

const DECLARATIONS = [
    'getLocalePack', 'formatI18n', 't', 'localizeCategory', 'localizeRiskLevel', 'getLocalizedItem',
    'getDisplayAction', 'getActionLabel', 'getActionTitle', 'logTaskFailure', 'queueSopTodo',
    'addSopToTodo', 'addAndExecuteSop', 'addRecommendToTodo', 'addAndExecuteRecommend', 'deleteTask',
].map(extractFunction).join('\n');

const SOP_ITEM = {
    id: 'synthetic_sop', name: 'Install Synthetic', description: 'Synthetic SOP', category: 'Test',
    recommendedAction: 'install',
};
const RECOMMEND_ITEM = {
    id: 'rec_synthetic', title: 'Install Synthetic', description: 'Synthetic recommendation', category: 'Test',
    recommendedAction: 'install',
};
const EXISTING_TASK = { id: 'existing-task', title: 'Existing', status: 'pending', progress: 0 };
const CREATED_TASK = { id: 'created-task', title: '📦 Install Synthetic', status: 'pending', progress: 0 };
const OK = { success: true, task: CREATED_TASK, todoList: [CREATED_TASK] };

function createContext(response, locale = 'zh-TW') {
    const calls = [];
    const logs = [];
    const rendered = [];
    const tabs = [];
    const executed = [];
    const bubbles = [];
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        todoList: [EXISTING_TASK],
        api: async (endpoint, options) => {
            calls.push({ endpoint, options });
            return response;
        },
        renderTodoList() { rendered.push(context.todoList.map((task) => task.id)); },
        addUILog(message, level) { logs.push({ message, level }); },
        openTab(name) { tabs.push(name); },
        appendChatBubble(role, message) { bubbles.push({ role, message }); },
        expandLog() {},
        async executeTask(id) { executed.push(id); },
        async refreshBrowserRuntimeAvailability() { executed.push('refresh-browser'); },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    return { context, calls, logs, rendered, tabs, executed, bubbles };
}

const REFUSED = { success: false, error: 'SOP directory is unavailable' };

test('addSopToTodo reports the refusal instead of doing nothing', async () => {
    const { context, calls, logs, rendered, tabs } = createContext(REFUSED);

    await context.addSopToTodo(SOP_ITEM);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, '/api/todo');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.body.skillId, 'synthetic_sop');
    assert.equal(calls[0].options.body.action, 'install');
    assert.deepEqual(context.todoList, [EXISTING_TASK]);
    assert.deepEqual(rendered, []);
    assert.deepEqual(tabs, []);
    assert.equal(logs.at(-1).level, 'error');
    assert.match(logs.at(-1).message, /加入任務失敗: SOP directory is unavailable/);
});

test('addAndExecuteSop does not start a task that was never created', async () => {
    const { context, logs, executed, bubbles, tabs } = createContext(REFUSED);

    await context.addAndExecuteSop(SOP_ITEM);

    assert.deepEqual(executed, []);
    assert.deepEqual(bubbles, []);
    assert.deepEqual(tabs, []);
    assert.deepEqual(context.todoList, [EXISTING_TASK]);
    assert.equal(logs.at(-1).level, 'error');
});

test('addRecommendToTodo reports the refusal', async () => {
    const { context, logs, rendered } = createContext(REFUSED);

    await context.addRecommendToTodo(RECOMMEND_ITEM);

    assert.deepEqual(context.todoList, [EXISTING_TASK]);
    assert.deepEqual(rendered, []);
    assert.equal(logs.at(-1).level, 'error');
    assert.match(logs.at(-1).message, /SOP directory is unavailable/);
});

test('addAndExecuteRecommend neither executes nor refreshes the browser runtime', async () => {
    const { context, executed, bubbles } = createContext(REFUSED);

    await context.addAndExecuteRecommend({ ...RECOMMEND_ITEM, id: 'install_playwright_chromium' });

    assert.deepEqual(executed, []);
    assert.deepEqual(bubbles, []);
    assert.deepEqual(context.todoList, [EXISTING_TASK]);
});

test('deleteTask surfaces the running-task refusal', async () => {
    const { context, calls, logs, rendered } = createContext({
        success: false, error: 'Cannot delete a running task',
    });

    await context.deleteTask('existing-task');

    assert.equal(calls[0].endpoint, '/api/todo/existing-task');
    assert.equal(calls[0].options.method, 'DELETE');
    assert.deepEqual(context.todoList, [EXISTING_TASK]);
    assert.deepEqual(rendered, []);
    assert.equal(logs.at(-1).level, 'error');
    assert.match(logs.at(-1).message, /刪除任務失敗: Cannot delete a running task/);
});

test('a transport failure wrapped by api() is still reported', async () => {
    const { context, logs } = createContext({ success: false, error: 'Failed to fetch' });

    await context.addSopToTodo(SOP_ITEM);
    await context.deleteTask('existing-task');

    assert.equal(logs.length, 2);
    assert.ok(logs.every((entry) => entry.level === 'error'));
    assert.match(logs[0].message, /Failed to fetch/);
    assert.match(logs[1].message, /Failed to fetch/);
});

test('the success paths still queue, render and execute', async () => {
    const queued = createContext(OK);
    await queued.context.addAndExecuteSop(SOP_ITEM);
    assert.deepEqual(queued.context.todoList, [CREATED_TASK]);
    assert.deepEqual(queued.rendered, [['created-task']]);
    assert.deepEqual(queued.tabs, ['todolist']);
    assert.deepEqual(queued.executed, ['created-task']);
    assert.equal(queued.bubbles.length, 1);
    assert.equal(queued.logs.at(-1).level, 'info');

    const recommended = createContext(OK);
    await recommended.context.addAndExecuteRecommend(RECOMMEND_ITEM);
    assert.deepEqual(recommended.executed, ['created-task']);

    const deleted = createContext({ success: true, todoList: [] });
    await deleted.context.deleteTask('existing-task');
    assert.deepEqual(deleted.context.todoList, []);
    assert.deepEqual(deleted.rendered, [[]]);
    assert.deepEqual(deleted.logs, []);
});

test('the failure labels follow the active locale', async () => {
    const { context, logs } = createContext(REFUSED, 'en-US');

    await context.addSopToTodo(SOP_ITEM);
    await context.deleteTask('existing-task');

    assert.match(logs[0].message, /Failed to add task: SOP directory is unavailable/);
    assert.match(logs[1].message, /Failed to delete task: SOP directory is unavailable/);
    assert.ok(logs.every((entry) => !/[\u4e00-\u9fff]/.test(entry.message)));
});