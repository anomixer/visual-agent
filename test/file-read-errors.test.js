'use strict';
// 讀檔失敗的回饋 — 擷取 public/app.js 的真實 importTasks / handleChalkImageUpload，以 fake FileReader 與 Image 執行。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractFunction(name) {
    const pattern = new RegExp(`^function ${name}\\([^)]*\\) \\{[^]*?^\\}\r?$`, 'gm');
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
    'getLocalePack', 'formatI18n', 't', 'importTasks', 'handleChalkImageUpload',
].map(extractFunction).join('\n');

const EXISTING_TASK = { id: 'existing-task', title: 'Existing', status: 'pending', progress: 0 };
const IMPORTED_TASK = { id: 'imported-task', title: 'Imported', status: 'success', progress: 100 };
const FILE = { name: 'tasks.json' };

function createContext({ locale = 'zh-TW', response } = {}) {
    const readers = [];
    const images = [];
    const calls = [];
    const logs = [];
    const rendered = [];
    const chalkCalls = [];

    class FakeFileReader {
        constructor() {
            this.onload = null;
            this.onerror = null;
            this.error = null;
            this.result = null;
            readers.push(this);
        }
        readAsText(file) { this.file = file; this.mode = 'text'; }
        readAsDataURL(file) { this.file = file; this.mode = 'dataurl'; }
        fail(message) { this.error = { message }; this.onerror(); }
        deliver(result) { this.result = result; this.onload({ target: this }); }
    }
    class FakeImage {
        constructor() { this.onload = null; this.onerror = null; this.src = ''; images.push(this); }
    }

    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        FileReader: FakeFileReader,
        Image: FakeImage,
        todoList: [EXISTING_TASK],
        chalkboardState: { tool: 'chalk', pendingImage: null, hoverPoint: null, cssWidth: 800, cssHeight: 600 },
        api: async (endpoint, options) => {
            calls.push({ endpoint, options });
            return response || { success: true, todoList: [IMPORTED_TASK] };
        },
        renderTodoList() { rendered.push(context.todoList.map((task) => task.id)); },
        addUILog(message, level) { logs.push({ message, level }); },
        cancelPendingChalkPreview() { chalkCalls.push('cancel'); },
        syncChalkboardUI() { chalkCalls.push('sync'); },
        updatePlacementGuide(point) { chalkCalls.push({ guide: point }); },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    return { context, readers, images, calls, logs, rendered, chalkCalls };
}

const uploadEvent = (file = FILE) => ({ target: { files: file ? [file] : [], value: 'C:\\fakepath\\tasks.json' } });
// vm context 內的物件與 host 物件原型不同，deepStrictEqual 會誤判；比對前先轉成純資料。
const plain = (value) => JSON.parse(JSON.stringify(value));

test('a failed import file read is reported instead of doing nothing', () => {
    const { context, readers, calls, logs, rendered } = createContext();

    context.importTasks(FILE);
    assert.equal(readers.length, 1);
    assert.equal(readers[0].mode, 'text');
    assert.equal(typeof readers[0].onerror, 'function', 'importTasks must wire FileReader.onerror');
    readers[0].fail('The requested file could not be read, typically due to permission problems');

    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].message, /讀取匯入檔失敗/);
    assert.match(logs[0].message, /permission problems/);
    assert.deepEqual(calls, [], 'a failed read must not post an import');
    assert.deepEqual(rendered, []);
    assert.deepEqual(context.todoList, [EXISTING_TASK]);
});

test('a read failure without an error message still reports', () => {
    const { context, readers, logs } = createContext();
    context.importTasks(FILE);
    readers[0].onerror();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].message, /Unknown error/);
});

