/**
 * AI PC Agent Local Server
 * 
 * 提供 REST API 給前端 UI 使用，橋接 sop-parser 與 sop-executor。
 * 啟動後會自動開啟瀏覽器。
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const pkg = require('../package.json');
const { loadAllSOPs } = require('./sop-parser');
const { SOPExecutor } = require('./sop-executor');
const llm = require('./llm');
const { getSystemHealth } = require('./system');
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
const SOPS_DIR = path.join(aipcDir, 'sops');
const SKILLS_DIR = path.join(aipcDir, 'skills');
const PLUGINS_DIR = path.join(aipcDir, 'plugins');
const EXPS_DIR = path.join(aipcDir, 'exps');
if (!fs.existsSync(SOPS_DIR)) fs.mkdirSync(SOPS_DIR, { recursive: true });
if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });
if (!fs.existsSync(EXPS_DIR)) fs.mkdirSync(EXPS_DIR, { recursive: true });
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
        console.error("[System] 同步內建資源失敗:", e.message);
    }


}


syncBundledAssets();
// ── In-memory state ─────────────────────────────────────────────────
let todoList = [];
let logs = [];
let runningSOP = null;
let chatHistory = []; // 儲存最近 6 則對話：[{role: 'user', content: '...'}, {role: 'assistant', content: '...'}]
const sopStateCache = new Map();
const SOP_STATE_TTL_MS = 30000;
function buildChatHistoryForRequest(history, hasChalkboardAttachment) {
    if (!hasChalkboardAttachment || !Array.isArray(history) || history.length === 0) {
        return Array.isArray(history) ? history : [];
    }


    const filtered = [];
    let skipAssistantReplyForImageTurn = false;
    history.forEach(entry => {
        const content = String(entry?.content || '');
        if (entry?.role === 'user' && content.includes('[使用者當時附上了 Chalkboard 草圖]')) {
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
        const aiReply = await llm.chatWithLLM(buildExperienceAIPrompt(task, sop, locale || "zh-TW"), []);
        const cleaned = redactSensitiveText(String(aiReply || '').trim());
        if (!cleaned) return;
        fs.appendFileSync(expPath, `### Veteran Notes\n${cleaned}\n\n`, 'utf8');
    } catch (err) {
        console.warn('[EXP] AI 老司機摘要生成失敗:', err.message);
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
        console.error('[EXP] 寫入經驗摘要失敗:', err.message);
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
        console.error('[EXP] 載入經驗摘要失敗:', err.message);
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
            entries.push({
                fileName: file.fileName,
                updatedAt: file.updatedAt,
                title: redactSensitiveText(title),
                content: redactSensitiveText(body),
                sopId: sopMatch ? redactSensitiveText(sopMatch[1]) : ''
            });
        });
    });
    return entries.slice(0, limit);
}


function buildTaskTitle(sop, action = 'install') {
    if (!sop) return '未命名任務';
    if (action === 'uninstall') {
        const normalizedName = String(sop.name || sop.id || '')
            .replace(/^[^\p{L}\p{N}]+/u, '')
            .replace(/^安裝\s*/u, '')
            .replace(/^下載\s*/u, '');
        return `🗑️ 解除安裝 ${normalizedName}`;
    }


    return `📦 ${sop.name}`;
}


