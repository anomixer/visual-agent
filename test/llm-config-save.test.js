'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');

// llm.js 在載入時就讀 APPDATA 並建立設定目錄，因此必須先指向暫存目錄再 require。
// chat-harness 把 llm.js 整個換成 stub，測不到真實的設定持久化行為。
const tempAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-agent-llm-config-test-'));
process.env.APPDATA = tempAppData;
const llm = require(path.join(__dirname, '..', 'src', 'llm.js'));

const configPath = path.join(tempAppData, 'visual-agent', 'config.json');
const originalFetch = global.fetch;
const DEFAULT_MODEL = 'gemma4:e2b-it-qat';

function blockConfigWrites() {
    // 把 config.json 換成目錄：writeFileSync 必定失敗（EISDIR），不需要系統管理員或 attrib。
    fs.rmSync(configPath, { recursive: true, force: true });
    fs.mkdirSync(configPath, { recursive: true });
}

function unblockConfigWrites() {
    fs.rmSync(configPath, { recursive: true, force: true });
}

function snapshot() {
    return {
        provider: llm.getCurrentProvider(),
        baseUrl: llm.getCurrentBaseUrl(),
        apiKey: llm.getCurrentApiKey(),
        authType: llm.getCurrentAuthType(),
        authConfig: llm.getCurrentAuthConfig(),
        model: llm.getCurrentModel(),
        visionModel: llm.getCurrentVisionModel(),
    };
}

function readDiskConfig() {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

after(() => {
    global.fetch = originalFetch;
    fs.rmSync(tempAppData, { recursive: true, force: true });
});

test('a successful save persists every setting to disk', () => {
    unblockConfigWrites();
    llm.updateProviderSettings(
        'OpenAI',
        'https://api.openai.com/v1',
        'sk-unit-test',
        'gpt-4o-mini',
        { type: 'api_key', apiKey: 'sk-unit-test' },
        'gpt-4o'
    );
    const disk = readDiskConfig();
    assert.equal(disk.currentProvider, 'OpenAI');
    assert.equal(disk.currentBaseUrl, 'https://api.openai.com/v1');
    assert.equal(disk.currentApiKey, 'sk-unit-test');
    assert.equal(disk.currentAuthType, 'api_key');
    assert.equal(disk.currentModel, 'gpt-4o-mini');
    assert.equal(disk.currentVisionModel, 'gpt-4o');
    assert.equal(llm.getCurrentProvider(), 'OpenAI');
    assert.equal(llm.getCurrentModel(), 'gpt-4o-mini');
});

test('a failed save throws and rolls back every setting', () => {
    const before = snapshot();
    const diskBefore = fs.statSync(configPath).isDirectory();
    assert.equal(diskBefore, false);
    blockConfigWrites();
    try {
        assert.throws(
            () => llm.updateProviderSettings(
                'Anthropic',
                'https://api.anthropic.com/v1',
                'sk-should-not-survive',
                'claude-sonnet-4',
                { type: 'api_key', apiKey: 'sk-should-not-survive' },
                'claude-vision'
            ),
            /EISDIR|EPERM|ENOSPC|EACCES/
        );
        // 七個欄位全部回到原值，否則畫面顯示新 Provider、重啟後回到舊的。
        assert.deepEqual(snapshot(), before);
        assert.equal(fs.statSync(configPath).isDirectory(), true);
    } finally {
        unblockConfigWrites();
    }
});

test('setCurrentModel rolls back when the save fails', () => {
    unblockConfigWrites();
    llm.setCurrentModel('model-before-failure');
    blockConfigWrites();
    try {
        assert.throws(() => llm.setCurrentModel('model-should-not-survive'), /EISDIR|EPERM|ENOSPC|EACCES/);
        assert.equal(llm.getCurrentModel(), 'model-before-failure');
    } finally {
        unblockConfigWrites();
    }
});

test('saving works again once the disk is writable', () => {
    unblockConfigWrites();
    llm.updateProviderSettings('Ollama', 'http://127.0.0.1:11434/v1', '', 'gemma4:e2b-it-qat', null, '');
    assert.equal(readDiskConfig().currentProvider, 'Ollama');
    llm.setCurrentModel('recovered-model');
    assert.equal(readDiskConfig().currentModel, 'recovered-model');
    assert.equal(llm.getCurrentModel(), 'recovered-model');
});

test('an auto-selected model stays ready even when it cannot be persisted', async () => {
    unblockConfigWrites();
    // 先把 currentModel 設成清單裡不存在的型號，才會觸發 DEFAULT_MODEL 自動選模。
    llm.updateProviderSettings('Ollama', 'http://127.0.0.1:11434/v1', '', 'model-not-installed', null, '');
    blockConfigWrites();
    global.fetch = async (url) => {
        const body = String(url).includes('/api/tags')
            ? { models: [{ name: DEFAULT_MODEL }] }
            : { version: '0.0.0-test' };
        return new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    try {
        const status = await llm.checkOllamaStatus(true);
        // 背景自動選模寫不進設定檔，不該讓已存在的模型被判為未就緒。
        assert.equal(status.available, true);
        assert.equal(status.modelReady, true);
        assert.equal(status.modelName, DEFAULT_MODEL);
        assert.equal(llm.getCurrentModel(), DEFAULT_MODEL);
        assert.equal(fs.statSync(configPath).isDirectory(), true);
    } finally {
        global.fetch = originalFetch;
        unblockConfigWrites();
    }
});

console.log('[llm-config-save.test] settings persistence failure is visible and rolled back');