'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const names = [
    'setLocaleText', 'setLocaleTitle', 'setLocalePlaceholder', 'setLocaleElementText',
    'applyLocaleTexts', 'applyLocaleTitles', 'applyLocalePlaceholders',
    'applyLocaleToShell', 'applyLocaleToWorkspace', 'applyLocaleToChat',
    'applyLocaleToPanels', 'applyLocaleToSettings', 'applyLocaleToTextTool',
    'applyLocaleToChalkboardTools', 'applyLocaleToFooter', 'updateLocaleUI',
];
const declarations = names.map((name) => {
    const matches = [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}\\r?$`, 'gm'))];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${name}`);
    return new vm.Script(matches[0][0], { filename: sourcePath });
});

class FakeElement {
    constructor(id = '') {
        this.id = id;
        this.textContent = '';
        this.title = '';
        this.placeholder = '';
        this.classList = { contains: () => true };
    }
}

function harness(locale = 'zh-TW') {
    const byId = new Map();
    const bySelector = new Map();
    const calls = [];
    const element = (key) => {
        if (!byId.has(key)) byId.set(key, new FakeElement(key));
        return byId.get(key);
    };
    const option = () => new FakeElement();
    const context = vm.createContext({
        currentLocale: locale,
        activeChatMode: 'local',
        todoList: [{ id: 'a' }, { id: 'b' }],
        window: {},
        localStorage: { getItem: () => '1' },
        document: {
            documentElement: {},
            body: {},
            title: '',
            getElementById: element,
            querySelector(selector) {
                if (!bySelector.has(selector)) bySelector.set(selector, new FakeElement(selector));
                return bySelector.get(selector);
            },
            querySelectorAll(selector) {
                if (selector === '#settingAuthType option') return [option(), option(), option()];
                if (selector === '#textToolFontFamily option') return Array.from({ length: 7 }, option);
                return [];
            },
        },
        t: (key) => key,
        btnLang: null,
        btnToggleSidebar: null, btnTogglePanel: null, btnToggleChat: null,
        chatModelBadge: null,
        btnMic: null, btnChalkAttach: null, btnNewLocalSession: null, btnRemoteAttachFile: null,
        btnClearChat: null, btnDisconnectRemote: null,
        remoteSessionStatus: null, remoteHostInput: null, remoteAgentNameInput: null,
        remoteUserNameInput: null, btnRemoteConnect: null, btnSaveRemoteProfile: null,
        btnShareScreen: null, remoteChatHint: null, remoteSendMode: null,
        remoteRequestTitle: null, remoteRequestSummary: null,
        btnAcceptRemoteRequest: null, btnRejectRemoteRequest: null,
        chatInput: null, btnSend: null,
        expSearchInput: null, btnExpsExport: null,
        btnRefreshModels: null, settingBaseUrl: null, settingApiKey2: null,
        settingModelName: null, settingVisionModelName: null,
        providerHelpTitle: null, providerHelpText: null,
        btnTestProviderSettings: null, btnSaveProviderSettings: null,
        btnToggleLog: null,
        statusTasks: element('statusTasks'),
        getRemoteStatusText: () => 'status',
        getActiveRemoteSession: () => null,
        getRemoteConnectButtonText: () => 'connect',
        updateRemoteToolbarToggle: () => calls.push('toolbar'),
        buildRemoteHintText: () => 'hint',
        switchChatMode: (mode) => calls.push(`switch:${mode}`),
        updateLLMStatusText: () => calls.push('llm'),
        renderSidebarTab: () => calls.push('sidebar'),
        renderTodoList: () => calls.push('todo'),
        renderExps: () => calls.push('exps'),
        updateChatModeBadges: () => calls.push('badges'),
        updateChatModelBadgeDisplay: () => calls.push('modelBadge'),
        renderLocalSessionControls: () => calls.push('sessionControls'),
        renderLocalChatMessages: () => calls.push('messages'),
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    return { context, byId, bySelector, calls, element };
}

test('zh-TW locale applies every surface through the split helpers', () => {
    const view = harness('zh-TW');
    view.context.updateLocaleUI();

    assert.equal(view.context.document.documentElement.lang, 'zh-TW');
    assert.equal(view.element('menuFileText').textContent, 'titlebar.file');
    assert.equal(view.element('menuView').textContent, 'titlebar.view');
    assert.equal(view.element('menuHelp').textContent, 'titlebar.help');
    assert.equal(view.element('menuRefreshText').textContent, 'titlebar.refresh');
    assert.equal(view.element('menuExitText').textContent, 'titlebar.exit');
    assert.equal(view.element('importTasksText').textContent, 'footer.importTasks');
    assert.equal(view.element('exportTasksText').textContent, 'footer.exportTasks');
    // llmLabel 由 updateLLMStatusText 依即時狀態寫入，locale 套用不應覆蓋它。
    assert.equal(view.element('llmLabel').textContent, '');
    assert.equal(view.element('appTitle').textContent, 'Visual Agent - 系統管家');
    assert.equal(view.context.document.title, 'Visual Agent - 系統管家');

    assert.equal(view.element('hw-title').textContent, 'hardware.title');
    assert.equal(view.element('hw-label-disk').textContent, 'hardware.disk');
    assert.equal(view.element('chalk-kicker').textContent, 'chalkboardWelcome.kicker');
    assert.equal(view.element('todo-empty-title').textContent, 'todo.emptyTitle');
    assert.equal(view.bySelector.get('#tab-todolist .tab-title').textContent, 'tabs.todolist');
    assert.equal(view.bySelector.get('[data-bottom-tab="exps"]').textContent, 'tabs.exps');

    assert.equal(view.element('logEmptyMessage').textContent, 'tabs.emptyMessage');
    assert.equal(view.element('expsEmptyMessage').textContent, 'exps.emptyMessage');
    assert.equal(view.bySelector.get('.provider-modal .modal-header h3').textContent, 'settings.title');
    assert.equal(view.element('settingBaseUrl').placeholder, 'settings.baseUrlPlaceholder');
    assert.equal(view.element('labelVisionModel').textContent, 'settings.visionModel');
    assert.equal(view.bySelector.get('.text-tool-modal h3').textContent, 'textTool.title');
    assert.equal(view.element('textToolContent').placeholder, 'textTool.contentPlaceholder');
    assert.equal(view.element('textToolStyleMono').textContent, 'textTool.styleOptions.mono');
    assert.equal(view.element('chalkEraser').title, 'chalkboard.tools.eraser');
    assert.equal(view.element('chalkRedoButton').title, '重做');
    assert.equal(view.element('statusTasks').textContent, 'footer.tasks');
    assert.equal(view.context.document.title, 'Visual Agent - 系統管家');

    for (const expected of ['switch:local', 'llm', 'sidebar', 'todo', 'exps', 'badges', 'modelBadge', 'sessionControls', 'messages']) {
        assert.ok(view.calls.includes(expected), `Missing ${expected}`);
    }
});

test('en-US locale updates titles, redo label and settings placeholders', () => {
    const view = harness('en-US');
    view.context.updateLocaleUI();

    assert.equal(view.context.document.documentElement.lang, 'en-US');
    assert.equal(view.context.document.title, 'Visual Agent - System Butler');
    assert.equal(view.element('appTitle').textContent, 'Visual Agent - System Butler');
    assert.equal(view.element('chalkRedoButton').title, 'Redo');
    assert.equal(view.element('menuFileText').textContent, 'titlebar.file');
    assert.equal(view.element('settingVisionModelName').placeholder, 'settings.visionModelPlaceholder');
    assert.equal(view.element('textToolAlignRight').textContent, 'textTool.alignOptions.right');
});

test('locale writes happen once per element instead of duplicated menu blocks', () => {
    const menuWrites = source.match(/menuFileText:\s*t\('titlebar\.file'\)/g) || [];
    assert.equal(menuWrites.length, 1, 'Menu labels must be written from a single map');
    assert.doesNotMatch(source, /const _mft = document\.getElementById\('menuFileText'\)/);
});

console.log('\n[app-i18n.test] 3 passed');
