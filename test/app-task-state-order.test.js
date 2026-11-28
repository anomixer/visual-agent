'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extract(name) {
    const matches = [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[^]*?^\\}\\r?$`, 'gm'))];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${name}`);
    return new vm.Script(matches[0][0], {
        filename: sourcePath,
        lineOffset: source.slice(0, matches[0].index).split('\n').length - 1,
    });
}

const declarations = [
    'loadTodo', 'applyTodoListSnapshot', 'announceTaskStatusChanges', 'syncKnownTaskStatuses',
    'syncBrowserInstallQueuedFromTasks', 'buildTaskCompletionMessage',
    'deleteTask', 'queueSopTaskById', 'waitForTaskCompletion',
].map(extract);

function task(id, status = 'pending', extra = {}) {
    return {
        id,
        title: id,
        skillId: null,
        action: 'install',
        status,
        progress: status === 'success' ? 100 : 0,
        ...extra,
    };
}

function harness(initialTasks = []) {
    const pending = [];
    const routes = [];
    const renders = [];
    const bubbles = [];
    const sidebarRefreshes = [];
    const logs = [];
    const timers = [];
    const executed = [];
    const context = {
        console: { error: () => {}, warn: () => {}, log: () => {} },
        todoList: initialTasks.map((item) => ({ ...item })),
        todoRequestSeq: 0,
        todoStateGeneration: 0,
        knownTaskStatuses: new Map(initialTasks.map((item) => [item.id, item.status])),
        browserInstallQueued: false,
        browserRuntimeReady: false,
        sopsList: [{ id: 'sop', name: 'SOP', description: '', category: 'Test', recommendedAction: 'install' }],
        t: (key) => key,
        getActionLabel: () => 'Install',
        getLocalizedItem: (item) => item,
        api: (route, options) => {
            routes.push({ route, options });
            return new Promise((resolve) => pending.push(resolve));
        },
        renderTodoList: () => renders.push(context.todoList.map((item) => item.id).join(',')),
        appendChatBubble: (role, message) => bubbles.push({ role, message }),
        refreshSidebarDataSoon: () => sidebarRefreshes.push(true),
        addUILog: (message, level) => logs.push({ message, level }),
        logTaskFailure: (key, data) => logs.push({ key, error: data?.error, level: 'error' }),
        async executeTask(id) { executed.push(id); },
        setTimeout: (callback) => { timers.push(callback); return timers.length; },
    };
    vm.createContext(context);
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });

    async function resolveAt(index, payload) {
        assert.ok(pending[index], `Expected pending task request ${index}`);
        pending[index](payload);
        await new Promise((resolve) => setImmediate(resolve));
    }

    return {
        context, pending, routes, renders, bubbles, sidebarRefreshes, logs, timers, executed, resolveAt,
    };
}

function snapshot(tasks) {
    return { success: true, todoList: tasks };
}

test('an older poll cannot overwrite a newer task snapshot', async () => {
    const fixture = harness([task('task', 'running')]);
    const { context, resolveAt } = fixture;

    const older = context.loadTodo();
    const newer = context.loadTodo();
    await resolveAt(1, snapshot([task('task', 'success')]));
    await newer;
    assert.equal(context.todoList[0].status, 'success');

    await resolveAt(0, snapshot([task('task', 'running')]));
    await older;

    assert.equal(context.todoList[0].status, 'success', 'the newer snapshot must remain visible');
    assert.equal(context.knownTaskStatuses.get('task'), 'success');
});

test('a successful delete cannot be undone by an older in-flight poll', async () => {
    const fixture = harness([task('deleted-task')]);
    const { context, resolveAt } = fixture;

    const olderPoll = context.loadTodo();
    const deletion = context.deleteTask('deleted-task');
    await resolveAt(1, snapshot([]));
    await deletion;
    assert.deepEqual(context.todoList, []);

    await resolveAt(0, snapshot([task('deleted-task')]));
    await olderPoll;

    assert.deepEqual(context.todoList, [], 'a stale poll must not resurrect a deleted task');
});

test('a successful add cannot be removed by an older in-flight poll', async () => {
    const fixture = harness();
    const { context, resolveAt } = fixture;

    const olderPoll = context.loadTodo();
    const creation = context.queueSopTaskById('sop');
    const created = task('created-task', 'pending', { skillId: 'sop' });
    await resolveAt(1, { success: true, task: created, todoList: [created] });
    await creation;
    assert.deepEqual(context.todoList.map((item) => item.id), ['created-task']);

    await resolveAt(0, snapshot([]));
    await olderPoll;

    assert.deepEqual(context.todoList.map((item) => item.id), ['created-task'], 'a stale poll must not hide a new task');
    assert.equal(context.knownTaskStatuses.get('created-task'), 'pending');
});

