'use strict';
// SOP 動詞文案 — 備份 / 還原 / 停用型 SOP 的 Install 階段不是安裝，顯示上不得冠上「安裝」。
// 擷取 public/app.js 的真實 getDisplayAction / getActionTitle / createSopCard / createRecommendCard 執行。
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
    'getLocalePack', 'formatI18n', 't', 'escapeHtml', 'localizeCategory', 'localizeRiskLevel', 'localizeStatus',
    'getLocalizedItem', 'getDisplayAction', 'getActionLabel', 'getActionTitle',
    'createSopCard', 'createRecommendCard', 'renderTaskCard', 'renderTaskModalBody',
    'logTaskFailure', 'addRecommendToTodo', 'addAndExecuteRecommend',
].map(extractFunction).join('\n');

// 這些 SOP 的 Install 階段執行的是停用 / 備份 / 還原 / 掃描，不是安裝任何軟體。
const NON_INSTALL_IDS = [
    'rec_remove_copilot', 'rec_backup', 'sys_backup_user_files', 'sys_restore_user_files', 'rec_driver_check',
];

function bundledSops() {
    const sopsDir = path.join(__dirname, '..', 'sops');
    return fs.readdirSync(sopsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const file = path.join(sopsDir, entry.name, 'SOP.md');
            const text = fs.readFileSync(file, 'utf8');
            const field = (key) => (text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm')) || [, ''])[1].trim();
            return {
                id: field('ID'), name: field('Name'), category: field('Category'),
                riskLevel: field('Risk Level'),
                hasUninstall: /^## Uninstall\s*$/m.test(text),
                installed: false, supportsUninstall: /^## Uninstall\s*$/m.test(text),
            };
        })
        .filter((sop) => sop.id)
        .sort((a, b) => a.id.localeCompare(b.id));
}

const SOP_ITEMS = bundledSops();
const COPILOT = SOP_ITEMS.find((sop) => sop.id === 'rec_remove_copilot');

function createElement() {
    const listeners = new Map();
    const element = {
        className: '', innerHTML: '', style: {}, dataset: {}, disabled: false,
        addEventListener(type, handler) { listeners.set(type, handler); },
        querySelector(selector) {
            const cls = selector.replace('.', '');
            if (!element.innerHTML.includes(`class="${cls}"`)) return null;
            return {
                disabled: false,
                addEventListener(type, handler) { listeners.set(`${cls}:${type}`, handler); },
            };
        },
        async clickButton(cls) {
            const handler = listeners.get(`${cls}:click`);
            assert.ok(handler, `expected a ${cls} button listener`);
            await handler({ stopPropagation() {}, currentTarget: { disabled: false } });
        },
    };
    return element;
}

function createContext(locale = 'zh-TW', response = { success: true, task: { id: 'new-task' }, todoList: [] }) {
    const calls = [];
    const logs = [];
    const executed = [];
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        todoList: [],
        document: { createElement },
        modalTitle: { textContent: '' },
        modalBody: { innerHTML: '' },
        api: async (endpoint, options) => { calls.push({ endpoint, options }); return response; },
        renderTodoList() {},
        openTab() {},
        expandLog() {},
        addUILog(message, level) { logs.push({ message, level }); },
        appendChatBubble() {},
        async executeTask(id) { executed.push(id); },
        async refreshBrowserRuntimeAvailability() {},
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    return { context, calls, logs, executed };
}

const INSTALL_VERBS = /安裝|Install/i;
// 驅動檢查的名稱是「檢查並安裝驅動程式」，句中的安裝是它真正要做的事，只有開頭的動詞才算誤導。
const LEADING_INSTALL = /^(?:安裝|Install\b)/i;
const titleOf = (markup) => (markup.match(/<div class="recommend-title">([^]*?)<\/div>/) || [, ''])[1];
const buttonTitle = (markup, cls) => (markup.match(new RegExp(`class="${cls}" title="([^"]*)"`)) || [, ''])[1];
const badges = (markup) => [...markup.matchAll(/<span class="recommend-skill-badge">([^<]*)<\/span>/g)].map((m) => m[1]);
const plain = (value) => JSON.parse(JSON.stringify(value));

test('the bundled SOPs still match the premise: non-install SOPs have no Uninstall phase', () => {
    assert.equal(SOP_ITEMS.length, 16);
    for (const id of NON_INSTALL_IDS) {
        const sop = SOP_ITEMS.find((entry) => entry.id === id);
        assert.ok(sop, `missing bundled SOP ${id}`);
        assert.equal(sop.hasUninstall, false, `${id} gained an Uninstall phase; revisit its display verb`);
    }
    assert.ok(COPILOT, 'remove-copilot must still be bundled');
});