test('the import success, refusal and malformed JSON paths are unchanged', async () => {
    const ok = createContext();
    ok.context.importTasks(FILE);
    ok.readers[0].deliver(JSON.stringify({ exportedAt: '2026-11-12', tasks: [IMPORTED_TASK] }));
    await new Promise(setImmediate);
    assert.equal(ok.calls[0].endpoint, '/api/todo/import');
    assert.deepEqual(plain(ok.calls[0].options.body.tasks), [IMPORTED_TASK]);
    assert.deepEqual(ok.context.todoList, [IMPORTED_TASK]);
    assert.deepEqual(ok.rendered, [['imported-task']]);
    assert.equal(ok.logs.at(-1).level, 'success');

    const refused = createContext({ response: { success: false, error: 'A task is running' } });
    refused.context.importTasks(FILE);
    refused.readers[0].deliver(JSON.stringify([IMPORTED_TASK]));
    await new Promise(setImmediate);
    assert.equal(refused.logs.at(-1).level, 'error');
    assert.match(refused.logs.at(-1).message, /匯入失敗: A task is running/);
    assert.deepEqual(refused.context.todoList, [EXISTING_TASK]);

    const malformed = createContext();
    malformed.context.importTasks(FILE);
    malformed.readers[0].deliver('{ not json');
    await new Promise(setImmediate);
    assert.deepEqual(malformed.calls, []);
    assert.equal(malformed.logs.at(-1).level, 'error');
    assert.match(malformed.logs.at(-1).message, /匯入失敗/);
});

test('a failed chalkboard image read leaves the board untouched', () => {
    const { context, readers, images, logs, chalkCalls } = createContext();
    const event = uploadEvent({ name: 'photo.png' });

    context.handleChalkImageUpload(event);
    assert.equal(readers[0].mode, 'dataurl');
    assert.equal(typeof readers[0].onerror, 'function', 'handleChalkImageUpload must wire FileReader.onerror');
    readers[0].fail('NotReadableError');

    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].message, /讀取圖片檔失敗：NotReadableError/);
    assert.deepEqual(images, []);
    assert.deepEqual(chalkCalls, []);
    assert.equal(context.chalkboardState.pendingImage, null);
    assert.equal(context.chalkboardState.tool, 'chalk');
    assert.equal(event.target.value, '', 'the file input must still be reset');
});

test('an undecodable chalkboard image is reported instead of silently stalling', () => {
    const { context, readers, images, logs, chalkCalls } = createContext();

    context.handleChalkImageUpload(uploadEvent({ name: 'broken.png' }));
    readers[0].deliver('data:image/png;base64,AAAA');
    assert.equal(images.length, 1);
    assert.equal(typeof images[0].onerror, 'function', 'the placed image must wire onerror');
    images[0].onerror();

    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].message, /圖片無法載入/);
    assert.deepEqual(chalkCalls, []);
    assert.equal(context.chalkboardState.pendingImage, null);
    assert.equal(context.chalkboardState.tool, 'chalk');
});

test('a successful chalkboard upload still enters image placement mode', () => {
    const { context, readers, images, logs, chalkCalls } = createContext();

    context.handleChalkImageUpload(uploadEvent({ name: 'photo.png' }));
    readers[0].deliver('data:image/png;base64,AAAA');
    images[0].onload();

    assert.deepEqual(logs, []);
    assert.equal(context.chalkboardState.pendingImage, images[0]);
    assert.equal(context.chalkboardState.tool, 'image');
    assert.equal(chalkCalls[0], 'cancel');
    assert.equal(chalkCalls[1], 'sync');
    assert.deepEqual(plain(chalkCalls[2]), { guide: { x: 400, y: 300 } });
});

test('no file selected creates no reader', () => {
    const { context, readers, logs } = createContext();
    context.handleChalkImageUpload(uploadEvent(null));
    assert.deepEqual(readers, []);
    assert.deepEqual(logs, []);
});

test('the read failure labels follow the active locale', () => {
    const importFailure = createContext({ locale: 'en-US' });
    importFailure.context.importTasks(FILE);
    importFailure.readers[0].fail('NotReadableError');
    assert.match(importFailure.logs[0].message, /Failed to read the import file: NotReadableError/);

    const chalkFailure = createContext({ locale: 'en-US' });
    chalkFailure.context.handleChalkImageUpload(uploadEvent({ name: 'photo.png' }));
    chalkFailure.readers[0].fail('NotReadableError');
    assert.match(chalkFailure.logs[0].message, /Failed to read the image file: NotReadableError/);
    chalkFailure.readers[0].deliver('data:image/png;base64,AAAA');
    chalkFailure.images[0].onerror();
    assert.match(chalkFailure.logs[1].message, /could not be loaded/);

    for (const entry of [...importFailure.logs, ...chalkFailure.logs]) {
        assert.ok(!/[\u4e00-\u9fff]/.test(entry.message), `en-US log leaked Chinese: ${entry.message}`);
    }
});