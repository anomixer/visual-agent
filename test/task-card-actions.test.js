'use strict';
// 任務卡片的執行 / 刪除鈕 — 擷取 public/app.js 的真實 renderTaskCard，以最小 fake DOM 執行。
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
    'getLocalePack', 'formatI18n', 't', 'escapeHtml', 'localizeStatus', 'getActionLabel', 'renderTaskCard',
].map(extractFunction).join('\n');

const BASE_TASK = {
    id: 'card-task', title: 'Synthetic task', category: 'Test', action: 'install',
    status: 'pending', progress: 0, createdAt: '2026-11-12T00:00:00.000Z',
};

function createContext(locale = 'zh-TW') {
    const executed = [];
    const deleted = [];
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        executeTask(id) { executed.push(id); },
        deleteTask(id) { deleted.push(id); },
        document: {
            createElement() {
                const listeners = new Map();
                const element = {
                    className: '',
                    dataset: {},
                    innerHTML: '',
                    addEventListener(type, handler) { listeners.set(type, handler); },
                    // 卡片只以 class 查詢自己剛產生的按鈕，因此直接比對 markup。
                    querySelector(selector) {
                        const cls = selector.replace('.', '');
                        if (!element.innerHTML.includes(`class="btn-task ${cls}"`)) return null;
                        return {
                            addEventListener(type, handler) { listeners.set(`${cls}:${type}`, handler); },
                        };
                    },
                    click() { listeners.get('click')?.({ stopPropagation() {} }); },
                    clickButton(cls) {
                        const handler = listeners.get(`${cls}:click`);
                        assert.ok(handler, `expected a ${cls} button listener`);
                        let propagated = true;
                        handler({ stopPropagation() { propagated = false; } });
                        return propagated;
                    },
                };
                return element;
            },
        },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    return { context, executed, deleted };
}

function renderCard(task, locale) {
    const { context, executed, deleted } = createContext(locale);
    return { card: context.renderTaskCard(task), executed, deleted };
}

test('a pending SOP task offers execute and delete', () => {
    const { card, executed, deleted } = renderCard({ ...BASE_TASK, skillId: 'synthetic_sop' });
    assert.equal(card.dataset.id, 'card-task');
    assert.ok(card.innerHTML.includes('class="btn-task run"'));
    assert.ok(card.innerHTML.includes('class="btn-task delete"'));
    assert.equal(card.clickButton('run'), false, 'the button must not also open the detail modal');
    assert.deepEqual(executed, ['card-task']);
    assert.equal(card.clickButton('delete'), false);
    assert.deepEqual(deleted, ['card-task']);
});

test('a pending dynamic command task without a SOP still offers execute', () => {
    const { card, executed } = renderCard({ ...BASE_TASK, skillId: null, dynamicCmd: 'Write-Output "probe"' });
    assert.ok(card.innerHTML.includes('class="btn-task run"'), 'imported dynamic commands must be runnable from the card');
    card.clickButton('run');
    assert.deepEqual(executed, ['card-task']);
});

test('a pending task with neither a SOP nor a command offers no execute button', () => {
    const { card } = renderCard({ ...BASE_TASK, skillId: null });
    assert.equal(card.innerHTML.includes('class="btn-task run"'), false);
    assert.ok(card.innerHTML.includes('class="btn-task delete"'));
});

test('a non-pending task offers no execute button', () => {
    for (const status of ['running', 'success', 'failed', 'skipped']) {
        const { card } = renderCard({ ...BASE_TASK, skillId: 'synthetic_sop', status });
        assert.equal(card.innerHTML.includes('class="btn-task run"'), false, `status ${status} must not be re-runnable`);
        assert.equal(card.innerHTML.includes('class="btn-task delete"'), status !== 'running');
    }
});

test('the card labels and status follow the active locale', () => {
    const zh = renderCard({ ...BASE_TASK, skillId: 'synthetic_sop', status: 'failed' }, 'zh-TW').card;
    const en = renderCard({ ...BASE_TASK, skillId: 'synthetic_sop', status: 'failed' }, 'en-US').card;
    assert.ok(zh.innerHTML.includes('失敗'));
    assert.ok(en.innerHTML.includes('Failed'));
    assert.ok(!en.innerHTML.includes('失敗'));
});