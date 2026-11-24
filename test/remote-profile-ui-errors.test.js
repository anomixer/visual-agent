'use strict';
// 遠端身份儲存與邀請回應失敗時必須留下可見回饋 — 擷取 public/app.js 的真實函式，以最小 fake 執行。
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

const DECLARATIONS = ['getLocalePack', 'formatI18n', 't', 'saveRemoteProfile', 'respondRemoteRequest']
    .map(extractFunction).join('\n');

function createContext(response, locale = 'zh-TW') {
    const calls = [];
    const logs = [];
    const reloads = [];
    const bubbles = [];
    const modeSwitches = [];
    const overlay = {
        visible: true,
        classList: {
            remove(name) { if (name === 'visible') overlay.visible = false; },
        },
    };
    const context = {
        I18N: loadLocalePacks(locale),
        currentLocale: locale,
        pendingRemoteRequestId: 'pending-session',
        lastRemoteStateTick: 7,
        selectedRemoteSessionId: '',
        remoteProfile: null,
        remoteRequestOverlay: overlay,
        remoteAgentNameInput: { value: 'Agent Probe' },
        remoteUserNameInput: { value: 'User Probe' },
        remoteChatMessages: { id: 'remote-chat' },
        api: async (endpoint, options) => {
            calls.push({ endpoint, options });
            return response;
        },
        addUILog(message, level) { logs.push({ message, level }); },
        async loadRemoteProfileAndState() { reloads.push(context.lastRemoteStateTick); },
        syncRemoteProfileDirty(value) { context.profileDirtyAfterSave = value; },
        switchChatMode(mode) { modeSwitches.push(mode); },
        appendChatBubble(role, message, extra, options) { bubbles.push({ role, message, options }); },
    };
    vm.createContext(context);
    vm.runInContext(DECLARATIONS, context, { filename: sourcePath });
    return { context, calls, logs, reloads, bubbles, modeSwitches, overlay };
}

const REFUSED = { success: false, error: 'remote profile file is locked' };

test('saveRemoteProfile reports a refusal instead of silently dropping it', async () => {
    const { context, calls, logs, reloads } = createContext(REFUSED);

    await context.saveRemoteProfile();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, '/api/remote/profile');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.body.userName, 'User Probe');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].message, /遠端身份儲存失敗：remote profile file is locked/);
    assert.equal(context.profileDirtyAfterSave, undefined, 'a failed save must not clear the dirty flag');
    assert.deepEqual(reloads, [], 'a failed save must not pretend the state was refreshed');
});

test('saveRemoteProfile still saves and refreshes on success', async () => {
    const { context, logs, reloads } = createContext({
        success: true,
        profile: { userName: 'User Probe', agentName: 'Agent Probe' },
    });

    await context.saveRemoteProfile();

    assert.equal(context.remoteProfile.userName, 'User Probe');
    assert.equal(context.profileDirtyAfterSave, false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'success');
    assert.equal(reloads.length, 1);
});

test('a refused invitation keeps the dialog open, reports it and forces a full refresh', async () => {
    const { context, calls, logs, reloads, overlay } = createContext(REFUSED);

    await context.respondRemoteRequest(true);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].endpoint, '/api/remote/session/pending-session/respond');
    // vm realm 的物件原型不同，跨 realm 比對前先 JSON 往返。
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)), { accept: true });
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, 'error');
    assert.match(logs[0].message, /回應連線邀請失敗：remote profile file is locked/);
    // 邀請可能已逾時或被取消；必須取回完整狀態，仍有效的邀請才會重新彈出。
    assert.equal(context.pendingRemoteRequestId, 'pending-session', 'the request must stay pending until resolved');
    assert.equal(overlay.visible, true, 'the dialog must not be dismissed by a failed respond');
    assert.deepEqual(reloads, [0], 'the tick must be reset so the next poll returns the full payload');
});

test('an accepted invitation closes the dialog and switches to the remote chat', async () => {
    const { context, bubbles, modeSwitches, overlay, reloads } = createContext({
        success: true,
        session: { id: 'accepted-session' },
    });

    await context.respondRemoteRequest(true);

    assert.equal(overlay.visible, false);
    assert.equal(context.pendingRemoteRequestId, '');
    assert.equal(context.selectedRemoteSessionId, 'accepted-session');
    assert.deepEqual(modeSwitches, ['remote']);
    assert.equal(bubbles.length, 1);
    assert.equal(bubbles[0].message, '您已接受對話。請開始聊天或支援');
    assert.equal(reloads.length, 1);
});

test('a rejected invitation closes the dialog without switching chat mode', async () => {
    const { context, bubbles, modeSwitches, overlay } = createContext({ success: true });

    await context.respondRemoteRequest(false);

    assert.equal(overlay.visible, false);
    assert.equal(context.pendingRemoteRequestId, '');
    assert.deepEqual(modeSwitches, []);
    assert.deepEqual(bubbles, []);
});

test('the failure labels follow the active locale', async () => {
    const { context, logs } = createContext(REFUSED, 'en-US');

    await context.saveRemoteProfile();
    await context.respondRemoteRequest(false);

    assert.match(logs[0].message, /Failed to save remote identity: remote profile file is locked/);
    assert.match(logs[1].message, /Failed to respond to the connection request: remote profile file is locked/);
    assert.ok(logs.every((entry) => !/[\u4e00-\u9fff]/.test(entry.message)));
});
