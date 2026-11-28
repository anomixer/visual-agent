'use strict';
// 執行中任務的 append-only 日誌：純函式 + 真實 HTTP / 隔離 harness。
// 全程不執行 PowerShell、不碰使用者 APPDATA；executor 由測試腳本控制。
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { once, EventEmitter } = require('node:events');
const { test } = require('node:test');
const { createChatHarness, FIXTURE_SOP_ID } = require('./helpers/chat-harness');
const { RUN_LOG_FILE_NAME, serializeRunLogRecord, parseRunLog } = require('../src/task-run-log');

const TASK_ID = 'run-log-fixture-task';

function request(port, method, route, { token, body } = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port, path: route, method, agent: false,
            headers: {
                Host: '127.0.0.1:3210',
                ...(token ? { 'X-Visual-Agent-Token': token } : {}),
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
            },
        }, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { raw += chunk; });
            res.on('error', reject);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { reject(new Error(`Non-JSON ${res.statusCode} from ${route}: ${raw.slice(0, 200)}`)); }
            });
        });
        req.setTimeout(5000, () => req.destroy(new Error(`Timed out: ${route}`)));
        req.on('error', reject);
        req.end(payload);
    });
}

function createScriptedExecutor() {
    const instances = [];
    class ScriptedExecutor extends EventEmitter {
        constructor(options) {
            super();
            this.options = options;
            instances.push(this);
        }
        async execute(sop, options) {
            this.executeArgs = { sopId: sop.id, options };
            return new Promise((resolve, reject) => {
                this.finish = resolve;
                this.fail = reject;
            });
        }
    }
    return { ScriptedExecutor, instances };
}

function pendingTask(overrides = {}) {
    return {
        id: TASK_ID,
        title: 'Synthetic run-log task',
        skillId: FIXTURE_SOP_ID,
        action: 'install',
        category: 'Test',
        status: 'pending',
        progress: 0,
        logs: [],
        createdAt: '2026-11-12T02:00:00.000Z',
        ...overrides,
    };
}