function shouldSearchWingetForRecommendations(message = '') {
    const text = String(message || '');
    const wantsRecommendation = /(推薦|建議|值得|有什麼|有哪些|可以用什麼|找.+軟體|recommend|suggest)/i.test(text);
    const mentionsSoftware = /(軟體|app|工具|程式|應用|software|application)/i.test(text);
    return wantsRecommendation && mentionsSoftware;
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
// Default recommend list
// 推薦清單基本資料（按優先順序排列，AI 引擎放最前面）
const RECOMMEND_BASE = [
    {
        id: 'rec_install_ollama',
        title: '🧠 安裝 Ollama 本地 AI 引擎',
        description: '下載並安裝 Ollama，讓 AI Agent 具備本地語意理解能力',
        category: 'AI 引擎',
        priority: 'critical',
    },
    {
        id: 'rec_pull_llm_model',
        title: '📥 下載語言模型 (Qwen3.5 4B)',
        description: '下載 Qwen3.5 4B 語言模型，約 2.6GB，完成後對話將由 AI 真正理解你的需求',
        category: 'AI 引擎',
        priority: 'critical',
    },
    {
        id: 'rec_driver_check',
        title: '🔍 檢查並安裝驅動程式',
        description: '掃描硬體裝置並確認驅動程式是否為最新版本',
        category: '系統優化',
        priority: 'high',
    },
    {
        id: 'rec_remove_copilot',
        title: '🗑️ 移除 Windows Copilot',
        description: '停用並移除 Windows 內建的 Copilot 功能',
        category: '系統淨化',
        priority: 'medium',
    },
    {
        id: 'rec_install_chrome',
        title: '🌐 安裝 Google Chrome',
        description: '下載並安裝 Chrome 瀏覽器，設為預設瀏覽器',
        category: '瀏覽器',
        priority: 'high',
    },
    {
        id: 'rec_backup',
        title: '💾 備份你的電腦',
        description: '建立系統還原點，保護重要資料',
        category: '資料保護',
        priority: 'medium',
    },
    {
        id: 'rec_office',
        title: '📄 安裝 LibreOffice',
        description: '強大且免費開源的辦公軟體套件，與 Microsoft Office 格式相容',
        category: '工作必備',
        priority: 'medium',
    },
    {
        id: 'rec_steam',
        title: '🎮 安裝 Steam',
        description: '安裝 Steam 遊戲平台，暢玩你的遊戲庫',
        category: '娛樂',
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
    const resolvedTitle = matchedSOP ? buildTaskTitle(matchedSOP, resolvedAction) : (title || '未命名任務');
    const resolvedDescription = matchedSOP
        ? (resolvedAction === 'uninstall'
            ? `解除安裝 ${String(matchedSOP.name || matchedSOP.id || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^安裝\s*/u, '').replace(/^下載\s*/u, '')}`
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
            res.json({ success: false, error: '格式錯誤：需要 { tasks: [...] }' });
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
        $dlg.Filter = 'JSON 檔案 (*.json)|*.json|所有檔案 (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = '匯出 AI PC Agent 任務清單'
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
        $dlg.Filter = 'PNG 圖片 (*.png)|*.png|所有檔案 (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = '匯出黑板圖片'
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
        $dlg.Filter = 'Markdown 檔案 (*.md)|*.md|所有檔案 (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = '匯出 AI PC Agent exps'
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
        console.log(`[LLM] 預覽模型列表: Provider=${provider || '預設'}, URL=${baseUrl || '預設'}`);
        const models = await llm.listModels({ provider, baseUrl, apiKey, authConfig, forceRefresh: true });
        res.json({ success: true, models, currentModel: llm.getCurrentModel() });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }


});
// POST /api/llm/model 切換模型
app.post('/api/llm/model', (req, res) => {
    const { modelName } = req.body;
    if (!modelName) return res.json({ success: false, error: '缺少 modelName' });
    llm.setCurrentModel(modelName);
    res.json({ success: true, currentModel: llm.getCurrentModel() });
});
// POST /api/execute/:taskId 執行指定任務
app.post('/api/execute/:taskId', async (req, res) => {
    const task = todoList.find((t) => t.id === req.params.taskId);
    if (!task) {
        return res.json({ success: false, error: '找不到任務' });
    }


    if (runningSOP) {
        return res.json({ success: false, error: '目前有任務正在執行中，請稍候' });
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
            return res.json({ success: false, error: '此任務沒有對應的 SOP，無法自動執行' });
        }


        const sops = loadAllSOPs(SOPS_DIR);
        sop = sops.find((s) => s.id === task.skillId);
    }


    if (!sop) {
        return res.json({ success: false, error: `找不到對應的 SOP${task.skillId ? ': ' + task.skillId : ''}` });
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
    res.json({ success: true, message: '任務已開始執行' });
    try {
        const result = await executor.execute(sop, { action: task.action || 'install' });
        task.status = result.status;
        task.progress = 100;
        task.completedAt = new Date().toISOString();
        if (task.skillId) sopStateCache.delete(task.skillId);
        const finishLog = { level: 'success', message: `任務「${task.title}」執行完畢 (狀態: ${result.status})`, timestamp: new Date().toISOString() };
        task.logs.push(finishLog);
        logs.push(finishLog);
        // 針對 AI 引擎相關任務，強制清除快取並重新偵測
        if (sop.id === 'rec_install_ollama' || sop.id === 'rec_pull_llm_model' || task.skillId === 'rec_pull_llm_model' || task.dynamicCmd?.includes('ollama')) {
            console.log(`[Server] 偵測到 AI 相關任務完成: ${sop.id || 'dynamic'}，執行快取更新...`);
            fileLog(`AI Task Completed: ${sop.id || 'dynamic'}, invalidating cache.`);
            llm.invalidateCache();
        }


        appendTaskExperience(task, sop);
    } catch (err) {
        task.status = 'failed';
        task.completedAt = new Date().toISOString();
        if (task.skillId) sopStateCache.delete(task.skillId);
        const errLog = { level: 'error', message: `任務執行崩潰: ${err.message}`, timestamp: new Date().toISOString() };
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
        return res.json({ success: false, error: '找不到任務' });
    }


    res.json({ success: true, task });
});
// POST /api/chat 處理對話輸入（LLM 優先，fallback 到關鍵字比對）
app.post('/api/chat', async (req, res) => {
    const { message, locale } = req.body;
    const chalkboardAttachment = normalizeChalkboardAttachment(req.body?.chalkboard);
    if (!message) return res.json({ success: false, error: '請輸入訊息' });
    const sops = loadAllSOPs(SOPS_DIR);
    const sopsWithState = await annotateSOPRuntimeState(sops);
    let suggestions = ['幫我安裝 Chrome', '清理工作清單', '查看系統狀態']; // 提升作用域
    let llmErrorForFallback = null;
    // 1. 快速蒐集背景資訊
    const sopCatalog = sopsWithState.map(s => `- ID: ${s.id}, 名稱: ${s.name}, 狀態: ${s.installed ? '已安裝' : '未安裝'}, 建議動作: ${s.recommendedAction === 'uninstall' ? '解除安裝' : '安裝'}`).join('\n');
    const taskContext = todoList.map(t => `- ID: ${t.id}, 標題: ${t.title}, 狀態: ${t.status}`).join('\n');
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
                reply: '目前 SOP 清單裡已經有相近項目了，先從左側 SOP 清單搜尋看看；如果你要，我也可以再幫你改寫成更適合的版本。',
                suggestions: ['切到 SOP 清單', `搜尋 ${packageQuery}`],
                task: false,
                llmUsed: false
            });
        }


        const githubCandidates = isGitHubRequest ? await searchGitHubReleaseApps(packageQuery, 5) : [];
        if (githubCandidates.length > 0) {
            const created = createGitHubReleaseSopFile(githubCandidates[0]);
            return res.json({
                success: true,
                reply: `已幫你根據 GitHub Releases 產生 SOP：${created.fileName}。重新整理 SOP 清單後，就可以直接拿來下載或執行。`,
                suggestions: ['重新整理 SOP 清單', `幫我下載 ${githubCandidates[0].name}`],
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
                reply: `已幫你根據 Microsoft Store 產生 SOP：${created.fileName}。之後重新整理 SOP 清單，就可以直接拿來加入任務或執行。`,
                suggestions: ['重新整理 SOP 清單', `幫我安裝 ${storeCandidates[0].name}`],
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
                reply: `已幫你根據 winget 商店產生 SOP：${created.fileName}。之後重新整理 SOP 清單，就可以直接拿來加入任務或執行。`,
                suggestions: ['重新整理 SOP 清單', `幫我安裝 ${candidates[0].name}`],
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
            reply: `我先從 Microsoft Store 幫你找了幾個可參考的 UWP / 商店版軟體：\n${topPackages}\n\n如果你要，我可以再幫你把其中一套產生成 SOP。`,
            suggestions: microsoftStoreRecommendation.packages.slice(0, 3).map(pkg => `幫我做 ${pkg.name} 的 Microsoft Store SOP`),
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
            reply: `我先從 GitHub Releases 幫你找了幾個有 Windows 版 release 的候選軟體：\n${topPackages}\n\n如果你要，我可以再幫你把其中一套產生成下載型 SOP。`,
            suggestions: githubRecommendation.packages.slice(0, 3).map(pkg => `幫我做 ${pkg.name} 的 GitHub SOP`),
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
            reply: `目前 SOP 裡沒有直接對應的軟體，我先從 winget 商店幫你找了幾個可參考選項：\n${topPackages}\n\n如果你要，我可以再幫你把其中一套產生成 SOP。`,
            suggestions: wingetRecommendation.packages.slice(0, 3).map(pkg => `幫我做 ${pkg.name} 的 SOP`),
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
            const requestHistory = buildChatHistoryForRequest(chatHistory, Boolean(chalkboardAttachment));
            const contextNote = `
[[當前系統環境]]
1. 硬體簡報: ${hardwareSummary}

2. 可用 SOP (ID 列表):
${sopCatalog || '(無)'}

3. 待辦任務清單:
${taskContext || '(空)'}

4. 當前使用的 AI 模型: ${llm.getCurrentModel()}

5. Chalkboard 草圖: ${chalkboardAttachment ? `已附上 ${chalkboardAttachment.width || '?'}x${chalkboardAttachment.height || '?'} 黑板快照，請把它視為使用者的視覺需求草稿，優先結合圖片內容理解意圖。若本輪有附圖，這張圖就是「目前正在談的圖」；除非使用者明確要求比較前後兩張圖，否則請忽略先前任何圖片內容，只回答這一張。` : '本次未附上黑板快照。'}

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
            const chatOptions = {};
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
                llmReply = await llm.chatWithLLM(
                    message + "\n\n" + contextNote + wingetPromptNote + microsoftStorePromptNote + githubPromptNote + "\n\n[[exps 經驗庫]]\n" + (experienceContext || '(目前尚無可參考經驗)'),
                    requestHistory,
                    chatOptions
                );
            } catch (visionErr) {
                if (!chalkboardAttachment) throw visionErr;
                console.warn('[LLM] 黑板影像理解失敗，改以純文字重試:', visionErr.message);
                llmReply = await llm.chatWithLLM(
                    `${message}\n\n${contextNote}${wingetPromptNote}${microsoftStorePromptNote}${githubPromptNote}\n\n[[exps 經驗庫]]\n${experienceContext || '(目前尚無可參考經驗)'}\n\n[系統補充] 使用者原本有附上 Chalkboard 草圖，但目前這個模型或 Provider 沒有成功吃下圖片。請先明確告知圖片理解失敗，再根據文字需求提供最接近的協助。`,
                    requestHistory
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
                                description: `由 AI 智慧管家排程`,
                                skillId: mSop.id,
                                action: mSop.recommendedAction,
                                category: mSop.category || '系統維護',
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
            chatHistory.push({ role: 'user', content: chalkboardAttachment ? `${message}\n\n[使用者當時附上了 Chalkboard 草圖]` : message });
            const cleanReply = llmReply.replace(/\[ACTION:.*?\]/g, '').replace(/\[SUGGEST:.*?\]/g, '').trim();
            chatHistory.push({ role: 'assistant', content: chalkboardAttachment ? `${cleanReply}\n\n[本回覆曾參考當輪 Chalkboard 草圖]` : cleanReply });
            if (chatHistory.length > 6) chatHistory = chatHistory.slice(-6);
            const suggestMatch = llmReply.match(/\[SUGGEST:(.*?)\]/);
            let finalSuggestions = suggestMatch ? suggestMatch[1].split(',').map(s => s.trim()) : suggestions;
            return res.json({
                success: true,
                reply: cleanReply,
                suggestions: finalSuggestions,
                task: taskListChanged,
                sopChanged,
                executeTaskId,
                llmUsed: true
            });
        } catch (llmErr) {
            console.error('[LLM] 智慧管家處理失敗:', llmErr);
            llmErrorForFallback = llmErr.message;
            // 發生錯誤不中斷，讓它往下走到關鍵字比對模式
        }


    }


    // ── 情境 2：LLM 不可用 (硬編碼備援模式) ───────────────────────────
    let matchedSOP = null;
    let taskAdded = null;
    let executeTaskId = null;
    let isActionTaken = false;
    suggestions = ['幫我安裝 Chrome', '清理工作清單', '查看系統狀態'];
    const isDeletionIntent = /刪除|移除|移掉|清空|清掉|delete|remove/.test(message);
    const isConfirmation = /是|好|確定|執行|同意/.test(message);
    // 備援模式的刪除邏輯：也改成需要確認
    if (isDeletionIntent) {
        if (/全部|所有|清單|工作表/.test(message) && !/(單一|這項|那個|個)/.test(message)) {
            // 不直接刪除，改為詢問
            return res.json({
                success: true,
                reply: "確認要清空所有任務清單嗎？這項操作無法復原喔。",
                suggestions: ['確認清空', '取消'],
                task: false,
                llmUsed: false
            });
        } else {
            const cleanQuery = message.replace(/刪除|移除|移掉|清空|清掉|這項|任務|工作|清單|delete|remove|task|安裝|平台/g, '').trim().toLowerCase();
            let targetTask = todoList.find(t => t.title.toLowerCase().includes(cleanQuery));
            if (targetTask) {
                return res.json({
                    success: true,
                    reply: `我找到了任務「${targetTask.title}」，確認要移除它嗎？`,
                    suggestions: [`移除 ${targetTask.title}`, '先不要'],
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
            chatHistory = []; // 清空也順便清空歷史
            return res.json({ success: true, reply: "已清空所有任務。 🧹", suggestions, task: true, llmUsed: false });
        }


        const removeMatch = message.match(/移除 (.*)/);
        if (removeMatch) {
            const title = removeMatch[1];
            todoList = todoList.filter(t => !t.title.includes(title));
            saveTasks();
            return res.json({ success: true, reply: `已移除任務「${title}」。`, suggestions, task: true, llmUsed: false });
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
        reply = `已幫你將「${taskAdded.title}」加入清單。現在要執行嗎？ 😊`;
        suggestions = ['執行任務', '先不要'];
    } else if (executeTaskId) {
        reply = `沒問題，這就開始執行！ 🚀`;
    } else {
        const errorHint = llmErrorForFallback ? ` (AI 引擎故障: ${llmErrorForFallback})` : ' (AI 引擎未就緒，目前為關鍵字模式)';
        reply = `收到您的訊息：「${message}」${errorHint}`;
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
        return res.status(400).json({ success: false, error: '缺少必要參數' });
    }


    llm.updateProviderSettings(provider, baseUrl, apiKey, model, authConfig, visionModel);
    res.json({ success: true, message: '設定已儲存' });
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
            return res.status(400).json({ success: false, error: '缺少 provider、baseUrl 或 model' });
        }


        const reply = await llm.testProviderConnection({ provider, baseUrl, authConfig, model });
        res.json({ success: true, reply });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }


});
app.listen(PORT, async () => {
    const startMsg = `AI PC Agent 已啟動！ (PID: ${process.pid}, Path: ${process.execPath})`;
    console.log(`\n  🖥️  ${startMsg}`);
    fileLog(startMsg);
    console.log(`  📍 http://localhost:${PORT}`);
    console.log(`  📂 SOPs    目錄: ${SOPS_DIR}`);
    console.log(`  🛠️ Skills  目錄: ${SKILLS_DIR}`);
    console.log(`  🔌 Plugins 目錄: ${PLUGINS_DIR}`);
    fileLog(`SOPs Directory: ${SOPS_DIR}`);
    fileLog(`Skills Directory: ${SKILLS_DIR}`);
    fileLog(`Plugins Directory: ${PLUGINS_DIR}`);
    // 啟動時非同步檢查 LLM 狀態
    try {
        const result = await llm.checkOllamaStatus();
        const provider = llm.getCurrentProvider();
        if (result.available && result.modelReady) {
            let msg = `🧠 LLM 就緒：${provider}`;
            if (provider === 'Ollama' && result.version) {
                msg += ` v${result.version}`;
            }


            msg += `，模型 ${result.modelName} 已載入`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        } else if (result.available) {
            const msg = `🟡 ${provider} 運作中，但模型尚未就緒`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        } else {
            const msg = `🔴 未偵測到 ${provider} 服務 (${llm.getCurrentBaseUrl()})`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        }


    } catch (e) {
        fileLog(`LLM Check Failed: ${e.message}`);
        console.log(`  🔴 LLM 狀態檢查失敗\n`);
    }


});