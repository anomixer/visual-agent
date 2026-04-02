/**
 * AI PC Agent Local Server
 * 
 * 提供 REST API 給前端 UI 使用，橋接 sop-parser 與 sop-executor。
 * 啟動後會自動開啟瀏覽器。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const pkg = require('../package.json');
const { loadAllSOPs } = require('./sop-parser');
const { SOPExecutor } = require('./sop-executor');
const llm = require('./llm');
const { getSystemHealth } = require('./system');
const { DEFAULT_REMOTE_PORT, RemoteAgentService, getLocalIPv4List } = require('./remote-agent');
const app = express();
const PORT = 3210;
const APP_VERSION = pkg.version || 'dev';
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }


    next();
});
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '../public')));
const os = require('os');
const isPkg = typeof process.pkg !== 'undefined';
const appDataDir = process.env.APPDATA || path.join(os.homedir(), '.config');
const aipcDir = path.join(appDataDir, 'aipc-agent');
if (!fs.existsSync(aipcDir)) {
    fs.mkdirSync(aipcDir, { recursive: true });
}


const TASKS_FILE = path.join(aipcDir, 'tasks.json');
const REMOTE_PROFILE_FILE = path.join(aipcDir, 'remote-profile.json');
const SOPS_DIR = path.join(aipcDir, 'sops');
const SKILLS_DIR = path.join(aipcDir, 'skills');
const PLUGINS_DIR = path.join(aipcDir, 'plugins');
const EXPS_DIR = path.join(aipcDir, 'exps');
let remoteStateTick = Date.now();
if (!fs.existsSync(SOPS_DIR)) fs.mkdirSync(SOPS_DIR, { recursive: true });
if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });
if (!fs.existsSync(EXPS_DIR)) fs.mkdirSync(EXPS_DIR, { recursive: true });

function buildDefaultRemoteProfile() {
    const machineName = process.env.COMPUTERNAME || os.hostname() || 'AI-PC';
    const userName = process.env.USERNAME || os.userInfo().username || 'User';
    const ips = getLocalIPv4List();
    return {
        machineName,
        userName,
        agentName: machineName,
        ip: ips[0] || '127.0.0.1',
        locale: 'zh-TW',
    };
}

function loadRemoteProfile() {
    const fallback = buildDefaultRemoteProfile();
    try {
        if (!fs.existsSync(REMOTE_PROFILE_FILE)) {
            fs.writeFileSync(REMOTE_PROFILE_FILE, JSON.stringify(fallback, null, 2), 'utf8');
            return fallback;
        }

        const parsed = JSON.parse(fs.readFileSync(REMOTE_PROFILE_FILE, 'utf8'));
        return {
            ...fallback,
            ...parsed,
            ip: (parsed?.ip || fallback.ip || '').trim() || fallback.ip,
        };
    } catch {
        return fallback;
    }
}

function saveRemoteProfile(profile = {}) {
    const merged = {
        ...buildDefaultRemoteProfile(),
        ...profile,
    };
    fs.writeFileSync(REMOTE_PROFILE_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
}

function getRemoteProfile() {
    const stored = loadRemoteProfile();
    const ips = getLocalIPv4List();
    const ip = stored.ip && ips.includes(stored.ip) ? stored.ip : (ips[0] || stored.ip || '127.0.0.1');
    return {
        ...stored,
        ip,
        locale: stored.locale || 'zh-TW',
    };
}

function touchRemoteState() {
    remoteStateTick = Date.now();
}
/**
 * 同步內建的腳本與技能至 AppData
 */
function syncBundledAssets() {
    try {
        const bundledSopsDir = path.join(__dirname, '..', 'sops');
        const bundledSkillsDir = path.join(__dirname, '..', 'skills');
        const syncIfChanged = (src, dest) => {
            if (!fs.existsSync(src)) return;
            if (!fs.existsSync(dest)) {
                fs.copyFileSync(src, dest);
                return;
            }


            const srcContent = fs.readFileSync(src);
            const destContent = fs.readFileSync(dest);
            if (!srcContent.equals(destContent)) {
                fs.copyFileSync(src, dest);
            }


        };
        // 同步 SOPs
        if (fs.existsSync(bundledSopsDir)) {
            const files = fs.readdirSync(bundledSopsDir).filter(f => f.endsWith('.md'));
            files.forEach(file => {
                const src = path.join(bundledSopsDir, file);
                const dest = path.join(SOPS_DIR, file);
                syncIfChanged(src, dest);
            });
        }


        // 同步 Skills
        if (fs.existsSync(bundledSkillsDir)) {
            const files = fs.readdirSync(bundledSkillsDir).filter(f => f.endsWith('.md'));
            files.forEach(file => {
                const src = path.join(bundledSkillsDir, file);
                const dest = path.join(SKILLS_DIR, file);
                syncIfChanged(src, dest);
            });
        }


        // 同步 Plugins
        const bundledPluginsDir = path.join(__dirname, '..', 'plugins');
        if (fs.existsSync(bundledPluginsDir)) {
            const files = fs.readdirSync(bundledPluginsDir).filter(f => f.endsWith('.js'));
            files.forEach(file => {
                const src = path.join(bundledPluginsDir, file);
                const dest = path.join(PLUGINS_DIR, file);
                syncIfChanged(src, dest);
            });
        }


    } catch (e) {
        console.error("[System] Failed to sync bundled assets:", e.message);
    }


}


syncBundledAssets();
const remoteAgent = new RemoteAgentService({
    port: DEFAULT_REMOTE_PORT,
    onStateChanged: () => touchRemoteState(),
    onError: (error) => fileLog(`Remote Agent Error: ${error.message}`),
    onMessage: async (session, message, payload) => {
        try {
            if (message.type !== 'chat_message') return;
            if (message.target !== 'remote-ai') return;
            const profile = getRemoteProfile();
            const history = session.messages
                .filter((item) => item.type === 'chat_message')
                .slice(-6)
                .map((item) => ({
                    role: item.senderType === 'ai' && item.direction !== 'incoming' ? 'assistant' : 'user',
                    content: `${item.senderLabel || item.senderType}: ${item.text || item.caption || ''}`.trim(),
                }));
            const aiReply = await llm.chatWithLLM(
                message.text || '',
                history,
                {
                    systemContext: [
                        `Current AI agent name: ${profile.agentName}`,
                        `Current machine name: ${profile.machineName}`,
                        `Current Windows user name: ${profile.userName}`,
                        `Current machine IP: ${profile.ip}`,
                        `Remote peer machine: ${session.peer?.machineName || 'Unknown'}`,
                        `Remote peer user: ${session.peer?.userName || 'Unknown'}`,
                        `Remote peer IP: ${session.peer?.ip || session.host || 'Unknown'}`,
                        `Current AI provider: ${llm.getCurrentProvider() || 'Unknown'}`,
                        `Current AI model: ${llm.getCurrentModel() || 'Unknown'}`,
                        `Model sharing status for this session: ${session.modelShare?.status || 'idle'}`,
                        `The current requester is: ${message.senderType === 'ai' ? 'the remote AI agent' : 'the remote human user'} (${message.senderLabel || 'Unknown'}).`,
                        `You are replying inside a remote support chat over TCP port ${DEFAULT_REMOTE_PORT}.`,
                        'If asked who is talking to you, answer whether it is the remote human or the remote AI.',
                        'If asked what model you are using, answer with the exact current provider and model shown above.',
                        'Keep replies concise, practical, and safe. If any system change is needed, ask for confirmation first.',
                    ].join('\n'),
                },
                payload?.locale || session.peer?.locale || 'zh-TW'
            );
            remoteAgent.sendChatMessage(session.id, {
                senderType: 'ai',
                senderLabel: profile.agentName,
                text: aiReply,
                target: 'remote-user',
            });
        } catch (error) {
            fileLog(`Remote AI reply failed: ${error.message}`);
            try {
                remoteAgent.sendSystemMessage(session.id, `Remote AI failed to reply: ${error.message}`);
            } catch {
                // ignore
            }
        }
    }
});
remoteAgent.start();
// ── In-memory state ─────────────────────────────────────────────────
let todoList = [];
let logs = [];
let runningSOP = null;
let chatHistory = []; // 儲存最近 6 則對話：[{role: 'user', content: '...'}, {role: 'assistant', content: '...'}]
const localChatHistoryBySession = new Map();
const sopStateCache = new Map();
const SOP_STATE_TTL_MS = 30000;
let skillDocsCache = [];
let skillDocsCacheAt = 0;
const SKILL_DOC_CACHE_TTL_MS = 30000;
function buildChatHistoryForRequest(history, hasChalkboardAttachment) {
    if (!hasChalkboardAttachment || !Array.isArray(history) || history.length === 0) {
        return Array.isArray(history) ? history : [];
    }


    const filtered = [];
    let skipAssistantReplyForImageTurn = false;
    history.forEach(entry => {
        const content = String(entry?.content || '');
        if (entry?.role === 'user' && content.includes('[User attached a Chalkboard sketch]')) {
            skipAssistantReplyForImageTurn = true;
            return;
        }


        if (skipAssistantReplyForImageTurn && entry?.role === 'assistant') {
            skipAssistantReplyForImageTurn = false;
            return;
        }


        filtered.push(entry);
    });
    return filtered;
}

function tokenizeForMatch(text = '') {
    return String(text || '')
        .toLowerCase()
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 2);
}

function loadSkillDocuments(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && skillDocsCache.length > 0 && (now - skillDocsCacheAt) < SKILL_DOC_CACHE_TTL_MS) {
        return skillDocsCache;
    }
    const docs = [];
    try {
        if (!fs.existsSync(SKILLS_DIR)) {
            skillDocsCache = [];
            skillDocsCacheAt = now;
            return skillDocsCache;
        }
        const files = fs.readdirSync(SKILLS_DIR).filter((name) => name.endsWith('.md'));
        files.forEach((name) => {
            const fullPath = path.join(SKILLS_DIR, name);
            const content = fs.readFileSync(fullPath, 'utf8');
            docs.push({
                name,
                content,
                tokens: new Set(tokenizeForMatch(`${name} ${content.slice(0, 1200)}`)),
            });
        });
    } catch (error) {
        fileLog(`Skill document load failed: ${error.message}`);
    }
    skillDocsCache = docs;
    skillDocsCacheAt = now;
    return docs;
}

function scoreByTokenSet(tokenSet = new Set(), queryTokens = []) {
    if (!queryTokens.length) return 0;
    let score = 0;
    queryTokens.forEach((token) => {
        if (tokenSet.has(token)) {
            score += 3;
            return;
        }
        if (Array.from(tokenSet).some((item) => item.includes(token) || token.includes(item))) {
            score += 1;
        }
    });
    return score;
}

