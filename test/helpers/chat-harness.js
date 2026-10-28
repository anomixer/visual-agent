'use strict';

// Trusted-source harness: allowlisted imports and in-memory APPDATA prevent real system changes.
const assert = require('node:assert/strict');
const hostFs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const express = require('express');

const ROOT = path.resolve(__dirname, '../..');
const SERVER = path.join(ROOT, 'src/server.js');
const FIXTURE_SOP_ID = 'consent_fixture_6d1972a9_primary';
const OTHER_SOP_ID = 'consent_fixture_6d1972a9_other';
const SOURCE_URL = 'https://example.com/consent-fixture/source';
const SOURCE_TEXT = 'Synthetic source fact: the consent fixture contains exactly 17 samples.';
const clone = (value) => JSON.parse(JSON.stringify(value));

function createMemoryFs(root, deny) {
    const files = new Map();
    const dirs = new Set([root]);
    const key = (file) => path.resolve(String(file));
    const checkWrite = (file) => {
        const resolved = key(file);
        const relative = path.relative(root, resolved);
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            deny(`fs write outside sandbox: ${resolved}`);
        }
        return resolved;
    };
    const missing = (file) => Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
    const api = {
        existsSync: (file) => files.has(key(file)) || dirs.has(key(file)),
        mkdirSync(file) { dirs.add(checkWrite(file)); },
        readFileSync(file, options) {
            const data = files.get(key(file));
            if (!data) throw missing(file);
            const encoding = typeof options === 'string' ? options : options?.encoding;
            return encoding ? data.toString(encoding) : Buffer.from(data);
        },
        writeFileSync(file, data, options) {
            const encoding = typeof options === 'string' ? options : options?.encoding;
            files.set(checkWrite(file), Buffer.from(data, encoding || 'utf8'));
        },
        appendFileSync(file, data, options) {
            const resolved = checkWrite(file);
            const previous = files.get(resolved) || Buffer.alloc(0);
            const encoding = typeof options === 'string' ? options : options?.encoding;
            files.set(resolved, Buffer.concat([previous, Buffer.from(data, encoding || 'utf8')]));
        },
        renameSync(from, to) {
            const source = checkWrite(from);
            const destination = checkWrite(to);
            if (!files.has(source)) throw missing(from);
            files.set(destination, files.get(source));
            files.delete(source);
        },
        readdirSync(dir, options) {
            const resolved = key(dir);
            if (!dirs.has(resolved)) throw missing(dir);
            const children = [...new Set([...dirs, ...files.keys()])]
                .filter((entry) => entry !== resolved && path.dirname(entry) === resolved);
            return children.map((entry) => options?.withFileTypes ? {
                name: path.basename(entry),
                isDirectory: () => dirs.has(entry),
                isFile: () => files.has(entry),
            } : path.basename(entry));
        },
    };
    return {
        api: new Proxy(api, {
            get(target, name) {
                if (Object.hasOwn(target, name)) return target[name];
                return deny(`unimplemented fs.${String(name)}`);
            },
        }),
        snapshot: () => Object.fromEntries([...files].map(([file, data]) => [file, data.toString('utf8')])),
    };
}