async function startHarness(t, options = {}) {
    const harness = createChatHarness(options);
    const server = harness.app.listen(0, '127.0.0.1');
    t.after(async () => {
        try {
            await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        } finally {
            harness.dispose();
            harness.assertSafe();
        }
    });
    await once(server, 'listening');
    const port = server.address().port;
    const meta = await request(port, 'GET', '/api/meta');
    assert.ok(meta.body.localApiToken, 'local API token should be available');
    return { harness, port, token: meta.body.localApiToken };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function runLogPath(harness) {
    return path.join(harness.sandboxRoot, 'appdata', 'visual-agent', RUN_LOG_FILE_NAME);
}

function tasksPath(harness) {
    return path.join(harness.sandboxRoot, 'appdata', 'visual-agent', 'tasks.json');
}

function failTaskWrites(harness) {
    const target = tasksPath(harness);
    const enospc = () => Object.assign(new Error('ENOSPC: synthetic task persistence failure'), { code: 'ENOSPC' });
    harness.failWrites((file) => (file.startsWith(target) ? enospc() : null));
}

function readRunRecords(harness) {
    const raw = harness.getFiles()[runLogPath(harness)];
    assert.ok(raw, 'Expected the run log sidecar to exist');
    return raw.trim().split('\n').map((line) => JSON.parse(line));
}

function readJson(files, file) {
    assert.ok(files[file], `Expected ${file} to exist`);
    return JSON.parse(files[file]);
}

// ── 純函式 ────────────────────────────────────────────────────────────

test('run log records are single JSON lines carrying task id and progress', () => {
    const entry = { level: 'info', message: 'synthetic step', timestamp: '2026-11-12T02:00:01.000Z' };
    const line = serializeRunLogRecord(TASK_ID, 40, entry);
    assert.equal(line.endsWith('\n'), true);
    assert.equal(line.trimEnd().includes('\n'), false);
    assert.deepEqual(JSON.parse(line), { taskId: TASK_ID, progress: 40, entry });
    assert.deepEqual(JSON.parse(serializeRunLogRecord(TASK_ID, 80, null)), { taskId: TASK_ID, progress: 80, entry: null });
});

test('terminal outcomes are serialized without changing legacy records', () => {
    const entry = { level: 'success', message: 'finished', timestamp: '2026-11-12T02:00:03.000Z' };
    const legacy = serializeRunLogRecord(TASK_ID, 100, entry);
    assert.equal(legacy, `${JSON.stringify({ taskId: TASK_ID, progress: 100, entry })}\n`);
    const outcome = { status: 'success', completedAt: '2026-11-12T02:00:03.000Z' };
    assert.deepEqual(JSON.parse(serializeRunLogRecord(TASK_ID, 100, entry, outcome)), {
        taskId: TASK_ID, progress: 100, entry, outcome,
    });
});

test('invalid terminal outcomes are not written to the run log', () => {
    const invalid = [
        null,
        {},
        { status: 'running', completedAt: '2026-11-12T02:00:03.000Z' },
        { status: 'pending', completedAt: '2026-11-12T02:00:03.000Z' },
        { status: 'unknown', completedAt: '2026-11-12T02:00:03.000Z' },
        { status: 'failed', completedAt: 'not-a-date' },
        { status: 'failed' },
    ];
    for (const outcome of invalid) {
        assert.deepEqual(JSON.parse(serializeRunLogRecord(TASK_ID, 100, null, outcome)), {
            taskId: TASK_ID, progress: 100, entry: null,
        });
    }
});

test('parseRunLog accepts only valid terminal metadata and keeps the latest valid outcome', () => {
    const outcome = { status: 'failed', completedAt: '2026-11-12T02:00:04.000Z' };
    const text = [
        serializeRunLogRecord(TASK_ID, 40, { level: 'info', message: 'working' }),
        serializeRunLogRecord(TASK_ID, 100, { level: 'error', message: 'crashed' }, outcome),
        serializeRunLogRecord(TASK_ID, 100, null),
        serializeRunLogRecord(TASK_ID, 100, null, { status: 'running', completedAt: outcome.completedAt }),
    ].join('');
    assert.deepEqual(parseRunLog(text, TASK_ID), {
        logs: [{ level: 'info', message: 'working' }, { level: 'error', message: 'crashed' }],
        progress: 100,
        outcome,
    });
    assert.deepEqual(parseRunLog(serializeRunLogRecord(TASK_ID, 40, null), TASK_ID), { logs: [], progress: 40 });
});

test('parseRunLog keeps entry order and the newest progress', () => {
    const text = [
        serializeRunLogRecord(TASK_ID, 20, { level: 'info', message: 'first' }),
        serializeRunLogRecord(TASK_ID, 40, null),
        serializeRunLogRecord(TASK_ID, 40, { level: 'warn', message: 'second' }),
        serializeRunLogRecord(TASK_ID, 80, null),
    ].join('');
    const { logs, progress } = parseRunLog(text, TASK_ID);
    assert.deepEqual(logs.map((l) => l.message), ['first', 'second']);
    assert.equal(progress, 80);
});

test('a half-written final line does not discard the earlier records', () => {
    const full = serializeRunLogRecord(TASK_ID, 40, { level: 'info', message: 'survivor' });
    const torn = serializeRunLogRecord(TASK_ID, 80, { level: 'info', message: 'torn' }).slice(0, 30);
    const { logs, progress } = parseRunLog(full + torn, TASK_ID);
    assert.deepEqual(logs.map((l) => l.message), ['survivor']);
    assert.equal(progress, 40);
});

test('records from another task are ignored', () => {
    const text = serializeRunLogRecord('other-task', 80, { level: 'info', message: 'not mine' });
    assert.deepEqual(parseRunLog(text, TASK_ID), { logs: [], progress: null });
});

test('empty or non-record input yields no logs and no progress', () => {
    for (const input of ['', '\n\n', 'not json at all\n', undefined, null]) {
        assert.deepEqual(parseRunLog(input, TASK_ID), { logs: [], progress: null });
    }
});

// ── 真實 route / 啟動復原 ─────────────────────────────────────────────

test('each log lands in the run log while tasks.json is left untouched mid-run', async (t) => {
    const { ScriptedExecutor, instances } = createScriptedExecutor();
    const { harness, port, token } = await startHarness(t, { executor: ScriptedExecutor });
    harness.setTasks([pendingTask()]);

    const started = await request(port, 'POST', `/api/execute/${TASK_ID}`, { token, body: {} });
    assert.equal(started.body.success, true);
    const tasksAtStart = harness.getFiles()[tasksPath(harness)];
    assert.deepEqual(readJson(harness.getFiles(), tasksPath(harness)).todoList[0].logs, []);

    const executor = instances[0];
    assert.ok(executor, 'the route should have constructed the executor before responding');
    executor.emit('phase:start', { phase: 'install' });
    executor.emit('log', { level: 'info', phase: 'running', message: '... step one' });
    executor.emit('ui:message', { message: 'synthetic ui notice' });
    executor.emit('log', { level: 'error', phase: 'running', message: '... step two failed' });

    const files = harness.getFiles();
    const records = files[runLogPath(harness)].trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(records.length, 4, 'one record per phase change and per log line');
    assert.deepEqual(records.map((r) => r.entry && r.entry.message), [null, '... step one', 'synthetic ui notice', '... step two failed']);
    assert.deepEqual(records.map((r) => r.progress), [40, 40, 40, 40]);
    assert.equal(records[2].entry.level, 'ui');

    // 執行期間不得為了 checkpoint 整份重寫 tasks.json（歷史任務的 logs 會被一起重送）。
    assert.equal(files[tasksPath(harness)], tasksAtStart, 'tasks.json must not be rewritten per log line');
    assert.equal(harness.getState().todoList[0].logs.length, 3, 'in-memory logs still accumulate');
});

test('a failed final save retains the terminal outcome and does not escape background finalization', async (t) => {
    const { ScriptedExecutor, instances } = createScriptedExecutor();
    const { harness, port, token } = await startHarness(t, { executor: ScriptedExecutor });
    harness.setReplies(['synthetic veteran note']);
    harness.setTasks([pendingTask()]);

    const started = await request(port, 'POST', `/api/execute/${TASK_ID}`, { token, body: {} });
    assert.equal(started.body.success, true);
    const executor = instances[0];
    executor.emit('log', { level: 'info', phase: 'running', message: 'mid-run before final save' });
    failTaskWrites(harness);
    executor.finish({ status: 'success' });
    await tick();
    await tick();

    const state = harness.getState();
    assert.equal(state.todoList[0].status, 'success');
    assert.equal(state.todoList[0].progress, 100);
    assert.equal(state.runningSOP, null);
    const disk = readJson(harness.getFiles(), tasksPath(harness)).todoList[0];
    assert.equal(disk.status, 'running', 'the failed atomic save must leave the previous disk snapshot intact');
    assert.equal(disk.progress, 10);

    const records = readRunRecords(harness);
    const terminal = records.at(-1);
    assert.equal(terminal.entry.message, `Task '${state.todoList[0].title}' completed (status: success)`);
    assert.deepEqual(terminal.outcome, { status: 'success', completedAt: state.todoList[0].completedAt });
    assert.ok(state.logs.some((entry) => entry.level === 'error' && /ENOSPC/.test(entry.message)), 'the save failure should be visible in the server log');
    assert.equal(harness.consoleEntries.some((entry) => entry.level === 'error' && /at .*server\.js/.test(entry.message)), false,
        'the background finalizer must not leak an uncaught save exception to the default error handler');
});

test('a failed final save after an executor crash preserves the failed outcome and final error log', async (t) => {
    const { ScriptedExecutor, instances } = createScriptedExecutor();
    const { harness, port, token } = await startHarness(t, { executor: ScriptedExecutor });
    harness.setReplies(['synthetic veteran note']);
    harness.setTasks([pendingTask()]);

    await request(port, 'POST', `/api/execute/${TASK_ID}`, { token, body: {} });
    const executor = instances[0];
    executor.emit('phase:start', { phase: 'install' });
    executor.emit('log', { level: 'info', phase: 'running', message: 'before synthetic crash' });
    failTaskWrites(harness);
    executor.fail(new Error('synthetic executor crash'));
    await tick();
    await tick();

    const state = harness.getState();
    assert.equal(state.todoList[0].status, 'failed');
    assert.equal(state.todoList[0].progress, 40);
    assert.equal(readJson(harness.getFiles(), tasksPath(harness)).todoList[0].status, 'running');
    const terminal = readRunRecords(harness).at(-1);
    assert.equal(terminal.entry.message, 'Task execution crashed: synthetic executor crash');
    assert.deepEqual(terminal.outcome, { status: 'failed', completedAt: state.todoList[0].completedAt });
});

test('startup restores a terminal sidecar outcome instead of marking the task interrupted', async (t) => {
    const completedAt = '2026-11-12T02:00:05.000Z';
    const finalEntry = { level: 'success', message: 'terminal completion', timestamp: completedAt };
    const runLog = serializeRunLogRecord(TASK_ID, 40, { level: 'info', message: 'mid-run' })
        + serializeRunLogRecord(TASK_ID, 100, finalEntry, { status: 'success', completedAt });
    const { harness } = await startHarness(t, {
        seedFiles: {
            'appdata/visual-agent/tasks.json': JSON.stringify({ todoList: [pendingTask({ status: 'running', progress: 10 })] }),
            [`appdata/visual-agent/${RUN_LOG_FILE_NAME}`]: runLog,
        },
    });

    const [task] = harness.getState().todoList;
    assert.equal(task.status, 'success');
    assert.equal(task.progress, 100);
    assert.equal(task.completedAt, completedAt);
    assert.deepEqual(Array.from(task.logs.map((entry) => entry.message)), ['mid-run', 'terminal completion']);
    assert.equal(harness.getFiles()[runLogPath(harness)], undefined);
    assert.equal(readJson(harness.getFiles(), tasksPath(harness)).todoList[0].status, 'success');
});

test('startup recovery save failure retains both the disk snapshot and sidecar for a later restart', async (t) => {
    const original = JSON.stringify({ todoList: [pendingTask({ status: 'running', progress: 10 })] });
    const runLog = serializeRunLogRecord(TASK_ID, 40, null)
        + serializeRunLogRecord(TASK_ID, 40, { level: 'info', message: 'recover me', timestamp: '2026-11-12T02:00:02.000Z' });
    const { harness } = await startHarness(t, {
        seedFiles: {
            'appdata/visual-agent/tasks.json': original,
            [`appdata/visual-agent/${RUN_LOG_FILE_NAME}`]: runLog,
        },
        initialWriteFailure: (file) => (file.includes(`${path.sep}tasks.json`)
            ? Object.assign(new Error('ENOSPC: synthetic startup save'), { code: 'ENOSPC' }) : null),
    });

    const [task] = harness.getState().todoList;
    assert.equal(task.status, 'failed');
    assert.equal(task.progress, 40);
    assert.deepEqual(Array.from(task.logs.map((entry) => entry.message)), [
        'recover me', 'Task execution interrupted: the server stopped before it finished.',
    ]);
    assert.equal(harness.getFiles()[tasksPath(harness)], original);
    assert.equal(harness.getFiles()[runLogPath(harness)], runLog);
    assert.ok(harness.getState().logs.some((entry) => entry.level === 'error' && /ENOSPC/.test(entry.message)));

    const second = await startHarness(t, {
        seedFiles: {
            'appdata/visual-agent/tasks.json': original,
            [`appdata/visual-agent/${RUN_LOG_FILE_NAME}`]: runLog,
        },
    });
    const [recovered] = second.harness.getState().todoList;
    assert.equal(recovered.status, 'failed');
    assert.equal(recovered.progress, 40);
    assert.equal(second.harness.getFiles()[runLogPath(second.harness)], undefined);
    assert.equal(readJson(second.harness.getFiles(), tasksPath(second.harness)).todoList[0].logs.length, 2);
});

test('startup keeps a terminal sidecar when its recovery snapshot cannot be saved', async (t) => {
    const original = JSON.stringify({ todoList: [pendingTask({ status: 'running', progress: 10 })] });
    const completedAt = '2026-11-12T02:00:06.000Z';
    const runLog = serializeRunLogRecord(TASK_ID, 100, { level: 'success', message: 'finished', timestamp: completedAt }, {
        status: 'success', completedAt,
    });
    const { harness } = await startHarness(t, {
        seedFiles: {
            'appdata/visual-agent/tasks.json': original,
            [`appdata/visual-agent/${RUN_LOG_FILE_NAME}`]: runLog,
        },
        initialWriteFailure: (file) => (file.includes(`${path.sep}tasks.json`)
            ? Object.assign(new Error('ENOSPC: synthetic terminal recovery save'), { code: 'ENOSPC' }) : null),
    });

    const [task] = harness.getState().todoList;
    assert.equal(task.status, 'success');
    assert.equal(task.completedAt, completedAt);
    assert.equal(harness.getFiles()[tasksPath(harness)], original);
    assert.equal(harness.getFiles()[runLogPath(harness)], runLog);
});

test('a new task cannot clear an unpersisted terminal sidecar before flushing the previous task', async (t) => {
    const { ScriptedExecutor, instances } = createScriptedExecutor();
    const { harness, port, token } = await startHarness(t, { executor: ScriptedExecutor });
    harness.setReplies(['first veteran note', 'second veteran note']);
    const secondId = 'second-run-log-task';
    harness.setTasks([pendingTask(), pendingTask({ id: secondId, title: 'Second synthetic task' })]);

    await request(port, 'POST', `/api/execute/${TASK_ID}`, { token, body: {} });
    instances[0].emit('log', { level: 'info', phase: 'running', message: 'first task mid-run' });
    failTaskWrites(harness);
    instances[0].finish({ status: 'success' });
    await tick();
    await tick();
    const previousSidecar = harness.getFiles()[runLogPath(harness)];
    assert.ok(previousSidecar);

    const blocked = await request(port, 'POST', `/api/execute/${secondId}`, { token, body: {} });
    assert.equal(blocked.body.success, false);
    assert.equal(instances.length, 1, 'the second executor must not be constructed when the pre-flush fails');
    assert.equal(harness.getState().todoList.find((task) => task.id === secondId).status, 'pending');
    assert.equal(harness.getFiles()[runLogPath(harness)], previousSidecar);

    harness.failWrites(null);
    const started = await request(port, 'POST', `/api/execute/${secondId}`, { token, body: {} });
    assert.equal(started.body.success, true);
    assert.equal(readJson(harness.getFiles(), tasksPath(harness)).todoList.find((task) => task.id === TASK_ID).status, 'success');
    assert.equal(harness.getFiles()[runLogPath(harness)], undefined, 'the old terminal sidecar is cleared only after its snapshot is persisted');
    instances[1].emit('log', { level: 'info', phase: 'running', message: 'second task mid-run' });
    instances[1].finish({ status: 'success' });
    await tick();
    await tick();

    const diskTasks = readJson(harness.getFiles(), tasksPath(harness)).todoList;
    assert.deepEqual(diskTasks.map((task) => task.status), ['success', 'success']);
    assert.equal(harness.getFiles()[runLogPath(harness)], undefined);
});

test('startup recovers the interrupted run log, progress and phase', async (t) => {
    const runLog = [
        serializeRunLogRecord(TASK_ID, 20, null),
        serializeRunLogRecord(TASK_ID, 20, { level: 'info', message: 'check passed', timestamp: '2026-11-12T02:00:01.000Z' }),
        serializeRunLogRecord(TASK_ID, 40, null),
        serializeRunLogRecord(TASK_ID, 40, { level: 'info', message: 'installing', timestamp: '2026-11-12T02:00:02.000Z' }),
    ].join('');
    const { harness } = await startHarness(t, {
        seedFiles: {
            'appdata/visual-agent/tasks.json': JSON.stringify({
                todoList: [pendingTask({ status: 'running', progress: 10 })],
            }),
            [`appdata/visual-agent/${RUN_LOG_FILE_NAME}`]: runLog,
        },
    });

    const [task] = harness.getState().todoList;
    assert.equal(task.status, 'failed');
    assert.equal(task.progress, 40, 'progress should reflect the phase reached before the crash');
    assert.deepEqual(Array.from(task.logs.map((l) => l.message)), [
        'check passed', 'installing',
        'Task execution interrupted: the server stopped before it finished.',
    ]);
    assert.equal(task.logs.at(-1).level, 'error');
    assert.equal(harness.getFiles()[runLogPath(harness)], undefined, 'the run log is consumed once');
});

test('a run log left by a different task is ignored and cleared', async (t) => {
    const { harness } = await startHarness(t, {
        seedFiles: {
            'appdata/visual-agent/tasks.json': JSON.stringify({
                todoList: [pendingTask({ status: 'running', progress: 10, logs: [{ level: 'info', message: 'from disk' }] })],
            }),
            [`appdata/visual-agent/${RUN_LOG_FILE_NAME}`]: serializeRunLogRecord('stale-task', 80, { level: 'info', message: 'stale' }),
        },
    });

    const [task] = harness.getState().todoList;
    assert.equal(task.status, 'failed');
    assert.equal(task.progress, 10);
    assert.deepEqual(Array.from(task.logs.map((l) => l.message)), ['from disk', 'Task execution interrupted: the server stopped before it finished.']);
    assert.equal(harness.getFiles()[runLogPath(harness)], undefined);
});

test('a finished run persists full logs and removes the run log', async (t) => {
    const { ScriptedExecutor, instances } = createScriptedExecutor();
    const { harness, port, token } = await startHarness(t, { executor: ScriptedExecutor });
    harness.setReplies(['synthetic veteran note']);
    harness.setTasks([pendingTask()]);

    await request(port, 'POST', `/api/execute/${TASK_ID}`, { token, body: {} });
    const executor = instances[0];
    executor.emit('log', { level: 'info', phase: 'running', message: '... finished step' });
    assert.ok(harness.getFiles()[runLogPath(harness)], 'run log exists while the task is in flight');

    executor.finish({ status: 'success' });
    await tick();
    await tick();

    const files = harness.getFiles();
    const [task] = readJson(files, tasksPath(harness)).todoList;
    assert.equal(task.status, 'success');
    assert.equal(task.progress, 100);
    assert.deepEqual(task.logs.map((l) => l.message), [
        '... finished step',
        `Task '${task.title}' completed (status: success)`,
    ]);
    assert.equal(files[runLogPath(harness)], undefined, 'a completed run must not leave a stale run log');
    assert.equal(harness.getState().runningSOP, null);
});

test('a healthy task list is not rewritten on startup and no run log is created', async (t) => {
    const original = JSON.stringify({ todoList: [pendingTask({ status: 'success', progress: 100 })] });
    const { harness } = await startHarness(t, {
        seedFiles: { 'appdata/visual-agent/tasks.json': original },
    });

    assert.equal(harness.getFiles()[tasksPath(harness)], original);
    assert.equal(harness.getFiles()[runLogPath(harness)], undefined);
    assert.equal(harness.getState().todoList[0].status, 'success');
});

test('recovery is persisted so a second restart keeps the log', async (t) => {
    const runLog = [
        serializeRunLogRecord(TASK_ID, 40, null),
        serializeRunLogRecord(TASK_ID, 40, { level: 'info', message: 'installing', timestamp: '2026-11-12T02:00:02.000Z' }),
    ].join('');
    const { harness } = await startHarness(t, {
        seedFiles: {
            'appdata/visual-agent/tasks.json': JSON.stringify({ todoList: [pendingTask({ status: 'running', progress: 10 })] }),
            [`appdata/visual-agent/${RUN_LOG_FILE_NAME}`]: runLog,
        },
    });

    const persisted = harness.getFiles()[tasksPath(harness)];
    const onDisk = JSON.parse(persisted).todoList[0];
    assert.equal(onDisk.status, 'failed', 'the reconciled status must reach the disk');
    assert.equal(onDisk.progress, 40);
    assert.equal(onDisk.logs.length, 2, 'recovered logs plus the interruption entry must be persisted');

    // 第二次重啟：run log 已被消費，只能靠 tasks.json。
    const second = await startHarness(t, {
        seedFiles: { 'appdata/visual-agent/tasks.json': persisted },
    });
    const [task] = second.harness.getState().todoList;
    assert.equal(task.status, 'failed');
    assert.equal(task.progress, 40);
    assert.deepEqual(Array.from(task.logs.map((l) => l.message)), [
        'installing',
        'Task execution interrupted: the server stopped before it finished.',
    ], 'a second restart must not lose the recovered log or duplicate the interruption entry');
    assert.equal(second.harness.getFiles()[tasksPath(second.harness)], persisted, 'an already-reconciled file is left alone');
});