function compactMarkdownSnippet(content = '', maxChars = 620) {
    return String(content || '')
        .replace(/^#.*$/gm, '')
        .replace(/^```[\s\S]*?```/gm, '')
        .replace(/[*_`>#-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
}

function buildOnDemandSkillAndSopContext(message = '', sops = [], locale = 'zh-TW') {
    const queryTokens = tokenizeForMatch(message).slice(0, 16);
    if (!queryTokens.length) return '';

    const skillDocs = loadSkillDocuments(false);
    const rankedSkills = skillDocs
        .map((doc) => ({
            doc,
            score: scoreByTokenSet(doc.tokens, queryTokens),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((item) => item.doc);

    const rankedSops = (sops || [])
        .map((sop) => {
            const tokenSet = new Set(tokenizeForMatch(`${sop.id} ${sop.name} ${sop.category} ${sop.description || ''}`));
            return {
                sop,
                score: scoreByTokenSet(tokenSet, queryTokens),
            };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((item) => item.sop);

    if (!rankedSkills.length && !rankedSops.length) {
        return locale === 'en-US'
            ? 'No direct internal skill/SOP match found. If needed, use Browser Use to fetch trusted references, then provide clear actionable steps.'
            : '目前找不到直接匹配的內建 Skill/SOP。必要時請改用 Browser Use 搜尋可信來源，再給使用者可執行步驟。';
    }

    const skillLines = rankedSkills.map((doc, index) => {
        const snippet = compactMarkdownSnippet(doc.content, 520);
        return `${index + 1}. ${doc.name}: ${snippet}`;
    });
    const sopLines = rankedSops.map((sop, index) => (
        `${index + 1}. ID=${sop.id}, Name=${sop.name}, Action=${sop.recommendedAction}, Category=${sop.category || 'N/A'}`
    ));

    const header = locale === 'en-US' ? '### On-Demand Skill/SOP Context' : '### 按需技能/SOP 情境';
    const skillHeader = locale === 'en-US' ? 'Relevant Skills' : '相關 Skills';
    const sopHeader = locale === 'en-US' ? 'Relevant SOPs' : '相關 SOPs';
    const fallbackNote = locale === 'en-US'
        ? 'If these are still insufficient, use Browser Use for web research or provide manual guidance.'
        : '若上述仍不足，請使用 Browser Use 做網路研究，或直接給使用者手動操作指引。';

    return [
        header,
        '',
        `${skillHeader}:`,
        ...(skillLines.length ? skillLines : ['- (none)']),
        '',
        `${sopHeader}:`,
        ...(sopLines.length ? sopLines : ['- (none)']),
        '',
        fallbackNote,
    ].join('\n');
}


function normalizeChalkboardAttachment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const dataUrl = typeof raw.dataUrl === 'string' ? raw.dataUrl.trim() : '';
    const mimeType = typeof raw.mimeType === 'string' ? raw.mimeType.trim() : 'image/jpeg';
    if (!dataUrl.startsWith('data:image/')) return null;
    return {
        dataUrl,
        mimeType,
        width: Number(raw.width) || 0,
        height: Number(raw.height) || 0
    };
}


function formatDateStamp(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('');
}


function escapeMarkdown(text = '') {
    return String(text)
        .replace(/\r/g, '')
        .replace(/\n/g, ' ')
        .replace(/\|/g, '\\|')
        .trim();
}


function redactSensitiveText(text = '') {
    let value = String(text || '');
    if (!value) return value;
    const rules = [
        {
            pattern: /\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|token|bearer|password|passwd|pwd|secret|client[_-]?secret)\b\s*([:=])\s*("[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi,
            replacer: (_, key, sep) => `${key}${sep} [REDACTED]`,
        },
        {
            pattern: /((?:--?|\/)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|bearer|password|passwd|pwd|secret|client[_-]?secret))\s+("[^"]*"|'[^']*'|`[^`]*`|[^\s,;]+)/gi,
            replacer: (_, key) => `${key} [REDACTED]`,
        },
        {
            pattern: /\b(Bearer)\s+[A-Za-z0-9._~+\/=-]{8,}\b/gi,
            replacer: '$1 [REDACTED]',
        },
        {
            pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi,
            replacer: '$1[REDACTED]:[REDACTED]@',
        },
        {
            pattern: /\b[A-Za-z]:(\\[^<>:"|?*\r\n]+)+/g,
            replacer: '[PATH]',
        },
        {
            pattern: /(^|[\s(])\\\\[^\\\s]+\\[^ \r\n\t)]+/g,
            replacer: '$1[PATH]',
        },
        {
            pattern: /\b(cd[\s-]?key|license[\s-]?key|product[\s-]?key|serial(?:\s+number)?|activation[\s-]?key)\b([^\r\n]{0,24}?)([A-Z0-9]{4,}(?:-[A-Z0-9]{4,}){2,})/gi,
            replacer: (_, label, between) => `${label}${between}[REDACTED]`,
        },
    ];
    rules.forEach(({ pattern, replacer }) => {
        value = value.replace(pattern, replacer);
    });
    return value;
}


function getTaskDurationText(task) {
    if (!task?.createdAt || !task?.completedAt) return 'N/A';
    const start = new Date(task.createdAt).getTime();
    const end = new Date(task.completedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'N/A';
    const seconds = Math.max(1, Math.round((end - start) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    return remainSeconds ? `${minutes}m ${remainSeconds}s` : `${minutes}m`;
}


function pickExperienceHighlights(task) {
    const sourceLogs = Array.isArray(task?.logs) ? task.logs : [];
    const interesting = [];
    const seen = new Set();
    sourceLogs.forEach(log => {
        const level = String(log?.level || '').toLowerCase();
        const message = redactSensitiveText(escapeMarkdown(log?.message || ''));
        if (!message) return;
        const isInterestingLevel = ['error', 'warn', 'success', 'ui'].includes(level);
        const hasSignalWord = /(失敗|錯誤|成功|完成|略過|跳過|uac|權限|denied|timeout|下載|安裝|verify|驗證|修復|retry|重試|already|exists)/i.test(message);
        if (!isInterestingLevel && !hasSignalWord) return;
        const dedupeKey = `${level}:${message}`;
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        interesting.push(message);
    });
    return interesting.slice(-6);
}


function buildExperienceAdvice(task, highlights) {
    const text = highlights.join('\n').toLowerCase();
    if (task.status === 'success') {
        return 'This run can be reused as the main reference for the next similar setup. Verify version, source, and permissions before repeating it.';
    }


    if (task.status === 'skipped') {
        return 'The target already appeared to exist. Run the check phase first next time to avoid duplicate installation or unnecessary actions.';
    }


    if (/uac|cancelled by user|canceled by user|權限|denied/.test(text)) {
        return 'This failure is related to permissions or UAC. Explain the need for administrator approval before the next run.';
    }


    if (/download|下載|timeout|network|連線/.test(text)) {
        return 'This failure is likely related to networking or the download phase. Check connectivity, source endpoints, and firewall rules first.';
    }


    if (/verify|經驗證/.test(text)) {
        return 'The install flow may have completed, but verification did not pass. Review whether the final verify condition actually matches the current machine.';
    }


    return 'Review the failure highlights before the next similar run, explain the risk to the user, and adjust the SOP or prerequisite checks if needed.';
}


function buildExperienceMarkdown(task, sop) {
    const completedAt = task?.completedAt ? new Date(task.completedAt) : new Date();
    const highlights = pickExperienceHighlights(task);
    const advice = redactSensitiveText(buildExperienceAdvice(task, highlights));
    const summary = task.status === 'success'
        ? 'This task completed successfully and can serve as a reference for similar future setup flows.'
        : task.status === 'skipped'
            ? 'This task was skipped because the target already existed or did not need to be repeated.'
            : 'This task did not complete successfully. Record the failure cause and pitfalls to avoid repeating them.';
    const lines = [
        `## ${completedAt.toISOString()} - ${redactSensitiveText(escapeMarkdown(task.title || sop?.name || task.id))}`,
        '',
        `- Task ID: \`${redactSensitiveText(escapeMarkdown(task.id || ''))}\``,
        `- SOP ID: \`${redactSensitiveText(escapeMarkdown(task.skillId || sop?.id || 'dynamic'))}\``,
        `- Status: \`${redactSensitiveText(escapeMarkdown(task.status || 'unknown'))}\``,
        `- Duration: ${getTaskDurationText(task)}`,
        `- Summary: ${redactSensitiveText(summary)}`,
        `- Advice: ${advice}`,
        ''
    ];
    if (highlights.length > 0) {
        lines.push('### Highlights', '');
        highlights.forEach(item => lines.push(`- ${item}`));
        lines.push('');
    }


    return lines.join('\n');
}


function buildExperienceAIPrompt(task, sop) {
    const highlights = pickExperienceHighlights(task);
    return [
        'Summarize the following Windows setup or installation run into a compact veteran memo.',
        'Rules:',
        '1. Write in English.',
        '2. Output 3 to 5 flat bullets.',
        '3. Every bullet must be actionable and specific.',
        '4. Prioritize pitfalls, success conditions, and a better sequence for the next run.',
        '5. Do not repeat the task title.',
        '',
        `Task: ${redactSensitiveText(task.title || sop?.name || task.id)}`,
        `SOP ID: ${redactSensitiveText(task.skillId || sop?.id || 'dynamic')}`,
        `Status: ${redactSensitiveText(task.status || 'unknown')}`,
        `Duration: ${getTaskDurationText(task)}`,
        'Highlights:',
        ...(highlights.length > 0 ? highlights.map(item => `- ${redactSensitiveText(item)}`) : ['- (no notable logs)'])
    ].join('\n');
}


async function enrichTaskExperienceWithAI(task, sop, expPath) {
    try {
        const llmStatus = await llm.checkOllamaStatus();
        if (!llmStatus.available || !llmStatus.modelReady) return;
        const aiReply = await llm.chatWithLLM(buildExperienceAIPrompt(task, sop), []);
        const cleaned = redactSensitiveText(String(aiReply || '').trim());
        if (!cleaned) return;
        fs.appendFileSync(expPath, `### Veteran Notes\n${cleaned}\n\n`, 'utf8');
    } catch (err) {
        console.warn('[EXP] AI experience summary generation failed:', err.message);
        fileLog(`EXP veteran summary failed: ${err.message}`);
    }


}


function appendTaskExperience(task, sop) {
    try {
        const stamp = formatDateStamp(task?.completedAt ? new Date(task.completedAt) : new Date());
        const expPath = path.join(EXPS_DIR, `exp-${stamp}.md`);
        if (!fs.existsSync(expPath)) {
            fs.writeFileSync(expPath, `# AI PC Agent Experience Log - ${stamp}\n\n`, 'utf8');
        }


        fs.appendFileSync(expPath, `${buildExperienceMarkdown(task, sop)}\n`, 'utf8');
        enrichTaskExperienceWithAI(task, sop, expPath);
    } catch (err) {
        console.error('[EXP] Failed to write experience log:', err.message);
        fileLog(`EXP write failed: ${err.message}`);
    }


}


function loadExperienceContext(queryText = '', limit = 3) {
    try {
        if (!fs.existsSync(EXPS_DIR)) return '';
        const files = fs.readdirSync(EXPS_DIR)
            .filter(name => /^exp-\d{8}\.md$/i.test(name))
            .sort()
            .reverse()
            .slice(0, 10)
            .map(name => ({ dir: EXPS_DIR, name }));
        if (files.length === 0) return '';
        const tokens = String(queryText || '')
            .toLowerCase()
            .split(/[\s,.;:!?，。；：、「」『』（）()【】\-\_\/\\]+/)
            .filter(token => token.length >= 2);
        const sections = [];
        files.forEach(file => {
            const fullText = fs.readFileSync(path.join(file.dir, file.name), 'utf8');
            fullText.split(/\n(?=## )/).forEach(section => {
                const trimmed = section.trim();
                if (trimmed.startsWith('## ')) sections.push(trimmed);
            });
        });
        const scored = sections.map(section => {
            const lower = section.toLowerCase();
            const score = tokens.reduce((sum, token) => sum + (lower.includes(token) ? 1 : 0), 0);
            return { section, score };
        });
        const selected = scored
            .sort((a, b) => b.score - a.score)
            .filter((item, index) => item.score > 0 || index < limit)
            .slice(0, limit)
            .map(item => {
                const section = item.section.length > 900 ? `${item.section.slice(0, 900)}...` : item.section;
                return redactSensitiveText(section);
            });
        return selected.join('\n\n');
    } catch (err) {
        console.error('[EXP] Failed to load experience log:', err.message);
        return '';
    }


}


function loadExperienceEntries(limit = 18) {
    if (!fs.existsSync(EXPS_DIR)) return [];
    const files = fs.readdirSync(EXPS_DIR)
        .filter(name => /^exp-\d{8}\.md$/i.test(name))
        .map((fileName) => {
            const fullPath = path.join(EXPS_DIR, fileName);
            const stats = fs.statSync(fullPath);
            return { fileName, fullPath, updatedAt: stats.mtime.toISOString() };
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const entries = [];
    files.forEach((file) => {
        const content = fs.readFileSync(file.fullPath, 'utf8');
        const sections = content.split(/\n(?=## )/).map(section => section.trim()).filter(Boolean);
        sections.forEach((section) => {
            if (!section.startsWith('## ')) return;
            const lines = section.split('\n');
            const title = lines[0].replace(/^##\s*/, '').trim();
            const body = lines.slice(1).join('\n').trim();
            const sopMatch = body.match(/- SOP ID:\s*`([^`]+)`/i);
            
            // Extract timestamp from title (format: "YYYY-MM-DDTHH:mm:ss.sssZ - Task Title")
            const timestampMatch = title.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s*-\s*/);
            const entryTimestamp = timestampMatch ? timestampMatch[1] : file.updatedAt;
            
            entries.push({
                fileName: file.fileName,
                updatedAt: entryTimestamp,
                title: redactSensitiveText(title),
                content: redactSensitiveText(body),
                sopId: sopMatch ? redactSensitiveText(sopMatch[1]) : ''
            });
        });
    });
    
    // Sort all entries by their actual timestamps (newest first)
    entries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    
    return entries.slice(0, limit);
}

function buildTaskTitle(sop, action = 'install') {
    if (!sop) return 'Unnamed Task';
    if (action === 'uninstall') {
        const normalizedName = String(sop.name || sop.id || '')
            .replace(/^[^\p{L}\p{N}]+/u, '')
            .replace(/^安裝\s*/u, '')
            .replace(/^下載\s*/u, '')
            .replace(/^Install\s+/gi, '')
            .replace(/^Download\s+/gi, '')
            .trim();
        return `🗑️ Uninstall ${normalizedName}`;
    }


    return `📦 ${sop.name}`;
}

function buildLocalAgentContext(sessionSummary = null) {
    const profile = getRemoteProfile();
    const sharedProvider = sessionSummary?.status === 'active' && sessionSummary?.modelShare?.status === 'active' && sessionSummary?.modelShare?.role === 'consumer'
        ? (sessionSummary.modelShare.provider || sessionSummary.peer || null)
        : null;
    const lines = [
        `Current AI agent name: ${profile.agentName}`,
        `Current machine name: ${profile.machineName}`,
        `Current Windows user name: ${profile.userName}`,
        `Current machine IP: ${profile.ip}`,
        `Current AI provider: ${llm.getCurrentProvider() || 'Unknown'}`,
        `Current AI model: ${llm.getCurrentModel() || 'Unknown'}`,
    ];

    if (sessionSummary?.peer) {
        lines.push(`Connected remote machine name: ${sessionSummary.peer.machineName || 'Unknown'}`);
        lines.push(`Connected remote user name: ${sessionSummary.peer.userName || 'Unknown'}`);
        lines.push(`Connected remote AI name: ${sessionSummary.peer.agentName || 'Unknown'}`);
        lines.push(`Connected remote IP: ${sessionSummary.peer.ip || sessionSummary.host || 'Unknown'}`);
        lines.push(`Remote model sharing status: ${sessionSummary.modelShare?.status || 'idle'}`);
        lines.push(`Remote model sharing role: ${sessionSummary.modelShare?.role || 'none'}`);
    }

    if (sharedProvider) {
        lines.push(`Shared model provider machine: ${sharedProvider.machineName || 'Unknown'}`);
        lines.push(`Shared model provider AI: ${sharedProvider.agentName || 'Unknown'}`);
        lines.push(`Shared model token expires at: ${sessionSummary.modelShare?.expiresAt || 'Unknown'}`);
    }

    return lines.join('\n');
}

function getRemoteSessionById(sessionId = '') {
    return remoteAgent.getSession(sessionId) || null;
}

function getSharedModelSession(preferredSessionId = '') {
    const sessions = remoteAgent.getState().sessions
        .filter((item) => {
            if (!(item.status === 'active' && item.modelShare?.status === 'active' && item.modelShare?.role === 'consumer')) {
                return false;
            }
            const expiresAtMs = Date.parse(String(item.modelShare?.expiresAt || ''));
            return Number.isNaN(expiresAtMs) || expiresAtMs <= 0 || Date.now() <= expiresAtMs;
        })
        .sort((a, b) => new Date(b.lastEventAt || 0).getTime() - new Date(a.lastEventAt || 0).getTime());
    if (preferredSessionId) {
        const preferred = sessions.find((item) => item.id === preferredSessionId);
        if (preferred) return preferred;
    }
    return sessions[0] || null;
}

async function proxyChatToSharedRemoteModel({ session, message, history = [], systemContext = '', locale = 'zh-TW', chalkboardAttachment = null }) {
    const peerHost = session?.peer?.ip || session?.host;
    const proxyToken = session?.modelShare?.proxyToken || '';
    if (!peerHost) {
        throw new Error('Shared model session is missing peer IP.');
    }
    if (!proxyToken) {
        throw new Error('Shared model session is missing authorization token.');
    }

    const response = await fetch(`http://${peerHost}:3210/api/remote/model-proxy/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-AIPC-Model-Share-Token': proxyToken,
        },
        body: JSON.stringify({
            sessionId: session.id,
            message,
            history,
            locale,
            systemContext,
            chalkboard: chalkboardAttachment || null,
            token: proxyToken,
        }),
        signal: AbortSignal.timeout(180000),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Remote shared model failed (${response.status}): ${text.slice(0, 160)}`);
    }

    return response.json();
}


function hasLikelySopForMessage(message = '', sops = []) {
    const text = String(message || '').toLowerCase();
    return sops.some((sop) => {
        const normalized = String(sop?.name || '')
            .replace(/^[^\p{L}\p{N}]+/gu, ' ')
            .replace(/安裝|解除安裝|下載/gu, ' ')
            .toLowerCase();
        const tokens = normalized.split(/[\s()\-_/]+/).filter(token => token.length >= 3);
        return tokens.some(token => text.includes(token));
    });
}


function extractWingetSearchQuery(message = '') {
    const text = String(message || '').toLowerCase();
    const keywordMap = [
        { pattern: /(繪圖|畫圖|畫畫|插畫|繪畫|drawing|paint|sketch)/i, query: 'drawing' },
        { pattern: /(修圖|影像|圖片編輯|image|photo|edit)/i, query: 'image editor' },
        { pattern: /(影片|剪輯|video|editor)/i, query: 'video editor' },
        { pattern: /(筆記|note|markdown)/i, query: 'notes' },
        { pattern: /(瀏覽器|browser)/i, query: 'browser' },
        { pattern: /(解壓縮|壓縮|zip|rar|archive)/i, query: 'archive' },
        { pattern: /(遠端|remote desktop|rdp)/i, query: 'remote desktop' },
    ];
    const mapped = keywordMap.find(entry => entry.pattern.test(text));
    if (mapped) return mapped.query;
    const cleaned = text
        .replace(/請|幫我|想找|想要|推薦|建議|值得|有什麼|有哪些|可以|軟體|app|工具|程式|應用|下載|安裝/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'software';
}


function parseWingetSearchOutput(output = '') {
    const lines = String(output || '').split(/\r?\n/).map(line => line.trimEnd()).filter(Boolean);
    const packages = [];
    let tableStarted = false;
    for (const line of lines) {
        if (/^-{3,}/.test(line.replace(/\s/g, ''))) {
            tableStarted = true;
            continue;
        }


        if (!tableStarted) continue;
        if (/^The following packages/i.test(line) || /^No package found/i.test(line)) continue;
        const match = line.match(/^(.*?)\s{2,}([A-Za-z0-9][A-Za-z0-9._-]+)\s{2,}(\S+)\s{2,}(\S+)(?:\s{2,}(\S+))?$/);
        if (!match) continue;
        const [, name, id, version, matchType, source] = match;
        packages.push({
            name: name.trim(),
            id: id.trim(),
            version: version.trim(),
            matchType: matchType.trim(),
            source: (source || '').trim() || 'winget',
        });
    }


    return packages;
}


function searchWingetPackages(query, limit = 8) {
    return searchWingetPackagesBySource(query, 'winget', limit);
}


function slugifyWingetPackage(input = '') {
    return String(input || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'package';
}


function escapeRegExp(text = '') {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runPowerShellCapture(command, timeoutMs = 15000) {
    const wrapped = [
        '$utf8NoBom = New-Object System.Text.UTF8Encoding($false)',
        '[Console]::InputEncoding = $utf8NoBom',
        '[Console]::OutputEncoding = $utf8NoBom',
        '$OutputEncoding = $utf8NoBom',
        '$ErrorActionPreference = "Stop"',
        command,
    ].join('; ');
    const result = spawnSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command', wrapped,
    ], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: timeoutMs,
    });
    return {
        success: result.status === 0 && !result.error,
        status: result.status,
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
        error: result.error ? result.error.message : '',
    };
}

function runPowerShellJson(command, timeoutMs = 15000) {
    const output = runPowerShellCapture(command, timeoutMs);
    if (!output.success) return { success: false, error: output.error || output.stderr || 'PowerShell failed', data: null };
    try {
        return { success: true, data: JSON.parse(output.stdout), error: '' };
    } catch (err) {
        return { success: false, data: null, error: `JSON parse failed: ${err.message}` };
    }
}

function escapePowerShellSingleQuoted(value = '') {
    return String(value).replace(/'/g, "''");
}

function detectAgentFinanceIntent(message = '') {
    const text = String(message || '');
    const hasWorkbook = /\.xlsx\b/i.test(text);
    const hasFinance = /(財報|earnings|financial report|quarterly results|季報|年報)/i.test(text);
    const hasUpdateAction = /(更新|update|填入|填寫|整理|refresh|sync)/i.test(text);
    return hasWorkbook && hasFinance && hasUpdateAction;
}

function detectGameResearchIntent(message = '') {
    const text = String(message || '');
    return /(攻略|教學|打法|build|walkthrough|guide|影片|youtube|video)/i.test(text)
        && /(遊戲|game|steam|boss|關卡|任務|角色|配裝)/i.test(text);
}

function extractWorkbookTarget(message = '') {
    const text = String(message || '').trim();
    const absoluteMatch = text.match(/[A-Za-z]:\\[^"'<>|?*\r\n]+\.xlsx/);
    if (absoluteMatch) return absoluteMatch[0].trim();

    const quotedMatch = text.match(/["“”']([^"“”']+\.xlsx)["“”']/i);
    if (quotedMatch) return quotedMatch[1].trim();

    const genericMatch = text.match(/([^\s"'“”]+\.xlsx)\b/i);
    if (genericMatch) return genericMatch[1].trim();

    return '財報.xlsx';
}

function resolveWorkbookPath(target = '') {
    const raw = String(target || '').trim();
    if (!raw) return '';
    if (path.isAbsolute(raw) && fs.existsSync(raw)) {
        return raw;
    }
    const maybeRelative = path.resolve(process.cwd(), raw);
    if (fs.existsSync(maybeRelative)) {
        return maybeRelative;
    }
    const fileName = path.basename(raw);
    const escapedName = escapePowerShellSingleQuoted(fileName);
    const cmd = [
        `$fileName = '${escapedName}'`,
        '$roots = @(',
        "  [Environment]::GetFolderPath('Desktop'),",
        "  [Environment]::GetFolderPath('MyDocuments'),",
        "  \"$env:USERPROFILE\\Downloads\"",
        ') | Where-Object { $_ -and (Test-Path -LiteralPath $_) }',
        '$hit = $null',
        'foreach ($root in $roots) {',
        '  $hit = Get-ChildItem -LiteralPath $root -Filter $fileName -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1',
        '  if ($hit) { break }',
        '}',
        'if ($hit) { $hit.FullName }',
    ].join('; ');
    const found = runPowerShellCapture(cmd, 20000);
    return found.success ? String(found.stdout || '').trim() : '';
}

function detectSpreadsheetEnvironment() {
    const cmd = [
        '$excel = Get-Command EXCEL.EXE -ErrorAction SilentlyContinue',
        '$libre = Get-Command soffice.exe -ErrorAction SilentlyContinue',
        '$wps = Get-Command et.exe -ErrorAction SilentlyContinue',
        '$obj = [PSCustomObject]@{',
        '  excel = [bool]$excel;',
        '  libreoffice = [bool]$libre;',
        '  wps = [bool]$wps;',
        "  preferred = if ($excel) { 'excel' } elseif ($libre) { 'libreoffice' } elseif ($wps) { 'wps' } else { 'none' }",
        '}',
        '$obj | ConvertTo-Json -Compress',
    ].join('; ');
    const output = runPowerShellJson(cmd, 12000);
    return output.success ? output.data : { excel: false, libreoffice: false, wps: false, preferred: 'none' };
}

function openFileWithDefaultApp(filePath = '') {
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    const escaped = escapePowerShellSingleQuoted(filePath);
    return runPowerShellCapture(`Start-Process -FilePath '${escaped}'`, 8000);
}

function openUrlInDefaultBrowser(url = '') {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) return { success: false, error: 'Invalid URL' };
    const escaped = escapePowerShellSingleQuoted(target);
    return runPowerShellCapture(`Start-Process -FilePath '${escaped}'`, 8000);
}

async function fetchNvidiaLatestFinancialSnapshot() {
    const cik = '0001045810';
    const headers = {
        'User-Agent': 'aipc-agent/2026.04.01 (local desktop agent)',
        'Accept': 'application/json',
    };
    const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
        throw new Error(`SEC API failed (${response.status})`);
    }
    const json = await response.json();
    const facts = json?.facts?.['us-gaap'] || {};
    const revenueSeries = facts?.RevenueFromContractWithCustomerExcludingAssessedTax?.units?.USD
        || facts?.Revenues?.units?.USD
        || [];
    const incomeSeries = facts?.NetIncomeLoss?.units?.USD || [];
    const epsSeries = facts?.EarningsPerShareDiluted?.units?.USD || [];
    const pickLatest = (series = []) => {
        return [...series]
            .filter((item) => item?.val !== undefined && item?.end)
            .sort((a, b) => {
                const aTime = Date.parse(a.end || a.filed || 0);
                const bTime = Date.parse(b.end || b.filed || 0);
                return bTime - aTime;
            })[0] || null;
    };
    const revenue = pickLatest(revenueSeries);
    const netIncome = pickLatest(incomeSeries);
    const eps = pickLatest(epsSeries);
    return {
        company: 'NVIDIA',
        periodEnd: revenue?.end || netIncome?.end || '',
        filedAt: revenue?.filed || netIncome?.filed || '',
        revenue: Number(revenue?.val || 0),
        netIncome: Number(netIncome?.val || 0),
        epsDiluted: eps?.val !== undefined ? Number(eps.val) : null,
        source: 'SEC Company Facts API',
        sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
    };
}

function formatUsdBillions(value = 0) {
    const amount = Number(value || 0);
    if (!Number.isFinite(amount)) return 'N/A';
    return `$${(amount / 1_000_000_000).toFixed(2)}B`;
}

function buildNvidiaSnapshotLines(snapshot = {}) {
    const periodLabel = snapshot.periodEnd || 'N/A';
    const filedLabel = snapshot.filedAt || 'N/A';
    return [
        `Period End: ${periodLabel}`,
        `Filed Date: ${filedLabel}`,
        `Revenue: ${formatUsdBillions(snapshot.revenue)}`,
        `Net Income: ${formatUsdBillions(snapshot.netIncome)}`,
        `Diluted EPS: ${snapshot.epsDiluted === null ? 'N/A' : snapshot.epsDiluted}`,
        `Source: ${snapshot.source || 'N/A'}`,
    ];
}

function updateWorkbookWithExcelComSnapshot(filePath = '', snapshot = {}) {
    const escapedPath = escapePowerShellSingleQuoted(filePath);
    const lines = buildNvidiaSnapshotLines(snapshot)
        .map((line) => `'${escapePowerShellSingleQuoted(line)}'`)
        .join(', ');
    const cmd = [
        `$target = '${escapedPath}'`,
        'if (-not (Test-Path -LiteralPath $target)) { throw "Workbook not found." }',
        '$excel = $null',
        'try {',
        '  $excel = New-Object -ComObject Excel.Application',
        '  $excel.Visible = $false',
        '  $excel.DisplayAlerts = $false',
        '  $wb = $excel.Workbooks.Open($target)',
        '  $ws = $wb.Worksheets.Item(1)',
        "  $ws.Range('A1').Value2 = 'NVIDIA Latest Earnings Update'",
        `  $payload = @(${lines})`,
        '  for ($i = 0; $i -lt $payload.Count; $i++) {',
        "    $ws.Cells.Item($i + 2, 1).Value2 = $payload[$i]",
        '  }',
        "  $ws.Range('A1:A20').EntireColumn.AutoFit() | Out-Null",
        '  $wb.Save()',
        '  $wb.Close($true)',
        "  [PSCustomObject]@{ success = $true; message = 'Workbook updated' } | ConvertTo-Json -Compress",
        '} catch {',
        "  [PSCustomObject]@{ success = $false; message = ($_ | Out-String).Trim() } | ConvertTo-Json -Compress",
        '} finally {',
        '  if ($excel -ne $null) {',
        '    $excel.Quit()',
        '    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)',
        '  }',
        '}',
    ].join('; ');
    return runPowerShellJson(cmd, 60000);
}

function updateWorkbookWithWpsComSnapshot(filePath = '', snapshot = {}) {
    const escapedPath = escapePowerShellSingleQuoted(filePath);
    const lines = buildNvidiaSnapshotLines(snapshot)
        .map((line) => `'${escapePowerShellSingleQuoted(line)}'`)
        .join(', ');
    const cmd = [
        `$target = '${escapedPath}'`,
        'if (-not (Test-Path -LiteralPath $target)) { throw "Workbook not found." }',
        '$app = $null',
        'try {',
        '  $app = New-Object -ComObject ket.Application',
        '  $app.Visible = $false',
        '  $app.DisplayAlerts = $false',
        '  $wb = $app.Workbooks.Open($target)',
        '  $ws = $wb.Worksheets.Item(1)',
        "  $ws.Range('A1').Value2 = 'NVIDIA Latest Earnings Update'",
        `  $payload = @(${lines})`,
        '  for ($i = 0; $i -lt $payload.Count; $i++) {',
        "    $ws.Cells.Item($i + 2, 1).Value2 = $payload[$i]",
        '  }',
        "  $ws.Range('A1:A20').EntireColumn.AutoFit() | Out-Null",
        '  $wb.Save()',
        '  $wb.Close($true)',
        "  [PSCustomObject]@{ success = $true; method = 'wps-com'; message = 'Workbook updated with WPS COM' } | ConvertTo-Json -Compress",
        '} catch {',
        "  [PSCustomObject]@{ success = $false; method = 'wps-com'; message = ($_ | Out-String).Trim() } | ConvertTo-Json -Compress",
        '} finally {',
        '  if ($app -ne $null) {',
        '    $app.Quit()',
        '    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)',
        '  }',
        '}',
    ].join('; ');
    return runPowerShellJson(cmd, 60000);
}

function updateWorkbookWithOpenXmlSnapshot(filePath = '', snapshot = {}) {
    const escapedPath = escapePowerShellSingleQuoted(filePath);
    const lines = [
        'NVIDIA Latest Earnings Update',
        ...buildNvidiaSnapshotLines(snapshot),
    ].map((line) => `'${escapePowerShellSingleQuoted(line)}'`).join(', ');
    const cmd = [
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        `$target = '${escapedPath}'`,
        'if (-not (Test-Path -LiteralPath $target)) { throw "Workbook not found." }',
        '$zip = [System.IO.Compression.ZipFile]::Open($target, [System.IO.Compression.ZipArchiveMode]::Update)',
        'try {',
        "  $entry = $zip.GetEntry('xl/worksheets/sheet1.xml')",
        "  if (-not $entry) { throw 'sheet1.xml not found in workbook' }",
        '  $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)',
        '  $xmlText = $reader.ReadToEnd()',
        '  $reader.Close()',
        '  [xml]$doc = $xmlText',
        "  $ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)",
        "  $ns.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')",
        "  $sheetData = $doc.SelectSingleNode('//x:worksheet/x:sheetData', $ns)",
        "  if (-not $sheetData) { throw 'sheetData missing' }",
        `  $payload = @(${lines})`,
        '  for ($i = 0; $i -lt $payload.Count; $i++) {',
        '    $rowIndex = $i + 1',
        "    $cellRef = 'A' + $rowIndex",
        "    $rowNode = $sheetData.SelectSingleNode(\"x:row[@r='$rowIndex']\", $ns)",
        '    if (-not $rowNode) {',
        "      $rowNode = $doc.CreateElement('row', $ns.LookupNamespace('x'))",
        "      $rowNode.SetAttribute('r', [string]$rowIndex)",
        '      [void]$sheetData.AppendChild($rowNode)',
        '    }',
        "    $cellNode = $rowNode.SelectSingleNode(\"x:c[@r='$cellRef']\", $ns)",
        '    if (-not $cellNode) {',
        "      $cellNode = $doc.CreateElement('c', $ns.LookupNamespace('x'))",
        "      $cellNode.SetAttribute('r', $cellRef)",
        "      $cellNode.SetAttribute('t', 'inlineStr')",
        '      [void]$rowNode.AppendChild($cellNode)',
        '    } else {',
        "      $cellNode.SetAttribute('t', 'inlineStr')",
        '      while ($cellNode.HasChildNodes) { [void]$cellNode.RemoveChild($cellNode.FirstChild) }',
        '    }',
        "    $isNode = $doc.CreateElement('is', $ns.LookupNamespace('x'))",
        "    $tNode = $doc.CreateElement('t', $ns.LookupNamespace('x'))",
        '    $tNode.InnerText = [string]$payload[$i]',
        '    [void]$isNode.AppendChild($tNode)',
        '    [void]$cellNode.AppendChild($isNode)',
        '  }',
        '$newXml = $doc.OuterXml',
        '$entry.Delete()',
        "$newEntry = $zip.CreateEntry('xl/worksheets/sheet1.xml')",
        '$writer = New-Object System.IO.StreamWriter($newEntry.Open(), [System.Text.Encoding]::UTF8)',
        '$writer.Write($newXml)',
        '$writer.Flush()',
        '$writer.Close()',
        "  [PSCustomObject]@{ success = $true; method = 'openxml'; message = 'Workbook updated with OpenXML' } | ConvertTo-Json -Compress",
        '} catch {',
        "  [PSCustomObject]@{ success = $false; method = 'openxml'; message = ($_ | Out-String).Trim() } | ConvertTo-Json -Compress",
        '} finally {',
        '  $zip.Dispose()',
        '}',
    ].join('; ');
    return runPowerShellJson(cmd, 60000);
}

function updateWorkbookWithNvidiaSnapshot(filePath = '', snapshot = {}, env = {}) {
    const resultBag = [];
    if (env.excel) {
        const excelResult = updateWorkbookWithExcelComSnapshot(filePath, snapshot);
        resultBag.push(excelResult);
        if (excelResult.success && excelResult.data?.success) return excelResult;
    }
    if (env.wps) {
        const wpsResult = updateWorkbookWithWpsComSnapshot(filePath, snapshot);
        resultBag.push(wpsResult);
        if (wpsResult.success && wpsResult.data?.success) return wpsResult;
    }
    const openXmlResult = updateWorkbookWithOpenXmlSnapshot(filePath, snapshot);
    resultBag.push(openXmlResult);
    if (openXmlResult.success && openXmlResult.data?.success) return openXmlResult;
    return {
        success: false,
        data: { success: false, message: resultBag.map((item) => item?.data?.message || item?.error).filter(Boolean).join(' | ') || 'Workbook update failed' },
        error: 'Workbook update failed',
    };
}

function parseActionArg(actionStr = '', key = '') {
    const regex = new RegExp(`${key}="(.*?)"`);
    const match = String(actionStr || '').match(regex);
    return match ? match[1] : '';
}

function buildModelCapabilityProfile() {
    const model = llm.getCurrentModel();
    const provider = llm.getCurrentProvider();
    const hasVision = llm.modelSupportsVision(model) || llm.modelSupportsVision(llm.getCurrentVisionModel() || '');
    const isTopTier = /(gpt-5|gpt-4\.1|claude-sonnet-4|claude-opus|gemini-2\.5|qwen.*vl|llama-3\.2-90b-vision|phi-4-multimodal)/i.test(
        `${provider} ${model} ${llm.getCurrentVisionModel() || ''}`
    );
    return {
        provider,
        model,
        hasVision,
        isTopTier,
        canUseAdvancedAgent: hasVision && isTopTier,
    };
}

async function runBrowserUseOperation(params = {}) {
    const mode = String(params.mode || '').toLowerCase();
    if (mode === 'open') {
        return {
            success: openUrlInDefaultBrowser(params.url).success,
            mode,
            openedUrl: params.url || '',
        };
    }
    if (mode === 'search') {
        const query = String(params.query || '').trim();
        const results = await searchWebLinks(query, Math.min(10, Number(params.limit) || 5));
        return {
            success: true,
            mode,
            query,
            results,
        };
    }
    if (mode === 'fetch_title') {
        const url = String(params.url || '').trim();
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'aipc-agent/2026.04.01' },
            signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error(`fetch failed (${response.status})`);
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        return {
            success: true,
            mode,
            url,
            title: decodeHtmlEntities((titleMatch?.[1] || '').trim()),
        };
    }
    return { success: false, mode, error: 'Unsupported browser mode' };
}

function detectVirtualBoxStatus() {
    const cmd = [
        '$vbox = Get-Command VBoxManage.exe -ErrorAction SilentlyContinue',
        '$obj = [PSCustomObject]@{',
        '  installed = [bool]$vbox;',
        "  executable = if ($vbox) { $vbox.Source } else { '' }",
        "  hypervisor = if ($vbox) { 'virtualbox' } else { 'none' }",
        '}',
        '$obj | ConvertTo-Json -Compress',
    ].join('; ');
    const output = runPowerShellJson(cmd, 10000);
    if (!output.success || !output.data) {
        return { installed: false, executable: '', hypervisor: 'none' };
    }
    return output.data;
}

function runComputerUseOperation(params = {}, sopsWithState = []) {
    const vmSafeByDefault = params.vmSafeByDefault !== false;
    const mode = String(params.mode || '').toLowerCase();
    if (mode === 'prepare_vm_sandbox') {
        const vmStatus = detectVirtualBoxStatus();
        if (vmStatus.installed) {
            return {
                success: true,
                mode,
                vm: vmStatus,
                message: 'VM sandbox is ready.',
            };
        }
        const existing = sopsWithState.find((item) => /virtualbox|vm/i.test(`${item.id} ${item.name}`));
        if (existing) {
            const task = {
                id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                title: buildTaskTitle(existing, existing.recommendedAction),
                description: 'Scheduled by Computer Use (VM sandbox prep)',
                skillId: existing.id,
                action: existing.recommendedAction,
                category: existing.category || 'Maintenance',
                status: 'pending',
                progress: 0,
                logs: [],
                createdAt: new Date().toISOString(),
            };
            todoList.push(task);
            saveTasks();
            return {
                success: true,
                mode,
                vm: vmStatus,
                taskId: task.id,
                sopId: existing.id,
                message: 'Queued VM install task via existing SOP.',
            };
        }
        const generated = createWingetSopFile({
            id: 'Oracle.VirtualBox',
            name: 'Oracle VM VirtualBox',
        });
        return {
            success: true,
            mode,
            vm: vmStatus,
            generatedSop: generated.fileName,
            message: 'Generated VirtualBox install SOP. Please approve installation before Computer Use executes inside VM.',
        };
    }
    if (mode === 'open_file') {
        if (vmSafeByDefault) {
            return {
                success: false,
                mode,
                error: 'Direct host file open blocked. Use prepare_vm_sandbox first or set vmSafeByDefault=false explicitly.',
            };
        }
        const result = openFileWithDefaultApp(params.filePath || params.file_path || '');
        return { success: result.success, mode, detail: result.stderr || result.error || '' };
    }
    if (mode === 'open_url') {
        if (vmSafeByDefault) {
            return {
                success: false,
                mode,
                error: 'Direct host browser open blocked. Use Browser Use or VM sandbox flow first.',
            };
        }
        const result = openUrlInDefaultBrowser(params.url || '');
        return { success: result.success, mode, detail: result.stderr || result.error || '' };
    }
    if (mode === 'install_sop') {
        const sopId = String(params.sopId || params.sop_id || '').trim();
        const targetSop = sopsWithState.find((item) => item.id === sopId);
        if (!targetSop) return { success: false, mode, error: `SOP not found: ${sopId}` };
        const task = {
            id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            title: buildTaskTitle(targetSop, targetSop.recommendedAction),
            description: 'Scheduled by Computer Use',
            skillId: targetSop.id,
            action: targetSop.recommendedAction,
            category: targetSop.category || 'Maintenance',
            status: 'pending',
            progress: 0,
            logs: [],
            createdAt: new Date().toISOString(),
        };
        todoList.push(task);
        saveTasks();
        return { success: true, mode, taskId: task.id, sopId: targetSop.id };
    }
    return { success: false, mode, error: 'Unsupported computer mode' };
}

function decodeHtmlEntities(value = '') {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function normalizeDuckDuckGoUrl(url = '') {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^\/l\/\?/.test(raw)) {
        try {
            const parsed = new URL(`https://duckduckgo.com${raw}`);
            const target = parsed.searchParams.get('uddg');
            if (target) return decodeURIComponent(target);
        } catch {
            return '';
        }
    }
    if (raw.startsWith('//')) return `https:${raw}`;
    if (/^https?:\/\//i.test(raw)) return raw;
    return '';
}

async function searchWebLinks(query = '', limit = 5) {
    const q = String(query || '').trim();
    if (!q) return [];
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'aipc-agent/2026.04.01',
            'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
        throw new Error(`Web search failed (${response.status})`);
    }
    const html = await response.text();
    const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const results = [];
    let match;
    while ((match = regex.exec(html)) !== null) {
        const href = normalizeDuckDuckGoUrl(decodeHtmlEntities(match[1]));
        const title = decodeHtmlEntities(match[2].replace(/<[^>]+>/g, '').trim());
        if (!href || !title) continue;
        results.push({ title, url: href });
        if (results.length >= limit) break;
    }
    return results;
}

function extractYouTubeVideoIdFromUrl(inputUrl = '') {
    try {
        const url = new URL(String(inputUrl || '').trim());
        const host = url.hostname.replace(/^www\./i, '').toLowerCase();
        if (host === 'youtu.be') {
            const id = url.pathname.replace(/^\/+/g, '').split('/')[0];
            return id || '';
        }
        if (host.endsWith('youtube.com')) {
            if (url.pathname === '/watch') {
                return String(url.searchParams.get('v') || '').trim();
            }
            if (/^\/shorts\//.test(url.pathname)) {
                return url.pathname.split('/')[2] || '';
            }
            if (/^\/embed\//.test(url.pathname)) {
                return url.pathname.split('/')[2] || '';
            }
        }
    } catch {
        return '';
    }
    return '';
}

function normalizeYouTubeWatchUrl(inputUrl = '') {
    const videoId = extractYouTubeVideoIdFromUrl(inputUrl);
    if (!videoId) return '';
    return `https://www.youtube.com/watch?v=${videoId}`;
}

async function isYouTubeVideoPlayable(watchUrl = '') {
    const normalized = normalizeYouTubeWatchUrl(watchUrl);
    if (!normalized) return false;
    try {
        const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`;
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: { 'User-Agent': 'aipc-agent/2026.04.02' },
            signal: AbortSignal.timeout(10000),
        });
        return response.ok;
    } catch {
        return false;
    }
}

async function searchPlayableYouTubeVideos(topic = '', limit = 5) {
    const query = String(topic || '').trim();
    if (!query) return [];
    const candidates = await searchWebLinks(`${query} site:youtube.com/watch`, 16);
    const unique = new Map();
    candidates.forEach((item) => {
        const watchUrl = normalizeYouTubeWatchUrl(item.url);
        if (!watchUrl) return;
        const id = extractYouTubeVideoIdFromUrl(watchUrl);
        if (!id) return;
        if (!unique.has(id)) {
            unique.set(id, { title: item.title, url: watchUrl });
        }
    });

    const playable = [];
    for (const entry of unique.values()) {
        const ok = await isYouTubeVideoPlayable(entry.url);
        if (!ok) continue;
        playable.push(entry);
        if (playable.length >= limit) break;
    }
    return playable;
}

function extractGameTopic(message = '') {
    const text = String(message || '').trim();
    const cleaned = text
        .replace(/請|幫我|找|一下|一些|關於|需要|想看|我要|給我|推薦|搜尋|search|find/gi, ' ')
        .replace(/攻略|教學|影片|youtube|video|guide|walkthrough|build|打法|配裝/gi, ' ')
        .replace(/遊戲|game/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'latest popular games';
}

function findOfficeInstallSop(sops = []) {
    const exact = sops.find((item) => item.id === 'rec_office');
    if (exact) return exact;
    return sops.find((item) => /office|libreoffice/i.test(`${item.id} ${item.name}`)) || null;
}

async function handleAgentFinanceWorkbookWorkflow(message = '', locale = 'zh-TW', sops = []) {
    const workbookTarget = extractWorkbookTarget(message);
    const workbookPath = resolveWorkbookPath(workbookTarget);
    const env = detectSpreadsheetEnvironment();
    const officeSop = findOfficeInstallSop(sops);
    if (!env.excel && !env.libreoffice && !env.wps) {
        const installPrompt = officeSop
            ? `[ACTION:ADD_TASK sop_id="${officeSop.id}"]`
            : '';
        const reply = locale === 'en-US'
            ? `No spreadsheet app is detected. I can install Office-compatible tools first, or switch to Google Sheets web version.\n\n${installPrompt}`.trim()
            : `目前未偵測到 Excel / LibreOffice / WPS。可先幫你安裝 Office 相容工具，或改用 Google Sheets 網頁版。\n\n${installPrompt}`.trim();
        return {
            success: true,
            reply,
            suggestions: locale === 'en-US'
                ? ['Install Office-compatible app', 'Use Google Sheets web', 'Cancel']
                : ['安裝 Office 相容工具', '改用 Google Sheets 網頁版', '先不用'],
            task: false,
            llmUsed: false,
        };
    }
    if (!workbookPath) {
        return {
            success: true,
            reply: locale === 'en-US'
                ? `I cannot locate ${workbookTarget}. Please provide a full path (for example: C:\\Users\\USER\\Documents\\${workbookTarget}).`
                : `我找不到 ${workbookTarget}。請提供完整路徑（例如：C:\\Users\\USER\\Documents\\${workbookTarget}）。`,
            suggestions: locale === 'en-US'
                ? ['Send full .xlsx path', 'Use Google Sheets web']
                : ['提供完整 .xlsx 路徑', '改用 Google Sheets 網頁版'],
            task: false,
            llmUsed: false,
        };
    }

    const snapshot = await fetchNvidiaLatestFinancialSnapshot();
    const summary = buildNvidiaSnapshotLines(snapshot);
    const writeResult = updateWorkbookWithNvidiaSnapshot(workbookPath, snapshot, env);
    if (writeResult.success && writeResult.data?.success) {
        openFileWithDefaultApp(workbookPath);
        return {
            success: true,
            reply: [
                locale === 'en-US'
                    ? `Workbook updated: ${workbookPath}`
                    : `已更新活頁簿：${workbookPath}`,
                locale === 'en-US'
                    ? `Write method: ${writeResult.data?.method || 'auto'}`
                    : `寫入方式：${writeResult.data?.method || 'auto'}`,
                '',
                ...summary.map((line) => `- ${line}`),
                '',
                snapshot.sourceUrl,
            ].join('\n'),
            chalkboardDraft: {
                title: locale === 'en-US' ? 'NVIDIA Earnings Snapshot' : 'NVIDIA 財報摘要',
                bullets: summary,
            },
            suggestions: locale === 'en-US'
                ? ['Open workbook folder', 'Update another workbook']
                : ['開啟活頁簿所在資料夾', '更新另一個活頁簿'],
            task: false,
            llmUsed: false,
        };
    }

    return {
        success: true,
        reply: [
            locale === 'en-US'
                ? `Detected workbook: ${workbookPath}, but automatic write failed.`
                : `已找到活頁簿：${workbookPath}，但自動寫入失敗。`,
            locale === 'en-US'
                ? `Failure: ${writeResult.data?.message || writeResult.error || 'Unknown'}`
                : `錯誤：${writeResult.data?.message || writeResult.error || 'Unknown'}`,
            '',
            locale === 'en-US' ? 'Latest NVIDIA snapshot:' : 'NVIDIA 最新財報摘要：',
            ...summary.map((line) => `- ${line}`),
            '',
            snapshot.sourceUrl,
        ].join('\n'),
        chalkboardDraft: {
            title: locale === 'en-US' ? 'NVIDIA Earnings Snapshot' : 'NVIDIA 財報摘要',
            bullets: summary,
        },
        suggestions: locale === 'en-US'
            ? ['Install Excel-compatible app', 'Use Google Sheets web']
            : ['安裝 Excel 相容工具', '改用 Google Sheets 網頁版'],
        task: false,
        llmUsed: false,
    };
}

async function handleAgentGameResearchWorkflow(message = '', locale = 'zh-TW') {
    const topic = extractGameTopic(message);
    const guideResults = await searchWebLinks(`${topic} 攻略`, 5);
    const videoResults = await searchPlayableYouTubeVideos(topic, 5);
    if (!guideResults.length && !videoResults.length) {
        return {
            success: true,
            reply: locale === 'en-US'
                ? `I could not find results for "${topic}" right now.`
                : `目前找不到「${topic}」的可用攻略或影片結果。`,
            suggestions: locale === 'en-US'
                ? ['Try another keyword', 'Search YouTube manually']
                : ['換關鍵字再試', '改查 YouTube'],
            task: false,
            llmUsed: false,
        };
    }
    const chalkboardBullets = guideResults.slice(0, 3).map((item, idx) => `${idx + 1}. ${item.title}`);
    const fallbackBullets = videoResults.slice(0, 3).map((item, idx) => `${idx + 1}. ${item.title}`);
    const reply = [
        locale === 'en-US' ? `## Game Research: ${topic}` : `## 遊戲資料蒐集：${topic}`,
        '',
        locale === 'en-US' ? '### Guides' : '### 攻略',
        ...(guideResults.length ? guideResults.map((item) => `- [${item.title}](${item.url})`) : ['- N/A']),
        '',
        locale === 'en-US' ? '### Videos' : '### 影片',
        ...(videoResults.length ? videoResults.map((item) => `- [${item.title}](${item.url})`) : ['- N/A']),
        '',
        locale === 'en-US' ? '### Chalkboard Summary Draft' : '### Chalkboard 摘要草稿',
        ...(chalkboardBullets.length ? chalkboardBullets.map((line) => `- ${line}`) : ['- N/A']),
    ].join('\n');
    return {
        success: true,
        reply,
        chalkboardDraft: {
            title: locale === 'en-US' ? `Game Research: ${topic}` : `遊戲資料蒐集：${topic}`,
            bullets: chalkboardBullets.length > 0 ? chalkboardBullets : fallbackBullets,
        },
        suggestions: locale === 'en-US'
            ? ['Find more videos', 'Search another game']
            : ['再找更多影片', '搜尋另一款遊戲'],
        task: false,
        llmUsed: false,
    };
}


function buildWingetSopMarkdown(packageInfo = {}) {
    return buildStoreSopMarkdown(packageInfo, {
        source: 'winget',
        category: 'winget store',
        titleVerb: 'Install',
    });
}


function createWingetSopFile(packageInfo = {}) {
    return createStoreSopFile(packageInfo, {
        builder: buildWingetSopMarkdown,
        filePrefix: 'install',
    });
}


async function evaluateSOPInstalledState(sop, options = {}) {
    const forceRefresh = Boolean(options.forceRefresh);
    const cached = sopStateCache.get(sop.id);
    const now = Date.now();
    if (!forceRefresh && cached && (now - cached.checkedAt) < SOP_STATE_TTL_MS) {
        return cached.state;
    }


    let installed = false;
    let available = Boolean(sop?.steps?.check?.commands?.length);
    try {
        if (sop.id === 'rec_install_ollama') {
            const status = await llm.checkOllamaStatus();
            installed = Boolean(status.available);
        } else if (sop.id === 'rec_pull_llm_model') {
            const status = await llm.checkOllamaStatus();
            installed = Boolean(status.modelReady);
        } else if (available) {
            const executor = new SOPExecutor({ timeoutMs: 20000 });
            const checkResult = await executor.runPhaseCommands(sop.steps.check.commands, 'check');
            const lastOutput = checkResult.outputs?.[checkResult.outputs.length - 1];
            installed = Boolean(checkResult.success && lastOutput && executor.isCheckSatisfied(lastOutput.stdout));
        }


    } catch {
        installed = false;
    }


    const state = {
        installed,
        supportsUninstall: Boolean(sop?.steps?.uninstall?.commands?.length),
        recommendedAction: installed && sop?.steps?.uninstall?.commands?.length ? 'uninstall' : 'install',
    };
    sopStateCache.set(sop.id, { checkedAt: now, state });
    return state;
}


async function annotateSOPRuntimeState(sops, options = {}) {
    const annotated = await Promise.all(sops.map(async (sop) => {
        const state = await evaluateSOPInstalledState(sop, options);
        return {
            ...sop,
            ...state,
        };
    }));
    return annotated;
}


/**
 * 獲取系統健康狀態 (CPU, RAM, Disk)
 */
app.get('/api/system/health', async (req, res) => {
    try {
        const health = await getSystemHealth();
        res.json({ success: true, health });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }


});
app.get('/api/meta', (req, res) => {
    res.json({
        success: true,
        name: pkg.name || 'aipc-agent',
        version: APP_VERSION,
    });
});

app.get('/api/remote/profile', (req, res) => {
    const profile = getRemoteProfile();
    res.json({
        success: true,
        profile,
        localIps: getLocalIPv4List(),
        port: DEFAULT_REMOTE_PORT,
    });
});

app.post('/api/remote/profile', (req, res) => {
    const current = getRemoteProfile();
    const nextProfile = saveRemoteProfile({
        ...current,
        machineName: String(req.body?.machineName || current.machineName).trim() || current.machineName,
        userName: String(req.body?.userName || current.userName).trim() || current.userName,
        agentName: String(req.body?.agentName || current.agentName).trim() || current.agentName,
        ip: String(req.body?.ip || current.ip).trim() || current.ip,
        locale: String(req.body?.locale || current.locale || 'zh-TW'),
    });
    touchRemoteState();
    res.json({ success: true, profile: nextProfile });
});

app.get('/api/remote/state', (req, res) => {
    res.json({
        success: true,
        tick: remoteStateTick,
        profile: getRemoteProfile(),
        ...remoteAgent.getState(),
    });
});

app.post('/api/remote/connect', async (req, res) => {
    try {
        const host = String(req.body?.host || '').trim();
        if (!host) {
            return res.status(400).json({ success: false, error: 'Missing host' });
        }
        const port = Number(req.body?.port) || DEFAULT_REMOTE_PORT;
        const session = await remoteAgent.connect(host, getRemoteProfile(), port);
        touchRemoteState();
        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/session/:sessionId/respond', (req, res) => {
    try {
        const session = remoteAgent.respondToSession(req.params.sessionId, !!req.body?.accept, getRemoteProfile());
        touchRemoteState();
        res.json({ success: true, session });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/session/:sessionId/message', async (req, res) => {
    try {
        const sessionId = req.params.sessionId;
        const text = String(req.body?.text || '').trim();
        const mode = String(req.body?.mode || 'user').trim();
        const target = String(req.body?.target || 'remote-user').trim();
        const locale = String(req.body?.locale || 'zh-TW');
        if (!text) {
            return res.status(400).json({ success: false, error: 'Missing text' });
        }

        let senderType = 'user';
        let senderLabel = getRemoteProfile().userName;
        let outboundText = text;
        if (mode === 'local-ai') {
            const profile = getRemoteProfile();
            const remoteState = remoteAgent.getState();
            const currentSession = remoteState.sessions.find((item) => item.id === sessionId);
            const history = (currentSession?.messages || [])
                .filter((item) => item.type === 'chat_message')
                .slice(-6)
                .map((item) => ({
                    role: item.senderType === 'ai' && item.direction !== 'incoming' ? 'assistant' : 'user',
                    content: `${item.senderLabel || item.senderType}: ${item.text || item.caption || ''}`.trim(),
                }));
            outboundText = await llm.chatWithLLM(
                text,
                history,
                {
                    systemContext: [
                        buildLocalAgentContext(currentSession),
                        'You are speaking as the local AI agent inside a peer-to-peer support chat.',
                        'The current requester is the local human user on this machine.',
                        'If asked what model you are using, answer with the exact current provider and model from the system context.',
                        'Keep the answer concise and practical.',
                    ].join('\n'),
                },
                locale
            );
            senderType = 'ai';
            senderLabel = profile.agentName;
        }

        const message = remoteAgent.sendChatMessage(sessionId, {
            senderType,
            senderLabel,
            text: outboundText,
            target,
        });
        touchRemoteState();
        res.json({ success: true, message });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/session/:sessionId/share-screen', (req, res) => {
    try {
        const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
        const caption = String(req.body?.caption || '').trim();
        if (!imageDataUrl.startsWith('data:image/')) {
            return res.status(400).json({ success: false, error: 'Invalid image data' });
        }
        const profile = getRemoteProfile();
        const message = remoteAgent.sendScreenShare(req.params.sessionId, {
            senderType: 'user',
            senderLabel: profile.userName,
            imageDataUrl,
            caption,
            target: 'remote-user',
        });
        touchRemoteState();
        res.json({ success: true, message });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/session/:sessionId/model-share/request', (req, res) => {
    try {
        const profile = getRemoteProfile();
        const session = remoteAgent.requestModelShare(req.params.sessionId, {
            requestedBy: `${profile.userName} @ ${profile.machineName}`,
            note: String(req.body?.note || '').trim(),
        });
        touchRemoteState();
        res.json({ success: true, session });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/session/:sessionId/model-share/respond', (req, res) => {
    try {
        const profile = getRemoteProfile();
        const session = remoteAgent.respondModelShare(req.params.sessionId, !!req.body?.accept, {
            respondedBy: `${profile.userName} @ ${profile.machineName}`,
        });
        touchRemoteState();
        res.json({ success: true, session });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/session/:sessionId/model-share/cancel', (req, res) => {
    try {
        const profile = getRemoteProfile();
        const session = remoteAgent.cancelModelShare(req.params.sessionId, {
            cancelledBy: `${profile.userName} @ ${profile.machineName}`,
            reason: String(req.body?.reason || '').trim() || 'Model sharing stopped by local user.',
        });
        touchRemoteState();
        res.json({ success: true, session });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/model-proxy/chat', async (req, res) => {
    try {
        const sessionId = String(req.body?.sessionId || '').trim();
        const message = String(req.body?.message || '').trim();
        const locale = String(req.body?.locale || 'zh-TW');
        const history = Array.isArray(req.body?.history) ? req.body.history : [];
        const systemContext = String(req.body?.systemContext || '').trim();
        const chalkboardAttachment = normalizeChalkboardAttachment(req.body?.chalkboard);
        const providedToken = String(req.headers['x-aipc-model-share-token'] || req.body?.token || '').trim();

        if (!sessionId || !message) {
            return res.status(400).json({ success: false, error: 'Missing sessionId or message' });
        }

        const session = getRemoteSessionById(sessionId);
        if (!session || session.status !== 'active') {
            return res.status(403).json({ success: false, error: 'Session is not active' });
        }
        if (session.modelShare?.status !== 'active' || session.modelShare?.role !== 'provider') {
            return res.status(403).json({ success: false, error: 'Model share is not active' });
        }
        const expiresAtMs = Date.parse(String(session.modelShare?.expiresAt || ''));
        if (!Number.isNaN(expiresAtMs) && expiresAtMs > 0 && Date.now() > expiresAtMs) {
            return res.status(403).json({ success: false, error: 'Shared model token expired' });
        }
        const expectedToken = String(session.modelShare?.proxyToken || '');
        const providedBuffer = Buffer.from(providedToken);
        const expectedBuffer = Buffer.from(expectedToken);
        if (!providedToken || !expectedToken || providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
            return res.status(403).json({ success: false, error: 'Invalid shared model token' });
        }

        const chatOptions = {
            systemContext: [
                buildLocalAgentContext(session),
                systemContext,
                'You are answering through a remote shared-model request.',
                'Be concise and practical.',
            ].filter(Boolean).join('\n'),
            chalkboardAttachment,
        };
        if (chalkboardAttachment) {
            const preferredVisionModel = llm.getCurrentVisionModel();
            if (preferredVisionModel) {
                chatOptions.modelOverride = preferredVisionModel;
            } else if (!llm.modelSupportsVision(llm.getCurrentModel())) {
                const visionModel = await llm.getVisionCapableModel();
                if (visionModel) chatOptions.modelOverride = visionModel;
            }
        }

        const reply = await llm.chatWithLLM(
            message,
            history,
            chatOptions,
            locale
        );

        return res.json({
            success: true,
            reply,
            provider: llm.getCurrentProvider(),
            model: llm.getCurrentModel(),
            machineName: getRemoteProfile().machineName,
            agentName: getRemoteProfile().agentName,
            sessionId,
            expiresAt: session.modelShare?.expiresAt || '',
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/save-image-file', (req, res) => {
    try {
        const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
        if (!imageDataUrl.startsWith('data:image/')) {
            return res.status(400).json({ success: false, error: 'Invalid image data' });
        }

        const defaultName = `remote-share-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = 'PNG Images (*.png)|*.png|All Files (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Save Shared Screen Image'
        $dlg.InitialDirectory = [Environment]::GetFolderPath('MyPictures')
        $res = $dlg.ShowDialog()
        if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $dlg.FileName
        }
        `;
        const output = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -Command "${psScript.replace(/\n/g, ';')}"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        }).trim();
        if (!output) {
            return res.json({ success: false, error: 'User cancelled', cancelled: true });
        }

        const base64 = imageDataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
        fs.writeFileSync(output, Buffer.from(base64, 'base64'));
        res.json({ success: true, filePath: output, fileName: path.basename(output) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/session/:sessionId/disconnect', (req, res) => {
    try {
        remoteAgent.disconnectSession(
            req.params.sessionId,
            String(req.body?.reason || '').trim() || 'Disconnected by local user.'
        );
        touchRemoteState();
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});
// Default recommend list
// 推薦清單基本資料（按優先順序排列，AI 引擎放最前面）
const RECOMMEND_BASE = [
    {
        id: 'rec_install_ollama',
        title: '🧠 Install Ollama Local AI Engine',
        description: 'Download and install Ollama to enable local AI understanding',
        category: 'AI Engine',
        priority: 'critical',
    },
    {
        id: 'rec_pull_llm_model',
        title: '📥 Download Language Model (Qwen3.5 4B)',
        description: 'Download Qwen3.5 4B (~2.6GB). After this, AI will truly understand your requests',
        category: 'AI Engine',
        priority: 'critical',
    },
    {
        id: 'rec_driver_check',
        title: '🔍 Check & Install Drivers',
        description: 'Scan hardware and verify drivers are up to date',
        category: 'System',
        priority: 'high',
    },
    {
        id: 'rec_remove_copilot',
        title: '🗑️ Remove Windows Copilot',
        description: 'Disable and remove the built-in Windows Copilot feature',
        category: 'Cleanup',
        priority: 'medium',
    },
    {
        id: 'rec_install_chrome',
        title: '🌐 Install Google Chrome',
        description: 'Download and install Chrome browser',
        category: 'Browser',
        priority: 'high',
    },
    {
        id: 'rec_backup',
        title: '💾 Backup Your PC',
        description: 'Create a Windows restore point to protect your data',
        category: 'Backup',
        priority: 'medium',
    },
    {
        id: 'rec_office',
        title: '📄 Install LibreOffice',
        description: 'Free and open-source office suite, compatible with Microsoft Office formats',
        category: 'Productivity',
        priority: 'medium',
    },
    {
        id: 'rec_steam',
        title: '🎮 Install Steam',
        description: 'Install the Steam gaming platform and access your game library',
        category: 'Entertainment',
        priority: 'low',
    },
];
// 建立推薦清單，標記哪些有對應 skill
async function buildRecommendList() {
    try {
        const sops = loadAllSOPs(SOPS_DIR);
        const sopIds = new Set(sops.map(s => s.id));
        const baseItems = RECOMMEND_BASE.map(item => ({
            ...item,
            skillId: sopIds.has(item.id) ? item.id : null,
        }));
        return await Promise.all(baseItems.map(async (item) => {
            if (!item.skillId) {
                return {
                    ...item,
                    installed: false,
                    supportsUninstall: false,
                    recommendedAction: 'install',
                };
            }


            const sop = sops.find((entry) => entry.id === item.skillId);
            const state = await evaluateSOPInstalledState(sop);
            return { ...item, ...state };
        }));
    } catch {
        return RECOMMEND_BASE.map(item => ({
            ...item,
            skillId: null,
            installed: false,
            supportsUninstall: false,
            recommendedAction: 'install',
        }));
    }


}


async function getRecommendList() {
    return await buildRecommendList();
}


// Load saved tasks on startup
function loadTasks() {
    try {
        if (fs.existsSync(TASKS_FILE)) {
            const data = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
            todoList = data.todoList || [];
        }


    } catch {
        todoList = [];
    }


}


function saveTasks() {
    fs.writeFileSync(TASKS_FILE, JSON.stringify({ todoList, exportedAt: new Date().toISOString() }, null, 2), 'utf-8');
}


loadTasks();
// ── API Routes ──────────────────────────────────────────────────────
// GET /api/sops  列出所有 SOP
app.get('/api/sops', async (req, res) => {
    try {
        const sops = await annotateSOPRuntimeState(loadAllSOPs(SOPS_DIR));
        res.json({ success: true, sops });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }


});
// GET /api/todo  取得 To-Do List
app.get('/api/todo', (req, res) => {
    res.json({ success: true, todoList });
});
app.get('/api/exps', (req, res) => {
    try {
        res.json({ success: true, entries: loadExperienceEntries() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }


});
// POST /api/todo 新增任務到 To-Do List
app.post('/api/todo', async (req, res) => {
    const { title, description, skillId, category, action } = req.body;
    const sops = loadAllSOPs(SOPS_DIR);
    const sopsWithState = await annotateSOPRuntimeState(sops);
    const matchedSOP = sops.find((s) => s.id === skillId);
    const resolvedAction = action || (matchedSOP ? (await evaluateSOPInstalledState(matchedSOP)).recommendedAction : 'install');
    const resolvedTitle = matchedSOP ? buildTaskTitle(matchedSOP, resolvedAction) : (title || 'Unnamed Task');
    const resolvedDescription = matchedSOP
        ? (resolvedAction === 'uninstall'
            ? `Uninstall ${String(matchedSOP.name || matchedSOP.id || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^安裝\s*/u, '').replace(/^下載\s*/u, '').replace(/^Install\s+/gi, '').replace(/^Download\s+/gi, '').trim()}`
            : matchedSOP.name)
        : (description || '');
    const task = {
        id: `task_${Date.now()}`,
        title: resolvedTitle,
        description: resolvedDescription,
        skillId: skillId || null,
        action: resolvedAction,
        category: category || (matchedSOP ? matchedSOP.category : '一般'),
        status: 'pending', // pending | running | success | failed | skipped
        progress: 0,
        logs: [],
        createdAt: new Date().toISOString(),
        completedAt: null,
    };
    todoList.push(task);
    saveTasks();
    res.json({ success: true, task, todoList });
});
// DELETE /api/todo/:id 移除任務
app.delete('/api/todo/:id', (req, res) => {
    todoList = todoList.filter((t) => t.id !== req.params.id);
    saveTasks();
    res.json({ success: true });
});
// POST /api/todo/import 匯入任務清單
app.post('/api/todo/import', (req, res) => {
    try {
        const { tasks } = req.body;
        if (Array.isArray(tasks)) {
            todoList = tasks;
            saveTasks();
            res.json({ success: true, count: tasks.length });
        } else {
            res.json({ success: false, error: 'Invalid format: expected { tasks: [...] }' });
        }


    } catch (err) {
        res.json({ success: false, error: err.message });
    }


});
// GET /api/todo/export 匯出任務清單 (Raw JSON)
app.get('/api/todo/export', (req, res) => {
    res.json({
        exportedAt: new Date().toISOString(),
        agentVersion: '1.0.0',
        tasks: todoList,
    });
});
// POST /api/todo/export-file 匯出任務清單 (跳出另存新檔對話框)
app.post('/api/todo/export-file', (req, res) => {
    try {
        const defaultName = `aipc-tasks-${new Date().toISOString().slice(0, 10)}.json`;
        // 透過 PowerShell 呼叫原生的 Windows SaveFileDialog
        const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Export AI PC Agent Tasks'
        $dlg.InitialDirectory = [Environment]::GetFolderPath('MyDocuments')
        $res = $dlg.ShowDialog()
        if ($res -eq [System.Windows.Forms.DialogResult]::OK) { 
            Write-Output $dlg.FileName 
        }


        `;
        // 為了讓對話框能正確顯示，必須加上 -Sta 參數 (Single-Threaded Apartment)
        const output = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -Command "${psScript.replace(/\n/g, ';')}"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        }).trim();
        if (!output) {
            return res.json({ success: false, error: 'User cancelled', cancelled: true });
        }


        const filePath = output;
        const data = {
            exportedAt: new Date().toISOString(),
            agentVersion: '1.0.0',
            tasks: todoList,
        };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        res.json({ success: true, filePath, fileName: path.basename(filePath) });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }


});
// POST /api/chalkboard/export-file 匯出 Chalkboard 圖片 (跳出另存新檔對話框)
app.post('/api/chalkboard/export-file', (req, res) => {
    try {
        const { imageBase64 } = req.body;
        if (!imageBase64) {
            return res.status(400).json({ success: false, error: 'No image data provided' });
        }


        const defaultName = `chalkboard-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = 'PNG Images (*.png)|*.png|All Files (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Export Chalkboard Image'
        $dlg.InitialDirectory = [Environment]::GetFolderPath('MyPictures')
        $res = $dlg.ShowDialog()
        if ($res -eq [System.Windows.Forms.DialogResult]::OK) { 
            Write-Output $dlg.FileName 
        }


        `;
        const output = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -Command "${psScript.replace(/\n/g, ';')}"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        }).trim();
        if (!output) {
            return res.json({ success: false, error: 'User cancelled', cancelled: true });
        }


        const filePath = output;
        const base64Data = imageBase64.replace(/^data:image\/png;base64,/, "");
        fs.writeFileSync(filePath, base64Data, 'base64');
        res.json({ success: true, filePath, fileName: path.basename(filePath) });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }


});
// POST /api/exps/export-file 匯出 exps Markdown (跳出另存新檔對話框)
app.post('/api/exps/export-file', (req, res) => {
    try {
        const { markdown } = req.body;
        if (!markdown) {
            return res.status(400).json({ success: false, error: 'No markdown content provided' });
        }


        const defaultName = `aipc-exps-${new Date().toISOString().slice(0, 10)}.md`;
        const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = 'Markdown Files (*.md)|*.md|All Files (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Export AI PC Agent Experience Log'
        $dlg.InitialDirectory = [Environment]::GetFolderPath('MyDocuments')
        $res = $dlg.ShowDialog()
        if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
            Write-Output $dlg.FileName
        }


        `;
        const output = execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Sta -Command "${psScript.replace(/\n/g, ';')}"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        }).trim();
        if (!output) {
            return res.json({ success: false, error: 'User cancelled', cancelled: true });
        }


        const filePath = output;
        fs.writeFileSync(filePath, markdown, 'utf8');
        res.json({ success: true, filePath, fileName: path.basename(filePath) });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }


});
// GET /api/recommend 取得推薦清單（動態附帶 skillId）
app.get('/api/recommend', async (req, res) => {
    try {
        res.json({ success: true, recommendList: await getRecommendList() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }


});
// GET /api/llm/status 查詢 Ollama 狀態
app.get('/api/llm/status', async (req, res) => {
    try {
        const status = await llm.checkOllamaStatus();
        res.json({
            success: true,
            ...status,
            currentModel: llm.getCurrentModel(),
            provider: llm.getCurrentProvider()
        });
    } catch (err) {
        res.json({ success: false, available: false, modelReady: false, error: err.message });
    }


});
// GET/POST /api/llm/models 列出所有可用模型 (支援動態參數預覽)
app.all('/api/llm/models', async (req, res) => {
    try {
        // 同時支援 GET (query) 與 POST (body)
        const params = req.method === 'POST' ? req.body : req.query;
        const { provider, baseUrl, apiKey, authConfig } = params;
        console.log(`[LLM] Preview model list: Provider=${provider || 'default'}, URL=${baseUrl || 'default'}`);
        const models = await llm.listModels({ provider, baseUrl, apiKey, authConfig, forceRefresh: true });
        res.json({ success: true, models, currentModel: llm.getCurrentModel() });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }


});
// POST /api/llm/model 切換模型
app.post('/api/llm/model', (req, res) => {
    const { modelName } = req.body;
    if (!modelName) return res.json({ success: false, error: 'Missing modelName' });
    llm.setCurrentModel(modelName);
    res.json({ success: true, currentModel: llm.getCurrentModel() });
});
// POST /api/execute/:taskId 執行指定任務
app.post('/api/execute/:taskId', async (req, res) => {
    const task = todoList.find((t) => t.id === req.params.taskId);
    if (!task) {
        return res.json({ success: false, error: 'Task not found' });
    }


    if (runningSOP) {
        return res.json({ success: false, error: 'A task is currently running, please wait' });
    }


    let sop;
    if (task.dynamicCmd) {
        // 建立虛擬 SOP
        sop = {
            id: task.id,
            name: task.title,
            phases: {
                install: {
                    commands: [
                        { type: 'ui', message: `🚀 執行動體指令: ${task.dynamicCmd}` },
                        { type: 'powershell', content: task.dynamicCmd }

                    ]
                }


            }


        };
    } else {
        if (!task.skillId) {
            return res.json({ success: false, error: 'This task has no associated SOP and cannot be auto-executed' });
        }


        const sops = loadAllSOPs(SOPS_DIR);
        sop = sops.find((s) => s.id === task.skillId);
    }


    if (!sop) {
        return res.json({ success: false, error: `SOP not found${task.skillId ? ': ' + task.skillId : ''}` });
    }


    // Start execution
    task.status = 'running';
    task.progress = 10;
    task.logs = [];
    runningSOP = task.id;
    const dryRun = req.body.dryRun ?? false;
    const executor = new SOPExecutor({ dryRun });
    executor.on('log', (event) => {
        const logEntry = { ...event, timestamp: new Date().toISOString() };
        task.logs.push(logEntry);
        logs.push(logEntry);
        if (logs.length > 500) logs.shift();
    });
    executor.on('phase:start', (e) => {
        const progressMap = { check: 20, install: 40, uninstall: 40, verify: 80 };
        task.progress = progressMap[e.phase] || task.progress;
    });
    executor.on('ui:message', (e) => {
        const logEntry = { level: 'ui', message: e.message, timestamp: new Date().toISOString() };
        task.logs.push(logEntry);
        logs.push(logEntry);
        if (logs.length > 500) logs.shift();
    });
    // Run async
    res.json({ success: true, message: 'Task execution started' });
    try {
        const result = await executor.execute(sop, { action: task.action || 'install' });
        task.status = result.status;
        task.progress = 100;
        task.completedAt = new Date().toISOString();
        if (task.skillId) sopStateCache.delete(task.skillId);
        const finishLog = { level: 'success', message: `Task '${task.title}' completed (status: ${result.status})`, timestamp: new Date().toISOString() };
        task.logs.push(finishLog);
        logs.push(finishLog);
        // 針對 AI 引擎相關任務，強制清除快取並重新偵測
        if (sop.id === 'rec_install_ollama' || sop.id === 'rec_pull_llm_model' || task.skillId === 'rec_pull_llm_model' || task.dynamicCmd?.includes('ollama')) {
            console.log(`[Server] AI-related task completed: ${sop.id || 'dynamic'}, invalidating cache...`);
            fileLog(`AI Task Completed: ${sop.id || 'dynamic'}, invalidating cache.`);
            llm.invalidateCache();
        }


        appendTaskExperience(task, sop);
    } catch (err) {
        task.status = 'failed';
        task.completedAt = new Date().toISOString();
        if (task.skillId) sopStateCache.delete(task.skillId);
        const errLog = { level: 'error', message: `Task execution crashed: ${err.message}`, timestamp: new Date().toISOString() };
        task.logs.push(errLog);
        logs.push(errLog);
        appendTaskExperience(task, sop);
    } finally {
        runningSOP = null;
        saveTasks();
    }


});
// GET /api/task/:taskId/status 查詢任務執行狀態
app.get('/api/task/:taskId/status', (req, res) => {
    const task = todoList.find((t) => t.id === req.params.taskId);
    if (!task) {
        return res.json({ success: false, error: 'Task not found' });
    }


    res.json({ success: true, task });
});
// POST /api/chat 處理對話輸入（LLM 優先，fallback 到關鍵字比對）
app.post('/api/chat', async (req, res) => {
    const { message, locale } = req.body;
    const preferRemoteModel = !!req.body?.preferRemoteModel;
    const remoteSessionId = String(req.body?.remoteSessionId || '').trim();
    const localChatSessionId = String(req.body?.localChatSessionId || '').trim();
    const requestedHistory = Array.isArray(req.body?.history) ? req.body.history : null;
    const chalkboardAttachment = normalizeChalkboardAttachment(req.body?.chalkboard);
    if (!message) return res.json({ success: false, error: 'Please enter a message' });
    const sops = loadAllSOPs(SOPS_DIR);
    const sopsWithState = await annotateSOPRuntimeState(sops);
    try {
        if (detectAgentFinanceIntent(message)) {
            const agentResponse = await handleAgentFinanceWorkbookWorkflow(message, locale || 'zh-TW', sopsWithState);
            if (agentResponse) return res.json(agentResponse);
        }
        if (detectGameResearchIntent(message)) {
            const gameResponse = await handleAgentGameResearchWorkflow(message, locale || 'zh-TW');
            if (gameResponse) return res.json(gameResponse);
        }
    } catch (agentErr) {
        fileLog(`Agent workflow failed: ${agentErr.message}`);
    }
    let suggestions = locale === 'en-US' ? ['Install Chrome', 'Clear Tasks', 'System Status'] : ['幫我安裝 Chrome', '清理工作清單', '查看系統狀態']; // 提升作用域
    let llmErrorForFallback = null;
    // 1. 快速蒐集背景資訊
    const sopCatalog = sopsWithState.map(s => `- ID: ${s.id}, Name: ${s.name}, Status: ${s.installed ? 'installed' : 'not installed'}, Action: ${s.recommendedAction}`).join('\n');
    const taskContext = todoList.map(t => `- ID: ${t.id}, Title: ${t.title}, Status: ${t.status}`).join('\n');
    const experienceContext = loadExperienceContext(message, 3);
    const wingetRecommendation = shouldSearchWingetForRecommendations(message)
        ? (() => {
            const query = extractWingetSearchQuery(message);
            return {
                query,
                packages: searchWingetPackages(query, 6),
            };
        })()
        : null;
    const microsoftStoreRecommendation = shouldSearchMicrosoftStore(message)
        ? (() => {
            const query = extractWingetSearchQuery(message);
            return {
                query,
                packages: searchMicrosoftStorePackages(query, 6),
            };
        })()
        : null;
    const githubRecommendation = shouldSearchGitHubReleases(message)
        ? await (async () => {
            const query = extractWingetSearchQuery(message);
            return {
                query,
                packages: await searchGitHubReleaseApps(query, 5),
            };
        })()
        : null;
    const wingetSopRequestMatch = String(message || '').match(/(?:幫我做|幫我產生|產生|建立|新增)\s+(.+?)\s*(?:的)?\s*sop/i);
    if (wingetSopRequestMatch) {
        const packageQuery = wingetSopRequestMatch[1].trim();
        const isGitHubRequest = shouldSearchGitHubReleases(message);
        const isMicrosoftStoreRequest = shouldSearchMicrosoftStore(message);
        if (hasLikelySopForMessage(packageQuery, sops)) {
            return res.json({
                success: true,
                reply: 'A similar SOP already exists. Try searching the SOP list on the left; I can also rewrite it if needed.',
                suggestions: ['Go to SOP List', `Search ${packageQuery}`],
                task: false,
                llmUsed: false
            });
        }


        const githubCandidates = isGitHubRequest ? await searchGitHubReleaseApps(packageQuery, 5) : [];
        if (githubCandidates.length > 0) {
            const created = createGitHubReleaseSopFile(githubCandidates[0]);
            return res.json({
                success: true,
                reply: `SOP generated from GitHub Releases: ${created.fileName}. Refresh the SOP list to use it.`,
                suggestions: ['Refresh SOP List', `Download ${githubCandidates[0].name}`],
                task: false,
                sopChanged: true,
                llmUsed: false
            });
        }


        const storeCandidates = isMicrosoftStoreRequest ? searchMicrosoftStorePackages(packageQuery, 5) : [];
        if (storeCandidates.length > 0) {
            const created = createMicrosoftStoreSopFile(storeCandidates[0]);
            return res.json({
                success: true,
                reply: `SOP generated from Microsoft Store: ${created.fileName}. Refresh the SOP list to use it.`,
                suggestions: ['Refresh SOP List', `Install ${storeCandidates[0].name}`],
                task: false,
                sopChanged: true,
                llmUsed: false
            });
        }


        const candidates = searchWingetPackages(packageQuery, 5);
        if (candidates.length > 0) {
            const created = createWingetSopFile(candidates[0]);
            return res.json({
                success: true,
                reply: `SOP generated from winget: ${created.fileName}. Refresh the SOP list to use it.`,
                suggestions: ['Refresh SOP List', `Install ${candidates[0].name}`],
                task: false,
                sopChanged: true,
                llmUsed: false
            });
        }


    }


    if (microsoftStoreRecommendation?.packages?.length && !hasLikelySopForMessage(message, sops)) {
        const topPackages = microsoftStoreRecommendation.packages
            .slice(0, 5)
            .map((pkg, index) => `${index + 1}. ${pkg.name}`)
            .join('\n');
        return res.json({
            success: true,
            reply: `Here are some Microsoft Store UWP apps I found:\n${topPackages}\n\nI can generate a SOP for any of them if you'd like.`,
            suggestions: microsoftStoreRecommendation.packages.slice(0, 3).map(pkg => `Create Microsoft Store SOP for ${pkg.name}`),
            task: false,
            llmUsed: false
        });
    }


    if (githubRecommendation?.packages?.length && !hasLikelySopForMessage(message, sops)) {
        const topPackages = githubRecommendation.packages
            .slice(0, 5)
            .map((pkg, index) => `${index + 1}. ${pkg.name} (${pkg.fullName})`)
            .join('\n');
        return res.json({
            success: true,
            reply: `Here are some GitHub apps with Windows releases I found:\n${topPackages}\n\nI can generate a download SOP for any of them.`,
            suggestions: githubRecommendation.packages.slice(0, 3).map(pkg => `Create GitHub SOP for ${pkg.name}`),
            task: false,
            llmUsed: false
        });
    }


    if (wingetRecommendation?.packages?.length && !hasLikelySopForMessage(message, sops)) {
        const topPackages = wingetRecommendation.packages
            .slice(0, 5)
            .map((pkg, index) => `${index + 1}. ${pkg.name}`)
            .join('\n');
        return res.json({
            success: true,
            reply: `No matching SOP found. Here are some winget options:\n${topPackages}\n\nI can generate a SOP for any of them.`,
            suggestions: wingetRecommendation.packages.slice(0, 3).map(pkg => `Create SOP for ${pkg.name}`),
            task: false,
            llmUsed: false
        });
    }


    let systemHealth = null;
    try {
        systemHealth = await getSystemHealth();
    } catch {
        systemHealth = null;
    }


    const hardwareSummary = (() => {
        if (!systemHealth) {
            const ramUsage = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
            return `CPU: ${os.cpus()[0].model.trim()}, RAM: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB (Usage: ${ramUsage}%)`;
        }


        const cpuPart = `CPU: ${systemHealth.cpu.model} (Load: ${systemHealth.cpu.load}%)`;
        const gpuPart = `GPU: ${systemHealth.gpu.name || 'N/A'} (Load: ${systemHealth.gpu.load || 0}%${systemHealth.gpu.temp ? `, Temp: ${systemHealth.gpu.temp}` : ''})`;
        const gpuDetails = systemHealth.gpu.details
            ? `GPU Detail: Driver ${systemHealth.gpu.details.driverVersion || 'N/A'}, VRAM ${Math.round((systemHealth.gpu.details.memoryUsedMB || 0) / 1024)}GB / ${Math.round((systemHealth.gpu.details.memoryTotalMB || 0) / 1024)}GB used, Power ${systemHealth.gpu.details.powerDrawW || 0}W / ${systemHealth.gpu.details.powerLimitW || 0}W`
            : null;
        const ramTotalGb = Math.round(systemHealth.ram.total / 1024 / 1024 / 1024);
        const ramPart = `RAM: ${ramTotalGb}GB (Usage: ${systemHealth.ram.usage}%)`;
        const diskList = Array.isArray(systemHealth.disk.drives) ? systemHealth.disk.drives : [];
        const volumeList = Array.isArray(systemHealth.disk.volumes) ? systemHealth.disk.volumes : [];
        const diskHealthPart = diskList.length > 0
            ? diskList.map(d => `${d.name} [${d.type}, ${d.health}]`).join('; ')
            : (systemHealth.disk.status || 'Unknown');
        const diskFreePart = volumeList.length > 0
            ? volumeList.map(v => `${v.name} ${Math.round(v.free / 1024 / 1024 / 1024)}GB / ${Math.round(v.size / 1024 / 1024 / 1024)}GB free`).join('; ')
            : 'N/A';
        const diskPart = `Disk: ${diskHealthPart}, Free Space: ${diskFreePart}`;
        return [cpuPart, gpuPart, gpuDetails, ramPart, diskPart].filter(Boolean).join(', ');
    })();
    // 取得快取的狀態 (不強制刷新，約 5ms 以內)
    const llmStatus = await llm.checkOllamaStatus();
    // ── 情境 1：AI 引擎就緒 (驅動模式) ───────────────────────
    if (llmStatus.available && llmStatus.modelReady) {
        try {
            const baseHistory = requestedHistory
                || (localChatSessionId ? (localChatHistoryBySession.get(localChatSessionId) || []) : chatHistory);
            const requestHistory = buildChatHistoryForRequest(baseHistory, Boolean(chalkboardAttachment));
            const onDemandGuidance = buildOnDemandSkillAndSopContext(message, sopsWithState, locale || 'zh-TW');
            const contextNote = `
[[Current System Context]]
1. Hardware Summary: ${hardwareSummary}

2. Available SOPs:
${sopCatalog || '(none)'}

3. Task List:
${taskContext || '(empty)'}

4. Current AI Model: ${llm.getCurrentModel()}

5. Chalkboard sketch: ${chalkboardAttachment ? `Attached ${chalkboardAttachment.width || '?'}x${chalkboardAttachment.height || '?'} chalkboard snapshot - treat it as the user's visual draft. This image is the current reference; unless the user explicitly asks to compare, ignore previous images.` : 'No chalkboard snapshot attached this round.'}

6. On-Demand Skill/SOP Guidance:
${onDemandGuidance || '(no direct skill/sop match)'}

`;
            // 2. 呼叫 LLM (附帶歷史紀錄)
            const wingetPromptNote = wingetRecommendation?.packages?.length
                ? `\n\n[[winget 商店候選軟體]]\n使用者此刻在詢問軟體推薦，而且目前 SOP 未必有直接對應項目。若你要推薦軟體，請優先參考下列 winget 結果來列出「軟體名稱」。若使用者要求產生對應 SOP，請輸出 [ACTION:CREATE_WINGET_SOP package_id="..." package_name="..."]。\nQuery: ${wingetRecommendation.query}\n${wingetRecommendation.packages.map((pkg, index) => `${index + 1}. ${pkg.name} | id=${pkg.id} | version=${pkg.version || 'unknown'}`).join('\n')}`
                : '';
            const microsoftStorePromptNote = microsoftStoreRecommendation?.packages?.length
                ? `\n\n[[Microsoft Store 候選軟體]]\n使用者偏向 Microsoft Store / UWP / 商店版軟體。若你要推薦軟體，請優先參考下列 msstore 結果；若使用者要求建立 SOP，請輸出 [ACTION:CREATE_MSSTORE_SOP package_id="..." package_name="..."]。\nQuery: ${microsoftStoreRecommendation.query}\n${microsoftStoreRecommendation.packages.map((pkg, index) => `${index + 1}. ${pkg.name} | id=${pkg.id} | version=${pkg.version || 'unknown'}`).join('\n')}`
                : '';
            const githubPromptNote = githubRecommendation?.packages?.length
                ? `\n\n[[GitHub Releases 候選軟體]]\n使用者在找 GitHub 上有 Windows release 的開源 App。若你要推薦軟體，請優先參考下列候選；若使用者要求建立 SOP，請輸出 [ACTION:CREATE_GITHUB_RELEASE_SOP repo_full_name="..." asset_name="..." download_url="..."]。\nQuery: ${githubRecommendation.query}\n${githubRecommendation.packages.map((pkg, index) => `${index + 1}. ${pkg.name} | repo=${pkg.fullName} | tag=${pkg.tagName || 'latest'} | asset=${pkg.assetName}`).join('\n')}`
                : '';
            let llmReply;
            const remoteState = remoteAgent.getState();
            const activeRemoteSession = remoteState.sessions.find((item) => item.status === 'active');
            const sharedModelSession = preferRemoteModel ? getSharedModelSession(remoteSessionId) : null;
            const chatOptions = {
                systemContext: [
                    buildLocalAgentContext(activeRemoteSession || null),
                    `Available local IPv4 list: ${remoteState.localIps.join(', ') || 'N/A'}`,
                    `Remote chat service port: ${DEFAULT_REMOTE_PORT}`,
                    sharedModelSession
                        ? `Shared remote model is active on ${sharedModelSession.peer?.machineName || sharedModelSession.host} (${sharedModelSession.peer?.agentName || 'Remote AI'}).`
                        : 'Shared remote model is not active.',
                    onDemandGuidance || '',
                ].join('\n'),
            };
            if (chalkboardAttachment) {
                chatOptions.chalkboardAttachment = chalkboardAttachment;
                const preferredVisionModel = llm.getCurrentVisionModel();
                if (preferredVisionModel) {
                    chatOptions.modelOverride = preferredVisionModel;
                } else {
                    const currentModel = llm.getCurrentModel();
                    if (!llm.modelSupportsVision(currentModel)) {
                        const visionModel = await llm.getVisionCapableModel();
                        if (visionModel) {
                            chatOptions.modelOverride = visionModel;
                        }


                    }


                }


            }


            try {
                const composedMessage = message + "\n\n" + contextNote + wingetPromptNote + microsoftStorePromptNote + githubPromptNote + "\n\n[[Experience Log]]\n" + (experienceContext || '(No experience entries yet)');
                let modelSource = {
                    type: 'local',
                    provider: llm.getCurrentProvider(),
                    model: chatOptions.modelOverride || llm.getCurrentModel(),
                    machineName: getRemoteProfile().machineName,
                    agentName: getRemoteProfile().agentName,
                    sessionId: '',
                    expiresAt: '',
                };
                if (sharedModelSession) {
                    const remoteResult = await proxyChatToSharedRemoteModel({
                        session: sharedModelSession,
                        message: composedMessage,
                        history: requestHistory,
                        systemContext: chatOptions.systemContext,
                        locale,
                        chalkboardAttachment,
                    });
                    if (!remoteResult?.success) {
                        throw new Error(remoteResult?.error || 'Remote shared model failed');
                    }
                    llmReply = remoteResult.reply;
                    modelSource = {
                        type: 'remote-shared',
                        provider: remoteResult.provider,
                        model: remoteResult.model,
                        machineName: remoteResult.machineName,
                        agentName: remoteResult.agentName,
                        sessionId: remoteResult.sessionId || sharedModelSession.id,
                        expiresAt: remoteResult.expiresAt || sharedModelSession.modelShare?.expiresAt || '',
                    };
                } else {
                    llmReply = await llm.chatWithLLM(
                        composedMessage,
                        requestHistory,
                        chatOptions,
                        locale
                    );
                }
                req.__modelSource = modelSource;
            } catch (visionErr) {
                if (!chalkboardAttachment) throw visionErr;
                console.warn('[LLM] Chalkboard vision failed, retrying as text:', visionErr.message);
                llmReply = await llm.chatWithLLM(
                    `${message}\n\n${contextNote}${wingetPromptNote}${microsoftStorePromptNote}${githubPromptNote}\n\n[[Experience Log]]\n${experienceContext || '(No experience entries yet)'}\n\n[System] The user attached a Chalkboard image, but this model/provider failed to process it. Please inform the user of the failure, then assist based on the text request.`,
                    requestHistory,
                    { systemContext: chatOptions.systemContext },
                    locale
                );
            }


            // 3. 解析與安全過濾
            const actionRegex = /\[ACTION:(.*?)\]/g;
            const actions = [];
            let match;
            while ((match = actionRegex.exec(llmReply)) !== null) {
                actions.push(match[1]);
            }


            // ── 執行安全攔截 ──
            const hasSuggestions = actions.length > 0 && llmReply.includes('[SUGGEST:');
            const isQuestioning = /[\?？]|是否要|確認點選|要不要執行|您是否同意/.test(llmReply);
            let executeTaskId = null;
            let hasActionTaken = false;
            let taskListChanged = false;
            let sopChanged = false;
            const actionSummaries = [];
            if (hasSuggestions && isQuestioning) {
                actions.length = 0; // 攔截待確認動作
            }


            for (const actionStr of actions) {
                if (actionStr.startsWith('ADD_TASK')) {
                    const idMatch = actionStr.match(/sop_id="(.*?)"/);
                    if (idMatch) {
                        const mSop = sopsWithState.find(s => s.id === idMatch[1]);
                        if (mSop) {
                            todoList.push({
                                id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                                title: buildTaskTitle(mSop, mSop.recommendedAction),
                                description: `Scheduled by AI Agent`,
                                skillId: mSop.id,
                                action: mSop.recommendedAction,
                                category: mSop.category || 'Maintenance',
                                status: 'pending', progress: 0, logs: [],
                                createdAt: new Date().toISOString()
                            });
                            hasActionTaken = true;
                            taskListChanged = true;
                        }


                    }


                }


                if (actionStr.startsWith('REMOVE_TASK')) {
                    const idMatch = actionStr.match(/task_id="(.*?)"/);
                    if (idMatch) {
                        todoList = todoList.filter(t => t.id !== idMatch[1]);
                        hasActionTaken = true;
                        taskListChanged = true;
                    }


                }


                if (actionStr.startsWith('EXECUTE_TASK')) {
                    const idMatch = actionStr.match(/task_id="(.*?)"/);
                    if (idMatch) executeTaskId = idMatch[1];
                }


                if (actionStr === 'CLEAR_ALL') {
                    todoList = [];
                    hasActionTaken = true;
                    taskListChanged = true;
                }


                if (actionStr.startsWith('SWITCH_MODEL')) {
                    const nameMatch = actionStr.match(/name="(.*?)"/);
                    if (nameMatch) llm.setCurrentModel(nameMatch[1]);
                }

                if (actionStr.startsWith('OPEN_FILE')) {
                    const fileMatch = actionStr.match(/file_path="(.*?)"/);
                    if (fileMatch) {
                        openFileWithDefaultApp(fileMatch[1]);
                        hasActionTaken = true;
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Opened file: ${fileMatch[1]}`
                                : `已開啟檔案：${fileMatch[1]}`
                        );
                    }
                }

                if (actionStr.startsWith('OPEN_URL')) {
                    const urlMatch = actionStr.match(/url="(.*?)"/);
                    if (urlMatch) {
                        openUrlInDefaultBrowser(urlMatch[1]);
                        hasActionTaken = true;
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Opened URL: ${urlMatch[1]}`
                                : `已開啟網址：${urlMatch[1]}`
                        );
                    }
                }

                if (actionStr.startsWith('BROWSER_USE')) {
                    const mode = parseActionArg(actionStr, 'mode') || 'search';
                    const query = parseActionArg(actionStr, 'query');
                    const url = parseActionArg(actionStr, 'url');
                    const browserResult = await runBrowserUseOperation({ mode, query, url, limit: 5 });
                    hasActionTaken = true;
                    if (browserResult?.success && mode === 'search') {
                        const items = Array.isArray(browserResult.results) ? browserResult.results.slice(0, 3) : [];
                        if (items.length > 0) {
                            const lines = items.map((item, index) => `${index + 1}. ${item.title} - ${item.url}`);
                            actionSummaries.push(
                                (locale === 'en-US'
                                    ? `Search results for "${query || message}":\n`
                                    : `「${query || message}」搜尋結果：\n`) + lines.join('\n')
                            );
                        } else {
                            actionSummaries.push(
                                locale === 'en-US'
                                    ? `Search completed, but no visible result items were parsed for "${query || message}".`
                                    : `已完成搜尋，但沒有解析到可用結果（${query || message}）。`
                            );
                        }
                    } else if (browserResult?.success) {
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Browser Use executed (${mode}).`
                                : `已執行 Browser Use（${mode}）。`
                        );
                    }
                }

                if (actionStr.startsWith('COMPUTER_USE')) {
                    const mode = parseActionArg(actionStr, 'mode');
                    const filePath = parseActionArg(actionStr, 'file_path');
                    const url = parseActionArg(actionStr, 'url');
                    const sopId = parseActionArg(actionStr, 'sop_id');
                    const computerResult = runComputerUseOperation({ mode, filePath, url, sopId }, sopsWithState);
                    hasActionTaken = true;
                    taskListChanged = true;
                    if (computerResult?.success) {
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Computer Use executed (${mode}).`
                                : `已執行 Computer Use（${mode}）。`
                        );
                        if (computerResult?.taskId) {
                            actionSummaries.push(
                                locale === 'en-US'
                                    ? `Created task: ${computerResult.taskId}`
                                    : `已建立任務：${computerResult.taskId}`
                            );
                        }
                    } else {
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Computer Use failed (${mode}): ${computerResult?.error || 'unknown error'}`
                                : `Computer Use 失敗（${mode}）：${computerResult?.error || '未知錯誤'}`
                        );
                    }
                }


                if (actionStr.startsWith('CREATE_WINGET_SOP')) {
                    const idMatch = actionStr.match(/package_id="(.*?)"/);
                    const nameMatch = actionStr.match(/package_name="(.*?)"/);
                    if (idMatch) {
                        createWingetSopFile({
                            id: idMatch[1],
                            name: nameMatch ? nameMatch[1] : idMatch[1],
                        });
                        hasActionTaken = true;
                        sopChanged = true;
                    }


                }


                if (actionStr.startsWith('CREATE_MSSTORE_SOP')) {
                    const idMatch = actionStr.match(/package_id="(.*?)"/);
                    const nameMatch = actionStr.match(/package_name="(.*?)"/);
                    if (idMatch) {
                        createMicrosoftStoreSopFile({
                            id: idMatch[1],
                            name: nameMatch ? nameMatch[1] : idMatch[1],
                            source: 'msstore',
                        });
                        hasActionTaken = true;
                        sopChanged = true;
                    }


                }


                if (actionStr.startsWith('CREATE_GITHUB_RELEASE_SOP')) {
                    const repoMatch = actionStr.match(/repo_full_name="(.*?)"/);
                    const assetMatch = actionStr.match(/asset_name="(.*?)"/);
                    const urlMatch = actionStr.match(/download_url="(.*?)"/);
                    if (repoMatch && assetMatch && urlMatch) {
                        createGitHubReleaseSopFile({
                            fullName: repoMatch[1],
                            name: repoMatch[1].split('/').pop(),
                            assetName: assetMatch[1],
                            downloadUrl: urlMatch[1],
                        });
                        hasActionTaken = true;
                        sopChanged = true;
                    }


                }


            }


            if (hasActionTaken) saveTasks();
            // 4. 更新對話紀錄
            const cleanReply = llmReply.replace(/\[ACTION:.*?\]/g, '').replace(/\[SUGGEST:.*?\]/g, '').trim();
            const finalReply = cleanReply || actionSummaries.join('\n\n') || (
                locale === 'en-US'
                    ? 'Done. I executed the requested action.'
                    : '已執行指定動作。'
            );
            const trimmedHistory = [
                ...baseHistory,
                { role: 'user', content: chalkboardAttachment ? `${message}\n\n[User attached a Chalkboard sketch]` : message },
                { role: 'assistant', content: chalkboardAttachment ? `${finalReply}\n\n[This reply referenced the Chalkboard sketch]` : finalReply },
            ].slice(-6);
            if (localChatSessionId) {
                localChatHistoryBySession.set(localChatSessionId, trimmedHistory);
            } else {
                chatHistory = trimmedHistory;
            }
            const suggestMatch = llmReply.match(/\[SUGGEST:(.*?)\]/);
            // In en-US mode, if [SUGGEST:...] contains Chinese characters, discard it and use locale-aware defaults
            let finalSuggestions;
            if (suggestMatch) {
                const suggestText = suggestMatch[1];
                const hasChinese = /[\u4e00-\u9fff]/.test(suggestText);
                if (locale === 'en-US' && hasChinese) {
                    finalSuggestions = suggestions; // use locale-aware defaults defined at line 1167
                } else {
                    finalSuggestions = suggestText.split(',').map(s => s.trim());
                }
            } else {
                finalSuggestions = suggestions;
            }
            return res.json({
                success: true,
                reply: finalReply,
                suggestions: finalSuggestions,
                task: taskListChanged,
                sopChanged,
                executeTaskId,
                llmUsed: true,
                modelSource: req.__modelSource || {
                    type: 'local',
                    provider: llm.getCurrentProvider(),
                    model: chatOptions.modelOverride || llm.getCurrentModel(),
                    machineName: getRemoteProfile().machineName,
                    agentName: getRemoteProfile().agentName,
                    sessionId: '',
                    expiresAt: '',
                },
                history: trimmedHistory,
            });
        } catch (llmErr) {
            console.error('[LLM] AI Agent processing failed:', llmErr);
            llmErrorForFallback = llmErr.message;
            // 發生錯誤不中斷，讓它往下走到關鍵字比對模式
        }


    }


    // ── 情境 2：LLM 不可用 (硬編碼備援模式) ───────────────────────────
    let matchedSOP = null;
    let taskAdded = null;
    let executeTaskId = null;
    let isActionTaken = false;
    suggestions = locale === 'en-US' ? ['Install Chrome', 'Clear Tasks', 'System Status'] : ['幫我安裝 Chrome', '清理工作清單', '查看系統狀態'];
    const isDeletionIntent = /刪除|移除|移掉|清空|清掉|delete|remove/.test(message);
    const isConfirmation = /是|好|確定|執行|同意/.test(message);
    // 備援模式的刪除邏輯：也改成需要確認
    if (isDeletionIntent) {
        if (/全部|所有|清單|工作表/.test(message) && !/(單一|這項|那個|個)/.test(message)) {
            // 不直接刪除，改為詢問
            return res.json({
                success: true,
                reply: "Confirm clearing all tasks? This cannot be undone.",
                suggestions: ['Confirm Clear', 'Cancel'],
                task: false,
                llmUsed: false
            });
        } else {
            const cleanQuery = message.replace(/刪除|移除|移掉|清空|清掉|這項|任務|工作|清單|delete|remove|task|安裝|平台/g, '').trim().toLowerCase();
            let targetTask = todoList.find(t => t.title.toLowerCase().includes(cleanQuery));
            if (targetTask) {
                return res.json({
                    success: true,
                    reply: `Found task '${targetTask.title}'. Confirm removal?`,
                    suggestions: [`Remove ${targetTask.title}`, 'Not now'],
                    task: false,
                    llmUsed: false
                });
            }


        }


    }


    if (isConfirmation) {
        if (message.includes('清空')) {
            todoList = [];
            saveTasks();
            if (localChatSessionId) {
                localChatHistoryBySession.set(localChatSessionId, []);
            } else {
                chatHistory = []; // 清空也順便清空歷史
            }
            return res.json({ success: true, reply: "All tasks cleared. 🧹", suggestions, task: true, llmUsed: false });
        }


        const removeMatch = message.match(/移除 (.*)/);
        if (removeMatch) {
            const title = removeMatch[1];
            todoList = todoList.filter(t => !t.title.includes(title));
            saveTasks();
            return res.json({ success: true, reply: `Task '${title}' removed.`, suggestions, task: true, llmUsed: false });
        }


        // 只有「明確」想執行才執行，不再隨便對「是」就執行
        if (message.includes('執行') || message.includes('開始')) {
            const pendingTask = [...todoList].reverse().find(t => t.status === 'pending');
            if (pendingTask) executeTaskId = pendingTask.id;
        }


    }


    if (!isActionTaken && !isConfirmation) {
        if (/日文|日語|japanese|ja-jp/i.test(message)) matchedSOP = sopsWithState.find((s) => s.id === 'sys_lang_ja_jp');
        if (/英文|english|en-us/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'sys_lang_en_us');
        if (/繁中|繁體中文|traditional chinese|zh-tw/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'sys_lang_zh_tw');
        if (/簡中|簡體中文|simplified chinese|zh-cn/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'sys_lang_zh_cn');
        if (/chrome|谷歌|瀏覽器/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'rec_install_chrome');
        if (/ollama|llm|語言模型|ai引擎/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'rec_install_ollama');
        if (/steam|steam|遊戲/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'rec_steam');
        if (/備份|backup|備分|同步檔案/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'sys_backup_user_files');
        if (/還原|restore|回復檔案/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'sys_restore_user_files');
        if (matchedSOP) {
            taskAdded = {
                id: `task_${Date.now()}`,
                title: buildTaskTitle(matchedSOP, matchedSOP.recommendedAction),
                skillId: matchedSOP.id,
                action: matchedSOP.recommendedAction,
                status: 'pending',
                progress: 0,
                logs: []
            };
            todoList.push(taskAdded);
            saveTasks();
        }


    }


    let reply = '';
    if (taskAdded) {
        reply = `Added '${taskAdded.title}' to the list. Execute now? 😊`;
        suggestions = ['Execute', 'Not now'];
    } else if (executeTaskId) {
        reply = `Sure, starting now! 🚀`;
    } else {
        const errorHint = llmErrorForFallback ? ` (AI engine error: ${llmErrorForFallback})` : ' (AI 引擎未就緒，目前為關鍵字模式)';
        reply = `Received: '${message}'${errorHint}`;
    }


    return res.json({
        success: true,
        reply,
        suggestions,
        task: !!taskAdded,
        executeTaskId,
        llmUsed: false
    });
});

app.get('/api/agent/capability', (req, res) => {
    const profile = buildModelCapabilityProfile();
    res.json({
        success: true,
        levels: {
            browserUse: 'inner-universe',
            computerUse: 'outer-universe',
        },
        policy: {
            browserUse: 'Browser Use is for web resource acquisition and browser-side editing actions.',
            computerUse: 'Computer Use should run inside VM sandbox when possible to avoid host interference.',
            vmSandboxFirst: true,
        },
        model: profile,
    });
});

app.post('/api/agent/browser-use', async (req, res) => {
    try {
        const profile = buildModelCapabilityProfile();
        const result = await runBrowserUseOperation(req.body || {});
        return res.json({ success: Boolean(result?.success), result, model: profile });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/agent/computer-use', async (req, res) => {
    try {
        const profile = buildModelCapabilityProfile();
        const sops = await annotateSOPRuntimeState(loadAllSOPs(SOPS_DIR));
        const result = runComputerUseOperation(req.body || {}, sops);
        return res.json({ success: Boolean(result?.success), result, model: profile });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/chalkboard/draft', (req, res) => {
    const title = String(req.body?.title || '').trim();
    const bullets = Array.isArray(req.body?.bullets)
        ? req.body.bullets.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [];
    if (!title && bullets.length === 0) {
        return res.status(400).json({ success: false, error: 'Empty chalkboard draft.' });
    }
    res.json({
        success: true,
        draft: {
            title: title || 'Chalkboard Draft',
            bullets,
            createdAt: new Date().toISOString(),
        },
    });
});
// GET /api/logs 取得全域 log
app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs });
});
/**
 * 寫入 Debug Log 到 APPDATA，修復打包後看不到 Console 的問題
 */
function fileLog(msg) {
    const logPath = path.join(aipcDir, 'debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
}


// LLM Config Endpoints
app.get('/api/llm/config', (req, res) => {
    res.json({
        success: true,
        provider: llm.getCurrentProvider(),
        baseUrl: llm.getCurrentBaseUrl(),
        apiKey: llm.getCurrentApiKey(),
        authType: llm.getCurrentAuthType(),
        authConfig: llm.getCurrentAuthConfig(),
        model: llm.getCurrentModel(),
        visionModel: llm.getCurrentVisionModel()
    });
});
app.post('/api/llm/config', (req, res) => {
    const { provider, baseUrl, apiKey, model, authConfig, visionModel } = req.body;
    if (!provider || !baseUrl) {
        return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }


    llm.updateProviderSettings(provider, baseUrl, apiKey, model, authConfig, visionModel);
    res.json({ success: true, message: 'Settings saved' });
});
function pickBestGitHubAsset(releases = []) {
    const candidates = [];
    releases.forEach((release) => {
        const releaseTag = release?.tag_name || '';
        const assets = Array.isArray(release?.assets) ? release.assets : [];
        assets.filter(isUsefulGitHubAsset).forEach((asset) => {
            candidates.push({
                tagName: releaseTag,
                assetName: asset.name,
                downloadUrl: asset.browser_download_url,
                size: asset.size,
                score: scoreGitHubAsset(asset),
            });
        });
    });
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
}


function shouldSearchWingetForRecommendations(message = '') {
    const text = String(message || '').toLowerCase();
    // 如果沒有匹配的 SOP 且包含軟體相關關鍵字，則搜尋 winget
    const softwareKeywords = /(軟體|app|工具|程式|應用|下載|安裝|推薦|找|想要|需要|安裝|下載|下載|推薦|軟體|app|工具|程式|應用|install|download|recommend|find|need|want)/i;
    const excludePatterns = /(microsoft\s*store|msstore|uwp|商店版|市集|github|repo|repository|release|開源|portable)/i;
    return softwareKeywords.test(text) && !excludePatterns.test(text);
}

function shouldSearchMicrosoftStore(message = '') {
    return /(microsoft\s*store|msstore|uwp|商店版|市集 app|windows store)/i.test(String(message || ''));
}


async function fetchJson(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'AI-PC-Agent',
            'Accept': 'application/vnd.github+json',
        }


    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }


    return response.json();
}


function scoreGitHubAsset(asset = {}) {
    const name = String(asset?.name || '').toLowerCase();
    let score = 0;
    if (/\.(msi|exe|zip)$/.test(name)) score += 10;
    if (/(win(dows)?|x64|amd64|x86|portable)/.test(name)) score += 8;
    if (/arm64/.test(name)) score -= 6;
    if (/setup|installer/.test(name)) score += 3;
    if (/portable/.test(name)) score += 2;
    if (/source[\s._-]*code|sha|checksum|sig|symbols|debug/.test(name)) score -= 10;
    return score;
}


function buildGitHubReleaseSopMarkdown(packageInfo = {}) {
    const repoFullName = String(packageInfo.fullName || packageInfo.repoFullName || '').trim();
    const repoName = String(packageInfo.name || repoFullName.split('/').pop() || 'GitHub App').trim();
    const assetName = String(packageInfo.assetName || 'release.zip').trim();
    const downloadUrl = String(packageInfo.downloadUrl || '').trim();
    const tagName = String(packageInfo.tagName || '').trim();
    const slug = slugifyWingetPackage(repoFullName || repoName);
    const assetSlug = slugifyWingetPackage(assetName);
    const sopId = `github_${slug}_${assetSlug}`;
    const escapedUrl = downloadUrl.replace(/'/g, "''");
    const escapedAssetName = assetName.replace(/'/g, "''");
    const extractDirName = assetSlug || 'app';
    return `# AI PC Agent SOP File v1
1. Metadata
ID: ${sopId}

Name: Download ${repoName} from GitHub
Category: github releases
Risk Level: Medium
2. Prerequisites
OS: Windows 10 / 11
Permissions: Standard User
Network: Required (download from GitHub Releases)
3. Execution Steps
## Check
Expected Result: Return True when the release asset already exists in the managed download folder.
\`\`\`powershell
try {
    $baseDir = Join-Path $env:USERPROFILE 'Downloads\\AI PC Agent Downloads'
    $assetPath = Join-Path $baseDir '${escapedAssetName}'
    if (Test-Path $assetPath) { $true } else { $false }

} catch {
    $false
}


\`\`\`
## Install
\`\`\`powershell
Write-Host "Downloading ${repoName} from GitHub Releases. Please wait..."
$baseDir = Join-Path $env:USERPROFILE 'Downloads\\AI PC Agent Downloads'
if (-not (Test-Path $baseDir)) {
    New-Item -ItemType Directory -Path $baseDir -Force | Out-Null
}


$assetPath = Join-Path $baseDir '${escapedAssetName}'
Invoke-WebRequest -Uri '${escapedUrl}' -OutFile $assetPath -UseBasicParsing
if (-not (Test-Path $assetPath)) {
    throw "Download failed: ${assetName}"
}


if ($assetPath -like '*.zip') {
    $extractDir = Join-Path $baseDir '${extractDirName}'
    if (Test-Path $extractDir) {
        Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    }


    Expand-Archive -Path $assetPath -DestinationPath $extractDir -Force
}


\`\`\`
## Verify
\`\`\`powershell
try {
    $baseDir = Join-Path $env:USERPROFILE 'Downloads\\AI PC Agent Downloads'
    $assetPath = Join-Path $baseDir '${escapedAssetName}'
    if (-not (Test-Path $assetPath)) {
        throw "Downloaded asset not found: ${assetName}"
    }


    $true
} catch {
    $false
}


\`\`\`
## Uninstall
\`\`\`powershell
Write-Host "Removing downloaded ${repoName} release asset..."
$baseDir = Join-Path $env:USERPROFILE 'Downloads\\AI PC Agent Downloads'
$assetPath = Join-Path $baseDir '${escapedAssetName}'
$extractDir = Join-Path $baseDir '${extractDirName}'
if (Test-Path $assetPath) {
    Remove-Item -Path $assetPath -Force -ErrorAction Stop
}


if (Test-Path $extractDir) {
    Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
}


\`\`\`
4. Error Handling
Error Code / Message,Possible Cause,AI Auto Fix
404 / Not Found,GitHub release asset no longer exists,1. Search repository releases again 2. Regenerate SOP with a newer asset
Invoke-WebRequest failed,Network or GitHub rate limit issue,1. Retry later 2. Verify network access to github.com
5. Notes
- Repo: ${repoFullName}

- Tag: ${tagName || 'latest'}

- Asset: ${assetName}

- URL: ${downloadUrl}

`;
}


function searchMicrosoftStorePackages(query, limit = 8) {
    return searchWingetPackagesBySource(query, 'msstore', limit);
}


function createStoreSopFile(packageInfo = {}, options = {}) {
    const markdown = options.builder(packageInfo);
    const sopIdMatch = markdown.match(/^ID:\s*(.+)$/m);
    const filePrefix = options.filePrefix || 'install';
    const fileName = `${filePrefix}-${slugifyWingetPackage(packageInfo.id || packageInfo.name || 'package')}.md`;
    const filePath = path.join(SOPS_DIR, fileName);
    fs.writeFileSync(filePath, markdown, 'utf8');
    return {
        fileName,
        filePath,
        sopId: sopIdMatch ? sopIdMatch[1].trim() : '',
    };
}


function buildStoreSopMarkdown(packageInfo = {}, options = {}) {
    const packageName = String(packageInfo.name || packageInfo.id || 'Unknown Package').trim();
    const packageId = String(packageInfo.id || '').trim();
    const source = String(options.source || packageInfo.source || 'winget').trim() || 'winget';
    const category = String(options.category || source).trim() || 'winget store';
    const titleVerb = String(options.titleVerb || 'Install').trim() || 'Install';
    const sopId = `${slugifyWingetPackage(source)}_${slugifyWingetPackage(packageId || packageName)}`;
    const packageIdRegex = escapeRegExp(packageId);
    const packageNameRegex = escapeRegExp(packageName);
    const uninstallSourceFlag = source === 'winget' ? '' : ` --source ${source}`;
    const installSourceFlag = source === 'winget' ? '' : ` --source ${source}`;
    return `# AI PC Agent SOP File v1
1. Metadata
ID: ${sopId}

Name: ${titleVerb} ${packageName}

Category: ${category}

Risk Level: Low
2. Prerequisites
OS: Windows 10 / 11
Permissions: Standard User
Network: Required (download via winget)
3. Execution Steps
## Check
Expected Result: Return True when the package is already installed.
\`\`\`powershell
try {
    $result = (& winget list --id ${packageId} --exact --accept-source-agreements 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and ($result -match "${packageIdRegex}" -or $result -match "${packageNameRegex}")) {
        $true
    } else {
        $false
    }


} catch {
    $false
}


\`\`\`
## Install
\`\`\`powershell
Write-Host "Installing ${packageName} via winget. Please wait..."
if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}


& winget install --id ${packageId} --exact${installSourceFlag} --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if ($LASTEXITCODE -ne 0) {
    Write-Host "winget install returned a non-zero exit code: $LASTEXITCODE. Verifying actual install state..."
}


$installed = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $result = (& winget list --id ${packageId} --exact --accept-source-agreements 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and ($result -match "${packageIdRegex}" -or $result -match "${packageNameRegex}")) {
        $installed = $true
        break
    }


}


if (-not $installed) {
    throw "winget finished but ${packageName} still cannot be detected. Check the source, network, or interactive installer behavior."
}


\`\`\`
## Verify
\`\`\`powershell
try {
    $result = (& winget list --id ${packageId} --exact --accept-source-agreements 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and ($result -match "${packageIdRegex}" -or $result -match "${packageNameRegex}")) {
        $true
    } else {
        throw "${packageName} verification failed."
    }


} catch {
    $false
}


\`\`\`
## Uninstall
\`\`\`powershell
Write-Host "Uninstalling ${packageName} via winget. Please wait..."
if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}


& winget uninstall --id ${packageId} --exact${uninstallSourceFlag} --silent --accept-source-agreements --disable-interactivity
if ($LASTEXITCODE -ne 0) {
    Write-Host "winget uninstall returned a non-zero exit code: $LASTEXITCODE. Verifying actual uninstall state..."
}


$removed = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $result = (& winget list --id ${packageId} --exact --accept-source-agreements 2>&1 | Out-String)
    if (-not ($result -match "${packageIdRegex}") -and -not ($result -match "${packageNameRegex}")) {
        $removed = $true
        break
    }


}


if (-not $removed) {
    throw "winget finished but ${packageName} is still detected. Check whether an interactive uninstaller is still pending."
}


\`\`\`
4. Error Handling
Error Code / Message,Possible Cause,AI Auto Fix
No package found,winget cannot find the requested package,1. Verify the package id 2. Search winget again
winget is not available,Microsoft App Installer is missing,1. Install or update Microsoft App Installer
`;
}


function buildMicrosoftStoreSopMarkdown(packageInfo = {}) {
    return buildStoreSopMarkdown(packageInfo, {
        source: 'msstore',
        category: 'microsoft store',
        titleVerb: 'Install',
    });
}


function createMicrosoftStoreSopFile(packageInfo = {}) {
    return createStoreSopFile(packageInfo, {
        builder: buildMicrosoftStoreSopMarkdown,
        filePrefix: 'install-msstore',
    });
}


async function searchGitHubReleaseApps(query, limit = 5) {
    try {
        const q = encodeURIComponent(`${String(query || '').trim()} windows`);
        const searchUrl = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=${Math.min(limit * 2, 10)}`;
        const searchData = await fetchJson(searchUrl);
        const repos = Array.isArray(searchData?.items) ? searchData.items.slice(0, Math.min(limit * 2, 8)) : [];
        const results = [];
        for (const repo of repos) {
            try {
                const releases = await fetchJson(`https://api.github.com/repos/${repo.full_name}/releases?per_page=5`);
                const bestAsset = pickBestGitHubAsset(Array.isArray(releases) ? releases.filter(r => !r.draft && !r.prerelease) : []);
                if (!bestAsset) continue;
                results.push({
                    name: repo.name,
                    fullName: repo.full_name,
                    description: repo.description || '',
                    htmlUrl: repo.html_url,
                    tagName: bestAsset.tagName,
                    assetName: bestAsset.assetName,
                    downloadUrl: bestAsset.downloadUrl,
                    assetSize: bestAsset.size || 0,
                });
                if (results.length >= limit) break;
            } catch {
                continue;
            }


        }


        return results;
    } catch {
        return [];
    }


}


function isUsefulGitHubAsset(asset = {}) {
    const name = String(asset?.name || '').toLowerCase();
    if (!name) return false;
    if (!/\.(exe|msi|zip)$/.test(name)) return false;
    if (/sha|checksum|checksums|sig|asc|symbols|debug|source[\s._-]*code/.test(name)) return false;
    return true;
}


function createGitHubReleaseSopFile(packageInfo = {}) {
    const markdown = buildGitHubReleaseSopMarkdown(packageInfo);
    const sopIdMatch = markdown.match(/^ID:\s*(.+)$/m);
    const baseName = `${packageInfo.fullName || packageInfo.name || 'github-app'}-${packageInfo.assetName || 'asset'}`;
    const fileName = `download-${slugifyWingetPackage(baseName)}.md`;
    const filePath = path.join(SOPS_DIR, fileName);
    fs.writeFileSync(filePath, markdown, 'utf8');
    return {
        fileName,
        filePath,
        sopId: sopIdMatch ? sopIdMatch[1].trim() : '',
    };
}


function searchWingetPackagesBySource(query, source = 'winget', limit = 8) {
    try {
        const safeQuery = String(query || '').replace(/"/g, '');
        const safeSource = String(source || 'winget').replace(/"/g, '');
        const output = execSync(`winget search --query "${safeQuery}" --source ${safeSource} --accept-source-agreements`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        return parseWingetSearchOutput(output)
            .map(pkg => ({ ...pkg, source: safeSource }))
            .slice(0, limit);
    } catch {
        return [];
    }


}


function shouldSearchGitHubReleases(message = '') {
    return /(github|repo|repository|release|開源|portable)/i.test(String(message || ''));
}


// ── Start Server ────────────────────────────────────────────────────
app.post('/api/llm/test', async (req, res) => {
    try {
        const { provider, baseUrl, model, authConfig } = req.body;
        if (!provider || !baseUrl || !model) {
            return res.status(400).json({ success: false, error: 'Missing provider, baseUrl or model' });
        }


        const reply = await llm.testProviderConnection({ provider, baseUrl, authConfig, model });
        res.json({ success: true, reply });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }


});
app.listen(PORT, async () => {
    const startMsg = `AI PC Agent started! (PID: ${process.pid}, Path: ${process.execPath})`;
    console.log(`\n  🖥️  ${startMsg}`);
    fileLog(startMsg);
    console.log(`  📍 http://localhost:${PORT}`);
    console.log(`  🌐 Remote Agent TCP: 0.0.0.0:${DEFAULT_REMOTE_PORT}`);
    console.log(`  📂 SOPs    Directory: ${SOPS_DIR}`);
    console.log(`  🛠️ Skills  Directory: ${SKILLS_DIR}`);
    console.log(`  🔌 Plugins Directory: ${PLUGINS_DIR}`);
    fileLog(`SOPs Directory: ${SOPS_DIR}`);
    fileLog(`Remote Agent TCP Port: ${DEFAULT_REMOTE_PORT}`);
    fileLog(`Skills Directory: ${SKILLS_DIR}`);
    fileLog(`Plugins Directory: ${PLUGINS_DIR}`);
    // 啟動時非同步檢查 LLM 狀態
    try {
        const result = await llm.checkOllamaStatus();
        const provider = llm.getCurrentProvider();
        if (result.available && result.modelReady) {
            let msg = `🧠 LLM ready: ${provider}`;
            if (provider === 'Ollama' && result.version) {
                msg += ` v${result.version}`;
            }


            msg += `, model ${result.modelName} loaded`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        } else if (result.available) {
            const msg = `🟡 ${provider} running, but no model ready`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        } else {
            const msg = `🔴 No ${provider} service detected (${llm.getCurrentBaseUrl()})`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        }


    } catch (e) {
        fileLog(`LLM Check Failed: ${e.message}`);
        console.log(`  🔴 LLM status check failed\n`);
    }


});
