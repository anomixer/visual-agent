'use strict';
// 分類本地化 — 擷取 public/app.js 的真實渲染函式與真實 I18N，並唯讀比對 repo 內建 SOP 的分類。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractFunction(name) {
    const pattern = new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[^]*?^\\}\r?$`, 'gm');
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
    'getLocalePack', 'formatI18n', 't', 'escapeHtml',
    'localizeCategory', 'localizeRiskLevel', 'localizeStatus', 'getLocalizedItem',
    'getDisplayAction', 'getActionLabel', 'getActionTitle', 'renderTaskCard', 'renderTaskModalBody', 'queueSopTaskById',
].map(extractFunction).join('\n');

function createElement() {
    const element = {
        className: '', textContent: '', style: {}, dataset: {}, children: [], listeners: [],
        appendChild(child) { element.children.push(child); return child; },
        addEventListener(type, handler) { element.listeners.push({ type, handler }); },
        querySelector() { return null; },
    };
    let html = '';
    Object.defineProperty(element, 'innerHTML', {
        get: () => html,
        set(value) { html = value; if (value === '') element.children.length = 0; },
    });
    return element;
}

function bundledSops() {
    const root = path.join(__dirname, '..', 'sops');
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const text = fs.readFileSync(path.join(root, entry.name, 'SOP.md'), 'utf8');
            const field = (key) => (text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [, ''])[1].trim();
            return { id: field('ID'), name: field('Name'), category: field('Category'), description: '' };
        })
        .filter((sop) => sop.id);
}

const SOP_ITEMS = bundledSops();
const CREATED_TASK = { id: 'created-task', title: 'Created', status: 'pending', progress: 0 };

function createContext({ locale = 'zh-TW', sops = SOP_ITEMS, tasks = [], response } = {}) {
    const calls = [];
    const executed = [];
    const rendered = [];
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        sopsList: sops,
        todoList: tasks,
        document: { createElement },
        modalTitle: createElement(),
        modalBody: createElement(),
        api: async (endpoint, options) => {
            calls.push({ endpoint, options });
            return response || { success: true, task: CREATED_TASK, todoList: [CREATED_TASK] };
        },
        renderTodoList() { rendered.push(context.todoList.map((task) => task.id)); },
        async executeTask(id) { executed.push(id); },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    return { context, calls, executed, rendered };
}

const categoryOf = (card) => {
    const match = card.innerHTML.match(/<span class="task-category">([^<]*)<\/span>/);
    return match ? match[1] : null;
};
const detailCategoryOf = (body) => {
    const match = body.innerHTML.match(/<span class="task-detail-value">([^<]*)<\/span>/);
    return match ? match[1] : null;
};

test('every bundled SOP category resolves to a Traditional Chinese label', () => {
    assert.ok(SOP_ITEMS.length >= 16, `Expected the bundled SOP library, got ${SOP_ITEMS.length}`);
    const { context } = createContext();
    for (const sop of SOP_ITEMS) {
        const label = context.localizeCategory(sop.category);
        assert.notEqual(label, sop.category, `${sop.id} category "${sop.category}" is still untranslated`);
        assert.match(label, /[\u4e00-\u9fff]/, `${sop.id} category label should be Chinese, got "${label}"`);
    }
});

test('every bundled SOP has a card preset in both locales', () => {
    const packs = { 'zh-TW': loadLocalePacks('zh-TW')['zh-TW'], 'en-US': loadLocalePacks('en-US')['en-US'] };
    for (const [locale, pack] of Object.entries(packs)) {
        for (const sop of SOP_ITEMS) {
            const preset = pack.sopUi[sop.id];
            assert.ok(preset, `${locale} is missing a sopUi preset for ${sop.id}`);
            assert.ok(preset.title, `${locale} preset for ${sop.id} has no title`);
            assert.ok(preset.category, `${locale} preset for ${sop.id} has no category`);
        }
    }

    const zh = createContext();
    const en = createContext({ locale: 'en-US' });
    for (const sop of SOP_ITEMS) {
        const localizedZh = zh.context.getLocalizedItem(sop);
        const localizedEn = en.context.getLocalizedItem(sop);
        assert.notEqual(localizedZh.name, sop.name, `${sop.id} still shows the stored English name in zh-TW`);
        assert.match(localizedZh.category, /[\u4e00-\u9fff]/);
        assert.ok(!/[\u4e00-\u9fff]/.test(localizedEn.category), `${sop.id} en-US category leaked Chinese`);
        assert.equal(localizedZh.id, sop.id);
    }
});

test('action titles stay readable for every bundled SOP', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext({ locale });
        for (const action of ['install', 'uninstall']) {
            for (const sop of SOP_ITEMS) {
                const name = context.getLocalizedItem(sop).name;
                const display = context.getDisplayAction(name, action);
                const title = context.getActionTitle(name, action);
                if (display === 'run') {
                    assert.equal(title, name, `${locale} ${sop.id} ${action}: a non-install SOP must keep its own verb, got "${title}"`);
                    continue;
                }
                const label = context.getActionLabel(display);
                assert.ok(title.startsWith(label), `${locale} ${sop.id} ${action}: "${title}" should start with "${label}"`);
                assert.ok(title.length > label.length, `${locale} ${sop.id} ${action} lost its subject: "${title}"`);
                assert.ok(!/^(Install|安裝)\s+(Install|安裝)/.test(title), `${locale} ${sop.id} duplicates the verb: "${title}"`);
                assert.ok(!/^(Uninstall|解除安裝)\s+(Uninstall|解除安裝)/.test(title), `${locale} ${sop.id} duplicates the verb: "${title}"`);
            }
        }
    }
});

test('recommendation and task fallback categories are covered', () => {
    const zh = createContext().context;
    const en = createContext({ locale: 'en-US' }).context;
    const recommendCategories = ['AI Engine', 'System', 'Cleanup', 'Browser', 'Backup', 'Productivity', 'Entertainment'];
    for (const category of recommendCategories) {
        assert.match(zh.localizeCategory(category), /[\u4e00-\u9fff]/, `zh-TW lacks "${category}"`);
        assert.equal(en.localizeCategory(category), category);
    }
    assert.equal(zh.localizeCategory('Maintenance'), '維護');
    assert.equal(en.localizeCategory('Maintenance'), 'Maintenance');
    assert.equal(zh.localizeCategory('一般'), '一般');
    assert.equal(en.localizeCategory('一般'), 'General');
    assert.equal(zh.localizeCategory('General'), '一般');
    assert.equal(zh.localizeCategory('SOP'), 'SOP');
    assert.equal(en.localizeCategory('SOP'), 'SOP');
});

test('a stored category follows the active locale in both card and detail', () => {
    const stored = { id: 'task-1', title: 'Back Up the Documents Folder', category: 'Maintenance', status: 'pending', progress: 0 };
    const zh = createContext();
    const en = createContext({ locale: 'en-US' });

    assert.equal(categoryOf(zh.context.renderTaskCard(stored)), '維護');
    assert.equal(categoryOf(en.context.renderTaskCard(stored)), 'Maintenance');
    zh.context.renderTaskModalBody(stored);
    en.context.renderTaskModalBody(stored);
    assert.equal(detailCategoryOf(zh.context.modalBody), '維護');
    assert.equal(detailCategoryOf(en.context.modalBody), 'Maintenance');
    assert.equal(stored.category, 'Maintenance', 'rendering must not rewrite the stored category');

    const chinese = { ...stored, category: '備份與還原' };
    assert.equal(categoryOf(en.context.renderTaskCard(chinese)), 'Backup and Restore');
    assert.equal(categoryOf(zh.context.renderTaskCard(chinese)), '備份與還原');
    assert.equal(chinese.category, '備份與還原');
});

test('an empty category keeps the existing card and detail fallbacks', () => {
    const zh = createContext();
    const task = { id: 'task-2', title: 'Manual', status: 'pending', progress: 0 };
    assert.equal(categoryOf(zh.context.renderTaskCard(task)), '一般');
    zh.context.renderTaskModalBody(task);
    assert.equal(detailCategoryOf(zh.context.modalBody), '—');

    const en = createContext({ locale: 'en-US' });
    assert.equal(categoryOf(en.context.renderTaskCard(task)), 'General');
});

test('an unknown category is shown as stored instead of becoming Other', () => {
    const { context } = createContext();
    assert.equal(context.localizeCategory('Quantum Tuning'), 'Quantum Tuning');
    assert.equal(categoryOf(context.renderTaskCard({ id: 't', title: 'T', category: 'Quantum Tuning', status: 'pending' })), 'Quantum Tuning');
    assert.equal(context.localizeCategory(''), context.t('sidebar.otherCategory'));
});

test('category text is escaped in the card and the detail window', () => {
    const { context } = createContext();
    const hostile = { id: 't', title: 'T', category: '<img src=x onerror=alert(1)>', status: 'pending', progress: 0 };
    const card = context.renderTaskCard(hostile);
    assert.ok(!card.innerHTML.includes('<img src=x'));
    assert.match(card.innerHTML, /&lt;img src=x/);
    context.renderTaskModalBody(hostile);
    assert.ok(!context.modalBody.innerHTML.includes('<img src=x'));
});

test('queueSopTaskById posts the localized title and category', async () => {
    const sop = SOP_ITEMS.find((item) => item.id === 'sys_backup_user_files');
    assert.ok(sop, 'Expected the backup SOP in the bundled library');

    const zh = createContext({ sops: [sop] });
    await zh.context.queueSopTaskById(sop.id);
    assert.equal(zh.calls.length, 1);
    assert.equal(zh.calls[0].endpoint, '/api/todo');
    assert.equal(zh.calls[0].options.body.skillId, sop.id);
    assert.equal(zh.calls[0].options.body.title, '備份文件資料夾');
    assert.equal(zh.calls[0].options.body.category, '備份與還原');
    assert.equal(zh.calls[0].options.body.action, 'install');

    const en = createContext({ locale: 'en-US', sops: [sop] });
    await en.context.queueSopTaskById(sop.id);
    assert.equal(en.calls[0].options.body.title, 'Documents Folder Backup');
    assert.equal(en.calls[0].options.body.category, 'Backup and Restore');
});

test('queueSopTaskById still reuses a pending task and only executes on request', async () => {
    const sop = SOP_ITEMS.find((item) => item.id === 'install_winhance');
    const existing = { id: 'pending-task', skillId: sop.id, action: 'install', status: 'pending' };

    const reused = createContext({ sops: [sop], tasks: [existing] });
    const result = await reused.context.queueSopTaskById(sop.id);
    assert.deepEqual(reused.calls, []);
    assert.deepEqual(reused.executed, []);
    assert.equal(result.reused, true);
    assert.equal(result.task.id, 'pending-task');

    const executed = createContext({ sops: [sop], tasks: [existing] });
    await executed.context.queueSopTaskById(sop.id, true);
    assert.deepEqual(executed.calls, []);
    assert.deepEqual(executed.executed, ['pending-task']);

    const missing = createContext({ sops: [] });
    await assert.rejects(() => missing.context.queueSopTaskById(sop.id), /SOP not found/);
    assert.deepEqual(missing.calls, []);
});