test('a stale intermediate snapshot cannot regress completion state or duplicate announcements', async () => {
    const fixture = harness([task('task', 'running', { skillId: 'sop' })]);
    const { context, resolveAt, bubbles, sidebarRefreshes } = fixture;

    const older = context.loadTodo();
    const newer = context.loadTodo();
    await resolveAt(1, snapshot([task('task', 'success', { skillId: 'sop' })]));
    await newer;
    assert.equal(bubbles.length, 1);
    assert.equal(sidebarRefreshes.length, 1);

    await resolveAt(0, snapshot([task('task', 'running', { skillId: 'sop' })]));
    await older;
    const confirmation = context.loadTodo();
    await resolveAt(2, snapshot([task('task', 'success', { skillId: 'sop' })]));
    await confirmation;

    assert.equal(context.knownTaskStatuses.get('task'), 'success');
    assert.equal(bubbles.length, 1, 'completion must not be announced twice after a stale response');
    assert.equal(sidebarRefreshes.length, 1);
});

test('a stale poll cannot restore browser-install queued state after the task disappears', async () => {
    const install = task('install', 'pending', { skillId: 'install_playwright_chromium' });
    const fixture = harness([install]);
    const { context, resolveAt } = fixture;
    context.browserInstallQueued = true;

    const older = context.loadTodo();
    const newer = context.loadTodo();
    await resolveAt(1, snapshot([]));
    await newer;
    assert.equal(context.browserInstallQueued, false);

    await resolveAt(0, snapshot([install]));
    await older;

    assert.equal(context.browserInstallQueued, false, 'queued state must follow the accepted snapshot');
});

test('a newer failed poll prevents an older success from applying', async () => {
    const fixture = harness([task('current')]);
    const { context, resolveAt, renders } = fixture;

    const older = context.loadTodo();
    const newer = context.loadTodo();
    await resolveAt(1, { success: false, error: 'offline' });
    await newer;
    const renderCount = renders.length;

    await resolveAt(0, snapshot([task('stale')]));
    await older;

    assert.deepEqual(context.todoList.map((item) => item.id), ['current']);
    assert.equal(renders.length, renderCount);
});

test('sequential polls still apply normally', async () => {
    const fixture = harness();
    const { context, resolveAt, renders } = fixture;

    const first = context.loadTodo();
    await resolveAt(0, snapshot([task('first')]));
    await first;
    const second = context.loadTodo();
    await resolveAt(1, snapshot([task('first'), task('second')]));
    await second;

    assert.deepEqual(context.todoList.map((item) => item.id), ['first', 'second']);
    assert.equal(renders.length, 2);
});

test('task completion waiting does not loop on a stale response after a newer terminal snapshot', async () => {
    const fixture = harness([task('task', 'running')]);
    const { context, resolveAt, routes, pending, timers } = fixture;

    const waiting = context.waitForTaskCompletion('task', 1000);
    const newerPoll = context.loadTodo();
    await resolveAt(1, snapshot([task('task', 'success')]));
    await newerPoll;
    await resolveAt(0, snapshot([task('task', 'running')]));
    await new Promise((resolve) => setImmediate(resolve));
    timers.shift()?.();
    await new Promise((resolve) => setImmediate(resolve));
    if (pending[2]) {
        await resolveAt(2, snapshot([task('task', 'success')]));
        assert.fail('a stale response must not make the completion waiter start another poll');
    }

    const completed = await waiting;
    assert.equal(completed?.status, 'success');
    assert.equal(routes.length, 2, 'the waiter must use the newer accepted snapshot instead of polling again');
});

test('an unusable snapshot does not invalidate an older valid poll', async () => {
    const fixture = harness();
    const { context, resolveAt, renders } = fixture;

    const older = context.loadTodo();
    assert.equal(context.applyTodoListSnapshot(null), false);
    assert.deepEqual(renders, []);
    assert.equal(context.todoStateGeneration, 0);

    await resolveAt(0, snapshot([task('valid')]));
    await older;

    assert.deepEqual(context.todoList.map((item) => item.id), ['valid']);
    assert.equal(context.todoStateGeneration, 1);
    assert.equal(renders.length, 1);
});

test('queueSopTaskById executes the task from its own response snapshot', async () => {
    const fixture = harness();
    const { context, resolveAt, executed } = fixture;
    const created = task('created-task', 'pending', { skillId: 'sop' });

    const creation = context.queueSopTaskById('sop', true);
    await resolveAt(0, { success: true, todoList: [created] });
    await creation;

    assert.deepEqual(context.todoList, [created]);
    assert.deepEqual(executed, ['created-task']);
});

test('runtime task-list replacement is confined to the central snapshot helper', () => {
    const assignments = [...source.matchAll(/^[ \t]*(?:let[ \t]+)?todoList[ \t]*=/gm)];
    assert.equal(assignments.length, 2, 'only the declaration and applyTodoListSnapshot may replace todoList');
});