function createChatHarness() {
    const sandboxRoot = path.join(ROOT, 'test', `.chat-harness-${crypto.randomUUID()}`);
    const violations = [];
    const consoleEntries = [];
    const llmCalls = [];
    const browserCalls = [];
    const executorCalls = [];
    const timers = new Set();
    let replies = [];
    let now = Date.parse('2026-10-28T12:00:00Z');
    const deny = (operation) => {
        violations.push(operation);
        throw new Error(`Chat harness blocked: ${operation}`);
    };
    const blocked = (label) => new Proxy(Object.create(null), {
        get: (_target, property) => deny(`${label}.${String(property)}`),
    });
    const memory = createMemoryFs(sandboxRoot, deny);
    const fixtures = [FIXTURE_SOP_ID, OTHER_SOP_ID].map((id, index) => ({
        id,
        name: `Consent fixture ${index + 1}`,
        description: 'Synthetic consent test only; no executable commands.',
        category: 'Test',
        steps: { check: { commands: [] }, install: { commands: [] } },
    }));
    const fakeProcess = {
        env: {
            APPDATA: path.join(sandboxRoot, 'appdata'),
            LOCALAPPDATA: path.join(sandboxRoot, 'localappdata'),
            COMPUTERNAME: 'CONSENT-FIXTURE-PC', USERNAME: 'consent-fixture-user',
        },
        pid: 424242, platform: 'win32', version: 'v20.0.0-test',
        execPath: path.join(sandboxRoot, 'node.exe'),
        cwd: () => sandboxRoot,
        on: () => fakeProcess,
        exit: () => deny('process.exit'),
    };
    const fakeOs = {
        homedir: () => path.join(sandboxRoot, 'home'),
        tmpdir: () => path.join(sandboxRoot, 'tmp'),
        hostname: () => 'CONSENT-FIXTURE-PC',
        userInfo: () => ({ username: 'consent-fixture-user' }),
        totalmem: () => 16 * 1024 ** 3, freemem: () => 8 * 1024 ** 3,
        release: () => 'fixture',
    };
    class ClockDate extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    class InertExecutor extends EventEmitter {
        async runPhaseCommands(_commands, phase) {
            executorCalls.push({ method: 'runPhaseCommands', phase });
            if (phase !== 'check') deny(`SOPExecutor phase ${phase}`);
            return { success: true, outputs: [{ stdout: 'False' }] };
        }
        isCheckSatisfied() { return false; }
        async execute() { return deny('SOPExecutor.execute'); }
    }
    class InertRemoteService {
        getState() { return { sessions: [], localIps: ['127.0.0.1'], started: false }; }
        getSession() { return null; }
        start() { return deny('RemoteAgentService.start'); }
    }
    const fakeLlm = {
        getCurrentProvider: () => 'Fixture',
        getCurrentModel: () => 'consent-fixture-text',
        getCurrentVisionModel: () => '',
        getCurrentBaseUrl: () => 'https://example.com/fixture-llm',
        getCurrentApiKey: () => '',
        getCurrentAuthType: () => 'api-key',
        getCurrentAuthConfig: () => ({}),
        modelSupportsVision: () => false,
        getVisionCapableModel: async () => '',
        listModels: async () => ['consent-fixture-text'],
        checkOllamaStatus: async () => ({ available: true, modelReady: true, modelName: 'consent-fixture-text' }),
        async chatWithLLM(message, history, options, locale) {
            llmCalls.push({ message, history: clone(history), locale, aborted: !!options?.signal?.aborted });
            if (!replies.length) return deny('unscripted llm.chatWithLLM');
            const reply = replies.shift();
            options?.onDelta?.(reply);
            return reply;
        },
    };
    const browserSpy = async (params) => {
        browserCalls.push(clone(params));
        const mode = String(params.mode || '').toLowerCase();
        const url = params.url || SOURCE_URL;
        const parsed = new URL(url);
        if (parsed.origin !== 'https://example.com' || parsed.username || parsed.password) {
            return deny(`browser URL outside example.com: ${url}`);
        }
        if (!['search', 'extract_text', 'fetch_title', 'snapshot', 'open', 'navigate'].includes(mode)) {
            return deny(`browser mode ${mode}`);
        }
        return {
            success: true, mode, url, title: 'Consent fixture source', text: SOURCE_TEXT,
            source: 'fixture',
            results: [{ title: 'Consent fixture source', url: SOURCE_URL }],
        };
    };

    const context = vm.createContext({
        Buffer, URL, URLSearchParams, AbortController, AbortSignal,
        Date: ClockDate, process: fakeProcess,
        console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map((level) => [
            level, (...args) => consoleEntries.push({ level, message: args.map(String).join(' ') }),
        ])),
        fetch: () => deny('global fetch'),
        setTimeout(callback, delay, ...args) {
            const timer = setTimeout(() => { timers.delete(timer); callback(...args); }, delay);
            timers.add(timer);
            return timer;
        },
        clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
        setInterval: () => deny('setInterval'),
    });
    const realFiles = new Set([
        SERVER,
        ...['pure.js', 'local-api-security.js', 'agent/actions.js', 'agent/consent.js',
            'agent/loop-budget.js', 'agent/prompts.js'].map((file) => path.join(ROOT, 'src', file)),
    ]);
    const injected = new Map([
        ['express', express], ['path', path], ['fs', memory.api], ['crypto', crypto],
        ['os', fakeOs],
        ['child_process', { execSync: () => deny('child_process.execSync'),
            spawnSync: () => deny('child_process.spawnSync'), spawn: () => deny('child_process.spawn') }],
        ['net', blocked('net')],
        ['playwright', { chromium: { launch: () => deny('playwright.chromium.launch') } }],
        [path.join(ROOT, 'src/sop-parser.js'), { loadAllSOPs: () => clone(fixtures) }],
        [path.join(ROOT, 'src/sop-executor.js'), { SOPExecutor: InertExecutor }],
        [path.join(ROOT, 'src/llm.js'), fakeLlm],
        [path.join(ROOT, 'src/system.js'), { getSystemHealth: async () => ({
            cpu: { model: 'Fixture CPU', load: 0 }, gpu: { name: 'Fixture GPU', load: 0 },
            ram: { total: 16 * 1024 ** 3, usage: 50 }, disk: { drives: [], volumes: [] },
        }) }],
        [path.join(ROOT, 'src/remote-agent.js'), {
            DEFAULT_REMOTE_PORT: 19168, RemoteAgentService: InertRemoteService,
            getLocalIPv4List: () => ['127.0.0.1'],
        }],
        [path.join(ROOT, 'src/safe-fetch.js'), { safeFetchText: () => deny('safeFetchText') }],
        [path.join(ROOT, 'package.json'), JSON.parse(hostFs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))],
    ]);
    const cache = new Map();
    const sourceHashes = {};
    function load(file) {
        if (cache.has(file)) return cache.get(file).exports;
        if (!realFiles.has(file)) return deny(`module ${file}`);
        let source = hostFs.readFileSync(file, 'utf8');
        sourceHashes[path.relative(ROOT, file)] = crypto.createHash('sha256').update(source).digest('hex');
        if (file === SERVER) {
            // Fail rather than accidentally remove a route or run a changed startup.
            const startup = source.match(/\r?\nstartVisualAgentServer\(\)\.catch\(\(error\) => \{\r?\n(?:[ \t]+[^\r\n]*\r?\n)*\}\);\s*$/);
            assert.ok(startup, 'Expected ONLY the final startVisualAgentServer().catch invocation');
            source = source.slice(0, startup.index) + `
module.exports = {
    app,
    setBrowserOperation(operation) { runBrowserUseOperation = operation; },
    setSopAction(id, action) {
        sopStateCache.set(id, { state: { installed: action === 'uninstall', supportsUninstall: true, recommendedAction: action } });
    },
    setTasks(tasks, runningId) {
        todoList = JSON.parse(JSON.stringify(tasks));
        runningSOP = runningId;
        saveTasks();
    },
    getState() {
        return JSON.parse(JSON.stringify({
            todoList, runningSOP, logs,
            histories: Object.fromEntries(localChatHistoryBySession),
        }));
    },
};
`;
        }
        const module = { exports: {} };
        cache.set(file, module);
        const injectedRequire = (specifier) => {
            let resolved = specifier.replace(/^node:/, '');
            if (specifier.startsWith('.')) {
                resolved = path.resolve(path.dirname(file), specifier);
                if (!path.extname(resolved)) resolved += '.js';
            }
            if (injected.has(resolved)) return injected.get(resolved);
            if (realFiles.has(resolved)) return load(resolved);
            return deny(`require(${specifier}) from ${file}`);
        };
        const wrapper = new vm.Script(`(function(exports, require, module, __filename, __dirname) {\n${source}\n})`, { filename: file });
        wrapper.runInContext(context)(module.exports, injectedRequire, module, file, path.dirname(file));
        return module.exports;
    }
    const captured = load(SERVER);
    captured.setBrowserOperation(browserSpy);
    const listen = captured.app.listen.bind(captured.app);
    captured.app.listen = (port, host, ...args) => {
        if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 0 || port > 65535) {
            return deny('app.listen must use a numeric port and 127.0.0.1');
        }
        return listen(port, host, ...args);
    };
    return {
        app: captured.app, sandboxRoot, sourceHashes,
        fixtures: clone(fixtures), llmCalls, browserCalls, executorCalls, consoleEntries,
        setReplies(next) {
            assert.ok(Array.isArray(next) && next.every((reply) => typeof reply === 'string'));
            replies = next.slice();
        },
        setTasks(tasks, runningId = tasks.find((task) => task.status === 'running')?.id || null) {
            captured.setTasks(tasks, runningId);
        },
        getState: captured.getState,
        setSopAction: captured.setSopAction,
        getFiles: memory.snapshot,
        advanceTime(milliseconds) {
            assert.ok(Number.isFinite(milliseconds) && milliseconds >= 0);
            now += milliseconds;
        },
        assertSafe() { assert.deepEqual(violations, [], 'Blocked operations (even if production caught the error)'); },
        dispose() { for (const timer of timers) clearTimeout(timer); timers.clear(); },
    };
}

module.exports = { createChatHarness, FIXTURE_SOP_ID, OTHER_SOP_ID, SOURCE_URL, SOURCE_TEXT };