test('a removal SOP is never labelled as an install in either locale', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        const localized = context.getLocalizedItem(COPILOT);
        assert.equal(context.getDisplayAction(localized.name, 'install'), 'run');
        const title = context.getActionTitle(localized.name, 'install');
        assert.equal(title, localized.name);
        assert.ok(!INSTALL_VERBS.test(title), `${locale}: "${title}" still promises an installation`);
        assert.match(title, locale === 'zh-TW' ? /移除/ : /Remove/i);
        assert.equal(context.getActionLabel('run'), locale === 'zh-TW' ? '執行' : 'Run');
    }
});

test('the Copilot SOP card carries no install wording in its title, buttons or badge', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        const markup = context.createSopCard(context.getLocalizedItem(COPILOT)).innerHTML;
        const runLabel = locale === 'zh-TW' ? '執行' : 'Run';
        assert.ok(!INSTALL_VERBS.test(titleOf(markup)), `${locale} title: ${titleOf(markup)}`);
        assert.ok(!INSTALL_VERBS.test(buttonTitle(markup, 'btn-add-todo')), `${locale} add button: ${buttonTitle(markup, 'btn-add-todo')}`);
        assert.ok(!INSTALL_VERBS.test(buttonTitle(markup, 'btn-run-now')), `${locale} run button: ${buttonTitle(markup, 'btn-run-now')}`);
        assert.ok(badges(markup).every((badge) => !INSTALL_VERBS.test(badge)), `${locale} badges: ${badges(markup).join(' / ')}`);
        assert.equal(buttonTitle(markup, 'btn-run-now'), locale === 'zh-TW' ? `立即${runLabel}` : `${runLabel} now`);
        assert.equal(buttonTitle(markup, 'btn-add-todo'), locale === 'zh-TW' ? '加入工作清單' : 'Add to work list');
    }
});

test('every non-install SOP keeps its own verb on the card and in the recommend list', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        for (const id of NON_INSTALL_IDS) {
            const sop = SOP_ITEMS.find((entry) => entry.id === id);
            const localized = context.getLocalizedItem(sop);
            assert.equal(context.getDisplayAction(localized.name, 'install'), 'run', `${locale} ${id}`);
            assert.equal(context.getActionTitle(localized.name, 'install'), localized.name, `${locale} ${id}`);
            const sopMarkup = context.createSopCard(localized).innerHTML;
            assert.ok(!LEADING_INSTALL.test(titleOf(sopMarkup)), `${locale} ${id} SOP card: ${titleOf(sopMarkup)}`);
            const recommendMarkup = context.createRecommendCard({ ...localized, skillId: id }).innerHTML;
            assert.ok(!LEADING_INSTALL.test(titleOf(recommendMarkup)), `${locale} ${id} recommend card: ${titleOf(recommendMarkup)}`);
        }
    }
});

test('installing SOPs keep the install verb and still flip to uninstall', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        const chrome = SOP_ITEMS.find((sop) => sop.id === 'rec_install_chrome');
        const localized = context.getLocalizedItem(chrome);
        assert.equal(context.getDisplayAction(localized.name, 'install'), 'install');
        const installTitle = context.getActionTitle(localized.name, 'install');
        const uninstallTitle = context.getActionTitle(localized.name, 'uninstall');
        assert.match(installTitle, locale === 'zh-TW' ? /^安裝/ : /^Install/);
        assert.match(uninstallTitle, locale === 'zh-TW' ? /^解除安裝/ : /^Uninstall/);
        assert.ok(!INSTALL_VERBS.test(uninstallTitle.replace(/^(解除安裝|Uninstall)\s*/i, '')));
        assert.equal(context.getDisplayAction(localized.name, 'uninstall'), 'uninstall');

        const installedCard = context.createSopCard({ ...localized, installed: true }).innerHTML;
        assert.match(titleOf(installedCard), locale === 'zh-TW' ? /解除安裝/ : /Uninstall/);
        assert.equal(buttonTitle(installedCard, 'btn-run-now'), locale === 'zh-TW' ? '立即解除安裝' : 'Uninstall now');
    }
});

test('a download SOP keeps its existing install-family treatment', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        const model = SOP_ITEMS.find((sop) => sop.id === 'rec_pull_llm_model');
        const localized = context.getLocalizedItem(model);
        assert.equal(context.getDisplayAction(localized.name, 'install'), 'install');
        assert.equal(context.getDisplayAction(localized.name, 'uninstall'), 'uninstall');
        assert.match(context.getActionTitle(localized.name, 'uninstall'), locale === 'zh-TW' ? /^解除安裝/ : /^Uninstall/);
    }
});

