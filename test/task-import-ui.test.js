'use strict';
// 任務匯入 UI 邏輯 — 直接擷取 public/app.js 的真實函式，以最小 fake DOM / FileReader 執行。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const match = [...source.matchAll(/^function importTasks\(file\) \{[^]*?^\}\r?$/gm)];
assert.equal(match.length, 1, 'Expected one actual declaration of importTasks');

function createContext(response) {
    const calls = [];
    const context = {
        api: async (endpoint, options) => {
            calls.push({ endpoint, options });
            return response;
        },
        t: (key) => key,
        todoList: [{ id: 'previous-task', title: 'Previous', status: 'pending' }],
        rendered: 0,
        renderTodoList() { context.rendered += 1; },
        logs: [],
        addUILog(message, level) { context.logs.push({ message, level }); },
    };
    context.FileReader = class {
        readAsText(file) {
            this.onload({ target: { result: file.content } });
        }
    };
    vm.createContext(context);
    vm.runInContext(match[0], context, { filename: sourcePath });
    return { context, calls };
}

function runImport(response, fileContent, waitMs = 50) {
    const { context, calls } = createContext(response);
    context.importTasks({ content: fileContent });
    return new Promise((resolve) => setTimeout(() => resolve({ context, calls }), waitMs));
}

test('importTasks posts the unwrapped task array to /api/todo/import', async () => {
    const tasks = [{ id: 'imported-task', title: 'Imported', status: 'pending' }];
    const { context, calls } = await runImport({ success: true, count: 1, todoList: tasks }, JSON.stringify({
        exportedAt: '2026-10-29T00:00:00.000Z',
        agentVersion: '2026.8.7',
        tasks,
    }));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, '/api/todo/import');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.body.tasks.length, 1);
    assert.equal(calls[0].options.body.tasks[0].id, 'imported-task');
    assert.equal(context.todoList[0].id, 'imported-task');
    assert.equal(context.rendered, 1);
    assert.equal(context.logs.at(-1).level, 'success');
});

test('importTasks still accepts the legacy bare-array export', async () => {
    const tasks = [{ id: 'legacy-task', title: 'Legacy', status: 'pending' }];
    const { calls, context } = await runImport({ success: true, count: 1, todoList: tasks }, JSON.stringify(tasks));

    assert.equal(calls[0].options.body.tasks.length, 1);
    assert.equal(calls[0].options.body.tasks[0].id, 'legacy-task');
    assert.equal(context.todoList[0].id, 'legacy-task');
});

test('importTasks reports the server refusal instead of failing silently', async () => {
    const { context, calls } = await runImport(
        { success: false, error: 'Cannot import tasks while a task is running' },
        JSON.stringify({ tasks: [{ id: 'blocked-task' }] })
    );

    assert.equal(calls.length, 1);
    assert.equal(context.rendered, 0);
    assert.equal(context.todoList[0].id, 'previous-task');
    assert.equal(context.logs.at(-1).level, 'error');
    assert.match(context.logs.at(-1).message, /running/);
});
