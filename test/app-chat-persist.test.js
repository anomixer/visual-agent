'use strict';

// 本機對話持久化 — 擷取 public/app.js 的真實預算函式與儲存流程，
// 驗證附件 base64 不會撐爆 localStorage，且配額失敗不會中斷對話。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const sourcePath = path.join(__dirname, '..', 'public', 'app.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function extract(pattern, label) {
    const matches = [...source.matchAll(pattern)];
    assert.equal(matches.length, 1, `Expected one actual declaration of ${label}`);
    return new vm.Script(matches[0][0], {
        filename: sourcePath,
        lineOffset: source.slice(0, matches[0].index).split('\n').length - 1,
    });
}

const declarations = [
    extract(/^const LOCAL_CHAT_PERSIST_LIMIT = [^;]+;\r?$/gm, 'LOCAL_CHAT_PERSIST_LIMIT'),
    extract(/^function buildLocalChatPersistPayload\([^]*?^\}\r?$/gm, 'buildLocalChatPersistPayload'),
    extract(/^function saveLocalChatSessions\([^]*?^\}\r?$/gm, 'saveLocalChatSessions'),
];

const image = (chars) => 'data:image/png;base64,' + 'A'.repeat(chars);

function session(id, updatedAt, messages) {
    return { id, title: id, updatedAt, messages };
}

function message(id, text, imageDataUrl = '') {
    return { id, role: 'user', text, imageDataUrl, createdAt: '2026-10-29T00:00:00.000Z' };
}

function harness(sessions, { failWrites = false } = {}) {
    const store = {};
    const warnings = [];
    const context = vm.createContext({
        localChatSessions: sessions,
        selectedLocalChatSessionId: sessions[0]?.id || '',
        normalizeLocalChatSessions: () => {},
        localStorage: {
            setItem(key, value) {
                if (failWrites) throw new Error('QuotaExceededError');
                store[key] = value;
            },
        },
        console: { warn: (...args) => warnings.push(args.map(String).join(' ')) },
    });
    for (const declaration of declarations) declaration.runInContext(context, { timeout: 1000 });
    // 頂層 const 是詞法宣告，不會變成 context 的屬性，需在 context 內取值。
    const limit = vm.runInContext('LOCAL_CHAT_PERSIST_LIMIT', context);
    return { context, store, warnings, limit };
}

test('a small history is persisted unchanged', () => {
    const sessions = [session('s1', '2026-10-29T02:00:00.000Z', [message('m1', 'hello')])];
    const { context } = harness(sessions);
    assert.deepEqual(JSON.parse(context.buildLocalChatPersistPayload(sessions)), sessions);
});

test('over budget the oldest attachments lose their image but keep their text', () => {
    const sessions = [
        session('old', '2026-10-29T01:00:00.000Z', [message('m1', 'old text', image(4000))]),
        session('new', '2026-10-29T03:00:00.000Z', [message('m2', 'new text', image(4000))]),
    ];
    const { context } = harness(sessions);
    const payload = context.buildLocalChatPersistPayload(sessions, 6000);
    const parsed = JSON.parse(payload);

    assert.ok(payload.length <= 6000, 'Payload must fit the budget');
    const oldMessage = parsed.find((s) => s.id === 'old').messages[0];
    const newMessage = parsed.find((s) => s.id === 'new').messages[0];
    assert.equal(oldMessage.imageDataUrl, '', 'Oldest attachment must be dropped first');
    assert.equal(oldMessage.text, 'old text');
    assert.ok(newMessage.imageDataUrl.length > 0, 'Newest attachment should survive');
    assert.equal(newMessage.text, 'new text');
});

test('the in-memory sessions are not mutated by persistence', () => {
    const original = image(9000);
    const sessions = [session('s1', '2026-10-29T01:00:00.000Z', [message('m1', 'text', original)])];
    const { context } = harness(sessions);
    context.buildLocalChatPersistPayload(sessions, 1000);
    assert.equal(sessions[0].messages[0].imageDataUrl, original, 'Only the persisted copy may lose its image');
});

test('a history without attachments is returned as-is even over budget', () => {
    const sessions = [session('s1', '2026-10-29T01:00:00.000Z', [message('m1', 'x'.repeat(5000))])];
    const { context } = harness(sessions);
    const payload = context.buildLocalChatPersistPayload(sessions, 100);
    assert.deepEqual(JSON.parse(payload), sessions);
});

test('saving stays within the limit and survives a quota failure', () => {
    const sessions = [session('s1', '2026-10-29T01:00:00.000Z', [message('m1', 'text', image(3 * 1024 * 1024))])];
    const ok = harness(sessions);
    ok.context.saveLocalChatSessions();
    assert.ok(ok.store.local_chat_sessions_v1.length <= ok.limit);
    assert.equal(ok.store.selected_local_chat_session_id, 's1');

    const failing = harness(sessions, { failWrites: true });
    assert.doesNotThrow(() => failing.context.saveLocalChatSessions(), 'A quota failure must not break the chat flow');
    assert.equal(failing.warnings.length, 1);
});
