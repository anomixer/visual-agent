'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    normalizeMessageContent,
    normalizeHistoryMessages,
    resolveChatUrl,
    assertChatResponseOk,
    extractReplyContent,
    splitThoughtTags,
    parseChatReply,
} = require('../src/llm/protocol');

test('normalizeMessageContent handles strings, arrays and objects', () => {
    assert.equal(normalizeMessageContent(null), '');
    assert.equal(normalizeMessageContent('text'), 'text');
    assert.equal(normalizeMessageContent(['a', { text: 'b' }, { content: 'c' }, { type: 'tool_use' }]), 'a\nb\nc\n');
    assert.equal(normalizeMessageContent({ text: 'hello' }), 'hello');
    assert.equal(normalizeMessageContent({ content: 'world' }), 'world');
    assert.equal(normalizeMessageContent({ other: 1 }), '{"other":1}');
    assert.equal(normalizeMessageContent(42), '42');
});

test('normalizeHistoryMessages keeps assistant/system and folds tool observations into user', () => {
    const normalized = normalizeHistoryMessages([
        { role: 'system', content: 'rules' },
        { role: 'assistant', content: 'hi' },
        { role: 'tool', content: 'observation' },
        { role: 'assistant', content: [{ text: 'part one' }, { content: 'part two' }] },
        { role: 'user', content: '   ' },
        null,
    ]);
    assert.deepEqual(normalized, [
        { role: 'system', content: 'rules' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'observation' },
        { role: 'assistant', content: 'part one\npart two' },
        { role: 'user', content: '' },
    ].filter((message) => message.content.trim()));
});

test('resolveChatUrl maps each provider style without duplicating the /v1 segment', () => {
    assert.equal(resolveChatUrl('ollama', 'http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/api/chat');
    assert.equal(resolveChatUrl('ollama', 'http://127.0.0.1:11434'), 'http://127.0.0.1:11434/api/chat');
    assert.equal(resolveChatUrl('anthropic', 'https://api.anthropic.com/v1', '/messages'), 'https://api.anthropic.com/messages');
    assert.equal(resolveChatUrl('openai', 'https://api.openai.com/v1'), 'https://api.openai.com/v1/chat/completions');
    assert.equal(resolveChatUrl('openai', 'https://example.com/v1/'), 'https://example.com/v1/chat/completions');
});

test('assertChatResponseOk passes 200 and reports auth and API failures', async () => {
    const ok = { ok: true, status: 200 };
    assert.equal(await assertChatResponseOk(ok, 'Ollama'), ok);

    await assert.rejects(
        assertChatResponseOk({ ok: false, status: 401, text: async () => 'denied' }, 'OpenAI'),
        /authentication failed \(401\).*OpenAI/
    );
    await assert.rejects(
        assertChatResponseOk({ ok: false, status: 500, text: async () => 'x'.repeat(500) }, 'Groq'),
        (error) => error.message.startsWith('API error (500): ') && error.message.length < 240
    );
});

test('extractReplyContent covers OpenAI, reasoning, Anthropic and Ollama shapes', () => {
    assert.equal(extractReplyContent({ choices: [{ message: { content: 'plain' } }] }), 'plain');
    assert.equal(extractReplyContent({ choices: [{ message: { reasoning_content: 'thought' } }] }), 'thought');
    assert.equal(extractReplyContent({ choices: [{ text: 'completion' }] }), 'completion');
    assert.equal(extractReplyContent({ content: [{ type: 'text', text: 'anthropic' }] }), 'anthropic');
    assert.equal(extractReplyContent({ message: { content: 'ollama' } }), 'ollama');
    assert.equal(extractReplyContent({ response: 'generate' }), 'generate');
    assert.equal(extractReplyContent({}), '');
});

test('splitThoughtTags keeps thought-only replies and strips mixed tags', () => {
    assert.deepEqual(splitThoughtTags('  <think>only thought</think>  '), {
        thought: 'only thought', cleanContent: '', finalReply: 'only thought',
    });
    assert.deepEqual(splitThoughtTags('<reasoning>plan</reasoning>answer'), {
        thought: 'plan', cleanContent: 'answer', finalReply: 'answer',
    });
    assert.deepEqual(splitThoughtTags('plain'), { thought: null, cleanContent: 'plain', finalReply: 'plain' });
});

test('parseChatReply combines extraction and thought handling', () => {
    const parsed = parseChatReply({ choices: [{ message: { content: '<think>plan</think>done' } }] });
    assert.equal(parsed.rawContent, '<think>plan</think>done');
    assert.equal(parsed.thought, 'plan');
    assert.equal(parsed.finalReply, 'done');
});

console.log('\n[llm-protocol.test] 7 passed');
