/**
 * Visual Agent Local Server
 * 
 * 提供 REST API 給前端 UI 使用，橋接 sop-parser 與 sop-executor。
 * 啟動後會自動開啟瀏覽器。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execSync, spawnSync, spawn } = require('child_process');
const os = require('os');
const net = require('net');

const appDataDir = process.env.APPDATA || path.join(os.homedir(), '.config');
const visualAgentDir = path.join(appDataDir, 'visual-agent');
if (!fs.existsSync(visualAgentDir)) {
    fs.mkdirSync(visualAgentDir, { recursive: true });
}
const appDataBrowserDir = path.join(visualAgentDir, 'playwright-browsers');
const defaultPlaywrightBrowserDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = appDataBrowserDir;
}

let playwright = null;
try {
    playwright = require('playwright');
} catch {
    playwright = null;
}
const pkg = require('../package.json');
const { loadAllSOPs } = require('./sop-parser');
const { SOPExecutor } = require('./sop-executor');
const llm = require('./llm');
const { getSystemHealth } = require('./system');
const { DEFAULT_REMOTE_PORT, RemoteAgentService, getLocalIPv4List } = require('./remote-agent');
// 純函式集（自本檔抽出，見 src/pure.js）— 解構回本地綁定，原有呼叫點不需改動。
const {
    tokenizeForMatch, scoreByTokenSet, escapeMarkdown, redactSensitiveText,
    compactMarkdownSnippet, buildChatHistoryForRequest, normalizeChalkboardAttachment,
    getTaskDurationText, pickExperienceHighlights, buildExperienceAdvice,
    buildExperienceMarkdown, detectAgentFinanceIntent, detectGameResearchIntent,
    extractWingetSearchQuery, parseWingetSearchOutput, slugifyWingetPackage,
    escapeRegExp, formatUsdBillions, buildNvidiaSnapshotLines,
} = require('./pure');
// ACTION / SUGGEST 標籤解析（自 /api/chat handler 抽出，見 src/agent/actions.js）。
const { normalizeActionString, extractActionsFromReply } = require('./agent/actions');
// 軟體推薦 prompt 註解（自 /api/chat handler 抽出，見 src/agent/prompts.js）。
const { buildRecommendationPromptNotes } = require('./agent/prompts');
const app = express();
const PORT = 3210;
const APP_VERSION = pkg.version || 'dev';
const REMOTE_AI_REPLY_TIMEOUT_MS = 190000;
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
app.use(express.static(path.join(__dirname, '../public'), {
    setHeaders(res, filePath) {
        if (/(?:index\.html|app\.js|style\.css)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'no-store');
        }
    },
}));
const isPkg = typeof process.pkg !== 'undefined';

function getPlaywrightBrowserDirCandidates() {
    // 只認 appData 自己管理的安裝目錄，避免誤判圖 %LOCALAPPDATA%\ms-playwright 等系統安裝位置
    return [process.env.PLAYWRIGHT_BROWSERS_PATH, appDataBrowserDir]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((p, i, arr) => arr.indexOf(p) === i); // 去重
}

function findExecutableRecursive(rootDir, executableName = 'chrome-headless-shell.exe') {
    const targetNames = (Array.isArray(executableName) ? executableName : [executableName])
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean);
    if (!rootDir || !fs.existsSync(rootDir)) return '';
    if (!targetNames.length) return '';
    const stack = [rootDir];
    while (stack.length) {
        const currentDir = stack.pop();
        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                } else if (entry.isFile() && targetNames.includes(entry.name.toLowerCase())) {
                    return fullPath;
                }
            }
        } catch {}
    }
    return '';
}

function resolvePlaywrightBrowserDir() {
    for (const browserDir of getPlaywrightBrowserDirCandidates()) {
        try {
            const browserExe = findExecutableRecursive(browserDir, ['chrome-headless-shell.exe', 'chrome.exe']);
            if (browserExe) return browserDir;
        } catch {}
    }
    return '';
}

function resolvePlaywrightBrowserExecutable() {
    for (const browserDir of getPlaywrightBrowserDirCandidates()) {
        const browserExe = findExecutableRecursive(browserDir, ['chrome-headless-shell.exe', 'chrome.exe']);
        if (browserExe) return browserExe;
    }
    return '';
}


const TASKS_FILE = path.join(visualAgentDir, 'tasks.json');
const REMOTE_PROFILE_FILE = path.join(visualAgentDir, 'remote-profile.json');
const SOPS_DIR = path.join(visualAgentDir, 'sops');
const SKILLS_DIR = path.join(visualAgentDir, 'skills');
const PLUGINS_DIR = path.join(visualAgentDir, 'plugins');
const EXPS_DIR = path.join(visualAgentDir, 'exps');
let remoteStateTick = Date.now();
const remoteAiReplyQueues = new Map();
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

function enqueueRemoteAiReply(sessionId, task) {
    const previous = remoteAiReplyQueues.get(sessionId) || Promise.resolve();
    const next = previous
        .catch(() => {})
        .then(() => runWithTimeout(task(), REMOTE_AI_REPLY_TIMEOUT_MS, 'Remote AI reply timed out before completion.'));
    remoteAiReplyQueues.set(sessionId, next.finally(() => {
        if (remoteAiReplyQueues.get(sessionId) === next) {
            remoteAiReplyQueues.delete(sessionId);
        }
    }));
    return next;
}

function runWithTimeout(promise, timeoutMs, message) {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
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
        // Sync SOPs - directory-per-SOP format: sops/<slug>/SOP.md
        if (fs.existsSync(bundledSopsDir)) {
            const entries = fs.readdirSync(bundledSopsDir, { withFileTypes: true });
            entries.forEach(entry => {
                if (entry.isDirectory()) {
                    const srcFile = path.join(bundledSopsDir, entry.name, 'SOP.md');
                    if (!fs.existsSync(srcFile)) return;
                    const destDir = path.join(SOPS_DIR, entry.name);
                    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                    syncIfChanged(srcFile, path.join(destDir, 'SOP.md'));
                }
            });
        }


        // Sync Skills - agentskills.io directory format: skills/<slug>/SKILL.md (only)
        if (fs.existsSync(bundledSkillsDir)) {
            const entries = fs.readdirSync(bundledSkillsDir, { withFileTypes: true });
            entries.forEach(entry => {
                if (!entry.isDirectory()) return;
                const srcSkillFile = path.join(bundledSkillsDir, entry.name, 'SKILL.md');
                if (!fs.existsSync(srcSkillFile)) return;
                const destDir = path.join(SKILLS_DIR, entry.name);
                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                syncIfChanged(srcSkillFile, path.join(destDir, 'SKILL.md'));
                ['scripts', 'references', 'assets'].forEach(sub => {
                    const srcSub = path.join(bundledSkillsDir, entry.name, sub);
                    if (!fs.existsSync(srcSub)) return;
                    const destSub = path.join(destDir, sub);
                    if (!fs.existsSync(destSub)) fs.mkdirSync(destSub, { recursive: true });
                    fs.readdirSync(srcSub).forEach(f => syncIfChanged(path.join(srcSub, f), path.join(destSub, f)));
                });
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
    onMessage: (session, message, payload) => {
        if (message.type !== 'chat_message') return;
        if (message.target !== 'remote-ai') return;
        enqueueRemoteAiReply(session.id, async () => {
            try {
                const profile = getRemoteProfile();
                remoteAgent.sendAiStatus(session.id, {
                    status: 'thinking',
                    senderLabel: profile.agentName,
                });
                const history = session.messages
                    .filter((item) => item.type === 'chat_message')
                    .slice(-6)
                    .map((item) => ({
                        role: item.senderType === 'ai' && item.direction !== 'incoming' ? 'assistant' : 'user',
                        content: `${item.senderLabel || item.senderType}: ${item.text || item.caption || ''}`.trim(),
                    }));
                const localHardwareContext = await getSystemHealth();
                const aiReply = isLocalHardwareStatusQuestion(message.text || '')
                    ? await buildLocalHardwareStatusReply(payload?.locale || session.peer?.locale || 'zh-TW')
                    : await llm.chatWithLLM(
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
                            `The current requester is: ${message.senderType === 'ai' ? 'the remote AI agent' : 'the remote human user'} (${message.senderLabel || 'Unknown'}).`,
                            `Address people by their explicit Windows user names. Do not say generic "使用者你好". Refer to yourself as ${profile.machineName}, and refer to the peer as ${session.peer?.machineName || 'remote PC'}.`,
                            `You are replying inside a remote support chat over TCP port ${DEFAULT_REMOTE_PORT}.`,
                        'If asked who is talking to you, answer whether it is the remote human or the remote AI.',
                        'If asked what model you are using, answer with the exact current provider and model shown above.',
                        'If the incoming message is from another AI, treat it as a teammate note and produce the final concise answer for the human user. Do not argue with the other AI.',
                        'If the human asks for teamwork, split work clearly between local AI and remote AI instead of both doing the same task.',
                        buildLatestChalkboardContext(session, payload?.locale || session.peer?.locale || 'zh-TW'),
                        'When using ##CHALKBOARD##, coordinate with Local AI. You are the Remote AI: use "position: right" and "clear: false"; never redraw or redefine a board/grid that already exists. For games such as tic-tac-toe, keep the existing numbering/coordinates and only update your move/status.',
                            `IMPORTANT: All hardware info (CPU/RAM/disk/free space) belongs to THIS machine (${profile.machineName}). When answering questions about disk space or system resources, always specify which machine: "On ${profile.machineName}: ..."`,
                            (() => { const ramTotal = Math.round(os.totalmem()/1024/1024/1024); const ramFree = Math.round(os.freemem()/1024/1024/1024); const diskFreePart = formatDiskFreePart(localHardwareContext); return `Local machine (${profile.machineName}) RAM: ${ramTotal - ramFree}GB used / ${ramTotal}GB total, Free: ${ramFree}GB\nLocal machine Disk Free Space: ${diskFreePart}`; })(),
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
                    locale: payload?.locale || session.peer?.locale || 'zh-TW',
                });
            } catch (error) {
                fileLog(`Remote AI reply failed: ${error.message}`);
                try {
                    remoteAgent.sendSystemMessage(
                        session.id,
                        `Remote AI failed to reply: ${error.message}`,
                        { localText: `Local AI failed to reply: ${error.message}` }
                    );
                } catch {
                    // ignore
                }
            } finally {
                try {
                    const profile = getRemoteProfile();
                    remoteAgent.sendAiStatus(session.id, {
                        status: 'idle',
                        senderLabel: profile.agentName,
                    });
                } catch {
                    // ignore
                }
            }
        });
    }
});
let remoteAgentStarted = false;
// ── In-memory state ─────────────────────────────────────────────────
let todoList = [];
let logs = [];
let runningSOP = null;
const browserSession = {
    browser: null,
    context: null,
    page: null,
    startedAt: '',
    lastTitle: '',
    lastUrl: '',
};
let chatHistory = []; // 儲存最近 6 則對話：[{role: 'user', content: '...'}, {role: 'assistant', content: '...'}]
const localChatHistoryBySession = new Map();
const sopStateCache = new Map();
const SOP_STATE_TTL_MS = 30000;
let skillDocsCache = [];
let skillDocsCacheAt = 0;
const SKILL_DOC_CACHE_TTL_MS = 30000;


/**
 * Load skill documents from SKILLS_DIR.
 * Reads agentskills.io spec format only: skills/<slug>/SKILL.md
 */
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
        const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
        entries.forEach((entry) => {
            if (!entry.isDirectory()) return;
            try {
                const skillFile = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
                if (!fs.existsSync(skillFile)) return;
                const content = fs.readFileSync(skillFile, 'utf8');
                const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/m);
                const fmText = fmMatch ? fmMatch[1] : '';
                const nameMatch = fmText.match(/^name:\s*(.+)$/m);
                const descMatch = fmText.match(/^description:\s*(.+)$/m);
                const categoryMatch = fmText.match(/^category:\s*(.+)$/m);
                const tagsBlockMatch = fmText.match(/^tags:\s*\r?\n((?:\s+-\s*.+\r?\n?)+)/m);
                const tagsInlineMatch = fmText.match(/^tags:\s*(.+)$/m);
                const displayName = nameMatch ? nameMatch[1].trim().replace(/^["']|["']$/g, '') : entry.name;
                const description = descMatch ? descMatch[1].trim().replace(/^["']|["']$/g, '') : '';
                const tags = tagsBlockMatch
                    ? tagsBlockMatch[1].split(/\r?\n/).map((line) => line.replace(/^\s+-\s*/, '').trim()).filter(Boolean)
                    : (tagsInlineMatch ? tagsInlineMatch[1].trim().replace(/^\[|\]$/g, '').split(',').map((tag) => tag.trim()).filter(Boolean) : []);
                const category = categoryMatch ? categoryMatch[1].trim().replace(/^["']|["']$/g, '') : 'Skills';
                const sourceMatch = fmText.match(/^source:\s*(.+)$/m);
                const sourceRaw = sourceMatch ? sourceMatch[1].trim().replace(/^["']|["']$/g, '') : '';
                const source = sourceRaw || (entry.name.startsWith('hermes-') ? 'hermes-agent' : 'visual-agent');
                docs.push({
                    slug: entry.name,
                    name: displayName,
                    description,
                    tags,
                    category,
                    source,
                    content,
                    tokens: new Set(tokenizeForMatch(
                        `${displayName} ${description} ${tags.join(' ')} ${category} ${content.slice(0, 1200)}`
                    )),
                });
            } catch (innerError) {
                fileLog(`Skill load failed for '${entry.name}': ${innerError.message}`);
            }
        });
    } catch (error) {
        fileLog(`Skill document load failed: ${error.message}`);
    }
    skillDocsCache = docs;
    skillDocsCacheAt = now;
    return docs;
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




function formatDateStamp(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
    ].join('');
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
            fs.writeFileSync(expPath, `# Visual Agent Experience Log - ${stamp}\n\n`, 'utf8');
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

function queueSopTaskById(sopsWithState = [], sopId = '', description = 'Scheduled by AI Agent') {
    const targetId = String(sopId || '').trim();
    if (!targetId) return { success: false, error: 'Missing SOP id' };
    const existingTask = [...todoList].reverse().find((task) =>
        String(task.skillId || '') === targetId && ['pending', 'running'].includes(String(task.status || ''))
    );
    if (existingTask) {
        return { success: true, task: existingTask, reused: true };
    }
    const sop = sopsWithState.find((item) => String(item.id || '') === targetId);
    if (!sop) return { success: false, error: `SOP not found: ${targetId}` };
    const task = {
        id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        title: buildTaskTitle(sop, sop.recommendedAction),
        description,
        skillId: sop.id,
        action: sop.recommendedAction,
        category: sop.category || 'Maintenance',
        status: 'pending',
        progress: 0,
        logs: [],
        createdAt: new Date().toISOString(),
        completedAt: null,
    };
    todoList.push(task);
    saveTasks();
    return { success: true, task, reused: false };
}

function buildLocalAgentContext(sessionSummary = null) {
    const profile = getRemoteProfile();
    const lines = [
        `Current AI agent name: ${profile.agentName}`,
        `Current machine name: ${profile.machineName}`,
        `Current Windows user name: ${profile.userName}`,
        `Current machine IP: ${profile.ip}`,
        `Current AI provider: ${llm.getCurrentProvider() || 'Unknown'}`,
        `Current AI model: ${llm.getCurrentModel() || 'Unknown'}`,
        `Identity rule: address the local human as ${profile.userName}; refer to yourself as ${profile.machineName}. Do not use generic "使用者你好".`,
    ];

    if (sessionSummary?.peer) {
        lines.push(`Connected remote machine name: ${sessionSummary.peer.machineName || 'Unknown'}`);
        lines.push(`Connected remote user name: ${sessionSummary.peer.userName || 'Unknown'}`);
        lines.push(`Connected remote AI name: ${sessionSummary.peer.agentName || 'Unknown'}`);
        lines.push(`Connected remote IP: ${sessionSummary.peer.ip || sessionSummary.host || 'Unknown'}`);
    }

    return lines.join('\n');
}

function isLocalHardwareStatusQuestion(text = '') {
    return /(free\s*space|disk\s*space|磁碟|硬碟|容量|剩餘空間|ram|記憶體|cpu|gpu|顯卡|硬體)/i.test(String(text || ''));
}

function requiresSopRuntimeState(message = '') {
    return /(安裝|移除|解除安裝|更新|修復|執行|開始|工作清單|任務|sop|install|uninstall|update|repair|run|start|task)/i.test(String(message || ''));
}

function getCachedOrDefaultSopState(sop = {}) {
    const cached = sopStateCache.get(sop.id)?.state;
    return cached || {
        installed: false,
        supportsUninstall: Boolean(sop?.steps?.uninstall?.commands?.length),
        recommendedAction: 'install',
    };
}

async function buildLocalHardwareStatusReply(locale = 'zh-TW') {
    const profile = getRemoteProfile();
    const health = await getSystemHealth();
    const ramTotal = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const ramFree = Math.round(os.freemem() / 1024 / 1024 / 1024);
    const diskLines = buildDiskLinesFromHealth(health, locale);
    if (locale === 'en-US') {
        return [
            `On ${profile.machineName}:`,
            `- RAM: ${ramTotal - ramFree}GB used / ${ramTotal}GB total, ${ramFree}GB free`,
            ...diskLines.map((line) => `- ${line}`),
        ].join('\n');
    }
    return [
        `${profile.machineName} 這台電腦：`,
        `- RAM：已用 ${ramTotal - ramFree}GB / 總共 ${ramTotal}GB，剩餘 ${ramFree}GB`,
        ...diskLines.map((line) => `- ${line}`),
    ].join('\n');
}

function getRemoteSessionById(sessionId = '') {
    return remoteAgent.getSession(sessionId) || null;
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






function searchWingetPackages(query, limit = 8) {
    return searchWingetPackagesBySource(query, 'winget', limit);
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

function openFileWithArguments(filePath = '', argumentsText = '') {
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };
    const escapedPath = escapePowerShellSingleQuoted(filePath);
    const escapedArgs = escapePowerShellSingleQuoted(argumentsText || '');
    return runPowerShellCapture(`Start-Process -FilePath '${escapedPath}' -ArgumentList '${escapedArgs}'`, 8000);
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
        'User-Agent': 'visual-agent/2026.04.01 (local desktop agent)',
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
    const src = String(actionStr || '');
    const keyEsc = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!keyEsc) return '';
    const quoted = src.match(new RegExp(`${keyEsc}\\s*=\\s*"([^"]*)"`, 'i'))
        || src.match(new RegExp(`${keyEsc}\\s*=\\s*'([^']*)'`, 'i'));
    if (quoted) return quoted[1];
    const bare = src.match(new RegExp(`${keyEsc}\\s*=\\s*([^\\s\\]]+)`, 'i'));
    return bare ? bare[1] : '';
}

function parseBrowserUseMode(actionStr = '') {
    const mode = parseActionArg(actionStr, 'mode') || parseActionArg(actionStr, 'action') || 'search';
    return String(mode || 'search').trim().toLowerCase() || 'search';
}

function stripControlTagsFromReply(text = '') {
    return String(text || '')
        .replace(/\[(?:ACTION\s*[:=]\s*|Action\s*=\s*).*?\]/gi, '')
        .replace(/(?:^|\n)\s*Action\s*=\s*[A-Za-z_]+[^\r\n]*/gi, '')
        .replace(/\[SUGGEST:.*?\]/g, '')
        .replace(/##CHALKBOARD##[\s\S]*?(?:##ENDCHALKBOARD##|$)/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function isUsableAgentFinalReply(text = '') {
    const clean = stripControlTagsFromReply(text);
    if (clean.length < 12) return false;
    if (/^(已執行指定動作|Done\.?\s*I executed the requested action\.?|馬上幫你查|好的[，,]?\s*我來查|我來幫你查|收到|了解|OK\.?|Sure\.?)[。.!！…]*$/i.test(clean)) {
        return false;
    }
    // Pure "I'll look it up" without facts
    if (
        clean.length < 60
        && /(馬上|立刻|正在|先查|幫你查|looking up|let me (check|search|look)|I'll (check|search|look))/i.test(clean)
        && !/(https?:\/\/|來源|°C|℃|NT\$|評分|上市|release|steam|ps5|switch|xbox|\d{4})/i.test(clean)
    ) {
        return false;
    }
    return true;
}

function buildFallbackAnswerFromToolSummaries(summaries = [], userMessage = '', locale = 'zh-TW') {
    const blocks = (Array.isArray(summaries) ? summaries : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    if (!blocks.length) {
        return locale === 'en-US'
            ? 'I could not finish the lookup with usable sources. Please try again, or install Browser runtime if Browser Use is unavailable.'
            : '這次查詢沒有整理出可用來源。請再試一次；若 Browser Use 不可用，請先安裝 Playwright Chromium。';
    }
    const joined = blocks.join('\n\n');
    const lines = joined.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const linkLines = lines
        .filter((line) => /^\d+\.\s+/.test(line) && /https?:\/\//i.test(line))
        .slice(0, 6);
    const contentChunks = [];
    const parts = joined.split(/(?=Source \d+:|已自動抓取來源內容|Extracted source content|Extracted content from|從\s+https?:\/\/)/i);
    for (const part of parts) {
        const chunk = String(part || '').trim();
        if (chunk.length > 50 && /(Source |URL:|抓取|Extracted|從\s+https?:\/\/)/i.test(chunk)) {
            contentChunks.push(chunk.slice(0, 1000));
        }
        if (contentChunks.length >= 3) break;
    }
    if (locale === 'en-US') {
        return [
            `Here is what I found for: ${userMessage}`,
            contentChunks.length ? contentChunks.join('\n\n---\n\n') : joined.slice(0, 2000),
            linkLines.length ? `### Sources\n${linkLines.join('\n')}` : '',
        ].filter(Boolean).join('\n\n');
    }
    return [
        `針對「${userMessage}」，目前查到的重點如下：`,
        contentChunks.length ? contentChunks.join('\n\n---\n\n') : joined.slice(0, 2000),
        linkLines.length ? `### 來源\n${linkLines.join('\n')}` : '',
    ].filter(Boolean).join('\n\n');
}

function buildAgentLoopContinuePrompt(locale = 'zh-TW', turn = 1, forceFinal = false) {
    if (locale === 'en-US') {
        return forceFinal
            ? '[Agent Loop] You already have tool results above. Give the user a complete final answer NOW in plain language with concrete facts and source links. Do NOT output ACTION tags. Do NOT say only "done" or "executed".'
            : `[Agent Loop turn ${turn}] If tool results already contain enough facts, answer the user completely now. Only output ACTION if you still lack necessary page content. Never reply with only control tags.`;
    }
    return forceFinal
        ? '[Agent Loop] 上方已有工具結果。請立刻用繁體中文給使用者完整最終答案：具體重點 + 來源連結。禁止再輸出 ACTION。禁止只回「已執行指定動作」。'
        : `[Agent Loop 第 ${turn} 回合] 若工具結果已有足夠事實，請直接給完整答案；只有缺內容時才輸出 ACTION。禁止只輸出控制碼或空話。`;
}

function formatDiskFreePart(health = null) {
    const volumeList = Array.isArray(health?.disk?.volumes) ? health.disk.volumes : [];
    if (!volumeList.length) return 'Unknown';
    return volumeList
        .map((v) => `${v.name || v.label || 'Disk'} ${Math.round((Number(v.free) || 0) / 1024 / 1024 / 1024)}GB / ${Math.round((Number(v.size) || 0) / 1024 / 1024 / 1024)}GB free`)
        .join('; ');
}

function buildDiskLinesFromHealth(health = null, locale = 'zh-TW') {
    const volumes = Array.isArray(health?.disk?.volumes) ? health.disk.volumes : [];
    if (!volumes.length) {
        return [locale === 'en-US' ? 'Disk free space: Unknown' : '磁碟剩餘空間：Unknown'];
    }
    return volumes.map((v) => {
        const name = v.name || v.label || v.deviceId || 'Disk';
        const free = Math.round((Number(v.free) || 0) / 1024 / 1024 / 1024);
        const size = Math.round((Number(v.size) || 0) / 1024 / 1024 / 1024);
        return `${name}: ${free}GB free / ${size}GB total`;
    });
}

function buildLatestChalkboardContext(session = null, locale = 'zh-TW') {
    const latest = [...(session?.messages || [])]
        .reverse()
        .find((item) => item.type === 'chalkboard_state' && item.imageDataUrl);
    if (!latest) {
        return locale === 'en-US'
            ? 'No recent Chalkboard sync has been received in this session.'
            : '此連線目前沒有最近的 Chalkboard 同步紀錄。';
    }
    const sender = latest.senderLabel || (latest.direction === 'incoming' ? 'Remote peer' : 'Local peer');
    const caption = String(latest.caption || '').trim();
    return locale === 'en-US'
        ? `Latest Chalkboard sync: updated by ${sender} at ${latest.createdAt || 'unknown time'}. ${caption || 'Review the latest synced Chalkboard state before answering if the task depends on shared notes.'} If you write to Chalkboard now, preserve this board, use clear:false, and add only a coordinated supplement.`
        : `最新 Chalkboard 同步：由 ${sender} 於 ${latest.createdAt || '未知時間'} 更新。${caption || '若回答依賴共同筆記，請先參考最新同步過來的 Chalkboard 狀態。'}`;
}

function shouldInvitePeerAiContinuation(text = '') {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) return false;
    return /(換你|輪到你|請你接著|請.*補|等你|your turn|take over|continue from here|remote ai.*continue|local ai.*continue)/i.test(normalized);
}

function buildPeerAiContinuationText(session = null, aiText = '', locale = 'zh-TW') {
    const peerName = session?.peer?.agentName || session?.peer?.machineName || 'Remote AI';
    const localName = session?.local?.agentName || session?.local?.machineName || 'Local AI';
    return locale === 'en-US'
        ? `Teammate handoff from ${localName}: ${aiText}\n\nPlease continue the collaboration now. If the Chalkboard already has a board/grid/coordinates, do not redraw or redefine it. Preserve the existing shared definition, use clear:false, and only update your move/status or a coordinated supplement.`
        : `${localName} 給 ${peerName} 的協作交接：${aiText}\n\n請你現在接續協作。若 Chalkboard 已有棋盤、格線、座標或共同定義，不要重畫或改定義；請沿用既有定義，使用 clear:false，只更新你的下一步、棋步或協調補充。`;
}

function parseStructuredSuggestions(reply = '', locale = 'zh-TW', fallbackSuggestions = []) {
    // Suggestion buttons are intentionally disabled: LLM-generated buttons were too often off-topic.
    return [];
    const raw = String(reply || '');
    const matches = [...raw.matchAll(/\[SUGGEST:(.*?)\]/gs)];
    if (!matches.length) return Array.isArray(fallbackSuggestions) ? fallbackSuggestions : [];
    const structured = matches.map((match) => {
        const body = String(match[1] || '').trim();
        const getArg = (key) => {
            const m = body.match(new RegExp(`${key}="(.*?)"`));
            return m ? m[1] : '';
        };
        const label = getArg('button_text');
        if (label) {
            return {
                label,
                action: getArg('action'),
                sopId: getArg('sop_id'),
                taskId: getArg('task_id'),
                mode: getArg('mode'),
            };
        }
        return { label: body, action: '', sopId: '', taskId: '', mode: '' };
    }).filter((item) => item.label);
    if (!structured.length) {
        return Array.isArray(fallbackSuggestions) ? fallbackSuggestions : [];
    }
    if (locale === 'en-US' && structured.some((item) => /[\u4e00-\u9fff]/.test(item.label || ''))) {
        return Array.isArray(fallbackSuggestions) ? fallbackSuggestions : [];
    }
    return structured;
}

function getRuntimeDateContext(locale = 'zh-TW') {
    const timeZone = 'Asia/Taipei';
    const now = new Date();
    const getParts = (date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'long',
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const today = getParts(now);
    const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tomorrow = getParts(tomorrowDate);
    const todayIso = `${today.year}-${today.month}-${today.day}`;
    const tomorrowIso = `${tomorrow.year}-${tomorrow.month}-${tomorrow.day}`;
    return locale === 'en-US'
        ? `Current date: ${todayIso} (${today.weekday}) in ${timeZone}. Tomorrow is ${tomorrowIso} (${tomorrow.weekday}). Resolve relative dates like today/tomorrow/yesterday from this context; never invent stale dates.`
        : `今天日期：${todayIso}（${today.weekday}，時區 ${timeZone}）。明天是 ${tomorrowIso}（${tomorrow.weekday}）。所有「今天/明天/昨天」都必須以這個日期解析，不可自行猜舊日期。`;
}

function isGameDiscoveryRequest(text = '') {
    const raw = String(text || '');
    const hasGame = /(\u904a\u6232|game|games|steam|ps5|switch|xbox|nintendo|playstation)/i.test(raw);
    const hasDiscovery = /(\u6700\u8fd1|\u6700\u65b0|\u65b0\u904a\u6232|\u65b0\u4f5c|\u4e0a\u5e02|\u767c\u552e|\u63a8\u85a6|\u6392\u884c|\u6709\u4ec0\u9ebc|latest|recent|new games?|upcoming|release|released|recommend|best|top)/i.test(raw);
    return hasGame && hasDiscovery;
}

function detectGameNewsIntent(text = '') {
    return isGameDiscoveryRequest(text);
}

function isCurrentInfoRequest(text = '') {
    const raw = String(text || '');
    return /(天氣|氣溫|降雨|颱風|物價|價格|報價|新聞|最新|今天|明天|昨日|昨天|匯率|股價|股票|油價|金價|weather|forecast|temperature|rain|price|quote|news|latest|today|tomorrow|yesterday|exchange rate|stock)/i.test(raw)
        || isGameDiscoveryRequest(raw);
}

function isWebResearchIntent(text = '') {
    const raw = String(text || '');
    return isCurrentInfoRequest(raw)
        || detectGameResearchIntentV3(raw)
        || /(查|搜尋|搜索|找|整理|比較|推薦|攻略|資料|來源|web|網路|網頁|search|find|research|compare|recommend|guide|walkthrough|source)/i.test(raw);
}

function inferFollowUpResearchQuery(message = '', history = []) {
    const current = String(message || '').trim();
    if (!current || current.length > 100 || !Array.isArray(history)) return '';
    const previousUserMessage = [...history].reverse()
        .find((entry) => entry?.role === 'user' && String(entry.content || '').trim());
    const previous = String(previousUserMessage?.content || '').trim();
    const followsGameNews = /(遊戲|game|steam|ps5|switch|xbox|nintendo|playstation)/i.test(previous)
        && /(新聞|最新|最近|新作|上市|news|latest|recent|release)/i.test(previous);
    const isPlatformFilter = /(純|只|限定|改成|那|這|pc|steam|epic|gog|itch|xbox|ps5|switch|平台)/i.test(current);
    if (!followsGameNews || !isPlatformFilter) return '';

    const platform = /(pc|電腦|steam|epic|gog|itch)/i.test(current) ? 'PC' : '';
    return `${platform ? `${platform} ` : ''}最新遊戲新聞（延續上一題的篩選條件：${current}）`;
}

function buildCurrentInfoSearchQuery(text = '', locale = 'zh-TW') {
    const base = String(text || '').trim();
    const context = getRuntimeDateContext(locale);
    const tomorrowMatch = context.match(locale === 'en-US' ? /Tomorrow is (\d{4}-\d{2}-\d{2})/ : /明天是 (\d{4}-\d{2}-\d{2})/);
    const todayMatch = context.match(locale === 'en-US' ? /Current date: (\d{4}-\d{2}-\d{2})/ : /今天日期：(\d{4}-\d{2}-\d{2})/);
    const dateHint = /(明天|tomorrow)/i.test(base)
        ? tomorrowMatch?.[1]
        : (/(今天|today)/i.test(base) ? todayMatch?.[1] : '');
    const yearHint = todayMatch?.[1]?.slice(0, 4) || '';
    const gameDiscoveryHint = isGameDiscoveryRequest(base)
        ? (locale === 'en-US'
            ? `latest new game releases ${yearHint} Steam PS5 Switch Xbox reviews`
            : `最新 新遊戲 上市 推薦 ${yearHint} Steam PS5 Switch Xbox 評價`)
        : '';
    return [base, dateHint, gameDiscoveryHint].filter(Boolean).join(' ');
}

function buildWebResearchSearchQuery(text = '', locale = 'zh-TW') {
    if (isCurrentInfoRequest(text)) return buildCurrentInfoSearchQuery(text, locale);
    return String(text || '').trim();
}

function buildToolObservation(content = '', locale = 'zh-TW') {
    const body = String(content || '').trim();
    return locale === 'en-US'
        ? `[Tool Observation]\n${body}\n\nUse this tool result to decide the next step. If it contains enough facts, answer the user directly with concrete details (do not say only "done" or "executed"). If it only contains links or empty text, call another ACTION.`
        : `[工具觀察結果]\n${body}\n\n請根據這份工具結果決定下一步。若已有足夠事實，直接用具體內容回答使用者（禁止只回「已執行指定動作」）；若只有連結或空內容，繼續呼叫下一個 ACTION。`;
}

function buildToolObservationMessage(content = '', locale = 'zh-TW') {
    return {
        role: 'user',
        content: buildToolObservation(content, locale),
    };
}

const AGENT_STATUS_TTL_MS = 10 * 60 * 1000;
const agentRunStatuses = new Map();

function normalizeAgentRunId(value = '') {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function setAgentRunStatus(runId = '', phase = 'planning', locale = 'zh-TW', detail = '') {
    const id = normalizeAgentRunId(runId);
    if (!id) return;
    const labels = locale === 'en-US'
        ? {
            planning: 'Planning',
            searching: 'Searching live sources',
            extracting: 'Extracting source content',
            summarizing: 'Summarizing findings',
            done: 'Done',
            error: 'Stopped',
        }
        : {
            planning: '規劃中',
            searching: '搜尋即時來源',
            extracting: '抽取來源內容',
            summarizing: '整理答案',
            done: '完成',
            error: '已停止',
        };
    agentRunStatuses.set(id, {
        success: true,
        runId: id,
        phase,
        label: labels[phase] || phase,
        detail: String(detail || ''),
        updatedAt: new Date().toISOString(),
    });
}

function pruneAgentRunStatuses() {
    const cutoff = Date.now() - AGENT_STATUS_TTL_MS;
    for (const [id, status] of agentRunStatuses.entries()) {
        if (Date.parse(status.updatedAt || '') < cutoff) agentRunStatuses.delete(id);
    }
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

function isPlaywrightAvailable() {
    return Boolean(playwright?.chromium);
}

function hasPlaywrightBrowserBinary() {
    return !!resolvePlaywrightBrowserExecutable();
}

async function ensureBrowserSession() {
    if (!isPlaywrightAvailable()) {
        throw new Error('Playwright not installed. Run npm.cmd install to enable Browser tab.');
    }
    const browserDir = resolvePlaywrightBrowserDir();
    const browserExe = resolvePlaywrightBrowserExecutable();
    if (browserDir) {
        process.env.PLAYWRIGHT_BROWSERS_PATH = browserDir;
    }
    if (!browserExe) {
        const err = new Error('Browser unavailable: Playwright Chromium not installed. Run the install_playwright_chromium SOP.');
        err.sopId = 'install_playwright_chromium';
        throw err;
    }
    if (browserSession.page && !browserSession.page.isClosed()) {
        return browserSession.page;
    }
    if (!browserSession.browser) {
        browserSession.browser = await playwright.chromium.launch({
            executablePath: browserExe,
            headless: true,
            args: ['--disable-blink-features=AutomationControlled'],
        });
    }
    browserSession.context = await browserSession.browser.newContext({
        viewport: { width: 1366, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    browserSession.page = await browserSession.context.newPage();
    browserSession.startedAt = new Date().toISOString();
    return browserSession.page;
}

async function closeBrowserSession() {
    try { await browserSession.page?.close(); } catch {}
    try { await browserSession.context?.close(); } catch {}
    try { await browserSession.browser?.close(); } catch {}
    browserSession.page = null;
    browserSession.context = null;
    browserSession.browser = null;
    browserSession.startedAt = '';
    browserSession.lastTitle = '';
    browserSession.lastUrl = '';
}

function normalizeNavigateUrl(input = '') {
    const raw = String(input || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
}

async function captureBrowserSnapshot(page) {
    const target = page || browserSession.page;
    if (!target) throw new Error('Browser session not started');
    const title = await target.title().catch(() => '');
    const url = target.url ? target.url() : '';
    const png = await target.screenshot({ fullPage: true, type: 'png' });
    browserSession.lastTitle = title || browserSession.lastTitle;
    browserSession.lastUrl = url || browserSession.lastUrl;
    return {
        title: title || '',
        url: url || '',
        snapshotDataUrl: `data:image/png;base64,${png.toString('base64')}`,
    };
}

async function runBrowserUseOperation(params = {}) {
    const mode = String(params.mode || '').toLowerCase();
        if (mode === 'open') {
        const targetUrl = normalizeNavigateUrl(params.url || '');
        if (!targetUrl) return { success: false, mode, error: 'Missing URL' };
        if (params.external === true) {
            return {
                success: openUrlInDefaultBrowser(targetUrl).success,
                mode,
                openedUrl: targetUrl,
                external: true,
            };
        }
        const page = await ensureBrowserSession();
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(60000, Number(params.timeoutMs) || 30000) });
        const snap = await captureBrowserSnapshot(page);
        return {
            success: true,
            mode,
            openedUrl: targetUrl,
            external: false,
            ...snap,
        };
    }
    if (mode === 'search') {
        const query = String(params.query || '').trim();
        const limit = Math.min(10, Number(params.limit) || 5);
        let results = [];
        let source = 'fetch';
        let fetchError = '';
        try {
            results = await searchWebLinks(query, limit);
        } catch (error) {
            fetchError = error.message || String(error);
        }
        if (!results.length && isPlaywrightAvailable() && hasPlaywrightBrowserBinary()) {
            source = 'browser';
            results = await searchWebLinksWithBrowser(query, limit);
        }
        if (!results.length && (!isPlaywrightAvailable() || !hasPlaywrightBrowserBinary())) {
            return {
                success: false,
                mode,
                query,
                source,
                fetchError,
                browserUnavailable: true,
                sopId: 'install_playwright_chromium',
                error: 'Browser Use plugin/runtime is unavailable. Install Playwright Chromium to enable live browser fallback.',
                results,
            };
        }
        return {
            success: true,
            mode,
            query,
            source,
            fetchError,
            results,
        };
    }
    if (mode === 'fetch_title') {
        const url = String(params.url || '').trim();
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'visual-agent/2026.04.01' },
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
    if (mode === 'navigate') {
        const url = normalizeNavigateUrl(params.url || '');
        if (!url) return { success: false, mode, error: 'Missing URL' };
        const page = await ensureBrowserSession();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(60000, Number(params.timeoutMs) || 30000) });
        const snap = await captureBrowserSnapshot(page);
        return { success: true, mode, ...snap };
    }
    if (mode === 'snapshot') {
        const page = await ensureBrowserSession();
        const snap = await captureBrowserSnapshot(page);
        return { success: true, mode, ...snap };
    }
    if (mode === 'extract_text') {
        const targetUrl = normalizeNavigateUrl(params.url || '');
        if (targetUrl) {
            if (!isPlaywrightAvailable() || !hasPlaywrightBrowserBinary()) {
                const fetched = await fetchReadablePageText(targetUrl);
                return {
                    success: true,
                    mode,
                    url: targetUrl,
                    title: fetched.title,
                    text: fetched.text,
                    source: 'fetch',
                };
            }
            const page = await ensureBrowserSession();
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(60000, Number(params.timeoutMs) || 30000) });
            await page.waitForTimeout(600).catch(() => null);
            const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 12000));
            return {
                success: true,
                mode,
                url: page.url(),
                title: await page.title().catch(() => ''),
                text: String(text || '').trim(),
                source: 'browser',
            };
        }
        const page = await ensureBrowserSession();
        const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 12000));
        return {
            success: true,
            mode,
            url: page.url(),
            title: await page.title().catch(() => ''),
            text: String(text || '').trim(),
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
        const filePath = params.filePath || params.file_path || params.path || '';
        const args = params.arguments || params.args || '';
        const result = args
            ? openFileWithArguments(filePath, args)
            : openFileWithDefaultApp(filePath);
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

function htmlToReadableText(html = '') {
    return decodeHtmlEntities(String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim());
}

async function fetchReadablePageText(url = '') {
    const targetUrl = normalizeNavigateUrl(url);
    if (!targetUrl) throw new Error('Missing URL');
    const response = await fetch(targetUrl, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) {
        throw new Error(`fetch failed (${response.status})`);
    }
    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = decodeHtmlEntities((titleMatch?.[1] || '').replace(/\s+/g, ' ').trim());
    const text = contentType.includes('text/plain')
        ? raw.trim()
        : htmlToReadableText(raw);
    return {
        url: response.url || targetUrl,
        title,
        text: String(text || '').slice(0, 12000).trim(),
    };
}

async function extractTextFromSearchResults(results = [], limit = 2) {
    const items = Array.isArray(results) ? results : [];
    const extracted = [];
    for (const item of items.slice(0, Math.max(1, limit))) {
        const url = String(item?.url || '').trim();
        if (!url) continue;
        try {
            const page = await runBrowserUseOperation({ mode: 'extract_text', url });
            if (page?.success && page.text) {
                extracted.push({
                    title: page.title || item.title || '',
                    url: page.url || url,
                    text: String(page.text || '').slice(0, 2500),
                });
            }
        } catch (error) {
            extracted.push({
                title: item.title || '',
                url,
                text: `EXTRACT_FAILED: ${error.message || String(error)}`,
            });
        }
    }
    return extracted;
}

function normalizeDuckDuckGoUrl(url = '') {
    let raw = String(url || '').trim();
    if (!raw) return '';
    if (raw.startsWith('//')) {
        raw = `https:${raw}`;
    }
    // Handle full DDG redirect URL: https://duckduckgo.com/l/?uddg=...
    if (/^https?:\/\/(?:www\.)?duckduckgo\.com\/l\/\?/i.test(raw)) {
        try {
            const parsed = new URL(raw);
            const target = parsed.searchParams.get('uddg');
            if (target) return target;
        } catch {
            return '';
        }
    }
    if (/^\/l\/\?/.test(raw)) {
        try {
            const parsed = new URL(`https://duckduckgo.com${raw}`);
            const target = parsed.searchParams.get('uddg');
            // URLSearchParams already decodes once; avoid double-decoding corruption.
            if (target) return target;
        } catch {
            return '';
        }
    }
    if (/^https?:\/\//i.test(raw)) return raw;
    return '';
}

async function searchWebLinks(query = '', limit = 5) {
    const q = String(query || '').trim();
    if (!q) return [];
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
        throw new Error(`Web search failed (${response.status})`);
    }
    const html = await response.text();
    const aTagRegex = /<a\s+([^>]+)>([\s\S]*?)<\/a>/gi;
    const results = [];
    let match;
    while ((match = aTagRegex.exec(html)) !== null) {
        const attrs = match[1];
        const content = match[2];
        if (!/class=['"](?:result-link|result__a)['"]/i.test(attrs)) continue;
        const hrefMatch = attrs.match(/href="([^"]+)"/i) || attrs.match(/href='([^']+)'/i);
        if (!hrefMatch) continue;
        const href = normalizeDuckDuckGoUrl(decodeHtmlEntities(hrefMatch[1]));
        const title = decodeHtmlEntities(content.replace(/<[^>]+>/g, '').trim());
        if (!href || !title) continue;
        results.push({ title, url: href });
        if (results.length >= limit) break;
    }
    if (results.length === 0) {
        fileLog(`[SearchDiagnostic] searchWebLinks extracted 0 results. HTML length: ${html.length}. Status: ${response.status}`);
        try {
            const dest = path.join(visualAgentDir, 'search_failed.html');
            fs.writeFileSync(dest, html, 'utf8');
            fileLog(`[SearchDiagnostic] Saved search HTML to ${dest}`);
        } catch (e) {
            fileLog(`[SearchDiagnostic] Failed to save search HTML: ${e.message}`);
        }
    }
    return results;
}

async function searchWebLinksWithBrowser(query = '', limit = 5) {
    const q = String(query || '').trim();
    if (!q) return [];
    const maxItems = Math.min(10, Number(limit) || 5);
    const page = await ensureBrowserSession();

    // 1. 優先嘗試 Yahoo 搜尋，因為 Yahoo 防爬蟲檢測極低，且不易觸發驗證
    try {
        fileLog(`[BrowserSearch] Attempting Yahoo search for: "${q}"`);
        await page.goto(`https://search.yahoo.com/search?p=${encodeURIComponent(q)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 25000,
        });
        await page.waitForTimeout(800).catch(() => null);
        const yahooResults = await page.evaluate((maxIt) => {
            const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const seen = new Set();
            const items = [];
            const links = [
                ...document.querySelectorAll('h3.title a'),
                ...document.querySelectorAll('a[href^="http"]'),
            ];
            for (const link of links) {
                const title = clean(link.innerText || link.textContent || '');
                const url = String(link.href || '').trim();
                if (!title || !/^https?:\/\//i.test(url)) continue;
                if (/yahoo\.com/i.test(url)) continue;
                const key = `${title}|${url}`;
                if (seen.has(key)) continue;
                seen.add(key);
                items.push({ title, url });
                if (items.length >= maxIt) break;
            }
            return items;
        }, maxItems);

        if (yahooResults && yahooResults.length > 0) {
            fileLog(`[BrowserSearch] Yahoo search succeeded with ${yahooResults.length} results`);
            return yahooResults;
        }
        fileLog(`[BrowserSearch] Yahoo search returned 0 results, trying Bing...`);
    } catch (err) {
        fileLog(`[BrowserSearch] Yahoo search failed: ${err.message}, trying Bing...`);
    }

    // 2. Fallback 到原先的 Bing 搜尋
    try {
        fileLog(`[BrowserSearch] Attempting Bing search for: "${q}"`);
        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(q)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 25000,
        });
        await page.waitForTimeout(800).catch(() => null);
        const bingResults = await page.evaluate((maxIt) => {
            const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const seen = new Set();
            const items = [];
            const links = [
                ...document.querySelectorAll('li.b_algo h2 a'),
                ...document.querySelectorAll('a[data-testid="result-title-a"]'),
                ...document.querySelectorAll('a[href^="http"]'),
            ];
            for (const link of links) {
                const title = clean(link.innerText || link.textContent || '');
                const url = String(link.href || '').trim();
                if (!title || !/^https?:\/\//i.test(url)) continue;
                if (/bing\.com\/(search|images|videos|maps)/i.test(url)) continue;

                let finalUrl = url;
                if (url.includes('bing.com/ck/a')) {
                    try {
                        const parsed = new URL(url);
                        const u = parsed.searchParams.get('u');
                        if (u && u.startsWith('a1')) {
                            const base64 = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
                            finalUrl = atob(base64);
                        }
                    } catch (e) {
                        // ignore
                    }
                }

                const key = `${title}|${finalUrl}`;
                if (seen.has(key)) continue;
                seen.add(key);
                items.push({ title, url: finalUrl });
                if (items.length >= maxIt) break;
            }
            return items;
        }, maxItems);

        fileLog(`[BrowserSearch] Bing search returned ${bingResults ? bingResults.length : 0} results`);
        return Array.isArray(bingResults) ? bingResults : [];
    } catch (err) {
        fileLog(`[BrowserSearch] Bing search failed: ${err.message}`);
        return [];
    }
}

function looksLikeUnavailableHtml(text = '') {
    const t = normalizeForScoring(text);
    if (!t) return false;
    return /(404 not found|page not found|content not available|this page isn't available|video unavailable|removed by uploader|private video|已移除|無法使用|找不到頁面)/i.test(t);
}

async function validatePlayableArticleUrl(inputUrl = '') {
    const url = String(inputUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) return null;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': 'visual-agent/2026.04.02', 'Accept': 'text/html,*/*' },
            redirect: 'follow',
            signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) return null;
        const finalUrl = response.url || url;
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
            return null;
        }
        const body = await response.text();
        const snippet = body.slice(0, 3000);
        if (looksLikeUnavailableHtml(snippet)) return null;
        return finalUrl;
    } catch {
        return null;
    }
}

function normalizeForScoring(text = '') {
    return String(text || '').toLowerCase();
}

function getHostnameFromUrl(inputUrl = '') {
    try {
        return new URL(String(inputUrl || '').trim()).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return '';
    }
}

function isWhitelistedGuideHost(host = '') {
    const h = String(host || '').toLowerCase();
    if (!h) return false;
    return /(ign\.com|rockstargames\.com|gta\.fandom\.com|fandom\.com|powerpyx\.com|gamepressure\.com|eurogamer\.net|polygon\.com|gamesradar\.com|steamcommunity\.com|reddit\.com|game8\.jp|gamersky\.com|gamer\.com\.tw|bahamut\.com\.tw|3dmgame\.com|bilibili\.com)/i.test(h);
}

function detectGameResearchIntentV2(message = '') {
    const text = String(message || '');
    const hasResearchKeyword = /(攻略|教學|打法|配裝|walkthrough|guide|tips|build|youtube|video|影片)/i.test(text);
    const hasGameKeyword = /(遊戲|game|steam|boss|任務|關卡|gta|elden ring|black myth|wukong|stellar blade|劍星)/i.test(text);
    return hasResearchKeyword && hasGameKeyword;
}

function extractGameTopicV2(message = '') {
    const text = String(message || '').trim();
    const cleaned = text
        .replace(/請|幫我|幫忙|找|搜尋|查|一下|想看|推薦/gi, ' ')
        .replace(/攻略|教學|打法|配裝|walkthrough|guide|tips|build|youtube|video|影片/gi, ' ')
        .replace(/呢|嗎|吧|呀|啊|喔/gi, ' ')
        .replace(/遊戲|game/gi, ' ')
        .replace(/[?？!！,，.。:：;；"'「」『』（）()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'popular game';
}

function detectGameResearchIntentV3(message = '') {
    const text = String(message || '');
    const hasResearchKeyword = /(攻略|教學|打法|配裝|walkthrough|guide|tips|build|youtube|video|影片)/i.test(text);
    const hasGameKeyword = /(遊戲|game|steam|boss|任務|關卡|gta|elden ring|black myth|wukong|stellar blade|劍星)/i.test(text);
    return hasResearchKeyword && hasGameKeyword;
}

function extractGameTopicV3(message = '') {
    const text = String(message || '').trim();
    const cleaned = text
        .replace(/(嗨|哈囉|hello|hi|hey|yo|你好|請問|麻煩|拜託|幫我|幫忙|幫|請|找|搜尋|查|一下|想看|推薦)/gi, ' ')
        .replace(/(攻略|教學|打法|配裝|walkthrough|guide|tips|build|youtube|video|影片|search)/gi, ' ')
        .replace(/(遊戲|game)/gi, ' ')
        .replace(/(呢|嗎|吧|呀|啊|喔|哦)/gi, ' ')
        .replace(/[?？!！,，.。:：;；"'「」『』（）()\[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'popular game';
}

function isManualBrowserSearchIntent(message = '') {
    const text = String(message || '');
    return /(改由瀏覽器手動搜尋|瀏覽器手動搜尋|手動搜尋|manual browser search|search manually in browser|continue in browser tab)/i.test(text);
}

function normalizeBrowserSearchQuery(raw = '') {
    const cleaned = String(raw || '')
        .replace(/\[.*?\]/g, ' ')
        .replace(/(改由瀏覽器手動搜尋|瀏覽器手動搜尋|手動搜尋|改用瀏覽器|用瀏覽器|browser tab|browser|manual|search|continue in browser tab|換關鍵字再查|切到 browser 分頁繼續)/gi, ' ')
        .replace(/(幫我|幫忙|請|找|搜尋|查|一下|呢|嗎|吧|呀|啊|喔|哦)/gi, ' ')
        .replace(/[?？!！,，.。:：;；"'「」『』（）()\[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned || cleaned.length < 2) return '';
    return cleaned;
}

function composeBrowserSearchQuery(topic = '', sourceText = '') {
    const base = normalizeBrowserSearchQuery(topic);
    if (!base) return '';
    const source = String(sourceText || '');
    if (/(攻略|教學|打法|配裝|walkthrough|guide|tips|build|任務|關卡)/i.test(source)) {
        return `${base} 攻略`;
    }
    if (/(安裝|install|setup|下載|download)/i.test(source)) {
        return `${base} 安裝 教學`;
    }
    if (/(錯誤|error|失敗|無法|問題|排解|troubleshoot|fix)/i.test(source)) {
        return `${base} 疑難排解`;
    }
    return base;
}

function inferBrowserSearchQuery(message = '', requestedHistory = []) {
    const directTopic = extractGameTopicV3(message);
    const direct = composeBrowserSearchQuery(directTopic, message);
    if (direct) {
        return direct;
    }
    const history = Array.isArray(requestedHistory) ? requestedHistory : [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
        const item = history[i];
        if (item?.role !== 'user') continue;
        const text = String(item?.content || '').replace(/\[.*?\]/g, ' ').trim();
        if (!text || isManualBrowserSearchIntent(text)) continue;
        const candidateTopic = extractGameTopicV3(text);
        const candidate = composeBrowserSearchQuery(candidateTopic, text);
        if (candidate) {
            return candidate;
        }
    }
    return '';
}

function isBlockedLowValueHost(host = '') {
    const h = String(host || '').toLowerCase();
    if (!h) return true;
    return /(pinterest\.|facebook\.|instagram\.|tiktok\.|dailymotion\.|9gag\.|bilibili\.com\/read)/i.test(h);
}

function isLikelyLowValueGuideTitle(title = '') {
    const t = normalizeForScoring(title);
    if (!t) return true;
    return /(trailer|teaser|reaction|meme|funny|compilation|montage|clip|shorts?|speedrun only|soundtrack|ost)/i.test(t);
}

function scoreGuideResult(item = {}, topic = '') {
    const title = String(item.title || '');
    const url = String(item.url || '');
    const host = getHostnameFromUrl(url);
    const text = normalizeForScoring(`${title} ${url}`);
    const topicText = normalizeForScoring(topic);
    let score = 0;

    if (/(攻略|教學|walkthrough|guide|tips|beginner|mission|build|賺錢|心得)/i.test(text)) score += 4;
    if (topicText && text.includes(topicText)) score += 3;
    if (/(ign\.com|fandom\.com|game8\.jp|powerpyx\.com|rockstargames\.com|steamcommunity\.com|reddit\.com)/i.test(host)) score += 2;
    if (isLikelyLowValueGuideTitle(title)) score -= 4;
    if (/youtube\.com|youtu\.be/i.test(host)) score -= 3;
    return score;
}

function rankGuideResults(results = [], topic = '', limit = 5) {
    const uniqueByUrl = new Map();
    for (const item of (results || [])) {
        const url = String(item?.url || '').trim();
        const title = String(item?.title || '').trim();
        const host = getHostnameFromUrl(url);
        if (!url || !title) continue;
        if (!/^https?:\/\//i.test(url)) continue;
        if (isBlockedLowValueHost(host)) continue;
        if (!isWhitelistedGuideHost(host)) continue;
        if (!uniqueByUrl.has(url)) {
            uniqueByUrl.set(url, { title, url });
        }
    }

    const ranked = [...uniqueByUrl.values()]
        .map((item) => ({ ...item, _score: scoreGuideResult(item, topic) }))
        .filter((item) => item._score >= 1)
        .sort((a, b) => b._score - a._score);

    const seenHost = new Set();
    const diversified = [];
    for (const item of ranked) {
        const host = getHostnameFromUrl(item.url) || item.url;
        if (seenHost.has(host)) continue;
        seenHost.add(host);
        diversified.push({ title: item.title, url: item.url });
        if (diversified.length >= limit) break;
    }
    return diversified;
}

function fallbackRankGuideResults(results = [], topic = '', limit = 5) {
    const ranked = [];
    for (const item of (results || [])) {
        const url = String(item?.url || '').trim();
        const title = String(item?.title || '').trim();
        const host = getHostnameFromUrl(url);
        if (!url || !title) continue;
        if (!/^https?:\/\//i.test(url)) continue;
        if (isBlockedLowValueHost(host)) continue;
        ranked.push({
            title,
            url,
            _score: scoreGuideResult({ title, url }, topic),
        });
    }
    return ranked
        .sort((a, b) => b._score - a._score)
        .slice(0, limit)
        .map(({ title, url }) => ({ title, url }));
}

async function searchGameGuideArticles(topic = '', limit = 5) {
    const q = String(topic || '').trim();
    if (!q) return [];
    const queries = [
        `${q} 攻略 walkthrough guide tips`,
    ];

    const merged = [];
    for (const query of queries) {
            let results = [];
            try {
                results = await searchWebLinks(query, 10);
            } catch (err) {
                fileLog(`[GuideSearch] DDG search failed: ${err.message}`);
            }
            if (!results || !results.length) {
                try {
                    fileLog(`[GuideSearch] Attempting browser fallback search for query: "${query}"`);
                    results = await searchWebLinksWithBrowser(query, 10);
                    fileLog(`[GuideSearch] Browser fallback returned ${results.length} results`);
                } catch (err) {
                    fileLog(`[GuideSearch] Browser fallback search failed: ${err.message}`);
                }
            }
            if (results && results.length) {
                merged.push(...results);
            }
    }
    const ranked = rankGuideResults(merged, q, 24);
    const usable = [];
    const fallback = [];
    for (const item of ranked) {
        if (fallback.length < limit) fallback.push({ title: item.title, url: item.url });
        const finalUrl = await validatePlayableArticleUrl(item.url);
        if (!finalUrl) continue;
        usable.push({ title: item.title, url: finalUrl });
        if (usable.length >= limit) break;
    }
    if (usable.length > 0) return usable;
    // Fallback: return ranked links even if runtime validation failed (some sites block bot fetch).
    if (fallback.length > 0) return fallback.slice(0, limit);
    return fallbackRankGuideResults(merged, q, limit);
}

function extractYouTubeVideoIdFromUrl(inputUrl = '') {
    try {
        const url = new URL(String(inputUrl || '').trim());
        const host = url.hostname.replace(/^www\./i, '').toLowerCase();
        const normalizeId = (value = '') => {
            const id = String(value || '').trim();
            return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
        };
        if (host === 'youtu.be') {
            const id = url.pathname.replace(/^\/+/g, '').split('/')[0];
            return normalizeId(id);
        }
        if (host.endsWith('youtube.com')) {
            if (url.pathname === '/watch') {
                return normalizeId(url.searchParams.get('v') || '');
            }
            if (/^\/shorts\//.test(url.pathname)) {
                return normalizeId(url.pathname.split('/')[2] || '');
            }
            if (/^\/embed\//.test(url.pathname)) {
                return normalizeId(url.pathname.split('/')[2] || '');
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
    if (!normalized) return null;
    try {
        const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`;
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: { 'User-Agent': 'visual-agent/2026.04.02' },
            signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return null;
        const data = await response.json().catch(() => ({}));
        return {
            ok: true,
            url: normalized,
            title: String(data?.title || '').trim(),
            authorName: String(data?.author_name || '').trim(),
        };
    } catch {
        return null;
    }
}

async function isYouTubeWatchPagePlayable(watchUrl = '') {
    const normalized = normalizeYouTubeWatchUrl(watchUrl);
    if (!normalized) return { playable: false };
    try {
        const response = await fetch(normalized, {
            method: 'GET',
            headers: { 'User-Agent': 'visual-agent/2026.04.02', 'Accept': 'text/html,*/*' },
            redirect: 'follow',
            signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) return { playable: false };
        const html = await response.text();
        if (looksLikeUnavailableHtml(html)) return { playable: false };
        if (/private video|video unavailable|playback on other websites has been disabled/i.test(html)) return { playable: false };
        
        let publishYear = null;
        const match = html.match(/(?:itemprop="datePublished"|itemprop="uploadDate")\s+content="([^"]+)"/i) 
                   || html.match(/"(?:publishDate|uploadDate)"\s*:\s*"([^"]+)"/i);
        if (match && match[1]) {
            const yearMatch = match[1].match(/^(\d{4})/);
            if (yearMatch) publishYear = parseInt(yearMatch[1], 10);
        }
        
        return { playable: true, publishYear };
    } catch {
        return { playable: false };
    }
}

function isLikelyLowValueVideoTitle(title = '') {
    const t = normalizeForScoring(title);
    if (!t) return true;
    return /(official trailer|trailer|teaser|reaction|meme|funny|compilation|montage|clip|shorts?|music video|ost|soundtrack|live stream|livestream|speedrun|all cutscenes|movie)/i.test(t);
}

function scoreVideoResult(item = {}, topic = '') {
    const title = normalizeForScoring(item.title || '');
    const author = normalizeForScoring(item.authorName || '');
    const topicText = normalizeForScoring(topic);
    let score = 0;
    if (/(攻略|教學|walkthrough|guide|tips|beginner|mission|賺錢|100%|解說)/i.test(title)) score += 5;
    if (topicText && title.includes(topicText)) score += 3;
    if (/(wiki|guide|gaming|攻略|教學)/i.test(author)) score += 1;
    if (isLikelyLowValueVideoTitle(item.title)) score -= 5;
    
    if (item.publishYear) {
        const year = item.publishYear;
        if (year >= 2025) {
            score += 10;
        } else if (year === 2024) {
            score += 6;
        } else if (year === 2023) {
            score += 3;
        } else if (year === 2022) {
            score += 1;
        } else if (year <= 2021) {
            score -= 6;
        }
    }
    return score;
}

function containsTopicToken(title = '', topic = '') {
    const t = normalizeForScoring(title);
    const q = normalizeForScoring(topic);
    if (!t || !q) return false;
    const tokens = q.split(/\s+/).map((x) => x.trim()).filter((x) => x.length >= 2);
    if (!tokens.length) return false;
    return tokens.some((token) => t.includes(token));
}

async function searchPlayableYouTubeVideos(topic = '', limit = 5) {
    const query = String(topic || '').trim();
    if (!query) return [];
    fileLog(`[VideoSearch] Start searching for topic: "${query}"`);
    let candidates = [];
    try {
        candidates = await searchWebLinks(`${query} 攻略 site:youtube.com`, 24);
        fileLog(`[VideoSearch] DDG search returned ${candidates.length} candidates`);
    } catch (err) {
        fileLog(`[VideoSearch] DDG search failed for videos: ${err.message}`);
    }
    if (!candidates || !candidates.length) {
        try {
            fileLog(`[VideoSearch] Attempting browser fallback search...`);
            candidates = await searchWebLinksWithBrowser(`${query} 攻略 walkthrough site:youtube.com`, 24);
            fileLog(`[VideoSearch] Browser fallback returned ${candidates.length} candidates`);
        } catch (err) {
            fileLog(`[VideoSearch] Browser fallback search failed for videos: ${err.message}`);
        }
    }
    const unique = new Map();
    candidates.forEach((item) => {
        const watchUrl = normalizeYouTubeWatchUrl(item.url);
        const host = getHostnameFromUrl(watchUrl);
        if (!watchUrl) return;
        if (isBlockedLowValueHost(host)) return;
        const id = extractYouTubeVideoIdFromUrl(watchUrl);
        if (!id) return;
        if (!unique.has(id)) {
            unique.set(id, { title: item.title, url: watchUrl });
        }
    });
    fileLog(`[VideoSearch] Unique video candidates count: ${unique.size}`);

    const playable = [];
    const fallback = [];
    for (const entry of unique.values()) {
        const isLowValue = isLikelyLowValueVideoTitle(entry.title);
        const hasTopic = containsTopicToken(entry.title, query);
        fileLog(`[VideoSearch] Candidate: "${entry.title}" -> isLowValue=${isLowValue}, hasTopic=${hasTopic}`);
        if (isLowValue) continue;
        if (!hasTopic) continue;
        if (fallback.length < limit) fallback.push({ title: entry.title, url: entry.url });
        
        const playableMeta = await isYouTubeVideoPlayable(entry.url);
        fileLog(`[VideoSearch]   oembed check: ${playableMeta?.ok ? 'OK' : 'failed'}`);
        if (!playableMeta?.ok) continue;
        
        const finalTitle = playableMeta.title || entry.title;
        const finalIsLowValue = isLikelyLowValueVideoTitle(finalTitle);
        const finalHasTopic = containsTopicToken(finalTitle, query);
        if (finalIsLowValue) continue;
        if (!finalHasTopic) continue;
        
        const pagePlayable = await isYouTubeWatchPagePlayable(entry.url);
        fileLog(`[VideoSearch]   watch page playability: ${pagePlayable.playable ? 'playable' : 'unplayable'} (year: ${pagePlayable.publishYear})`);
        if (!pagePlayable.playable) continue;
        
        const score = scoreVideoResult({ 
            title: finalTitle, 
            authorName: playableMeta.authorName || '',
            publishYear: pagePlayable.publishYear 
        }, query);
        
        fileLog(`[VideoSearch]   Score: ${score}`);
        playable.push({
            title: finalTitle,
            url: entry.url,
            authorName: playableMeta.authorName || '',
            publishYear: pagePlayable.publishYear,
            _score: score,
        });
    }
    fileLog(`[VideoSearch] Total playable videos: ${playable.length}`);
    const rankedPlayable = playable
        .filter((item) => item._score >= 1)
        .sort((a, b) => b._score - a._score)
        .slice(0, limit)
        .map((item) => ({ title: item.title, url: item.url }));
    fileLog(`[VideoSearch] Ranked playable videos: ${rankedPlayable.length}`);
    if (rankedPlayable.length > 0) return rankedPlayable;
    if (fallback.length > 0) {
        fileLog(`[VideoSearch] Returning fallback candidates (count: ${fallback.length})`);
        return fallback.slice(0, limit);
    }
    return unique.size ? [...unique.values()].slice(0, limit).map((item) => ({ title: item.title, url: item.url })) : [];
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

function selectGameGuideFallbackLines(extractedGuides = [], limit = 5) {
    const useful = [];
    const keyword = /(攻略|教學|打法|配裝|任務|關卡|boss|build|weapon|armor|mission|quest|unlock|level|upgrade|farm|money|tip|tips|guide|walkthrough|strategy|location|reward|技能|武器|裝備|升級|解鎖|位置|獎勵|賺錢)/i;
    for (const source of extractedGuides) {
        const text = String(source?.text || '')
            .replace(/\r/g, '\n')
            .split(/\n|(?<=[。！？.!?])\s+/)
            .map((line) => line.replace(/\s+/g, ' ').trim())
            .filter((line) => line.length >= 24 && line.length <= 180)
            .filter((line) => !/(cookie|privacy|subscribe|sign in|login|advertisement|copyright|網站導覽|回首頁|意見箱)/i.test(line));
        const picked = text.filter((line) => keyword.test(line)).slice(0, 2);
        for (const line of (picked.length ? picked : text.slice(0, 1))) {
            useful.push(line);
            if (useful.length >= limit) return useful;
        }
    }
    return useful;
}

async function buildGameGuideTakeaways(topic = '', guideResults = [], locale = 'zh-TW') {
    const extractedGuides = await extractTextFromSearchResults(guideResults, 2);
    const usableGuides = extractedGuides.filter((item) =>
        item?.text && !/^EXTRACT_FAILED:/i.test(String(item.text || ''))
    );
    if (!usableGuides.length) {
        return {
            text: '',
            bullets: [],
            extractedGuides,
            llmUsed: false,
        };
    }

    try {
        const status = await llm.checkOllamaStatus();
        if (status.available && status.modelReady) {
            const sourceText = usableGuides.map((item, index) => [
                `Source ${index + 1}: ${item.title || '(untitled)'}`,
                `URL: ${item.url}`,
                String(item.text || '').slice(0, 2500),
            ].join('\n')).join('\n\n');
            const prompt = locale === 'en-US'
                ? `Summarize actionable game guide takeaways for "${topic}". Do not just list links. Use the source text below. Return 5 concise bullets and avoid inventing facts.\n\n${sourceText}`
                : `請根據以下來源內容，整理「${topic}」的可執行遊戲攻略重點。不要只列連結，不要編造來源沒有的內容。請輸出 5 個精簡條列重點。\n\n${sourceText}`;
            const summary = await llm.chatWithLLM(
                prompt,
                [],
                {
                    systemContext: locale === 'en-US'
                        ? 'You summarize game guide sources into practical steps. Keep it concise and cite source titles when useful.'
                        : '你負責把遊戲攻略來源整理成實用步驟。回答要精簡，必要時提到來源標題。',
                },
                locale
            );
            const bullets = String(summary || '')
                .split(/\r?\n/)
                .map((line) => line.replace(/^[-*]\s*/, '').replace(/^\d+[.)、]\s*/, '').trim())
                .filter(Boolean)
                .slice(0, 6);
            return {
                text: String(summary || '').trim(),
                bullets,
                extractedGuides: usableGuides,
                llmUsed: true,
            };
        }
    } catch (error) {
        fileLog(`[GameResearch] LLM source summary failed: ${error.message}`);
    }

    const fallbackLines = selectGameGuideFallbackLines(usableGuides, 5);
    return {
        text: fallbackLines.length
            ? fallbackLines.map((line) => `- ${line}`).join('\n')
            : '',
        bullets: fallbackLines,
        extractedGuides: usableGuides,
        llmUsed: false,
    };
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

async function handleAgentGameResearchWorkflowV2(message = '', locale = 'zh-TW') {
    const topic = extractGameTopicV2(message);
    const guideResults = await searchGameGuideArticles(topic, 5);
    const videoResults = await searchPlayableYouTubeVideos(topic, 5);

    if (!guideResults.length && !videoResults.length) {
        return {
            success: true,
            reply: locale === 'en-US'
                ? `I could not verify high-quality results for "${topic}" right now, but Browser search has already been used and I can refine the query.`
                : `目前無法完整驗證「${topic}」的高品質攻略資源，但我已先用 Browser 搜尋過，可再縮小關鍵字。`,
            suggestions: locale === 'en-US'
                ? ['Try another keyword', 'Search manually in browser']
                : ['換關鍵字再試', '改由瀏覽器手動搜尋'],
            task: false,
            llmUsed: false,
        };
    }

    const chalkboardBullets = guideResults.slice(0, 3).map((item, idx) => `${idx + 1}. ${item.title}`);
    const fallbackBullets = videoResults.slice(0, 3).map((item, idx) => `${idx + 1}. ${item.title}`);
    const reply = [
        locale === 'en-US' ? `## Game Research: ${topic}` : `## 遊戲資料蒐集：${topic}`,
        '',
        locale === 'en-US'
            ? '_Filtered: removed trailers/reactions/invalid links; prioritized practical guides._'
            : '_已過濾：排除預告片、反應片、失效連結；優先實用攻略。_',
        '',
        locale === 'en-US' ? '### Guides' : '### 攻略文章',
        ...(guideResults.length ? guideResults.map((item) => `- [${item.title}](${item.url})`) : ['- N/A']),
        '',
        locale === 'en-US' ? '### Videos' : '### YouTube 教學影片',
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
            : ['再找更多影片', '改查其他遊戲'],
        task: false,
        llmUsed: false,
    };
}


async function handleAgentGameResearchWorkflowV3(message = '', locale = 'zh-TW') {
    const topic = extractGameTopicV3(message);
    const guideResults = await searchGameGuideArticles(topic, 5);
    const videoResults = await searchPlayableYouTubeVideos(topic, 5);
    const guideTakeaways = guideResults.length
        ? await buildGameGuideTakeaways(topic, guideResults, locale)
        : { text: '', bullets: [], extractedGuides: [], llmUsed: false };

    if (!guideResults.length && !videoResults.length) {
        return {
            success: true,
            reply: locale === 'en-US'
                ? `I could not find high-quality results for "${topic}" right now.`
                : `目前找不到「${topic}」可用且高品質的攻略資源。`,
            suggestions: locale === 'en-US'
                ? ['Try another keyword', 'Search manually in browser']
                : ['換關鍵字再試', '改由瀏覽器手動搜尋'],
            task: false,
            llmUsed: false,
        };
    }

    const takeawayBullets = guideTakeaways.bullets.length
        ? guideTakeaways.bullets.slice(0, 5)
        : guideResults.slice(0, 3).map((item, idx) => `${idx + 1}. ${item.title}`);
    const chalkboardBullets = takeawayBullets;
    const fallbackBullets = videoResults.slice(0, 3).map((item, idx) => `${idx + 1}. ${item.title}`);
    const boardLines = (chalkboardBullets.length > 0 ? chalkboardBullets : fallbackBullets).slice(0, 6);
    const chalkboardControlBlock = [
        '##CHALKBOARD##',
        `title: ${locale === 'en-US' ? `Game Research: ${topic}` : `遊戲攻略：${topic}`}`,
        ...boardLines.map((line) => `- ${line}`),
        '##ENDCHALKBOARD##',
    ].join('\n');

    const reply = [
        locale === 'en-US' ? `## Game Research: ${topic}` : `## 遊戲資料蒐集：${topic}`,
        '',
        locale === 'en-US'
            ? '_Filtered: removed trailers/reactions/invalid links; prioritized practical guides._'
            : '_已過濾：排除預告片、反應片與失效連結，優先實用攻略。_',
        '',
        locale === 'en-US' ? '### Takeaways' : '### 攻略重點',
        ...(guideTakeaways.text
            ? [guideTakeaways.text]
            : (takeawayBullets.length ? takeawayBullets.map((line) => `- ${line}`) : ['- N/A'])),
        '',
        locale === 'en-US' ? '### Source Guides' : '### 來源攻略',
        ...(guideResults.length ? guideResults.map((item) => `- [${item.title}](${item.url})`) : ['- N/A']),
        '',
        locale === 'en-US' ? '### Videos' : '### YouTube 教學影片',
        ...(videoResults.length ? videoResults.map((item) => `- [${item.title}](${item.url})`) : ['- N/A']),
        '',
        locale === 'en-US' ? '### Chalkboard Summary Draft' : '### Chalkboard 摘要草稿',
        ...(boardLines.length ? boardLines.map((line) => `- ${line}`) : ['- N/A']),
        '',
        chalkboardControlBlock,
    ].join('\n');

    return {
        success: true,
        reply,
        chalkboardDraft: {
            title: locale === 'en-US' ? `Game Research: ${topic}` : `遊戲資料蒐集：${topic}`,
            bullets: boardLines,
        },
        suggestions: locale === 'en-US'
            ? ['Find more videos', 'Search another game']
            : ['再找更多影片', '改查其他遊戲'],
        task: false,
        llmUsed: guideTakeaways.llmUsed,
    };
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
    const browserExecutable = resolvePlaywrightBrowserExecutable();
    res.json({
        success: true,
        name: pkg.name || 'visual-agent',
        version: APP_VERSION,
        browserAvailable: Boolean(browserExecutable),
        browserExecutable,
        browserSearchPaths: getPlaywrightBrowserDirCandidates(),
        playwrightModuleAvailable: isPlaywrightAvailable(),
    });
});

function readDebugLogTail(maxLines = 80) {
    const logPath = path.join(visualAgentDir, 'debug.log');
    try {
        if (!fs.existsSync(logPath)) {
            return { path: logPath, lines: [], exists: false };
        }
        const text = fs.readFileSync(logPath, 'utf8');
        const lines = text.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, maxLines));
        return { path: logPath, lines, exists: true };
    } catch (error) {
        return { path: logPath, lines: [`Failed to read debug log: ${error.message}`], exists: false };
    }
}

function getListenPortDiagnostic(port) {
    const owner = getPortOwnerHint(port);
    return {
        port,
        expectedOwnerPid: process.pid,
        listening: Boolean(owner),
        owner,
        ownedByCurrentProcess: owner.includes(`PID ${process.pid}`),
    };
}

app.get('/api/diagnostics', async (req, res) => {
    try {
        const browserExecutable = resolvePlaywrightBrowserExecutable();
        const llmStatus = await llm.checkOllamaStatus().catch((error) => ({
            available: false,
            modelReady: false,
            error: error.message,
        }));
        loadTasks();
        const tasks = Array.isArray(todoList) ? todoList : [];
        const sops = loadAllSOPs(SOPS_DIR);
        const skills = loadSkillDocuments();
        const debugLog = readDebugLogTail(Number(req.query?.tail) || 80);
        res.json({
            success: true,
            generatedAt: new Date().toISOString(),
            app: {
                name: pkg.name || 'visual-agent',
                version: APP_VERSION,
                pid: process.pid,
                node: process.version,
                platform: `${process.platform} ${os.release()}`,
                cwd: process.cwd(),
                executable: process.execPath,
            },
            paths: {
                appData: visualAgentDir,
                sops: SOPS_DIR,
                skills: SKILLS_DIR,
                plugins: PLUGINS_DIR,
                exps: EXPS_DIR,
                debugLog: debugLog.path,
                browserRuntime: process.env.PLAYWRIGHT_BROWSERS_PATH || '',
            },
            ports: {
                http: getListenPortDiagnostic(PORT),
                remote: getListenPortDiagnostic(DEFAULT_REMOTE_PORT),
            },
            browser: {
                playwrightModuleAvailable: isPlaywrightAvailable(),
                browserAvailable: Boolean(browserExecutable),
                browserExecutable,
                searchPaths: getPlaywrightBrowserDirCandidates(),
                installSopId: 'install_playwright_chromium',
            },
            llm: {
                provider: llm.getCurrentProvider(),
                baseUrl: llm.getCurrentBaseUrl(),
                model: llm.getCurrentModel(),
                visionModel: llm.getCurrentVisionModel(),
                available: Boolean(llmStatus.available),
                modelReady: Boolean(llmStatus.modelReady),
                version: llmStatus.version || '',
                modelName: llmStatus.modelName || '',
                error: llmStatus.error || '',
            },
            data: {
                taskCount: tasks.length,
                pendingTaskCount: tasks.filter((task) => String(task.status || '') === 'pending').length,
                runningTaskCount: tasks.filter((task) => String(task.status || '') === 'running').length,
                sopCount: sops.length,
                skillCount: skills.length,
                logCount: logs.length,
            },
            debugLog,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/open-external-url', (req, res) => {
    try {
        const raw = String(req.body?.url || '').trim();
        if (!raw) return res.status(400).json({ success: false, error: 'Missing url' });
        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            return res.status(400).json({ success: false, error: 'Invalid url' });
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return res.status(400).json({ success: false, error: 'Unsupported protocol' });
        }

        const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', parsed.toString()], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
        });
        child.unref();
        return res.json({ success: true });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
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
    let localAiThinkingSessionId = '';
    try {
        const sessionId = req.params.sessionId;
        const text = String(req.body?.text || '').trim();
        const mode = String(req.body?.mode || 'user').trim();
        const target = String(req.body?.target || 'remote-user').trim();
        const locale = String(req.body?.locale || 'zh-TW');
        const skipUserEcho = !!req.body?.skipUserEcho;
        if (!text) {
            return res.status(400).json({ success: false, error: 'Missing text' });
        }

        let senderType = 'user';
        let senderLabel = getRemoteProfile().userName;
        let outboundText = text;
        if (mode === 'local-ai') {
            const profile = getRemoteProfile();
            localAiThinkingSessionId = sessionId;
            if (!skipUserEcho) {
                remoteAgent.sendChatMessage(sessionId, {
                    senderType: 'user',
                    senderLabel: getRemoteProfile().userName,
                    text,
                    target,
                    locale,
                });
            }
            remoteAgent.sendAiStatus(sessionId, {
                status: 'thinking',
                senderLabel: profile.agentName,
            });
            const remoteState = remoteAgent.getState();
            const currentSession = remoteState.sessions.find((item) => item.id === sessionId);
            const history = (currentSession?.messages || [])
                .filter((item) => item.type === 'chat_message' && item.target !== 'remote-ai')
                .slice(-6)
                .map((item) => ({
                    role: item.senderType === 'ai' && item.direction !== 'incoming' ? 'assistant' : 'user',
                    content: `${item.senderLabel || item.senderType}: ${item.text || item.caption || ''}`.trim(),
                }));
            const localHardwareContext = await getSystemHealth();
            outboundText = isLocalHardwareStatusQuestion(text)
                ? await buildLocalHardwareStatusReply(locale)
                : await llm.chatWithLLM(
                text,
                history,
                {
                    systemContext: [
                        buildLocalAgentContext(currentSession),
                        `IMPORTANT - ALL hardware info below is from LOCAL machine (${profile.machineName}), NOT from the remote peer. Always prefix free-space / hardware answers with the machine name.`,
                        (() => { const ramTotal = Math.round(os.totalmem()/1024/1024/1024); const ramFree = Math.round(os.freemem()/1024/1024/1024); const diskFreePart = formatDiskFreePart(localHardwareContext); return `Local machine (${profile.machineName}) RAM: ${ramTotal - ramFree}GB used / ${ramTotal}GB total, Free: ${ramFree}GB\nLocal machine Disk Free Space: ${diskFreePart}`; })(),
                        'You are speaking as the local AI agent inside a peer-to-peer support chat.',
                        `Address the local human as ${profile.userName}, not generic "使用者". Refer to yourself as ${profile.machineName}. Refer to the peer as ${currentSession?.peer?.machineName || 'remote PC'}.`,
                        'The current requester is the local human user on this machine.',
                        target === 'remote-ai'
                            ? 'The remote AI will receive your message next. Provide concise complementary notes, facts to check, or a division-of-labor suggestion. Do not compete with the remote AI for the final answer.'
                            : 'Answer the local human directly and concisely.',
                        buildLatestChalkboardContext(currentSession, locale),
                        'If asked what model you are using, answer with the exact current provider and model from the system context.',
                        'When using ##CHALKBOARD##, coordinate with Remote AI. You are the Local AI: use "position: left" and "clear: false"; never redraw or redefine a board/grid that already exists. For games such as tic-tac-toe, define the shared board once, then keep the same numbering/coordinates and only update moves/status.',
                        'Keep the answer concise and practical.',
                    ].join('\n'),
                },
                locale
            );
            senderType = 'ai';
            senderLabel = profile.agentName;
            remoteAgent.sendAiStatus(sessionId, {
                status: 'idle',
                senderLabel: profile.agentName,
            });
            localAiThinkingSessionId = '';
        }

        const message = remoteAgent.sendChatMessage(sessionId, {
            senderType,
            senderLabel,
            text: outboundText,
            target,
            locale,
        });
        if (mode === 'local-ai' && target !== 'remote-ai' && shouldInvitePeerAiContinuation(outboundText)) {
            const currentSession = remoteAgent.getState().sessions.find((item) => item.id === sessionId);
            remoteAgent.sendChatMessage(sessionId, {
                senderType: 'ai',
                senderLabel,
                text: buildPeerAiContinuationText(currentSession, outboundText, locale),
                target: 'remote-ai',
                locale,
            });
        }
        touchRemoteState();
        res.json({ success: true, message });
    } catch (error) {
        if (localAiThinkingSessionId) {
            try {
                remoteAgent.sendAiStatus(localAiThinkingSessionId, {
                    status: 'idle',
                    senderLabel: getRemoteProfile().agentName,
                });
            } catch {
                // ignore
            }
        }
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
    return res.status(410).json({ success: false, error: 'Model sharing has been removed. Use remote AI collaboration instead.' });
});

app.post('/api/remote/session/:sessionId/model-share/respond', (req, res) => {
    return res.status(410).json({ success: false, error: 'Model sharing has been removed. Use remote AI collaboration instead.' });
});

app.post('/api/remote/session/:sessionId/model-share/cancel', (req, res) => {
    return res.status(410).json({ success: false, error: 'Model sharing has been removed. Use remote AI collaboration instead.' });
});

app.post('/api/remote/session/:sessionId/chalkboard-sync', (req, res) => {
    try {
        const imageDataUrl = String(req.body?.imageDataUrl || '').trim();
        const hasContent = req.body?.hasContent !== false;
        if (!imageDataUrl.startsWith('data:image/')) {
            return res.status(400).json({ success: false, error: 'Invalid image data' });
        }
        const profile = getRemoteProfile();
        const message = remoteAgent.sendChalkboardState(req.params.sessionId, {
            senderType: String(req.body?.senderType || 'user').trim() || 'user',
            senderLabel: String(req.body?.senderLabel || profile.userName).trim() || profile.userName,
            imageDataUrl,
            caption: String(req.body?.caption || '').trim(),
            width: Number(req.body?.width) || 0,
            height: Number(req.body?.height) || 0,
            hasContent,
        });
        touchRemoteState();
        res.json({ success: true, message });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

app.post('/api/remote/model-proxy/chat', async (req, res) => {
    return res.status(410).json({ success: false, error: 'Remote model proxy has been removed. Use remote AI collaboration instead.' });
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

app.delete('/api/remote/session/:sessionId', (req, res) => {
    try {
        remoteAgent.forgetSession(req.params.sessionId);
        touchRemoteState();
        res.json({
            success: true,
            sessions: remoteAgent.getState().sessions,
        });
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
        title: '📥 Download Language Model (Gemma 4 E2B QAT)',
        description: 'Download Gemma 4 E2B QAT (~1.1GB). After this, AI will truly understand your requests',
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

app.get('/api/skills', (req, res) => {
    try {
        const skills = loadSkillDocuments(true).map((skill) => ({
            slug: skill.slug || skill.name,
            name: skill.name,
            description: skill.description || '',
            tags: skill.tags || [],
            category: skill.category || 'Skills',
        }));
        res.json({ success: true, skills });
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
        const defaultName = `visual-agent-tasks-${new Date().toISOString().slice(0, 10)}.json`;
        // 透過 PowerShell 呼叫原生的 Windows SaveFileDialog
        const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Export Visual Agent Tasks'
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


        const defaultName = `visual-agent-exps-${new Date().toISOString().slice(0, 10)}.md`;
        const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = 'Markdown Files (*.md)|*.md|All Files (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Export Visual Agent Experience Log'
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
app.get('/api/agent-status/:runId', (req, res) => {
    pruneAgentRunStatuses();
    const runId = normalizeAgentRunId(req.params.runId);
    res.json(agentRunStatuses.get(runId) || {
        success: true,
        runId,
        phase: 'planning',
        label: 'Planning',
        detail: '',
        updatedAt: '',
    });
});

app.post('/api/chat', async (req, res) => {
    const { message, locale } = req.body;
    const agentRunId = normalizeAgentRunId(req.body?.agentRunId || '');
    setAgentRunStatus(agentRunId, 'planning', locale || 'zh-TW');
    const localChatSessionId = String(req.body?.localChatSessionId || '').trim();
    const requestedHistory = Array.isArray(req.body?.history) ? req.body.history : null;
    const chalkboardAttachment = normalizeChalkboardAttachment(req.body?.chalkboard);
    if (!message) return res.json({ success: false, error: 'Please enter a message' });
    const historyForIntent = requestedHistory
        || (localChatSessionId ? (localChatHistoryBySession.get(localChatSessionId) || []) : chatHistory);
    const followUpResearchQuery = inferFollowUpResearchQuery(message, historyForIntent);
    const researchIntentMessage = followUpResearchQuery || message;
    const sops = loadAllSOPs(SOPS_DIR);
    // 一般聊天不應先對每一個 SOP 啟動 PowerShell 偵測；這會讓第一句話卡住十多秒。
    // 僅在確實涉及系統任務時更新即時安裝狀態，其他情況沿用快取或預設值。
    const needsSopRuntimeState = requiresSopRuntimeState(message);
    const sopsWithState = needsSopRuntimeState
        ? await annotateSOPRuntimeState(sops)
        : sops.map((sop) => ({ ...sop, ...getCachedOrDefaultSopState(sop) }));
    if (/(執行|開始|安裝|run|start|execute|install)/i.test(message)) {
        const pendingBrowserInstall = [...todoList].reverse().find((task) =>
            String(task.skillId || '') === 'install_playwright_chromium'
            && String(task.status || '') === 'pending'
        );
        if (pendingBrowserInstall && /(browser|chromium|playwright|瀏覽器|瀏覽|搜尋|查|執行|開始|安裝|run|start|execute|install)/i.test(message)) {
            return res.json({
                success: true,
                reply: locale === 'en-US'
                    ? `Starting Browser Use runtime install task: ${pendingBrowserInstall.title}`
                    : `開始執行 Browser Use runtime 安裝任務：${pendingBrowserInstall.title}`,
                suggestions: [],
                task: false,
                executeTaskId: pendingBrowserInstall.id,
                llmUsed: false,
            });
        }
    }
    try {
        if (isManualBrowserSearchIntent(message)) {
            const query = inferBrowserSearchQuery(message, requestedHistory) || 'GTA V 攻略';
            const targetUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            const browserResult = await runBrowserUseOperation({
                mode: 'navigate',
                url: targetUrl,
                timeoutMs: 45000,
            });
            const linkPreview = await runBrowserUseOperation({
                mode: 'search',
                query,
                limit: 5,
            }).catch(() => ({ success: false, results: [] }));
            const linkLines = (linkPreview?.results || [])
                .slice(0, 3)
                .map((item) => `- [${item.title}](${item.url})`);
            const browserReply = locale === 'en-US'
                ? [
                    `I have opened Browser tab and searched: ${query}`,
                    browserResult?.success ? '' : `Browser session warning: ${browserResult?.error || 'unknown'}`,
                    linkLines.length ? '### Quick links' : '',
                    ...linkLines,
                ].filter(Boolean).join('\n')
                : [
                    `我已在 Browser 分頁啟動搜尋：${query}`,
                    browserResult?.success ? '' : `Browser 啟動警告：${browserResult?.error || '未知錯誤'}`,
                    linkLines.length ? '### 快速連結' : '',
                    ...linkLines,
                ].filter(Boolean).join('\n');
            return res.json({
                success: true,
                reply: browserReply,
                suggestions: [],
                task: false,
                llmUsed: false,
                browser: browserResult || null,
            });
        }
        if (detectAgentFinanceIntent(message)) {
            const agentResponse = await handleAgentFinanceWorkbookWorkflow(message, locale || 'zh-TW', sopsWithState);
            if (agentResponse) return res.json(agentResponse);
        }
        if (detectGameResearchIntentV3(message)) {
            const gameResponse = await handleAgentGameResearchWorkflowV3(message, locale || 'zh-TW');
            if (gameResponse) return res.json(gameResponse);
        }
    } catch (agentErr) {
        fileLog(`Agent workflow failed: ${agentErr.message}`);
    }
    let suggestions = []; // Suggestion buttons disabled; use plain text and task list actions instead.
    let llmErrorForFallback = null;
    // 1. 快速蒐集背景資訊
    const sopCatalog = needsSopRuntimeState
        ? sopsWithState.map(s => `- ID: ${s.id}, Name: ${s.name}, Status: ${s.installed ? 'installed' : 'not installed'}, Action: ${s.recommendedAction}`).join('\n')
        : '(not requested for this conversation)';
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
        if (isLocalHardwareStatusQuestion(message)) {
            systemHealth = await getSystemHealth();
        }
    } catch {
        systemHealth = null;
    }


    const hardwareSummary = (() => {
        if (!systemHealth) {
            return 'Not requested for this conversation.';
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
            const runtimeDateContext = getRuntimeDateContext(locale || 'zh-TW');
            const contextNote = `
[[Current System Context]]
0. Runtime Date: ${runtimeDateContext}

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
            const { wingetPromptNote, microsoftStorePromptNote, githubPromptNote } = buildRecommendationPromptNotes({
                wingetRecommendation,
                microsoftStoreRecommendation,
                githubRecommendation,
            });
            let llmReply;
            const remoteState = remoteAgent.getState();
            const activeRemoteSession = remoteState.sessions.find((item) => item.status === 'active');
            const chatOptions = {
                systemContext: [
                    buildLocalAgentContext(activeRemoteSession || null),
                    runtimeDateContext,
                    `Available local IPv4 list: ${remoteState.localIps.join(', ') || 'N/A'}`,
                    `Remote chat service port: ${DEFAULT_REMOTE_PORT}`,
                    `Built-in Browser tab availability: Playwright module=${isPlaywrightAvailable() ? 'yes' : 'no'}, Chromium binary=${hasPlaywrightBrowserBinary() ? 'yes' : 'no'}.`,
                    'When web/current-info tasks are needed, prefer Browser Use actions. If Browser Use is unavailable, say so briefly and still provide text/link fallback from available search results.',
                    'Remote model proxy is removed. Use remote chat collaboration when another AI should help.',
                    followUpResearchQuery
                        ? `This is a follow-up filter for the previous news search. Interpret the user message as: ${followUpResearchQuery}. Search and answer that topic; do not explain the platform itself.`
                        : '',
                    locale === 'en-US'
                        ? 'CRITICAL: NEVER put [ACTION:...] tags inside ##CHALKBOARD## blocks. Always output ACTION tags in plain text OUTSIDE chalkboard blocks, then optionally add chalkboard summary after.'
                        : '**重要**：絕對不要把 [ACTION:...] 標籤放在 ##CHALKBOARD## 區塊裡面。永遠在一般文字區輸出 ACTION 標籤（在黑板區塊外），然後可選擇性地加上黑板摘要。',
                    onDemandGuidance || '',
                ].join('\n'),
            };
            if (chalkboardAttachment) {
                chatOptions.chalkboardAttachment = chalkboardAttachment;
                chatOptions.systemContext += locale === 'en-US'
                    ? '\nA cropped, lossless Chalkboard image is attached. Inspect all handwriting, labels, diagrams, arrows, and placed images before answering. State clearly when a detail is unreadable; never claim you saw details that are absent.'
                    : '\n已附上裁切後、無失真的 Chalkboard 圖。回答前必須檢視所有手寫文字、標籤、圖表、箭頭與置入圖片；看不清的細節要明確說明，不可臆測。';
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
                const effectiveModel = chatOptions.modelOverride || llm.getCurrentModel();
                if (chalkboardAttachment && !llm.modelSupportsVision(effectiveModel)) {
                    // Many local text-only models accept the request without an HTTP
                    // error, silently discard images, then claim no image was sent.
                    // Do not let that misleading response reach the user.
                    llmReply = locale === 'en-US'
                        ? `The Chalkboard image was received, but the current model (${effectiveModel || 'unknown'}) cannot read images. Set a Vision Model in Settings (for example a Qwen VL, Llama Vision, Gemma 3, GPT-4o, Gemini, or Claude vision model), then send the message again.`
                        : `已收到 Chalkboard 圖片，但目前模型（${effectiveModel || '未知模型'}）不支援圖片辨識。請在「設定 → Vision 多模態模型」選擇或填入可看圖模型（例如 Qwen VL、Llama Vision、Gemma 3、GPT-4o、Gemini 或 Claude 視覺模型），再重新送出。`;
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
                    `${message}\n\n${contextNote}${wingetPromptNote}${microsoftStorePromptNote}${githubPromptNote}\n\n[[Experience Log]]\n${experienceContext || '(No experience entries yet)'}\n\n[System] The attached Chalkboard image could not be processed by the configured vision model/provider. Start by explicitly telling the user that visual recognition failed and ask them to select a Vision Model in Settings or provide the key text, then assist with the text request.`,
                    requestHistory,
                    { systemContext: chatOptions.systemContext },
                    locale
                );
            }


            // 3. 解析與安全過濾
            const { actions, proseForConsent, hasSuggestions } = extractActionsFromReply(llmReply);
            // ── 執行安全攔截 ──
            // 只看「一般文字」是否在徵詢同意；ACTION 的 query="...?" 不應觸發攔截
            const isQuestioning = /是否要|確認點選|要不要執行|您是否同意|要我幫|shall I|would you like|do you want/i.test(proseForConsent);
            let executeTaskId = null;
            let hasActionTaken = false;
            let taskListChanged = false;
            let sopChanged = false;
            let actionSummaries = [];
            if (hasSuggestions && isQuestioning) {
                // 只擋「待確認」的系統變更；Browser Use 查詢仍應執行
                for (let i = actions.length - 1; i >= 0; i--) {
                    if (!String(actions[i] || '').startsWith('BROWSER_USE')) {
                        actions.splice(i, 1);
                    }
                }
            }


            for (const actionStr of actions) {
                if (actionStr.startsWith('ADD_TASK')) {
                    const idMatch = actionStr.match(/sop_id="(.*?)"/) || actionStr.match(/sop_id=([^\s\]]+)/i);
                    if (idMatch) {
                        const mSop = sopsWithState.find(s => s.id === idMatch[1]);
                        if (mSop) {
                            const task = {
                                id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                                title: buildTaskTitle(mSop, mSop.recommendedAction),
                                description: `Scheduled by AI Agent`,
                                skillId: mSop.id,
                                action: mSop.recommendedAction,
                                category: mSop.category || 'Maintenance',
                                status: 'pending', progress: 0, logs: [],
                                createdAt: new Date().toISOString()
                            };
                            todoList.push(task);
                            hasActionTaken = true;
                            taskListChanged = true;
                            actionSummaries.push(
                                locale === 'en-US'
                                    ? `Added task to list: ${task.title} (${task.id})`
                                    : `已加入工作清單：${task.title}（${task.id}）`
                            );
                        }


                    }


                }


                if (actionStr.startsWith('REMOVE_TASK')) {
                    const idMatch = actionStr.match(/task_id="(.*?)"/) || actionStr.match(/task_id=([^\s\]]+)/i);
                    if (idMatch) {
                        const removed = todoList.find((t) => t.id === idMatch[1]);
                        todoList = todoList.filter(t => t.id !== idMatch[1]);
                        hasActionTaken = true;
                        taskListChanged = true;
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Removed task: ${removed?.title || idMatch[1]}`
                                : `已移除任務：${removed?.title || idMatch[1]}`
                        );
                    }


                }


                if (actionStr.startsWith('EXECUTE_TASK')) {
                    const idMatch = actionStr.match(/task_id="(.*?)"/) || actionStr.match(/task_id=([^\s\]]+)/i);
                    if (idMatch) {
                        executeTaskId = idMatch[1];
                        hasActionTaken = true;
                        const target = todoList.find((t) => t.id === idMatch[1]);
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Starting task: ${target?.title || idMatch[1]}`
                                : `開始執行任務：${target?.title || idMatch[1]}`
                        );
                    }
                }

                if (actionStr.startsWith('INSTALL_SOP')) {
                    const idMatch = actionStr.match(/sop_id="(.*?)"/) || actionStr.match(/sop_id=([^\s\]]+)/i);
                    if (idMatch) {
                        const mSop = sopsWithState.find((s) => s.id === idMatch[1]);
                        if (mSop) {
                            const task = {
                                id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                                title: buildTaskTitle(mSop, mSop.recommendedAction),
                                description: 'Scheduled by AI Agent',
                                skillId: mSop.id,
                                action: mSop.recommendedAction,
                                category: mSop.category || 'Maintenance',
                                status: 'pending', progress: 0, logs: [],
                                createdAt: new Date().toISOString()
                            };
                            todoList.push(task);
                            hasActionTaken = true;
                            taskListChanged = true;
                            executeTaskId = task.id;
                            actionSummaries.push(
                                locale === 'en-US'
                                    ? `Queued and starting SOP task: ${task.title} (${task.id})`
                                    : `已建立並開始 SOP 任務：${task.title}（${task.id}）`
                            );
                        }
                    }
                }


                if (actionStr === 'CLEAR_ALL') {
                    todoList = [];
                    hasActionTaken = true;
                    taskListChanged = true;
                    actionSummaries.push(
                        locale === 'en-US' ? 'Cleared all tasks.' : '已清空全部任務。'
                    );
                }


                if (actionStr.startsWith('SWITCH_MODEL')) {
                    const nameMatch = actionStr.match(/name="(.*?)"/) || actionStr.match(/name=([^\s\]]+)/i);
                    if (nameMatch) {
                        llm.setCurrentModel(nameMatch[1]);
                        hasActionTaken = true;
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Switched model to: ${nameMatch[1]}`
                                : `已切換模型：${nameMatch[1]}`
                        );
                    }
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
                    const mode = parseBrowserUseMode(actionStr);
                    const query = parseActionArg(actionStr, 'query') || String(researchIntentMessage || '').trim();
                    const url = parseActionArg(actionStr, 'url');
                    let browserResult;
                    try {
                        setAgentRunStatus(agentRunId, mode === 'extract_text' ? 'extracting' : 'searching', locale || 'zh-TW', query || url || mode);
                        browserResult = await runBrowserUseOperation({ mode, query, url, limit: 5 });
                    } catch (browserError) {
                        browserResult = {
                            success: false,
                            mode,
                            error: browserError.message || String(browserError),
                            sopId: browserError.sopId || (/playwright|chromium|browser unavailable/i.test(browserError.message || '') ? 'install_playwright_chromium' : ''),
                            browserUnavailable: /playwright|chromium|browser unavailable/i.test(browserError.message || ''),
                        };
                    }
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
                            if (isWebResearchIntent(researchIntentMessage)) {
                                setAgentRunStatus(agentRunId, 'extracting', locale || 'zh-TW', items[0]?.title || query || message);
                                const extracted = await extractTextFromSearchResults(items, 2);
                                if (extracted.length > 0) {
                                    actionSummaries.push(
                                        (locale === 'en-US'
                                            ? 'Extracted source content:\n'
                                            : '已自動抓取來源內容：\n') +
                                        extracted.map((item, index) => [
                                            `Source ${index + 1}: ${item.title || '(untitled)'}`,
                                            `URL: ${item.url}`,
                                            item.text,
                                        ].filter(Boolean).join('\n')).join('\n\n')
                                    );
                                }
                            }
                        } else {
                            actionSummaries.push(
                                locale === 'en-US'
                                    ? `Search completed, but no visible result items were parsed for "${query || message}".`
                                    : `已完成搜尋，但沒有解析到可用結果（${query || message}）。`
                            );
                        }
                    } else if (browserResult?.success && mode === 'extract_text') {
                        actionSummaries.push(
                            (locale === 'en-US'
                                ? `Extracted content from ${browserResult.url || url}:\n`
                                : `從 ${browserResult.url || url} 抓取的內容：\n`) +
                            String(browserResult.text || '').slice(0, 2500)
                        );
                    } else if (browserResult?.success) {
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Browser Use executed (${mode}).`
                                : `已執行 Browser Use（${mode}）。`
                        );
                    } else {
                        if (browserResult?.sopId === 'install_playwright_chromium' || browserResult?.browserUnavailable) {
                            const queued = queueSopTaskById(
                                sopsWithState,
                                'install_playwright_chromium',
                                'Required by Browser Use'
                            );
                            if (queued.success) {
                                taskListChanged = true;
                                actionSummaries.push(
                                    locale === 'en-US'
                                        ? `Browser Use is unavailable because Playwright Chromium is not installed. ${queued.reused ? 'Reused' : 'Added'} install task: ${queued.task.title} (${queued.task.id}). Please run this task, then try Browser Use again.`
                                        : `Browser Use 目前不可用，因為尚未安裝 Playwright Chromium。已${queued.reused ? '沿用' : '加入'}安裝任務：${queued.task.title}（${queued.task.id}）。請先執行此任務，完成後再使用 Browser Use。`
                                );
                            } else {
                                actionSummaries.push(
                                    locale === 'en-US'
                                        ? `Browser Use is unavailable and I could not queue the install task: ${queued.error}`
                                        : `Browser Use 不可用，而且無法加入安裝任務：${queued.error}`
                                );
                            }
                        }
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Browser Use failed (${mode}): ${browserResult?.error || 'unknown error'}`
                                : `Browser Use 失敗（${mode}）：${browserResult?.error || '未知錯誤'}`
                        );
                    }
                }

                if (actionStr.startsWith('COMPUTER_USE')) {
                    const mode = parseActionArg(actionStr, 'mode');
                    const filePath = parseActionArg(actionStr, 'file_path') || parseActionArg(actionStr, 'path');
                    const args = parseActionArg(actionStr, 'arguments') || parseActionArg(actionStr, 'args');
                    const url = parseActionArg(actionStr, 'url');
                    const sopId = parseActionArg(actionStr, 'sop_id');
                    const computerResult = runComputerUseOperation({ mode, filePath, path: filePath, arguments: args, url, sopId }, sopsWithState);
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
                        const created = createWingetSopFile({
                            id: idMatch[1],
                            name: nameMatch ? nameMatch[1] : idMatch[1],
                        });
                        hasActionTaken = true;
                        sopChanged = true;
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Created winget SOP: ${created?.fileName || idMatch[1]}`
                                : `已建立 winget SOP：${created?.fileName || idMatch[1]}`
                        );
                    }


                }


                if (actionStr.startsWith('CREATE_MSSTORE_SOP')) {
                    const idMatch = actionStr.match(/package_id="(.*?)"/);
                    const nameMatch = actionStr.match(/package_name="(.*?)"/);
                    if (idMatch) {
                        const created = createMicrosoftStoreSopFile({
                            id: idMatch[1],
                            name: nameMatch ? nameMatch[1] : idMatch[1],
                            source: 'msstore',
                        });
                        hasActionTaken = true;
                        sopChanged = true;
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Created Microsoft Store SOP: ${created?.fileName || idMatch[1]}`
                                : `已建立 Microsoft Store SOP：${created?.fileName || idMatch[1]}`
                        );
                    }


                }


                if (actionStr.startsWith('CREATE_GITHUB_RELEASE_SOP')) {
                    const repoMatch = actionStr.match(/repo_full_name="(.*?)"/);
                    const assetMatch = actionStr.match(/asset_name="(.*?)"/);
                    const urlMatch = actionStr.match(/download_url="(.*?)"/);
                    if (repoMatch && assetMatch && urlMatch) {
                        const created = createGitHubReleaseSopFile({
                            fullName: repoMatch[1],
                            name: repoMatch[1].split('/').pop(),
                            assetName: assetMatch[1],
                            downloadUrl: urlMatch[1],
                        });
                        hasActionTaken = true;
                        sopChanged = true;
                        actionSummaries.push(
                            locale === 'en-US'
                                ? `Created GitHub release SOP: ${created?.fileName || repoMatch[1]}`
                                : `已建立 GitHub Release SOP：${created?.fileName || repoMatch[1]}`
                        );
                    }


                }


            }


            // ═══════════════════════════════════════════════════════════════
            // 強制 Web Research Fallback：如果 LLM 沒輸出 ACTION 但這是網路查詢
            // ═══════════════════════════════════════════════════════════════
            if (!actionSummaries.length && isWebResearchIntent(researchIntentMessage)) {
                console.log('[Agent Loop] Web research request detected but LLM did not output ACTION. Forcing fallback search...');
                const query = buildWebResearchSearchQuery(researchIntentMessage, locale || 'zh-TW');
                try {
                    setAgentRunStatus(agentRunId, 'searching', locale || 'zh-TW', query);
                    const browserResult = await runBrowserUseOperation({ mode: 'search', query, limit: 5 });
                    const items = Array.isArray(browserResult?.results) ? browserResult.results.slice(0, 5) : [];
                    if (items.length > 0) {
                        actionSummaries.push(
                            [
                                browserResult?.browserUnavailable
                                    ? (locale === 'en-US'
                                        ? 'Browser Use is not fully installed, so I used text/link search fallback.'
                                        : 'Browser Use 尚未完整安裝，因此先改用文字/連結搜尋 fallback。')
                                    : '',
                                (locale === 'en-US'
                                    ? `Current-info search results for "${query}":`
                                    : `「${query}」即時資訊搜尋結果：`),
                                ...items.map((item, index) => `${index + 1}. ${item.title} - ${item.url}`),
                            ].filter(Boolean).join('\n')
                        );
                        setAgentRunStatus(agentRunId, 'extracting', locale || 'zh-TW', items[0]?.title || query);
                        const extracted = await extractTextFromSearchResults(items, 2);
                        if (extracted.length > 0) {
                            actionSummaries.push(
                                (locale === 'en-US'
                                    ? 'Extracted source content:\n'
                                    : '已自動抓取來源內容：\n') +
                                extracted.map((item, index) => [
                                    `Source ${index + 1}: ${item.title || '(untitled)'}`,
                                    `URL: ${item.url}`,
                                    item.text,
                                ].filter(Boolean).join('\n')).join('\n\n')
                            );
                        }
                    } else {
                        if (browserResult?.browserUnavailable) {
                            const queued = queueSopTaskById(
                                sopsWithState,
                                'install_playwright_chromium',
                                'Required by Browser Use current-info search'
                            );
                            if (queued.success) {
                                taskListChanged = true;
                            }
                        }
                        actionSummaries.push(
                            browserResult?.browserUnavailable
                                ? (locale === 'en-US'
                                    ? 'Browser Use is unavailable. Please install the Playwright Chromium browser runtime; no text fallback results were found.'
                                    : 'Browser Use 不可用。請先安裝 Playwright Chromium 瀏覽器 runtime；這次也沒有取得文字 fallback 結果。')
                                : (locale === 'en-US'
                                    ? `Current-info search completed, but no usable results were parsed for "${query}".`
                                    : `已完成即時資訊搜尋，但沒有解析到可用結果：「${query}」。`)
                        );
                    }
                } catch (searchError) {
                    actionSummaries.push(
                        locale === 'en-US'
                            ? `Current-info search failed: ${searchError.message}`
                            : `即時資訊搜尋失敗：${searchError.message}`
                    );
                }
            }

            if (hasActionTaken) saveTasks();

            // ═══════════════════════════════════════════════════════════════
            // Hermes-style Agent Loop: Loop until LLM stops outputting ACTIONs
            // ═══════════════════════════════════════════════════════════════
            const MAX_AGENT_TURNS = 8;
            let agentTurnCount = 0;
            let conversationHistory = []; // Start fresh conversation for this request
            let lastToolBundle = actionSummaries.slice();
            const looksLikeWebObservation = (bundle = []) => (Array.isArray(bundle) ? bundle : []).some((item) =>
                /(搜尋結果|search results|來源內容|Extracted|即時資訊|Current-info|Browser Use|extract|URL:|https?:\/\/)/i.test(String(item || ''))
            );
            // 只有 web 工具結果才進 Agent Loop；ADD_TASK 等本機動作不必再叫 LLM 重講一次
            const shouldRunAgentLoop = looksLikeWebObservation(lastToolBundle)
                || (isWebResearchIntent(researchIntentMessage) && lastToolBundle.length > 0 && !isUsableAgentFinalReply(llmReply));

            // Add user message
            conversationHistory.push({
                role: 'user',
                content: message
            });

            // Add first assistant reply
            conversationHistory.push({
                role: 'assistant',
                content: llmReply
            });

            // If first reply had actions / web fallback, add their results as tool messages
            if (lastToolBundle.length > 0 && shouldRunAgentLoop) {
                conversationHistory.push(buildToolObservationMessage(lastToolBundle.join('\n\n'), locale));
            }

            let currentLlmReply = llmReply;
            let emptyFinalRetries = 0;

            console.log(`[Agent Loop] Initialization: actionSummaries.length = ${lastToolBundle.length}, llmReply length = ${llmReply.length}, usableFirst=${isUsableAgentFinalReply(llmReply)}, shouldLoop=${shouldRunAgentLoop}`);

            // Enter loop when web tool results need to become a real user-facing answer
            while (shouldRunAgentLoop && lastToolBundle.length > 0 && agentTurnCount < MAX_AGENT_TURNS) {
                agentTurnCount++;
                const forceFinal = emptyFinalRetries > 0 || agentTurnCount >= 3;
                console.log(`[Agent Loop] Turn ${agentTurnCount}/${MAX_AGENT_TURNS}, tool results: ${lastToolBundle.length} items, forceFinal=${forceFinal}`);

                try {
                    setAgentRunStatus(agentRunId, 'summarizing', locale || 'zh-TW', `turn ${agentTurnCount}`);
                    const loopReply = await llm.chatWithLLM(
                        buildAgentLoopContinuePrompt(locale || 'zh-TW', agentTurnCount, forceFinal),
                        conversationHistory,
                        {
                            systemContext: [
                                chatOptions.systemContext || '',
                                locale === 'en-US'
                                    ? `[Agent Loop Turn ${agentTurnCount}/${MAX_AGENT_TURNS}] CRITICAL RULES:\n1. If tool results above only show URLs without actual weather/price/news DATA, you MUST output [ACTION:BROWSER_USE mode="extract_text" url="<first-url>"] OUTSIDE any ##CHALKBOARD## block\n2. NEVER put [ACTION:...] tags inside ##CHALKBOARD## blocks - they will not execute\n3. Output ACTION tags in plain text first, then optionally add ##CHALKBOARD## summary after\n4. Only after you have REAL DATA (temperature numbers, prices, facts), provide final answer with actual information\n5. Do NOT respond with only ##CHALKBOARD## blocks - always include plain text explanation\n6. NEVER answer with only "Done" / "executed the action" when tool facts exist`
                                    : `[Agent Loop 第 ${agentTurnCount}/${MAX_AGENT_TURNS} 回合] **關鍵規則**：\n1. 如果上方工具結果只有網址而無實際天氣/物價/新聞**數據**，你必須輸出 [ACTION:BROWSER_USE mode="extract_text" url="<第一個網址>"] 且**不可放在** ##CHALKBOARD## 區塊內\n2. **絕對禁止**把 [ACTION:...] 標籤寫在 ##CHALKBOARD## 區塊裡 - 這樣不會被執行\n3. 先在一般文字輸出 ACTION 標籤，再選擇性地加上 ##CHALKBOARD## 摘要\n4. 只有在取得**實際數據**（溫度數字、價格、事實）後，才提供包含具體資訊的最終答案\n5. **禁止**只輸出 ##CHALKBOARD## 區塊 - 回覆中必須包含一般文字說明\n6. **禁止**在已有工具結果時只回「已執行指定動作」`,
                            ].filter(Boolean).join('\n'),
                        },
                        locale
                    );

                    // Parse actions from loop reply
                    const loopActionRegex = /\[(?:ACTION\s*[:=]\s*|Action\s*=\s*)(.*?)\]/gi;
                    const loopActions = [];
                    let loopMatch;
                    while ((loopMatch = loopActionRegex.exec(loopReply)) !== null) {
                        loopActions.push(normalizeActionString(loopMatch[1]));
                    }
                    const bareLoopActionRegex = /(?:^|\n)\s*Action\s*=\s*([A-Za-z_]+[^\r\n]*)/gi;
                    while ((loopMatch = bareLoopActionRegex.exec(loopReply)) !== null) {
                        loopActions.push(normalizeActionString(loopMatch[1]));
                    }

                    // Add this assistant reply to conversation
                    conversationHistory.push({
                        role: 'assistant',
                        content: loopReply
                    });

                    // Execute actions and collect results
                    const newActionSummaries = [];
                    for (const actionStr of loopActions) {
                        if (actionStr.startsWith('BROWSER_USE')) {
                            const mode = parseBrowserUseMode(actionStr);
                            const query = parseActionArg(actionStr, 'query') || String(researchIntentMessage || '').trim();
                            const url = parseActionArg(actionStr, 'url');
                            try {
                                setAgentRunStatus(agentRunId, mode === 'extract_text' ? 'extracting' : 'searching', locale || 'zh-TW', query || url || mode);
                                const browserResult = await runBrowserUseOperation({ mode, query, url, limit: 5 });
                                if (browserResult?.success) {
                                    if (mode === 'search' && Array.isArray(browserResult.results)) {
                                        const items = browserResult.results.slice(0, 5);
                                        if (items.length > 0) {
                                            newActionSummaries.push(
                                                (locale === 'en-US' ? `Search results for "${query}":\n` : `「${query}」搜尋結果：\n`) +
                                                items.map((item, i) => `${i + 1}. ${item.title} - ${item.url}`).join('\n')
                                            );
                                            if (isWebResearchIntent(researchIntentMessage)) {
                                                setAgentRunStatus(agentRunId, 'extracting', locale || 'zh-TW', items[0]?.title || query || message);
                                                const extracted = await extractTextFromSearchResults(items, 2);
                                                if (extracted.length > 0) {
                                                    newActionSummaries.push(
                                                        (locale === 'en-US' ? 'Extracted source content:\n' : '已自動抓取來源內容：\n') +
                                                        extracted.map((item, i) => [
                                                            `Source ${i + 1}: ${item.title || '(untitled)'}`,
                                                            `URL: ${item.url}`,
                                                            item.text,
                                                        ].filter(Boolean).join('\n')).join('\n\n')
                                                    );
                                                }
                                            }
                                        }
                                    } else if (mode === 'extract_text' && browserResult.text) {
                                        newActionSummaries.push(
                                            (locale === 'en-US' ? `Extracted content from ${url}:\n` : `從 ${url} 抓取的內容：\n`) +
                                            String(browserResult.text).slice(0, 2000)
                                        );
                                    } else if (mode === 'fetch_title' && browserResult.title) {
                                        newActionSummaries.push(
                                            (locale === 'en-US' ? `Page title: ${browserResult.title}` : `頁面標題：${browserResult.title}`)
                                        );
                                    } else if (mode === 'open' || mode === 'navigate') {
                                        newActionSummaries.push(
                                            locale === 'en-US'
                                                ? `Opened ${url || query} in Browser tab`
                                                : `已在 Browser 分頁開啟 ${url || query}`
                                        );
                                    }
                                } else {
                                    newActionSummaries.push(
                                        (locale === 'en-US' ? `Browser Use failed (${mode}): ` : `Browser Use 失敗（${mode}）：`) +
                                        (browserResult?.error || 'unknown error')
                                    );
                                }
                            } catch (err) {
                                newActionSummaries.push(
                                    (locale === 'en-US' ? `Browser Use error (${mode}): ` : `Browser Use 錯誤（${mode}）：`) + err.message
                                );
                            }
                        }
                    }

                    // If no new actions, check whether reply is usable
                    if (newActionSummaries.length === 0) {
                        currentLlmReply = loopReply;
                        console.log(`[Agent Loop] Turn ${agentTurnCount} complete: no new actions. Final reply length = ${loopReply.length}, usable=${isUsableAgentFinalReply(loopReply)}`);
                        if (isUsableAgentFinalReply(loopReply) || forceFinal || emptyFinalRetries >= 1) {
                            break;
                        }
                        // Model returned only control tags / boilerplate — force one more summarize pass
                        emptyFinalRetries += 1;
                        conversationHistory.push({
                            role: 'user',
                            content: locale === 'en-US'
                                ? 'Your previous reply was empty or only control tags. Using the same tool results, answer the user completely now. No ACTION tags.'
                                : '你上一則回覆是空的或只有控制碼。請用相同工具結果直接回答使用者完整答案，不要再輸出 ACTION。',
                        });
                        continue;
                    }

                    // Add tool results to conversation and continue loop
                    conversationHistory.push(buildToolObservationMessage(newActionSummaries.join('\n\n'), locale));
                    lastToolBundle = newActionSummaries;
                    actionSummaries = newActionSummaries;
                    currentLlmReply = loopReply;
                    emptyFinalRetries = 0;
                    console.log(`[Agent Loop] Turn ${agentTurnCount} complete: ${newActionSummaries.length} new actions. Continuing loop...`);

                } catch (loopError) {
                    console.warn(`[Agent Loop] Turn ${agentTurnCount} failed:`, loopError.message);
                    break;
                }
            }

            console.log(`[Agent Loop] Exit: agentTurnCount = ${agentTurnCount}, final currentLlmReply length = ${currentLlmReply.length}`);

            // Clean final reply (remove ACTION / control tags)
            let cleanReply = stripControlTagsFromReply(currentLlmReply);

            // If still unusable but we have web tool data, one last forced summarize, then local fallback
            if (!isUsableAgentFinalReply(cleanReply) && shouldRunAgentLoop && looksLikeWebObservation(lastToolBundle)) {
                try {
                    setAgentRunStatus(agentRunId, 'summarizing', locale || 'zh-TW', 'force-final');
                    const forceReply = await llm.chatWithLLM(
                        buildAgentLoopContinuePrompt(locale || 'zh-TW', agentTurnCount + 1, true),
                        conversationHistory,
                        {
                            systemContext: [
                                chatOptions.systemContext || '',
                                locale === 'en-US'
                                    ? 'Final pass: answer with concrete findings and links only. No ACTION tags.'
                                    : '最後一輪：只用具體查詢結果與來源連結回答。禁止 ACTION。',
                            ].filter(Boolean).join('\n'),
                        },
                        locale
                    );
                    if (isUsableAgentFinalReply(forceReply)) {
                        cleanReply = stripControlTagsFromReply(forceReply);
                        currentLlmReply = forceReply;
                    }
                } catch (forceError) {
                    console.warn('[Agent Loop] Force-final summarize failed:', forceError.message);
                }
            }

            if (!isUsableAgentFinalReply(cleanReply) && looksLikeWebObservation(lastToolBundle)) {
                cleanReply = buildFallbackAnswerFromToolSummaries(lastToolBundle, message, locale || 'zh-TW');
                console.log('[Agent Loop] Used local fallback answer from tool summaries');
            }

            // 非 web 工具類 ACTION（加任務等）也要有可讀回覆
            if (!isUsableAgentFinalReply(cleanReply) && actionSummaries.length > 0) {
                cleanReply = actionSummaries.join('\n');
            }

            const finalReply = cleanReply || (
                looksLikeWebObservation(lastToolBundle)
                    ? buildFallbackAnswerFromToolSummaries(lastToolBundle, message, locale || 'zh-TW')
                    : (actionSummaries.length > 0
                        ? actionSummaries.join('\n')
                        : (locale === 'en-US'
                            ? 'I could not complete this request with a usable answer. Please try again.'
                            : '這次沒有產生可用答案，請再試一次。'))
            );

            // Update chat history for future conversations
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
            const finalSuggestions = parseStructuredSuggestions(llmReply, locale, suggestions);
            setAgentRunStatus(agentRunId, 'done', locale || 'zh-TW');
            return res.json({
                success: true,
                reply: finalReply,
                suggestions: finalSuggestions,
                task: taskListChanged,
                sopChanged,
                executeTaskId,
                llmUsed: true,
                agentTurns: agentTurnCount, // Report how many agent loop turns were executed
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
            setAgentRunStatus(agentRunId, 'error', locale || 'zh-TW', llmErr.message || String(llmErr));
            llmErrorForFallback = llmErr.message;
            // 發生錯誤不中斷，讓它往下走到關鍵字比對模式
        }


    }


    // ── 情境 2：LLM 不可用 (硬編碼備援模式) ───────────────────────────
    let matchedSOP = null;
    let taskAdded = null;
    let executeTaskId = null;
    let isActionTaken = false;
    suggestions = [];
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
        // 「寫個小遊戲」等創作請求不能因為含有「遊戲」就誤新增 Steam。
        // 僅在使用者明確提及 Steam 時，備援模式才建立 Steam 任務。
        if (/\bsteam\b/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'rec_steam');
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
    let aiWarning = '';
    if (taskAdded) {
        reply = locale === 'en-US'
            ? `Added '${taskAdded.title}' to the list. Execute now? 😊`
            : `已將「${taskAdded.title}」加入清單。要執行嗎？😊`;
        suggestions = locale === 'en-US' ? ['Execute', 'Not now'] : ['執行', '先不用'];
    } else if (executeTaskId) {
        reply = locale === 'en-US' ? 'Sure, starting now! 🚀' : '好的，開始執行！🚀';
    } else {
        // AI 引擎不可用、落到關鍵字模式：明確告知 + 給可執行的下一步，而不是籠統英文句。
        const raw = String(llmErrorForFallback || '').toLowerCase();
        let hint;
        if (/fetch failed|econnrefused|econnreset|etimedout|network|connect|11434|127\.0\.0\.1|localhost/.test(raw)) {
            hint = locale === 'en-US'
                ? 'The AI engine (Ollama) seems to be down or unreachable. Start Ollama (or check the Provider Base URL), then retry.'
                : 'AI 引擎（Ollama）似乎未啟動或連不到。請啟動 Ollama（或檢查設定裡的 Provider Base URL）後再試。';
        } else if (/401|403|unauthorized|authentication|api key|api key|bearer|invalid key/.test(raw)) {
            hint = locale === 'en-US'
                ? 'Authentication failed. Check the API Key in Settings.'
                : '驗證失敗。請在設定中檢查 API Key。';
        } else if (/404|not found|model/.test(raw)) {
            hint = locale === 'en-US'
                ? 'The model may be missing or misnamed. Pull the default model, or check the model name in Settings.'
                : '模型可能未下載或名稱有誤。請下載預設模型，或到設定中檢查模型名稱。';
        } else if (llmErrorForFallback) {
            hint = locale === 'en-US'
                ? `AI engine error: ${llmErrorForFallback}`
                : `AI 引擎錯誤：${llmErrorForFallback}`;
        } else {
            hint = locale === 'en-US'
                ? 'The AI engine is not ready yet. Running in keyword mode — results may be limited.'
                : 'AI 引擎尚未就緒，目前為關鍵字模式，結果可能有限。';
        }
        aiWarning = hint;
        reply = locale === 'en-US'
            ? `I received “${message}”, but I couldn't use the AI engine for this, so I'm falling back to keyword mode.`
            : `我收到「${message}」，但這次無法使用 AI 引擎，因此改用關鍵字模式。`;
    }


    return res.json({
        success: true,
        reply,
        aiWarning,
        suggestions,
        task: !!taskAdded,
        executeTaskId,
        llmUsed: false
    });
});

app.post('/api/browser/session/start', async (req, res) => {
    try {
        await ensureBrowserSession();
        const snap = await captureBrowserSnapshot(browserSession.page);
        res.json({
            success: true,
            startedAt: browserSession.startedAt,
            playwrightAvailable: isPlaywrightAvailable(),
            ...snap,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            sopId: error?.sopId || '',
            playwrightAvailable: isPlaywrightAvailable(),
        });
    }
});

app.post('/api/browser/session/stop', async (req, res) => {
    try {
        await closeBrowserSession();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/browser/session/navigate', async (req, res) => {
    try {
        const url = normalizeNavigateUrl(req.body?.url || '');
        if (!url) return res.status(400).json({ success: false, error: 'Missing URL' });
        const page = await ensureBrowserSession();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const snap = await captureBrowserSnapshot(page);
        res.json({ success: true, ...snap });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/browser/session/action', async (req, res) => {
    try {
        const action = String(req.body?.action || '').toLowerCase();
        const page = await ensureBrowserSession();
        if (action === 'back') {
            await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        } else if (action === 'forward') {
            await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
        } else if (action === 'reload') {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        } else {
            return res.status(400).json({ success: false, error: 'Unsupported action' });
        }
        const snap = await captureBrowserSnapshot(page);
        res.json({ success: true, ...snap });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/browser/session/snapshot', async (req, res) => {
    try {
        const page = await ensureBrowserSession();
        const snap = await captureBrowserSnapshot(page);
        res.json({ success: true, ...snap });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message, playwrightAvailable: isPlaywrightAvailable() });
    }
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
    const position = ['left', 'right', 'full'].includes(String(req.body?.position || '').toLowerCase())
        ? String(req.body.position).toLowerCase()
        : 'full';
    const clear = req.body?.clear !== false;
    const replaceLane = req.body?.replaceLane !== false;
    const layoutRaw = String(req.body?.layout || '').toLowerCase();
    const layout = (layoutRaw === 'news' || layoutRaw === 'list') ? layoutRaw : '';
    const maxBullets = (layout === 'news' || layout === 'list') ? 8 : 4;
    const maxChars = (layout === 'news' || layout === 'list') ? 96 : 64;
    const bullets = Array.isArray(req.body?.bullets)
        ? req.body.bullets
            .map((item) => String(item || '').trim().slice(0, maxChars))
            .filter(Boolean)
            .slice(0, maxBullets)
        : [];
    if (!title && bullets.length === 0) {
        return res.status(400).json({ success: false, error: 'Empty chalkboard draft.' });
    }
    res.json({
        success: true,
        draft: {
            title: title || 'Chalkboard Draft',
            bullets,
            position,
            clear,
            replaceLane,
            layout,
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
    const logPath = path.join(visualAgentDir, 'debug.log');
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
    return `# Visual Agent SOP File v1
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
    $baseDir = Join-Path $env:USERPROFILE 'Downloads\\Visual Agent Downloads'
    $assetPath = Join-Path $baseDir '${escapedAssetName}'
    if (Test-Path $assetPath) { $true } else { $false }

} catch {
    $false
}


\`\`\`
## Install
\`\`\`powershell
Write-Host "Downloading ${repoName} from GitHub Releases. Please wait..."
$baseDir = Join-Path $env:USERPROFILE 'Downloads\\Visual Agent Downloads'
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
    $baseDir = Join-Path $env:USERPROFILE 'Downloads\\Visual Agent Downloads'
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
$baseDir = Join-Path $env:USERPROFILE 'Downloads\\Visual Agent Downloads'
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
    return `# Visual Agent SOP File v1
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

process.on('SIGINT', async () => {
    await closeBrowserSession();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await closeBrowserSession();
    process.exit(0);
});

function getPortOwnerHint(port) {
    if (process.platform !== 'win32') return '';
    try {
        const cmd = [
            `$items = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue`,
            '$items | Select-Object -First 5 LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress',
        ].join('; ');
        const output = execSync(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${cmd}"`, {
            encoding: 'utf8',
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (!output) return '';
        const parsed = JSON.parse(output);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        return rows
            .filter(Boolean)
            .map((item) => `${item.LocalAddress}:${item.LocalPort} PID ${item.OwningProcess}`)
            .join(', ');
    } catch {
        return '';
    }
}

function canListenOnPort(port, host = '0.0.0.0') {
    return new Promise((resolve) => {
        const tester = net.createServer();
        tester.once('error', (error) => {
            tester.close(() => resolve({ available: false, error }));
        });
        tester.once('listening', () => {
            tester.close(() => resolve({ available: true, error: null }));
        });
        tester.listen(port, host);
    });
}

async function assertPortAvailable(port, label) {
    const check = await canListenOnPort(port);
    if (check.available) return;
    const owner = getPortOwnerHint(port);
    const message = `${label} port ${port} is already in use${owner ? ` (${owner})` : ''}. Stop the existing Visual Agent process or use that running instance.`;
    console.error(`\n  ❌ ${message}\n`);
    fileLog(`Startup blocked: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}

async function startVisualAgentServer() {
    await assertPortAvailable(PORT, 'HTTP API');
    await assertPortAvailable(DEFAULT_REMOTE_PORT, 'Remote Agent TCP');

    if (!remoteAgentStarted) {
        remoteAgent.start();
        remoteAgentStarted = true;
    }

    // 綁定 127.0.0.1：本 app 的 HTTP API 提供 SOP 執行、設定（含 API Key）等敏感端點，
    // 僅供本機前端（http://localhost:3210）與 Tauri dev 使用。綁 0.0.0.0 會讓區域網路
    // 內任何主機可遠端觸發 SOP/PowerShell 執行與讀取 API Key（RCE 級風險）。
    // 遠端雙機協作走獨立的 raw TCP（remote-agent.js），不受此綁定影響。
    const httpServer = app.listen(PORT, '127.0.0.1', async () => {
    const startMsg = `Visual Agent started! (PID: ${process.pid}, Path: ${process.execPath})`;
    console.log(`\n  🖥️  ${startMsg}`);
    fileLog(startMsg);
    console.log(`  📍 http://127.0.0.1:${PORT} (localhost-only)`);
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

    httpServer.on('error', (error) => {
        const owner = getPortOwnerHint(PORT);
        const message = `HTTP API port ${PORT} failed to listen: ${error.message}${owner ? ` (${owner})` : ''}`;
        console.error(`\n  ❌ ${message}\n`);
        fileLog(message);
        process.exit(1);
    });
}

startVisualAgentServer().catch((error) => {
    if (process.exitCode) return;
    console.error(`\n  ❌ Visual Agent failed to start: ${error.message}\n`);
    fileLog(`Visual Agent failed to start: ${error.message}`);
    process.exit(1);
});