test('no bundled SOP title duplicates its verb in either locale or action', () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context } = createContext(locale);
        for (const sop of SOP_ITEMS) {
            const localized = context.getLocalizedItem(sop);
            for (const action of ['install', 'uninstall']) {
                const title = context.getActionTitle(localized.name, action);
                assert.ok(!/^(Install|安裝)\s+(Install|安裝)/i.test(title), `${locale} ${sop.id} ${action}: ${title}`);
                assert.ok(!/^(Uninstall|解除安裝)\s+(Uninstall|解除安裝)/i.test(title), `${locale} ${sop.id} ${action}: ${title}`);
                assert.ok(title.trim().length > 0, `${locale} ${sop.id} ${action} produced an empty title`);
            }
        }
    }
});

test('clicking add on a removal card still posts action install, so execution is unchanged', async () => {
    const { context, calls, executed } = createContext('zh-TW');
    const localized = context.getLocalizedItem(COPILOT);
    const card = context.createRecommendCard({ ...localized, skillId: COPILOT.id });
    await card.clickButton('btn-add-todo');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, '/api/todo');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.body.action, 'install');
    assert.equal(calls[0].options.body.skillId, 'rec_remove_copilot');
    assert.deepEqual(executed, []);
    assert.ok(!INSTALL_VERBS.test(context.getActionTitle(localized.title, 'install')));
});

test('the queue log for a removal SOP says run, not install', async () => {
    for (const locale of ['zh-TW', 'en-US']) {
        const { context, logs } = createContext(locale);
        await context.addRecommendToTodo({ ...context.getLocalizedItem(COPILOT), recommendedAction: 'install' });
        const message = logs.at(-1).message;
        assert.ok(!INSTALL_VERBS.test(message), `${locale}: ${message}`);
        assert.match(message, locale === 'zh-TW' ? /執行/ : /Run/i);
    }
});

test('task card and detail chips use the neutral verb for a removal task', () => {
    const stored = { id: 't1', title: '📦 Disable Windows Copilot', category: 'System Cleanup', action: 'install', status: 'pending', progress: 0 };
    const queued = { id: 't2', title: '移除 Windows Copilot', category: '系統清理', action: 'install', status: 'pending', progress: 0 };
    for (const task of [stored, queued]) {
        const zh = createContext('zh-TW').context;
        assert.match(zh.renderTaskCard(task).innerHTML, /<span class="task-category">執行<\/span>/);
        zh.renderTaskModalBody(task);
        assert.match(zh.modalBody.innerHTML, /<span class="task-detail-value">執行<\/span>/);
        const en = createContext('en-US').context;
        assert.match(en.renderTaskCard(task).innerHTML, /<span class="task-category">Run<\/span>/);
        en.renderTaskModalBody(task);
        assert.match(en.modalBody.innerHTML, /<span class="task-detail-value">Run<\/span>/);
    }
});

test('an uninstall task still shows the uninstall chip', () => {
    const task = { id: 't3', title: '🗑️ Uninstall Google Chrome', category: 'Browser', action: 'uninstall', status: 'pending', progress: 0 };
    const zh = createContext('zh-TW').context;
    assert.match(zh.renderTaskCard(task).innerHTML, /<span class="task-category">解除安裝<\/span>/);
    const en = createContext('en-US').context;
    assert.match(en.renderTaskCard(task).innerHTML, /<span class="task-category">Uninstall<\/span>/);
});

test('manual and dynamic task titles are not forced into an install verb', () => {
    const zh = createContext('zh-TW').context;
    const en = createContext('en-US').context;
    for (const title of ['幫我清理磁碟', 'Clean up my disk']) {
        assert.equal(zh.getDisplayAction(title, 'install'), 'run');
        assert.equal(en.getDisplayAction(title, 'install'), 'run');
        assert.equal(zh.getActionTitle(title, 'install'), title);
    }
    assert.equal(zh.getDisplayAction('安裝 Chrome', 'install'), 'install');
    assert.equal(en.getDisplayAction('Install Chrome', 'install'), 'install');
    assert.equal(zh.getDisplayAction('', 'install'), 'run');
    assert.equal(zh.getActionTitle('', 'install'), zh.t('task.unnamedItem'));
});

test('the neutral labels follow the active locale without leaking Chinese into en-US', () => {
    const en = createContext('en-US').context;
    assert.equal(en.getActionLabel('run'), 'Run');
    assert.equal(en.t('task.addRunTask'), 'Add to work list');
    assert.ok(!/[\u4e00-\u9fff]/.test(en.getActionLabel('run')));
    const markup = en.createSopCard(en.getLocalizedItem(COPILOT)).innerHTML;
    assert.ok(!/[\u4e00-\u9fff]/.test(markup), 'en-US removal card leaked Chinese');
    assert.deepEqual(plain(badges(markup)).filter((badge) => /Run/i.test(badge)).length, 1);
});