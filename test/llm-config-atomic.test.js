'use strict';
// config.json 必須原子置換：寫到一半失敗時，既有設定（含 API Key）要一個位元組都不動。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test, after } = require('node:test');

// llm.js 在載入時就讀 APPDATA 並建立設定目錄，因此必須先指向暫存目錄再 require。
const tempAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-agent-llm-atomic-test-'));
process.env.APPDATA = tempAppData;
const llmPath = path.join(__dirname, '..', 'src', 'llm.js');
const llm = require(llmPath);

const appDataDir = path.join(tempAppData, 'visual-agent');
const configPath = path.join(appDataDir, 'config.json');
// 與 saveTasks() 相同的命名：同目錄、帶 pid，避免兩個行程互相覆寫暫存檔。
const tempPath = `${configPath}.${process.pid}.tmp`;
const SECRET = 'sk-atomic-original-8c1d';

function seedConfig() {
    fs.rmSync(configPath, { recursive: true, force: true });
    fs.writeFileSync(configPath, JSON.stringify({
        currentModel: 'gemma4:e2b-it-qat',
        currentProvider: 'Ollama',
        currentBaseUrl: 'http://127.0.0.1:11434/v1',
        currentApiKey: SECRET,
        currentAuthType: 'api_key',
        currentAuthConfig: { type: 'api_key', apiKey: SECRET },
        currentVisionModel: '',
    }, null, 2), 'utf8');
    return fs.readFileSync(configPath, 'utf8');
}

function tempFiles() {
    return fs.readdirSync(appDataDir).filter((name) => name.endsWith('.tmp'));
}

function saveSomethingElse() {
    llm.updateProviderSettings(
        'OpenAI',
        'https://api.openai.com/v1',
        'sk-atomic-replacement',
        'gpt-4o-mini',
        { type: 'api_key', apiKey: 'sk-atomic-replacement' },
        'gpt-4o'
    );
}

after(() => {
    fs.rmSync(tempAppData, { recursive: true, force: true });
});

test('a successful save replaces the config and leaves no temp file', () => {
    seedConfig();
    saveSomethingElse();
    const disk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(disk.currentProvider, 'OpenAI');
    assert.equal(disk.currentApiKey, 'sk-atomic-replacement');
    assert.equal(disk.currentVisionModel, 'gpt-4o');
    assert.deepEqual(tempFiles(), []);
});

test('a failed temp write keeps the previous config byte-for-byte', () => {
    seedConfig();
    // 記憶體也對齊 Ollama，否則回滾斷言會因為新舊 provider 相同而失去意義。
    llm.updateProviderSettings('Ollama', 'http://127.0.0.1:11434/v1', SECRET, 'gemma4:e2b-it-qat',
        { type: 'api_key', apiKey: SECRET }, '');
    const before = fs.readFileSync(configPath, 'utf8');
    const memoryBefore = {
        provider: llm.getCurrentProvider(),
        apiKey: llm.getCurrentApiKey(),
        model: llm.getCurrentModel(),
    };
    assert.equal(memoryBefore.provider, 'Ollama');
    // 暫存路徑換成目錄：openSync 必定失敗，且發生在置換 config.json 之前。
    fs.rmSync(tempPath, { recursive: true, force: true });
    fs.mkdirSync(tempPath, { recursive: true });
    try {
        assert.throws(saveSomethingElse, /EISDIR|EPERM|ENOSPC|EACCES/);
        assert.equal(fs.readFileSync(configPath, 'utf8'), before);
        assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).currentApiKey, SECRET);
        assert.deepEqual({
            provider: llm.getCurrentProvider(),
            apiKey: llm.getCurrentApiKey(),
            model: llm.getCurrentModel(),
        }, memoryBefore);
    } finally {
        fs.rmSync(tempPath, { recursive: true, force: true });
    }
});

test('a failed rename removes the temp file it already wrote', () => {
    seedConfig();
    fs.rmSync(configPath, { recursive: true, force: true });
    fs.mkdirSync(configPath, { recursive: true });
    try {
        assert.throws(saveSomethingElse, /EISDIR|EPERM|ENOSPC|EACCES/);
        // 暫存檔已經寫成功，失敗在 rename；留著只會累積垃圾。
        assert.deepEqual(tempFiles(), []);
    } finally {
        fs.rmSync(configPath, { recursive: true, force: true });
    }
});

test('a stale temp from a killed process does not block the next save', () => {
    seedConfig();
    const stale = `${configPath}.999999.tmp`;
    fs.writeFileSync(stale, '{"currentApiKey":"half-writ');
    try {
        saveSomethingElse();
        assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).currentApiKey, 'sk-atomic-replacement');
        // 別的 pid 的暫存檔可能屬於仍在執行的行程，不可順手刪掉。
        assert.equal(fs.readFileSync(stale, 'utf8'), '{"currentApiKey":"half-writ');
        assert.deepEqual(tempFiles(), [path.basename(stale)]);
    } finally {
        fs.rmSync(stale, { force: true });
    }
});

test('a fresh process loads exactly what the atomic save wrote', () => {
    seedConfig();
    saveSomethingElse();
    const script = `const llm = require(${JSON.stringify(llmPath)});`
        + 'process.stdout.write("RESULT:" + JSON.stringify({'
        + 'provider: llm.getCurrentProvider(), baseUrl: llm.getCurrentBaseUrl(),'
        + 'apiKey: llm.getCurrentApiKey(), authType: llm.getCurrentAuthType(),'
        + 'model: llm.getCurrentModel(), visionModel: llm.getCurrentVisionModel()}));';
    const child = spawnSync(process.execPath, ['-e', script], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, APPDATA: tempAppData },
        encoding: 'utf8',
        timeout: 30000,
    });
    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout.split(/\r?\n/).find((text) => text.startsWith('RESULT:'));
    assert.ok(line, `expected a result line, got: ${child.stdout}`);
    assert.deepEqual(JSON.parse(line.slice('RESULT:'.length)), {
        provider: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-atomic-replacement',
        authType: 'api_key',
        model: 'gpt-4o-mini',
        visionModel: 'gpt-4o',
    });
});

console.log('[llm-config-atomic.test] a failed save never damages the stored settings');