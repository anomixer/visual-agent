/**
 * LLM protocol helpers shared by every provider path.
 * Pure data shaping except assertChatResponseOk, which only reads a Response body.
 */
'use strict';

const DEFAULT_AUTH_ERROR = (provider) =>
    `AI engine authentication failed (401). Please check your ${provider} API Key in Settings.`;

function normalizeMessageContent(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        return value.map((part) => {
            if (typeof part === 'string') return part;
            return part?.text || part?.content || '';
        }).join('\n');
    }
    if (typeof value === 'object') {
        return value.text || value.content || JSON.stringify(value);
    }
    return String(value);
}

/**
 * Most OpenAI-compatible and Ollama endpoints reject role:"tool" without a
 * tool_call_id, so tool observations arrive as user messages. System stays.
 */
function normalizeHistoryMessages(history = []) {
    return (Array.isArray(history) ? history : [])
        .map((message) => {
            const rawRole = String(message?.role || 'user');
            const role = rawRole === 'assistant'
                ? 'assistant'
                : (rawRole === 'system' ? 'system' : 'user');
            return { role, content: normalizeMessageContent(message?.content) };
        })
        .filter((message) => message.content.trim());
}

function resolveChatUrl(providerType, baseUrl = '', chatPath = '/messages') {
    const base = String(baseUrl || '');
    const apiRoot = base.replace(/\/v1\/?$/, '');
    if (providerType === 'ollama') return `${apiRoot}/api/chat`;
    if (providerType === 'anthropic') return `${apiRoot}${chatPath || '/messages'}`;
    return base.endsWith('/') ? `${base}chat/completions` : `${base}/chat/completions`;
}

function chatApiError(status, body, provider, authMessage) {
    if (status === 401) {
        return new Error(typeof authMessage === 'function'
            ? authMessage(provider)
            : (authMessage || DEFAULT_AUTH_ERROR(provider)));
    }
    return new Error(`API error (${status}): ${String(body || '').substring(0, 200)}`);
}

async function assertChatResponseOk(response, provider, authMessage) {
    if (response.ok) return response;
    const body = await response.text();
    throw chatApiError(response.status, body, provider, authMessage);
}

function extractReplyContent(data) {
    if (Array.isArray(data?.choices) && data.choices.length) {
        const choice = data.choices[0] || {};
        const choiceMessage = choice.message;
        return String(
            normalizeMessageContent(choiceMessage?.content)
            || normalizeMessageContent(choiceMessage?.reasoning_content)
            || normalizeMessageContent(choiceMessage?.reasoning)
            || normalizeMessageContent(choice.text)
        ).trim();
    }
    if (data?.message) {
        return String(
            normalizeMessageContent(data.message.content)
            || normalizeMessageContent(data.message.reasoning_content)
        ).trim();
    }
    if (data?.content) return String(normalizeMessageContent(data.content)).trim();
    if (data?.response) return String(normalizeMessageContent(data.response)).trim();
    return '';
}

/**
 * Reasoning models may emit <think>/<reasoning> blocks. Keep the block when it
 * is the only content instead of turning the reply into an empty string.
 */
function splitThoughtTags(content = '') {
    const text = String(content || '').trim();
    const thoughtMatch = text.match(/<think>([\s\S]*?)<\/think>/i)
        || text.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
    const thought = thoughtMatch ? thoughtMatch[1].trim() : null;
    const cleanContent = text
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .trim();
    return { thought, cleanContent, finalReply: cleanContent || thought || '' };
}

function parseChatReply(data) {
    const rawContent = extractReplyContent(data);
    return { rawContent, ...splitThoughtTags(rawContent) };
}

module.exports = {
    normalizeMessageContent,
    normalizeHistoryMessages,
    resolveChatUrl,
    chatApiError,
    assertChatResponseOk,
    extractReplyContent,
    splitThoughtTags,
    parseChatReply,
};
