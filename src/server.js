/**
 * AI PC Agent Ã¢â‚¬â€ Local Server
 * 
 * Ã¦ÂÂÃ¤Â¾â€º REST API Ã§ÂµÂ¦Ã¥â€°ÂÃ§Â«Â¯ UI Ã¤Â½Â¿Ã§â€Â¨Ã¯Â¼Å’Ã¦Â©â€¹Ã¦Å½Â¥ sop-parser Ã¨Ë†â€¡ sop-executorÃ£â‚¬â€š
 * Ã¥â€¢Å¸Ã¥â€¹â€¢Ã¥Â¾Å’Ã¦Å“Æ’Ã¨â€¡ÂªÃ¥â€¹â€¢Ã©â€“â€¹Ã¥â€¢Å¸Ã§â‚¬ÂÃ¨Â¦Â½Ã¥â„¢Â¨Ã£â‚¬â€š
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
 * Ã¥ÂÅ’Ã¦Â­Â¥Ã¥â€¦Â§Ã¥Â»ÂºÃ§Å¡â€žÃ¨â€¦Â³Ã¦Å“Â¬Ã¨Ë†â€¡Ã¦Å â‚¬Ã¨Æ’Â½Ã¨â€¡Â³ AppData
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

        // Ã¥ÂÅ’Ã¦Â­Â¥ SOPs
        if (fs.existsSync(bundledSopsDir)) {
            const files = fs.readdirSync(bundledSopsDir).filter(f => f.endsWith('.md'));
            files.forEach(file => {
                const src = path.join(bundledSopsDir, file);
                const dest = path.join(SOPS_DIR, file);
                syncIfChanged(src, dest);
            });
        }

        // Ã¥ÂÅ’Ã¦Â­Â¥ Skills
        if (fs.existsSync(bundledSkillsDir)) {
            const files = fs.readdirSync(bundledSkillsDir).filter(f => f.endsWith('.md'));
            files.forEach(file => {
                const src = path.join(bundledSkillsDir, file);
                const dest = path.join(SKILLS_DIR, file);
                syncIfChanged(src, dest);
            });
        }

        // Ã¥ÂÅ’Ã¦Â­Â¥ Plugins
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
        console.error("[System] Ã¥ÂÅ’Ã¦Â­Â¥Ã¥â€¦Â§Ã¥Â»ÂºÃ¨Â³â€¡Ã¦ÂºÂÃ¥Â¤Â±Ã¦â€¢â€”:", e.message);
    }
}
syncBundledAssets();

// Ã¢â€â‚¬Ã¢â€â‚¬ In-memory state Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
let todoList = [];
let logs = [];
let runningSOP = null;
let chatHistory = []; // Ã¥â€žÂ²Ã¥Â­ËœÃ¦Å“â‚¬Ã¨Â¿â€˜ 6 Ã¥â€°â€¡Ã¥Â°ÂÃ¨Â©Â±Ã¯Â¼Å¡[{role: 'user', content: '...'}, {role: 'assistant', content: '...'}]
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
        if (entry?.role === 'user' && content.includes('[Ã¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã§â€¢Â¶Ã¦â„¢â€šÃ©â„¢â€žÃ¤Â¸Å Ã¤Âºâ€  Chalkboard Ã¨Ââ€°Ã¥Å“â€“]')) {
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
        const hasSignalWord = /(Ã¥Â¤Â±Ã¦â€¢â€”|Ã©Å’Â¯Ã¨ÂªÂ¤|Ã¦Ë†ÂÃ¥Å Å¸|Ã¥Â®Å’Ã¦Ë†Â|Ã§â€¢Â¥Ã©ÂÅ½|Ã¨Â·Â³Ã©ÂÅ½|uac|Ã¦Â¬Å Ã©â„¢Â|denied|timeout|Ã¤Â¸â€¹Ã¨Â¼â€°|Ã¥Â®â€°Ã¨Â£Â|verify|Ã©Â©â€”Ã¨Â­â€°|Ã¤Â¿Â®Ã¥Â¾Â©|retry|Ã©â€¡ÂÃ¨Â©Â¦|already|exists)/i.test(message);
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
    if (/uac|cancelled by user|canceled by user|æ¬Šé™|denied/.test(text)) {
        return 'This failure is related to permissions or UAC. Explain the need for administrator approval before the next run.';
    }
    if (/download|ä¸‹è¼‰|timeout|network|é€£ç·š/.test(text)) {
        return 'This failure is likely related to networking or the download phase. Check connectivity, source endpoints, and firewall rules first.';
    }
    if (/verify|é©—è­‰/.test(text)) {
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
        console.warn('[EXP] AI ÃƒÂ¨Ã¢â€šÂ¬Ã‚ÂÃƒÂ¥Ã‚ÂÃ‚Â¸ÃƒÂ¦Ã‚Â©Ã…Â¸ÃƒÂ¦Ã¢â‚¬ËœÃ‹Å“ÃƒÂ¨Ã‚Â¦Ã‚ÂÃƒÂ§Ã¢â‚¬ÂÃ…Â¸ÃƒÂ¦Ã‹â€ Ã‚ÂÃƒÂ¥Ã‚Â¤Ã‚Â±ÃƒÂ¦Ã¢â‚¬Â¢Ã¢â‚¬â€:', err.message);
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
        console.error('[EXP] Ã¥Â¯Â«Ã¥â€¦Â¥Ã§Â¶â€œÃ©Â©â€”Ã¦â€˜ËœÃ¨Â¦ÂÃ¥Â¤Â±Ã¦â€¢â€”:', err.message);
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
            .split(/[\s,.;:!?Ã¯Â¼Å’Ã£â‚¬â€šÃ¯Â¼â€ºÃ¯Â¼Å¡Ã£â‚¬ÂÃ£â‚¬Å’Ã£â‚¬ÂÃ£â‚¬Å½Ã£â‚¬ÂÃ¯Â¼Ë†Ã¯Â¼â€°()Ã£â‚¬ÂÃ£â‚¬â€˜\-\_\/\\]+/)
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
        console.error('[EXP] Ã¨Â¼â€°Ã¥â€¦Â¥Ã§Â¶â€œÃ©Â©â€”Ã¦â€˜ËœÃ¨Â¦ÂÃ¥Â¤Â±Ã¦â€¢â€”:', err.message);
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
    if (!sop) return 'Ã¦Å“ÂªÃ¥â€˜Â½Ã¥ÂÂÃ¤Â»Â»Ã¥â€¹â„¢';
    if (action === 'uninstall') {
        const normalizedName = String(sop.name || sop.id || '')
            .replace(/^[^\p{L}\p{N}]+/u, '')
            .replace(/^Ã¥Â®â€°Ã¨Â£Â\s*/u, '')
            .replace(/^Ã¤Â¸â€¹Ã¨Â¼â€°\s*/u, '');
        return `Ã°Å¸â€”â€˜Ã¯Â¸Â Ã¨Â§Â£Ã©â„¢Â¤Ã¥Â®â€°Ã¨Â£Â ${normalizedName}`;
    }
    return `Ã°Å¸â€œÂ¦ ${sop.name}`;
}

function shouldSearchWingetForRecommendations(message = '') {
    const text = String(message || '');
    const wantsRecommendation = /(Ã¦Å½Â¨Ã¨â€“Â¦|Ã¥Â»ÂºÃ¨Â­Â°|Ã¥â‚¬Â¼Ã¥Â¾â€”|Ã¦Å“â€°Ã¤Â»â‚¬Ã©ÂºÂ¼|Ã¦Å“â€°Ã¥â€œÂªÃ¤Âºâ€º|Ã¥ÂÂ¯Ã¤Â»Â¥Ã§â€Â¨Ã¤Â»â‚¬Ã©ÂºÂ¼|Ã¦â€°Â¾.+Ã¨Â»Å¸Ã©Â«â€|recommend|suggest)/i.test(text);
    const mentionsSoftware = /(Ã¨Â»Å¸Ã©Â«â€|app|Ã¥Â·Â¥Ã¥â€¦Â·|Ã§Â¨â€¹Ã¥Â¼Â|Ã¦â€¡â€°Ã§â€Â¨|software|application)/i.test(text);
    return wantsRecommendation && mentionsSoftware;
}

function shouldSearchMicrosoftStore(message = '') {
    return /(microsoft\s*store|msstore|uwp|Ã¥â€¢â€ Ã¥Âºâ€”Ã§â€°Ë†|Ã¥Â¸â€šÃ©â€ºâ€  app|windows store)/i.test(String(message || ''));
}

function shouldSearchGitHubReleases(message = '') {
    return /(github|repo|repository|release|Ã©â€“â€¹Ã¦ÂºÂ|portable)/i.test(String(message || ''));
}

function hasLikelySopForMessage(message = '', sops = []) {
    const text = String(message || '').toLowerCase();
    return sops.some((sop) => {
        const normalized = String(sop?.name || '')
            .replace(/^[^\p{L}\p{N}]+/gu, ' ')
            .replace(/Ã¥Â®â€°Ã¨Â£Â|Ã¨Â§Â£Ã©â„¢Â¤Ã¥Â®â€°Ã¨Â£Â|Ã¤Â¸â€¹Ã¨Â¼â€°/gu, ' ')
            .toLowerCase();
        const tokens = normalized.split(/[\s()\-_/]+/).filter(token => token.length >= 3);
        return tokens.some(token => text.includes(token));
    });
}

function extractWingetSearchQuery(message = '') {
    const text = String(message || '').toLowerCase();
    const keywordMap = [
        { pattern: /(Ã§Â¹ÂªÃ¥Å“â€“|Ã§â€¢Â«Ã¥Å“â€“|Ã§â€¢Â«Ã§â€¢Â«|Ã¦Ââ€™Ã§â€¢Â«|Ã§Â¹ÂªÃ§â€¢Â«|drawing|paint|sketch)/i, query: 'drawing' },
        { pattern: /(Ã¤Â¿Â®Ã¥Å“â€“|Ã¥Â½Â±Ã¥Æ’Â|Ã¥Å“â€“Ã§â€°â€¡Ã§Â·Â¨Ã¨Â¼Â¯|image|photo|edit)/i, query: 'image editor' },
        { pattern: /(Ã¥Â½Â±Ã§â€°â€¡|Ã¥â€°ÂªÃ¨Â¼Â¯|video|editor)/i, query: 'video editor' },
        { pattern: /(Ã§Â­â€ Ã¨Â¨Ëœ|note|markdown)/i, query: 'notes' },
        { pattern: /(Ã§â‚¬ÂÃ¨Â¦Â½Ã¥â„¢Â¨|browser)/i, query: 'browser' },
        { pattern: /(Ã¨Â§Â£Ã¥Â£â€œÃ§Â¸Â®|Ã¥Â£â€œÃ§Â¸Â®|zip|rar|archive)/i, query: 'archive' },
        { pattern: /(Ã©ÂÂ Ã§Â«Â¯|remote desktop|rdp)/i, query: 'remote desktop' },
    ];

    const mapped = keywordMap.find(entry => entry.pattern.test(text));
    if (mapped) return mapped.query;

    const cleaned = text
        .replace(/Ã¨Â«â€¹|Ã¥Â¹Â«Ã¦Ë†â€˜|Ã¦Æ’Â³Ã¦â€°Â¾|Ã¦Æ’Â³Ã¨Â¦Â|Ã¦Å½Â¨Ã¨â€“Â¦|Ã¥Â»ÂºÃ¨Â­Â°|Ã¥â‚¬Â¼Ã¥Â¾â€”|Ã¦Å“â€°Ã¤Â»â‚¬Ã©ÂºÂ¼|Ã¦Å“â€°Ã¥â€œÂªÃ¤Âºâ€º|Ã¥ÂÂ¯Ã¤Â»Â¥|Ã¨Â»Å¸Ã©Â«â€|app|Ã¥Â·Â¥Ã¥â€¦Â·|Ã§Â¨â€¹Ã¥Â¼Â|Ã¦â€¡â€°Ã§â€Â¨|Ã¤Â¸â€¹Ã¨Â¼â€°|Ã¥Â®â€°Ã¨Â£Â/gi, ' ')
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

function searchWingetPackages(query, limit = 8) {
    return searchWingetPackagesBySource(query, 'winget', limit);
}

function searchMicrosoftStorePackages(query, limit = 8) {
    return searchWingetPackagesBySource(query, 'msstore', limit);
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

function buildWingetSopMarkdown(packageInfo = {}) {
    return buildStoreSopMarkdown(packageInfo, {
        source: 'winget',
        category: 'winget store',
        titleVerb: 'Install',
    });
}

function buildMicrosoftStoreSopMarkdown(packageInfo = {}) {
    return buildStoreSopMarkdown(packageInfo, {
        source: 'msstore',
        category: 'microsoft store',
        titleVerb: 'Install',
    });
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

function createWingetSopFile(packageInfo = {}) {
    return createStoreSopFile(packageInfo, {
        builder: buildWingetSopMarkdown,
        filePrefix: 'install',
    });
}

function createMicrosoftStoreSopFile(packageInfo = {}) {
    return createStoreSopFile(packageInfo, {
        builder: buildMicrosoftStoreSopMarkdown,
        filePrefix: 'install-msstore',
    });
}

function isUsefulGitHubAsset(asset = {}) {
    const name = String(asset?.name || '').toLowerCase();
    if (!name) return false;
    if (!/\.(exe|msi|zip)$/.test(name)) return false;
    if (/sha|checksum|checksums|sig|asc|symbols|debug|source[\s._-]*code/.test(name)) return false;
    return true;
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
 * Ã§ÂÂ²Ã¥Ââ€“Ã§Â³Â»Ã§ÂµÂ±Ã¥ÂÂ¥Ã¥ÂºÂ·Ã§â€¹â‚¬Ã¦â€¦â€¹ (CPU, RAM, Disk)
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
// Ã¦Å½Â¨Ã¨â€“Â¦Ã¦Â¸â€¦Ã¥â€“Â®Ã¥Å¸ÂºÃ¦Å“Â¬Ã¨Â³â€¡Ã¦â€“â„¢Ã¯Â¼Ë†Ã¦Å’â€°Ã¥â€žÂªÃ¥â€¦Ë†Ã©Â â€ Ã¥ÂºÂÃ¦Å½â€™Ã¥Ë†â€”Ã¯Â¼Å’AI Ã¥Â¼â€¢Ã¦â€œÅ½Ã¦â€Â¾Ã¦Å“â‚¬Ã¥â€°ÂÃ©ÂÂ¢Ã¯Â¼â€°
const RECOMMEND_BASE = [
    {
        id: 'rec_install_ollama',
        title: 'Ã°Å¸Â§Â  Ã¥Â®â€°Ã¨Â£Â Ollama Ã¦Å“Â¬Ã¥Å“Â° AI Ã¥Â¼â€¢Ã¦â€œÅ½',
        description: 'Ã¤Â¸â€¹Ã¨Â¼â€°Ã¤Â¸Â¦Ã¥Â®â€°Ã¨Â£Â OllamaÃ¯Â¼Å’Ã¨Â®â€œ AI Agent Ã¥â€¦Â·Ã¥â€šâ„¢Ã¦Å“Â¬Ã¥Å“Â°Ã¨ÂªÅ¾Ã¦â€žÂÃ§Ââ€ Ã¨Â§Â£Ã¨Æ’Â½Ã¥Å â€º',
        category: 'AI Ã¥Â¼â€¢Ã¦â€œÅ½',
        priority: 'critical',
    },
    {
        id: 'rec_pull_llm_model',
        title: 'Ã°Å¸â€œÂ¥ Ã¤Â¸â€¹Ã¨Â¼â€°Ã¨ÂªÅ¾Ã¨Â¨â‚¬Ã¦Â¨Â¡Ã¥Å¾â€¹ (Qwen3.5 4B)',
        description: 'Ã¤Â¸â€¹Ã¨Â¼â€° Qwen3.5 4B Ã¨ÂªÅ¾Ã¨Â¨â‚¬Ã¦Â¨Â¡Ã¥Å¾â€¹Ã¯Â¼Å’Ã§Â´â€ž 2.6GBÃ¯Â¼Å’Ã¥Â®Å’Ã¦Ë†ÂÃ¥Â¾Å’Ã¥Â°ÂÃ¨Â©Â±Ã¥Â°â€¡Ã§â€Â± AI Ã§Å“Å¸Ã¦Â­Â£Ã§Ââ€ Ã¨Â§Â£Ã¤Â½Â Ã§Å¡â€žÃ©Å“â‚¬Ã¦Â±â€š',
        category: 'AI Ã¥Â¼â€¢Ã¦â€œÅ½',
        priority: 'critical',
    },
    {
        id: 'rec_driver_check',
        title: 'Ã°Å¸â€Â Ã¦ÂªÂ¢Ã¦Å¸Â¥Ã¤Â¸Â¦Ã¥Â®â€°Ã¨Â£ÂÃ©Â©â€¦Ã¥â€¹â€¢Ã§Â¨â€¹Ã¥Â¼Â',
        description: 'Ã¦Å½Æ’Ã¦ÂÂÃ§Â¡Â¬Ã©Â«â€Ã¨Â£ÂÃ§Â½Â®Ã¤Â¸Â¦Ã§Â¢ÂºÃ¨ÂªÂÃ©Â©â€¦Ã¥â€¹â€¢Ã§Â¨â€¹Ã¥Â¼ÂÃ¦ËœÂ¯Ã¥ÂÂ¦Ã§â€šÂºÃ¦Å“â‚¬Ã¦â€“Â°Ã§â€°Ë†Ã¦Å“Â¬',
        category: 'Ã§Â³Â»Ã§ÂµÂ±Ã¥â€žÂªÃ¥Å’â€“',
        priority: 'high',
    },
    {
        id: 'rec_remove_copilot',
        title: 'Ã°Å¸â€”â€˜Ã¯Â¸Â Ã§Â§Â»Ã©â„¢Â¤ Windows Copilot',
        description: 'Ã¥ÂÅ“Ã§â€Â¨Ã¤Â¸Â¦Ã§Â§Â»Ã©â„¢Â¤ Windows Ã¥â€¦Â§Ã¥Â»ÂºÃ§Å¡â€ž Copilot Ã¥Å Å¸Ã¨Æ’Â½',
        category: 'Ã§Â³Â»Ã§ÂµÂ±Ã¦Â·Â¨Ã¥Å’â€“',
        priority: 'medium',
    },
    {
        id: 'rec_install_chrome',
        title: 'Ã°Å¸Å’Â Ã¥Â®â€°Ã¨Â£Â Google Chrome',
        description: 'Ã¤Â¸â€¹Ã¨Â¼â€°Ã¤Â¸Â¦Ã¥Â®â€°Ã¨Â£Â Chrome Ã§â‚¬ÂÃ¨Â¦Â½Ã¥â„¢Â¨Ã¯Â¼Å’Ã¨Â¨Â­Ã§â€šÂºÃ©Â ÂÃ¨Â¨Â­Ã§â‚¬ÂÃ¨Â¦Â½Ã¥â„¢Â¨',
        category: 'Ã§â‚¬ÂÃ¨Â¦Â½Ã¥â„¢Â¨',
        priority: 'high',
    },
    {
        id: 'rec_backup',
        title: 'Ã°Å¸â€™Â¾ Ã¥â€šâ„¢Ã¤Â»Â½Ã¤Â½Â Ã§Å¡â€žÃ©â€ºÂ»Ã¨â€¦Â¦',
        description: 'Ã¥Â»ÂºÃ§Â«â€¹Ã§Â³Â»Ã§ÂµÂ±Ã©â€šâ€žÃ¥Å½Å¸Ã©Â»Å¾Ã¯Â¼Å’Ã¤Â¿ÂÃ¨Â­Â·Ã©â€¡ÂÃ¨Â¦ÂÃ¨Â³â€¡Ã¦â€“â„¢',
        category: 'Ã¨Â³â€¡Ã¦â€“â„¢Ã¤Â¿ÂÃ¨Â­Â·',
        priority: 'medium',
    },
    {
        id: 'rec_office',
        title: 'Ã°Å¸â€œâ€ž Ã¥Â®â€°Ã¨Â£Â LibreOffice',
        description: 'Ã¥Â¼Â·Ã¥Â¤Â§Ã¤Â¸â€Ã¥â€¦ÂÃ¨Â²Â»Ã©â€“â€¹Ã¦ÂºÂÃ§Å¡â€žÃ¨Â¾Â¦Ã¥â€¦Â¬Ã¨Â»Å¸Ã©Â«â€Ã¥Â¥â€”Ã¤Â»Â¶Ã¯Â¼Å’Ã¨Ë†â€¡ Microsoft Office Ã¦Â Â¼Ã¥Â¼ÂÃ§â€ºÂ¸Ã¥Â®Â¹',
        category: 'Ã¥Â·Â¥Ã¤Â½Å“Ã¥Â¿â€¦Ã¥â€šâ„¢',
        priority: 'medium',
    },
    {
        id: 'rec_steam',
        title: 'Ã°Å¸Å½Â® Ã¥Â®â€°Ã¨Â£Â Steam',
        description: 'Ã¥Â®â€°Ã¨Â£Â Steam Ã©ÂÅ Ã¦Ë†Â²Ã¥Â¹Â³Ã¥ÂÂ°Ã¯Â¼Å’Ã¦Å¡Â¢Ã§Å½Â©Ã¤Â½Â Ã§Å¡â€žÃ©ÂÅ Ã¦Ë†Â²Ã¥ÂºÂ«',
        category: 'Ã¥Â¨â€ºÃ¦Â¨â€š',
        priority: 'low',
    },
];

// Ã¥Â»ÂºÃ§Â«â€¹Ã¦Å½Â¨Ã¨â€“Â¦Ã¦Â¸â€¦Ã¥â€“Â®Ã¯Â¼Å’Ã¦Â¨â„¢Ã¨Â¨ËœÃ¥â€œÂªÃ¤Âºâ€ºÃ¦Å“â€°Ã¥Â°ÂÃ¦â€¡â€° skill
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

// Ã¢â€â‚¬Ã¢â€â‚¬ API Routes Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GET /api/sops Ã¢â‚¬â€ Ã¥Ë†â€”Ã¥â€¡ÂºÃ¦â€°â‚¬Ã¦Å“â€° SOP
app.get('/api/sops', async (req, res) => {
    try {
        const sops = await annotateSOPRuntimeState(loadAllSOPs(SOPS_DIR));
        res.json({ success: true, sops });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/todo Ã¢â‚¬â€ Ã¥Ââ€“Ã¥Â¾â€” To-Do List
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

// POST /api/todo Ã¢â‚¬â€ Ã¦â€“Â°Ã¥Â¢Å¾Ã¤Â»Â»Ã¥â€¹â„¢Ã¥Ë†Â° To-Do List
app.post('/api/todo', async (req, res) => {
    const { title, description, skillId, category, action } = req.body;
    const sops = loadAllSOPs(SOPS_DIR);
    const sopsWithState = await annotateSOPRuntimeState(sops);
    const matchedSOP = sops.find((s) => s.id === skillId);
    const resolvedAction = action || (matchedSOP ? (await evaluateSOPInstalledState(matchedSOP)).recommendedAction : 'install');
    const resolvedTitle = matchedSOP ? buildTaskTitle(matchedSOP, resolvedAction) : (title || 'Ã¦Å“ÂªÃ¥â€˜Â½Ã¥ÂÂÃ¤Â»Â»Ã¥â€¹â„¢');
    const resolvedDescription = matchedSOP
        ? (resolvedAction === 'uninstall'
            ? `Ã¨Â§Â£Ã©â„¢Â¤Ã¥Â®â€°Ã¨Â£Â ${String(matchedSOP.name || matchedSOP.id || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^Ã¥Â®â€°Ã¨Â£Â\s*/u, '').replace(/^Ã¤Â¸â€¹Ã¨Â¼â€°\s*/u, '')}`
            : matchedSOP.name)
        : (description || '');

    const task = {
        id: `task_${Date.now()}`,
        title: resolvedTitle,
        description: resolvedDescription,
        skillId: skillId || null,
        action: resolvedAction,
        category: category || (matchedSOP ? matchedSOP.category : 'Ã¤Â¸â‚¬Ã¨Ë†Â¬'),
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

// DELETE /api/todo/:id Ã¢â‚¬â€ Ã§Â§Â»Ã©â„¢Â¤Ã¤Â»Â»Ã¥â€¹â„¢
app.delete('/api/todo/:id', (req, res) => {
    todoList = todoList.filter((t) => t.id !== req.params.id);
    saveTasks();
    res.json({ success: true });
});

// POST /api/todo/import Ã¢â‚¬â€ Ã¥Å’Â¯Ã¥â€¦Â¥Ã¤Â»Â»Ã¥â€¹â„¢Ã¦Â¸â€¦Ã¥â€“Â®
app.post('/api/todo/import', (req, res) => {
    try {
        const { tasks } = req.body;
        if (Array.isArray(tasks)) {
            todoList = tasks;
            saveTasks();
            res.json({ success: true, count: tasks.length });
        } else {
            res.json({ success: false, error: 'Ã¦Â Â¼Ã¥Â¼ÂÃ©Å’Â¯Ã¨ÂªÂ¤Ã¯Â¼Å¡Ã©Å“â‚¬Ã¨Â¦Â { tasks: [...] }' });
        }
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// GET /api/todo/export Ã¢â‚¬â€ Ã¥Å’Â¯Ã¥â€¡ÂºÃ¤Â»Â»Ã¥â€¹â„¢Ã¦Â¸â€¦Ã¥â€“Â® (Raw JSON)
app.get('/api/todo/export', (req, res) => {
    res.json({
        exportedAt: new Date().toISOString(),
        agentVersion: '1.0.0',
        tasks: todoList,
    });
});

// POST /api/todo/export-file Ã¢â‚¬â€ Ã¥Å’Â¯Ã¥â€¡ÂºÃ¤Â»Â»Ã¥â€¹â„¢Ã¦Â¸â€¦Ã¥â€“Â® (Ã¨Â·Â³Ã¥â€¡ÂºÃ¥ÂÂ¦Ã¥Â­ËœÃ¦â€“Â°Ã¦Âªâ€Ã¥Â°ÂÃ¨Â©Â±Ã¦Â¡â€ )
app.post('/api/todo/export-file', (req, res) => {
    try {
        const defaultName = `aipc-tasks-${new Date().toISOString().slice(0, 10)}.json`;

        // Ã©â‚¬ÂÃ©ÂÅ½ PowerShell Ã¥â€˜Â¼Ã¥ÂÂ«Ã¥Å½Å¸Ã§â€Å¸Ã§Å¡â€ž Windows SaveFileDialog
        const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = 'JSON Ã¦Âªâ€Ã¦Â¡Ë† (*.json)|*.json|Ã¦â€°â‚¬Ã¦Å“â€°Ã¦Âªâ€Ã¦Â¡Ë† (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Ã¥Å’Â¯Ã¥â€¡Âº AI PC Agent Ã¤Â»Â»Ã¥â€¹â„¢Ã¦Â¸â€¦Ã¥â€“Â®'
        $dlg.InitialDirectory = [Environment]::GetFolderPath('MyDocuments')
        $res = $dlg.ShowDialog()
        if ($res -eq [System.Windows.Forms.DialogResult]::OK) { 
            Write-Output $dlg.FileName 
        }
        `;

        // Ã§â€šÂºÃ¤Âºâ€ Ã¨Â®â€œÃ¥Â°ÂÃ¨Â©Â±Ã¦Â¡â€ Ã¨Æ’Â½Ã¦Â­Â£Ã§Â¢ÂºÃ©Â¡Â¯Ã§Â¤ÂºÃ¯Â¼Å’Ã¥Â¿â€¦Ã©Â Ë†Ã¥Å Â Ã¤Â¸Å  -Sta Ã¥ÂÆ’Ã¦â€¢Â¸ (Single-Threaded Apartment)
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

// POST /api/chalkboard/export-file Ã¢â‚¬â€ Ã¥Å’Â¯Ã¥â€¡Âº Chalkboard Ã¥Å“â€“Ã§â€°â€¡ (Ã¨Â·Â³Ã¥â€¡ÂºÃ¥ÂÂ¦Ã¥Â­ËœÃ¦â€“Â°Ã¦Âªâ€Ã¥Â°ÂÃ¨Â©Â±Ã¦Â¡â€ )
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
        $dlg.Filter = 'PNG Ã¥Å“â€“Ã§â€°â€¡ (*.png)|*.png|Ã¦â€°â‚¬Ã¦Å“â€°Ã¦Âªâ€Ã¦Â¡Ë† (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Ã¥Å’Â¯Ã¥â€¡ÂºÃ©Â»â€˜Ã¦ÂÂ¿Ã¥Å“â€“Ã§â€°â€¡'
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

// POST /api/exps/export-file Ã¢â‚¬â€ Ã¥Å’Â¯Ã¥â€¡Âº exps Markdown (Ã¨Â·Â³Ã¥â€¡ÂºÃ¥ÂÂ¦Ã¥Â­ËœÃ¦â€“Â°Ã¦Âªâ€Ã¥Â°ÂÃ¨Â©Â±Ã¦Â¡â€ )
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
        $dlg.Filter = 'Markdown Ã¦Âªâ€Ã¦Â¡Ë† (*.md)|*.md|Ã¦â€°â‚¬Ã¦Å“â€°Ã¦Âªâ€Ã¦Â¡Ë† (*.*)|*.*'
        $dlg.FileName = '${defaultName}'
        $dlg.Title = 'Ã¥Å’Â¯Ã¥â€¡Âº AI PC Agent exps'
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

// GET /api/recommend Ã¢â‚¬â€ Ã¥Ââ€“Ã¥Â¾â€”Ã¦Å½Â¨Ã¨â€“Â¦Ã¦Â¸â€¦Ã¥â€“Â®Ã¯Â¼Ë†Ã¥â€¹â€¢Ã¦â€¦â€¹Ã©â„¢â€žÃ¥Â¸Â¶ skillIdÃ¯Â¼â€°
app.get('/api/recommend', async (req, res) => {
    try {
        res.json({ success: true, recommendList: await getRecommendList() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/llm/status Ã¢â‚¬â€ Ã¦Å¸Â¥Ã¨Â©Â¢ Ollama Ã§â€¹â‚¬Ã¦â€¦â€¹
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

// GET/POST /api/llm/models Ã¢â‚¬â€ Ã¥Ë†â€”Ã¥â€¡ÂºÃ¦â€°â‚¬Ã¦Å“â€°Ã¥ÂÂ¯Ã§â€Â¨Ã¦Â¨Â¡Ã¥Å¾â€¹ (Ã¦â€Â¯Ã¦ÂÂ´Ã¥â€¹â€¢Ã¦â€¦â€¹Ã¥ÂÆ’Ã¦â€¢Â¸Ã©Â ÂÃ¨Â¦Â½)
app.all('/api/llm/models', async (req, res) => {
    try {
        // Ã¥ÂÅ’Ã¦â„¢â€šÃ¦â€Â¯Ã¦ÂÂ´ GET (query) Ã¨Ë†â€¡ POST (body)
        const params = req.method === 'POST' ? req.body : req.query;
        const { provider, baseUrl, apiKey, authConfig } = params;
        
        console.log(`[LLM] Ã©Â ÂÃ¨Â¦Â½Ã¦Â¨Â¡Ã¥Å¾â€¹Ã¥Ë†â€”Ã¨Â¡Â¨: Provider=${provider || 'Ã©Â ÂÃ¨Â¨Â­'}, URL=${baseUrl || 'Ã©Â ÂÃ¨Â¨Â­'}`);
        
        const models = await llm.listModels({ provider, baseUrl, apiKey, authConfig, forceRefresh: true });
        res.json({ success: true, models, currentModel: llm.getCurrentModel() });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/llm/model Ã¢â‚¬â€ Ã¥Ë†â€¡Ã¦Ââ€ºÃ¦Â¨Â¡Ã¥Å¾â€¹
app.post('/api/llm/model', (req, res) => {
    const { modelName } = req.body;
    if (!modelName) return res.json({ success: false, error: 'Ã§Â¼ÂºÃ¥Â°â€˜ modelName' });
    llm.setCurrentModel(modelName);
    res.json({ success: true, currentModel: llm.getCurrentModel() });
});

// POST /api/execute/:taskId Ã¢â‚¬â€ Ã¥Å¸Â·Ã¨Â¡Å’Ã¦Å’â€¡Ã¥Â®Å¡Ã¤Â»Â»Ã¥â€¹â„¢
app.post('/api/execute/:taskId', async (req, res) => {
    const task = todoList.find((t) => t.id === req.params.taskId);
    if (!task) {
        return res.json({ success: false, error: 'Ã¦â€°Â¾Ã¤Â¸ÂÃ¥Ë†Â°Ã¤Â»Â»Ã¥â€¹â„¢' });
    }

    if (runningSOP) {
        return res.json({ success: false, error: 'Ã§â€ºÂ®Ã¥â€°ÂÃ¦Å“â€°Ã¤Â»Â»Ã¥â€¹â„¢Ã¦Â­Â£Ã¥Å“Â¨Ã¥Å¸Â·Ã¨Â¡Å’Ã¤Â¸Â­Ã¯Â¼Å’Ã¨Â«â€¹Ã§Â¨ÂÃ¥â‚¬â„¢' });
    }

    let sop;
    if (task.dynamicCmd) {
        // Ã¥Â»ÂºÃ§Â«â€¹Ã¨â„¢â€ºÃ¦â€œÂ¬ SOP
        sop = {
            id: task.id,
            name: task.title,
            phases: {
                install: {
                    commands: [
                        { type: 'ui', message: `Ã°Å¸Å¡â‚¬ Ã¥Å¸Â·Ã¨Â¡Å’Ã¥â€¹â€¢Ã©Â«â€Ã¦Å’â€¡Ã¤Â»Â¤: ${task.dynamicCmd}` },
                        { type: 'powershell', content: task.dynamicCmd }
                    ]
                }
            }
        };
    } else {
        if (!task.skillId) {
            return res.json({ success: false, error: 'Ã¦Â­Â¤Ã¤Â»Â»Ã¥â€¹â„¢Ã¦Â²â€™Ã¦Å“â€°Ã¥Â°ÂÃ¦â€¡â€°Ã§Å¡â€ž SOPÃ¯Â¼Å’Ã§â€žÂ¡Ã¦Â³â€¢Ã¨â€¡ÂªÃ¥â€¹â€¢Ã¥Å¸Â·Ã¨Â¡Å’' });
        }
        const sops = loadAllSOPs(SOPS_DIR);
        sop = sops.find((s) => s.id === task.skillId);
    }

    if (!sop) {
        return res.json({ success: false, error: `Ã¦â€°Â¾Ã¤Â¸ÂÃ¥Ë†Â°Ã¥Â°ÂÃ¦â€¡â€°Ã§Å¡â€ž SOP${task.skillId ? ': ' + task.skillId : ''}` });
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
    res.json({ success: true, message: 'Ã¤Â»Â»Ã¥â€¹â„¢Ã¥Â·Â²Ã©â€“â€¹Ã¥Â§â€¹Ã¥Å¸Â·Ã¨Â¡Å’' });

    try {
        const result = await executor.execute(sop, { action: task.action || 'install' });
        task.status = result.status;
        task.progress = 100;
        task.completedAt = new Date().toISOString();
        if (task.skillId) sopStateCache.delete(task.skillId);

        const finishLog = { level: 'success', message: `Ã¤Â»Â»Ã¥â€¹â„¢Ã£â‚¬Å’${task.title}Ã£â‚¬ÂÃ¥Å¸Â·Ã¨Â¡Å’Ã¥Â®Å’Ã§â€¢Â¢ (Ã§â€¹â‚¬Ã¦â€¦â€¹: ${result.status})`, timestamp: new Date().toISOString() };
        task.logs.push(finishLog);
        logs.push(finishLog);

        // Ã©â€¡ÂÃ¥Â°Â AI Ã¥Â¼â€¢Ã¦â€œÅ½Ã§â€ºÂ¸Ã©â€”Å“Ã¤Â»Â»Ã¥â€¹â„¢Ã¯Â¼Å’Ã¥Â¼Â·Ã¥Ë†Â¶Ã¦Â¸â€¦Ã©â„¢Â¤Ã¥Â¿Â«Ã¥Ââ€“Ã¤Â¸Â¦Ã©â€¡ÂÃ¦â€“Â°Ã¥ÂÂµÃ¦Â¸Â¬
        if (sop.id === 'rec_install_ollama' || sop.id === 'rec_pull_llm_model' || task.skillId === 'rec_pull_llm_model' || task.dynamicCmd?.includes('ollama')) {
            console.log(`[Server] Ã¥ÂÂµÃ¦Â¸Â¬Ã¥Ë†Â° AI Ã§â€ºÂ¸Ã©â€”Å“Ã¤Â»Â»Ã¥â€¹â„¢Ã¥Â®Å’Ã¦Ë†Â: ${sop.id || 'dynamic'}Ã¯Â¼Å’Ã¥Å¸Â·Ã¨Â¡Å’Ã¥Â¿Â«Ã¥Ââ€“Ã¦â€ºÂ´Ã¦â€“Â°...`);
            fileLog(`AI Task Completed: ${sop.id || 'dynamic'}, invalidating cache.`);
            llm.invalidateCache();
        }
        appendTaskExperience(task, sop);
    } catch (err) {
        task.status = 'failed';
        task.completedAt = new Date().toISOString();
        if (task.skillId) sopStateCache.delete(task.skillId);
        const errLog = { level: 'error', message: `Ã¤Â»Â»Ã¥â€¹â„¢Ã¥Å¸Â·Ã¨Â¡Å’Ã¥Â´Â©Ã¦Â½Â°: ${err.message}`, timestamp: new Date().toISOString() };
        task.logs.push(errLog);
        logs.push(errLog);
        appendTaskExperience(task, sop);
    } finally {
        runningSOP = null;
        saveTasks();
    }
});

// GET /api/task/:taskId/status Ã¢â‚¬â€ Ã¦Å¸Â¥Ã¨Â©Â¢Ã¤Â»Â»Ã¥â€¹â„¢Ã¥Å¸Â·Ã¨Â¡Å’Ã§â€¹â‚¬Ã¦â€¦â€¹
app.get('/api/task/:taskId/status', (req, res) => {
    const task = todoList.find((t) => t.id === req.params.taskId);
    if (!task) {
        return res.json({ success: false, error: 'Ã¦â€°Â¾Ã¤Â¸ÂÃ¥Ë†Â°Ã¤Â»Â»Ã¥â€¹â„¢' });
    }
    res.json({ success: true, task });
});

// POST /api/chat Ã¢â‚¬â€ Ã¨â„¢â€¢Ã§Ââ€ Ã¥Â°ÂÃ¨Â©Â±Ã¨Â¼Â¸Ã¥â€¦Â¥Ã¯Â¼Ë†LLM Ã¥â€žÂªÃ¥â€¦Ë†Ã¯Â¼Å’fallback Ã¥Ë†Â°Ã©â€”Å“Ã©ÂÂµÃ¥Â­â€”Ã¦Â¯â€Ã¥Â°ÂÃ¯Â¼â€°
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    const chalkboardAttachment = normalizeChalkboardAttachment(req.body?.chalkboard);
    if (!message) return res.json({ success: false, error: 'Ã¨Â«â€¹Ã¨Â¼Â¸Ã¥â€¦Â¥Ã¨Â¨Å Ã¦ÂÂ¯' });

    const sops = loadAllSOPs(SOPS_DIR);
    const sopsWithState = await annotateSOPRuntimeState(sops);
    let suggestions = ['Ã¥Â¹Â«Ã¦Ë†â€˜Ã¥Â®â€°Ã¨Â£Â Chrome', 'Ã¦Â¸â€¦Ã§Ââ€ Ã¥Â·Â¥Ã¤Â½Å“Ã¦Â¸â€¦Ã¥â€“Â®', 'Ã¦Å¸Â¥Ã§Å“â€¹Ã§Â³Â»Ã§ÂµÂ±Ã§â€¹â‚¬Ã¦â€¦â€¹']; // Ã¦ÂÂÃ¥Ââ€¡Ã¤Â½Å“Ã§â€Â¨Ã¥Å¸Å¸
    let llmErrorForFallback = null;
    // 1. Ã¥Â¿Â«Ã©â‚¬Å¸Ã¨â€™ÂÃ©â€ºâ€ Ã¨Æ’Å’Ã¦â„¢Â¯Ã¨Â³â€¡Ã¨Â¨Å 
    const sopCatalog = sopsWithState.map(s => `- ID: ${s.id}, Ã¥ÂÂÃ§Â¨Â±: ${s.name}, Ã§â€¹â‚¬Ã¦â€¦â€¹: ${s.installed ? 'Ã¥Â·Â²Ã¥Â®â€°Ã¨Â£Â' : 'Ã¦Å“ÂªÃ¥Â®â€°Ã¨Â£Â'}, Ã¥Â»ÂºÃ¨Â­Â°Ã¥â€¹â€¢Ã¤Â½Å“: ${s.recommendedAction === 'uninstall' ? 'Ã¨Â§Â£Ã©â„¢Â¤Ã¥Â®â€°Ã¨Â£Â' : 'Ã¥Â®â€°Ã¨Â£Â'}`).join('\n');
    const taskContext = todoList.map(t => `- ID: ${t.id}, Ã¦Â¨â„¢Ã©Â¡Å’: ${t.title}, Ã§â€¹â‚¬Ã¦â€¦â€¹: ${t.status}`).join('\n');
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

    const wingetSopRequestMatch = String(message || '').match(/(?:Ã¥Â¹Â«Ã¦Ë†â€˜Ã¥ÂÅ¡|Ã¥Â¹Â«Ã¦Ë†â€˜Ã§â€Â¢Ã§â€Å¸|Ã§â€Â¢Ã§â€Å¸|Ã¥Â»ÂºÃ§Â«â€¹|Ã¦â€“Â°Ã¥Â¢Å¾)\s+(.+?)\s*(?:Ã§Å¡â€ž)?\s*sop/i);
    if (wingetSopRequestMatch) {
        const packageQuery = wingetSopRequestMatch[1].trim();
        const isGitHubRequest = shouldSearchGitHubReleases(message);
        const isMicrosoftStoreRequest = shouldSearchMicrosoftStore(message);
        if (hasLikelySopForMessage(packageQuery, sops)) {
            return res.json({
                success: true,
                reply: 'Ã§â€ºÂ®Ã¥â€°Â SOP Ã¦Â¸â€¦Ã¥â€“Â®Ã¨Â£Â¡Ã¥Â·Â²Ã§Â¶â€œÃ¦Å“â€°Ã§â€ºÂ¸Ã¨Â¿â€˜Ã©Â â€¦Ã§â€ºÂ®Ã¤Âºâ€ Ã¯Â¼Å’Ã¥â€¦Ë†Ã¥Â¾Å¾Ã¥Â·Â¦Ã¥ÂÂ´ SOP Ã¦Â¸â€¦Ã¥â€“Â®Ã¦ÂÅ“Ã¥Â°â€¹Ã§Å“â€¹Ã§Å“â€¹Ã¯Â¼â€ºÃ¥Â¦â€šÃ¦Å¾Å“Ã¤Â½Â Ã¨Â¦ÂÃ¯Â¼Å’Ã¦Ë†â€˜Ã¤Â¹Å¸Ã¥ÂÂ¯Ã¤Â»Â¥Ã¥â€ ÂÃ¥Â¹Â«Ã¤Â½Â Ã¦â€Â¹Ã¥Â¯Â«Ã¦Ë†ÂÃ¦â€ºÂ´Ã©ÂÂ©Ã¥ÂË†Ã§Å¡â€žÃ§â€°Ë†Ã¦Å“Â¬Ã£â‚¬â€š',
                suggestions: ['Ã¥Ë†â€¡Ã¥Ë†Â° SOP Ã¦Â¸â€¦Ã¥â€“Â®', `Ã¦ÂÅ“Ã¥Â°â€¹ ${packageQuery}`],
                task: false,
                llmUsed: false
            });
        }
        const githubCandidates = isGitHubRequest ? await searchGitHubReleaseApps(packageQuery, 5) : [];
        if (githubCandidates.length > 0) {
            const created = createGitHubReleaseSopFile(githubCandidates[0]);
            return res.json({
                success: true,
                reply: `Ã¥Â·Â²Ã¥Â¹Â«Ã¤Â½Â Ã¦Â Â¹Ã¦â€œÅ¡ GitHub Releases Ã§â€Â¢Ã§â€Å¸ SOPÃ¯Â¼Å¡${created.fileName}Ã£â‚¬â€šÃ©â€¡ÂÃ¦â€“Â°Ã¦â€¢Â´Ã§Ââ€  SOP Ã¦Â¸â€¦Ã¥â€“Â®Ã¥Â¾Å’Ã¯Â¼Å’Ã¥Â°Â±Ã¥ÂÂ¯Ã¤Â»Â¥Ã§â€ºÂ´Ã¦Å½Â¥Ã¦â€¹Â¿Ã¤Â¾â€ Ã¤Â¸â€¹Ã¨Â¼â€°Ã¦Ë†â€“Ã¥Å¸Â·Ã¨Â¡Å’Ã£â‚¬â€š`,
                suggestions: ['Ã©â€¡ÂÃ¦â€“Â°Ã¦â€¢Â´Ã§Ââ€  SOP Ã¦Â¸â€¦Ã¥â€“Â®', `Ã¥Â¹Â«Ã¦Ë†â€˜Ã¤Â¸â€¹Ã¨Â¼â€° ${githubCandidates[0].name}`],
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
                reply: `Ã¥Â·Â²Ã¥Â¹Â«Ã¤Â½Â Ã¦Â Â¹Ã¦â€œÅ¡ Microsoft Store Ã§â€Â¢Ã§â€Å¸ SOPÃ¯Â¼Å¡${created.fileName}Ã£â‚¬â€šÃ¤Â¹â€¹Ã¥Â¾Å’Ã©â€¡ÂÃ¦â€“Â°Ã¦â€¢Â´Ã§Ââ€  SOP Ã¦Â¸â€¦Ã¥â€“Â®Ã¯Â¼Å’Ã¥Â°Â±Ã¥ÂÂ¯Ã¤Â»Â¥Ã§â€ºÂ´Ã¦Å½Â¥Ã¦â€¹Â¿Ã¤Â¾â€ Ã¥Å Â Ã¥â€¦Â¥Ã¤Â»Â»Ã¥â€¹â„¢Ã¦Ë†â€“Ã¥Å¸Â·Ã¨Â¡Å’Ã£â‚¬â€š`,
                suggestions: ['Ã©â€¡ÂÃ¦â€“Â°Ã¦â€¢Â´Ã§Ââ€  SOP Ã¦Â¸â€¦Ã¥â€“Â®', `Ã¥Â¹Â«Ã¦Ë†â€˜Ã¥Â®â€°Ã¨Â£Â ${storeCandidates[0].name}`],
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
                reply: `Ã¥Â·Â²Ã¥Â¹Â«Ã¤Â½Â Ã¦Â Â¹Ã¦â€œÅ¡ winget Ã¥â€¢â€ Ã¥Âºâ€”Ã§â€Â¢Ã§â€Å¸ SOPÃ¯Â¼Å¡${created.fileName}Ã£â‚¬â€šÃ¤Â¹â€¹Ã¥Â¾Å’Ã©â€¡ÂÃ¦â€“Â°Ã¦â€¢Â´Ã§Ââ€  SOP Ã¦Â¸â€¦Ã¥â€“Â®Ã¯Â¼Å’Ã¥Â°Â±Ã¥ÂÂ¯Ã¤Â»Â¥Ã§â€ºÂ´Ã¦Å½Â¥Ã¦â€¹Â¿Ã¤Â¾â€ Ã¥Å Â Ã¥â€¦Â¥Ã¤Â»Â»Ã¥â€¹â„¢Ã¦Ë†â€“Ã¥Å¸Â·Ã¨Â¡Å’Ã£â‚¬â€š`,
                suggestions: ['Ã©â€¡ÂÃ¦â€“Â°Ã¦â€¢Â´Ã§Ââ€  SOP Ã¦Â¸â€¦Ã¥â€“Â®', `Ã¥Â¹Â«Ã¦Ë†â€˜Ã¥Â®â€°Ã¨Â£Â ${candidates[0].name}`],
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
            reply: `Ã¦Ë†â€˜Ã¥â€¦Ë†Ã¥Â¾Å¾ Microsoft Store Ã¥Â¹Â«Ã¤Â½Â Ã¦â€°Â¾Ã¤Âºâ€ Ã¥Â¹Â¾Ã¥â‚¬â€¹Ã¥ÂÂ¯Ã¥ÂÆ’Ã¨â‚¬Æ’Ã§Å¡â€ž UWP / Ã¥â€¢â€ Ã¥Âºâ€”Ã§â€°Ë†Ã¨Â»Å¸Ã©Â«â€Ã¯Â¼Å¡\n${topPackages}\n\nÃ¥Â¦â€šÃ¦Å¾Å“Ã¤Â½Â Ã¨Â¦ÂÃ¯Â¼Å’Ã¦Ë†â€˜Ã¥ÂÂ¯Ã¤Â»Â¥Ã¥â€ ÂÃ¥Â¹Â«Ã¤Â½Â Ã¦Å Å Ã¥â€¦Â¶Ã¤Â¸Â­Ã¤Â¸â‚¬Ã¥Â¥â€”Ã§â€Â¢Ã§â€Å¸Ã¦Ë†Â SOPÃ£â‚¬â€š`,
            suggestions: microsoftStoreRecommendation.packages.slice(0, 3).map(pkg => `Ã¥Â¹Â«Ã¦Ë†â€˜Ã¥ÂÅ¡ ${pkg.name} Ã§Å¡â€ž Microsoft Store SOP`),
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
            reply: `Ã¦Ë†â€˜Ã¥â€¦Ë†Ã¥Â¾Å¾ GitHub Releases Ã¥Â¹Â«Ã¤Â½Â Ã¦â€°Â¾Ã¤Âºâ€ Ã¥Â¹Â¾Ã¥â‚¬â€¹Ã¦Å“â€° Windows Ã§â€°Ë† release Ã§Å¡â€žÃ¥â‚¬â„¢Ã©ÂÂ¸Ã¨Â»Å¸Ã©Â«â€Ã¯Â¼Å¡\n${topPackages}\n\nÃ¥Â¦â€šÃ¦Å¾Å“Ã¤Â½Â Ã¨Â¦ÂÃ¯Â¼Å’Ã¦Ë†â€˜Ã¥ÂÂ¯Ã¤Â»Â¥Ã¥â€ ÂÃ¥Â¹Â«Ã¤Â½Â Ã¦Å Å Ã¥â€¦Â¶Ã¤Â¸Â­Ã¤Â¸â‚¬Ã¥Â¥â€”Ã§â€Â¢Ã§â€Å¸Ã¦Ë†ÂÃ¤Â¸â€¹Ã¨Â¼â€°Ã¥Å¾â€¹ SOPÃ£â‚¬â€š`,
            suggestions: githubRecommendation.packages.slice(0, 3).map(pkg => `Ã¥Â¹Â«Ã¦Ë†â€˜Ã¥ÂÅ¡ ${pkg.name} Ã§Å¡â€ž GitHub SOP`),
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
            reply: `Ã§â€ºÂ®Ã¥â€°Â SOP Ã¨Â£Â¡Ã¦Â²â€™Ã¦Å“â€°Ã§â€ºÂ´Ã¦Å½Â¥Ã¥Â°ÂÃ¦â€¡â€°Ã§Å¡â€žÃ¨Â»Å¸Ã©Â«â€Ã¯Â¼Å’Ã¦Ë†â€˜Ã¥â€¦Ë†Ã¥Â¾Å¾ winget Ã¥â€¢â€ Ã¥Âºâ€”Ã¥Â¹Â«Ã¤Â½Â Ã¦â€°Â¾Ã¤Âºâ€ Ã¥Â¹Â¾Ã¥â‚¬â€¹Ã¥ÂÂ¯Ã¥ÂÆ’Ã¨â‚¬Æ’Ã©ÂÂ¸Ã©Â â€¦Ã¯Â¼Å¡\n${topPackages}\n\nÃ¥Â¦â€šÃ¦Å¾Å“Ã¤Â½Â Ã¨Â¦ÂÃ¯Â¼Å’Ã¦Ë†â€˜Ã¥ÂÂ¯Ã¤Â»Â¥Ã¥â€ ÂÃ¥Â¹Â«Ã¤Â½Â Ã¦Å Å Ã¥â€¦Â¶Ã¤Â¸Â­Ã¤Â¸â‚¬Ã¥Â¥â€”Ã§â€Â¢Ã§â€Å¸Ã¦Ë†Â SOPÃ£â‚¬â€š`,
            suggestions: wingetRecommendation.packages.slice(0, 3).map(pkg => `Ã¥Â¹Â«Ã¦Ë†â€˜Ã¥ÂÅ¡ ${pkg.name} Ã§Å¡â€ž SOP`),
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
            return `CPU: ${os.cpus()[0].model.trim()}, RAM: ${Math.round(os.totalmem()/1024/1024/1024)}GB (Usage: ${ramUsage}%)`;
        }

        const cpuPart = `CPU: ${systemHealth.cpu.model} (Load: ${systemHealth.cpu.load}%)`;
        const gpuPart = `GPU: ${systemHealth.gpu.name || 'N/A'} (Load: ${systemHealth.gpu.load || 0}%${systemHealth.gpu.temp ? `, Temp: ${systemHealth.gpu.temp}Ã‚Â°C` : ''})`;
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
    
    // Ã¥Ââ€“Ã¥Â¾â€”Ã¥Â¿Â«Ã¥Ââ€“Ã§Å¡â€žÃ§â€¹â‚¬Ã¦â€¦â€¹ (Ã¤Â¸ÂÃ¥Â¼Â·Ã¥Ë†Â¶Ã¥Ë†Â·Ã¦â€“Â°Ã¯Â¼Å’Ã§Â´â€ž 5ms Ã¤Â»Â¥Ã¥â€¦Â§)
    const llmStatus = await llm.checkOllamaStatus();

    // Ã¢â€â‚¬Ã¢â€â‚¬ Ã¦Æ’â€¦Ã¥Â¢Æ’ 1Ã¯Â¼Å¡AI Ã¥Â¼â€¢Ã¦â€œÅ½Ã¥Â°Â±Ã§Â·â€™ (Ã©Â©â€¦Ã¥â€¹â€¢Ã¦Â¨Â¡Ã¥Â¼Â) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    if (llmStatus.available && llmStatus.modelReady) {
        try {
            const requestHistory = buildChatHistoryForRequest(chatHistory, Boolean(chalkboardAttachment));
            const contextNote = `
[[Ã§â€¢Â¶Ã¥â€°ÂÃ§Â³Â»Ã§ÂµÂ±Ã§â€™Â°Ã¥Â¢Æ’]]
1. Ã§Â¡Â¬Ã©Â«â€Ã§Â°Â¡Ã¥Â Â±: ${hardwareSummary}
2. Ã¥ÂÂ¯Ã§â€Â¨ SOP (ID Ã¥Ë†â€”Ã¨Â¡Â¨):
${sopCatalog || '(Ã§â€žÂ¡)'}
3. Ã¥Â¾â€¦Ã¨Â¾Â¦Ã¤Â»Â»Ã¥â€¹â„¢Ã¦Â¸â€¦Ã¥â€“Â®:
${taskContext || '(Ã§Â©Âº)'}
4. Ã§â€¢Â¶Ã¥â€°ÂÃ¤Â½Â¿Ã§â€Â¨Ã§Å¡â€ž AI Ã¦Â¨Â¡Ã¥Å¾â€¹: ${llm.getCurrentModel()}
5. Chalkboard Ã¨Ââ€°Ã¥Å“â€“: ${chalkboardAttachment ? `Ã¥Â·Â²Ã©â„¢â€žÃ¤Â¸Å  ${chalkboardAttachment.width || '?'}x${chalkboardAttachment.height || '?'} Ã©Â»â€˜Ã¦ÂÂ¿Ã¥Â¿Â«Ã§â€¦Â§Ã¯Â¼Å’Ã¨Â«â€¹Ã¦Å Å Ã¥Â®Æ’Ã¨Â¦â€“Ã§â€šÂºÃ¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã§Å¡â€žÃ¨Â¦â€“Ã¨Â¦ÂºÃ©Å“â‚¬Ã¦Â±â€šÃ¨Ââ€°Ã§Â¨Â¿Ã¯Â¼Å’Ã¥â€žÂªÃ¥â€¦Ë†Ã§ÂµÂÃ¥ÂË†Ã¥Å“â€“Ã§â€°â€¡Ã¥â€¦Â§Ã¥Â®Â¹Ã§Ââ€ Ã¨Â§Â£Ã¦â€žÂÃ¥Å“â€“Ã£â‚¬â€šÃ¨â€¹Â¥Ã¦Å“Â¬Ã¨Â¼ÂªÃ¦Å“â€°Ã©â„¢â€žÃ¥Å“â€“Ã¯Â¼Å’Ã©â‚¬â„¢Ã¥Â¼ÂµÃ¥Å“â€“Ã¥Â°Â±Ã¦ËœÂ¯Ã£â‚¬Å’Ã§â€ºÂ®Ã¥â€°ÂÃ¦Â­Â£Ã¥Å“Â¨Ã¨Â«â€¡Ã§Å¡â€žÃ¥Å“â€“Ã£â‚¬ÂÃ¯Â¼â€ºÃ©â„¢Â¤Ã©ÂÅ¾Ã¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã¦ËœÅ½Ã§Â¢ÂºÃ¨Â¦ÂÃ¦Â±â€šÃ¦Â¯â€Ã¨Â¼Æ’Ã¥â€°ÂÃ¥Â¾Å’Ã¥â€¦Â©Ã¥Â¼ÂµÃ¥Å“â€“Ã¯Â¼Å’Ã¥ÂÂ¦Ã¥â€°â€¡Ã¨Â«â€¹Ã¥Â¿Â½Ã§â€¢Â¥Ã¥â€¦Ë†Ã¥â€°ÂÃ¤Â»Â»Ã¤Â½â€¢Ã¥Å“â€“Ã§â€°â€¡Ã¥â€¦Â§Ã¥Â®Â¹Ã¯Â¼Å’Ã¥ÂÂªÃ¥â€ºÅ¾Ã§Â­â€Ã©â‚¬â„¢Ã¤Â¸â‚¬Ã¥Â¼ÂµÃ£â‚¬â€š` : 'Ã¦Å“Â¬Ã¦Â¬Â¡Ã¦Å“ÂªÃ©â„¢â€žÃ¤Â¸Å Ã©Â»â€˜Ã¦ÂÂ¿Ã¥Â¿Â«Ã§â€¦Â§Ã£â‚¬â€š'}
`;

            // 2. Ã¥â€˜Â¼Ã¥ÂÂ« LLM (Ã©â„¢â€žÃ¥Â¸Â¶Ã¦Â­Â·Ã¥ÂÂ²Ã§Â´â‚¬Ã©Å’â€ž)
            const wingetPromptNote = wingetRecommendation?.packages?.length
                ? `\n\n[[winget Ã¥â€¢â€ Ã¥Âºâ€”Ã¥â‚¬â„¢Ã©ÂÂ¸Ã¨Â»Å¸Ã©Â«â€]]\nÃ¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã¦Â­Â¤Ã¥Ë†Â»Ã¥Å“Â¨Ã¨Â©Â¢Ã¥â€¢ÂÃ¨Â»Å¸Ã©Â«â€Ã¦Å½Â¨Ã¨â€“Â¦Ã¯Â¼Å’Ã¨â‚¬Å’Ã¤Â¸â€Ã§â€ºÂ®Ã¥â€°Â SOP Ã¦Å“ÂªÃ¥Â¿â€¦Ã¦Å“â€°Ã§â€ºÂ´Ã¦Å½Â¥Ã¥Â°ÂÃ¦â€¡â€°Ã©Â â€¦Ã§â€ºÂ®Ã£â‚¬â€šÃ¨â€¹Â¥Ã¤Â½Â Ã¨Â¦ÂÃ¦Å½Â¨Ã¨â€“Â¦Ã¨Â»Å¸Ã©Â«â€Ã¯Â¼Å’Ã¨Â«â€¹Ã¥â€žÂªÃ¥â€¦Ë†Ã¥ÂÆ’Ã¨â‚¬Æ’Ã¤Â¸â€¹Ã¥Ë†â€” winget Ã§ÂµÂÃ¦Å¾Å“Ã¤Â¾â€ Ã¥Ë†â€”Ã¥â€¡ÂºÃ£â‚¬Å’Ã¨Â»Å¸Ã©Â«â€Ã¥ÂÂÃ§Â¨Â±Ã£â‚¬ÂÃ£â‚¬â€šÃ¨â€¹Â¥Ã¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã¨Â¦ÂÃ¦Â±â€šÃ§â€Â¢Ã§â€Å¸Ã¥Â°ÂÃ¦â€¡â€° SOPÃ¯Â¼Å’Ã¨Â«â€¹Ã¨Â¼Â¸Ã¥â€¡Âº [ACTION:CREATE_WINGET_SOP package_id="..." package_name="..."]Ã£â‚¬â€š\nQuery: ${wingetRecommendation.query}\n${wingetRecommendation.packages.map((pkg, index) => `${index + 1}. ${pkg.name} | id=${pkg.id} | version=${pkg.version || 'unknown'}`).join('\n')}`
                : '';
            const microsoftStorePromptNote = microsoftStoreRecommendation?.packages?.length
                ? `\n\n[[Microsoft Store Ã¥â‚¬â„¢Ã©ÂÂ¸Ã¨Â»Å¸Ã©Â«â€]]\nÃ¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã¥ÂÂÃ¥Ââ€˜ Microsoft Store / UWP / Ã¥â€¢â€ Ã¥Âºâ€”Ã§â€°Ë†Ã¨Â»Å¸Ã©Â«â€Ã£â‚¬â€šÃ¨â€¹Â¥Ã¤Â½Â Ã¨Â¦ÂÃ¦Å½Â¨Ã¨â€“Â¦Ã¨Â»Å¸Ã©Â«â€Ã¯Â¼Å’Ã¨Â«â€¹Ã¥â€žÂªÃ¥â€¦Ë†Ã¥ÂÆ’Ã¨â‚¬Æ’Ã¤Â¸â€¹Ã¥Ë†â€” msstore Ã§ÂµÂÃ¦Å¾Å“Ã¯Â¼â€ºÃ¨â€¹Â¥Ã¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã¨Â¦ÂÃ¦Â±â€šÃ¥Â»ÂºÃ§Â«â€¹ SOPÃ¯Â¼Å’Ã¨Â«â€¹Ã¨Â¼Â¸Ã¥â€¡Âº [ACTION:CREATE_MSSTORE_SOP package_id="..." package_name="..."]Ã£â‚¬â€š\nQuery: ${microsoftStoreRecommendation.query}\n${microsoftStoreRecommendation.packages.map((pkg, index) => `${index + 1}. ${pkg.name} | id=${pkg.id} | version=${pkg.version || 'unknown'}`).join('\n')}`
                : '';
            const githubPromptNote = githubRecommendation?.packages?.length
                ? `\n\n[[GitHub Releases Ã¥â‚¬â„¢Ã©ÂÂ¸Ã¨Â»Å¸Ã©Â«â€]]\nÃ¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã¥Å“Â¨Ã¦â€°Â¾ GitHub Ã¤Â¸Å Ã¦Å“â€° Windows release Ã§Å¡â€žÃ©â€“â€¹Ã¦ÂºÂ AppÃ£â‚¬â€šÃ¨â€¹Â¥Ã¤Â½Â Ã¨Â¦ÂÃ¦Å½Â¨Ã¨â€“Â¦Ã¨Â»Å¸Ã©Â«â€Ã¯Â¼Å’Ã¨Â«â€¹Ã¥â€žÂªÃ¥â€¦Ë†Ã¥ÂÆ’Ã¨â‚¬Æ’Ã¤Â¸â€¹Ã¥Ë†â€”Ã¥â‚¬â„¢Ã©ÂÂ¸Ã¯Â¼â€ºÃ¨â€¹Â¥Ã¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã¨Â¦ÂÃ¦Â±â€šÃ¥Â»ÂºÃ§Â«â€¹ SOPÃ¯Â¼Å’Ã¨Â«â€¹Ã¨Â¼Â¸Ã¥â€¡Âº [ACTION:CREATE_GITHUB_RELEASE_SOP repo_full_name="..." asset_name="..." download_url="..."]Ã£â‚¬â€š\nQuery: ${githubRecommendation.query}\n${githubRecommendation.packages.map((pkg, index) => `${index + 1}. ${pkg.name} | repo=${pkg.fullName} | tag=${pkg.tagName || 'latest'} | asset=${pkg.assetName}`).join('\n')}`
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
                    message + "\n\n" + contextNote + wingetPromptNote + microsoftStorePromptNote + githubPromptNote + "\n\n[[exps Ã§Â¶â€œÃ©Â©â€”Ã¥ÂºÂ«]]\n" + (experienceContext || '(Ã§â€ºÂ®Ã¥â€°ÂÃ¥Â°Å¡Ã§â€žÂ¡Ã¥ÂÂ¯Ã¥ÂÆ’Ã¨â‚¬Æ’Ã§Â¶â€œÃ©Â©â€”)'),
                    requestHistory,
                    chatOptions
                );
            } catch (visionErr) {
                if (!chalkboardAttachment) throw visionErr;

                console.warn('[LLM] Ã©Â»â€˜Ã¦ÂÂ¿Ã¥Â½Â±Ã¥Æ’ÂÃ§Ââ€ Ã¨Â§Â£Ã¥Â¤Â±Ã¦â€¢â€”Ã¯Â¼Å’Ã¦â€Â¹Ã¤Â»Â¥Ã§Â´â€Ã¦â€“â€¡Ã¥Â­â€”Ã©â€¡ÂÃ¨Â©Â¦:', visionErr.message);
                llmReply = await llm.chatWithLLM(
                    `${message}\n\n${contextNote}${wingetPromptNote}${microsoftStorePromptNote}${githubPromptNote}\n\n[[exps Ã§Â¶â€œÃ©Â©â€”Ã¥ÂºÂ«]]\n${experienceContext || '(Ã§â€ºÂ®Ã¥â€°ÂÃ¥Â°Å¡Ã§â€žÂ¡Ã¥ÂÂ¯Ã¥ÂÆ’Ã¨â‚¬Æ’Ã§Â¶â€œÃ©Â©â€”)'}\n\n[Ã§Â³Â»Ã§ÂµÂ±Ã¨Â£Å“Ã¥â€¦â€¦] Ã¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã¥Å½Å¸Ã¦Å“Â¬Ã¦Å“â€°Ã©â„¢â€žÃ¤Â¸Å  Chalkboard Ã¨Ââ€°Ã¥Å“â€“Ã¯Â¼Å’Ã¤Â½â€ Ã§â€ºÂ®Ã¥â€°ÂÃ©â‚¬â„¢Ã¥â‚¬â€¹Ã¦Â¨Â¡Ã¥Å¾â€¹Ã¦Ë†â€“ Provider Ã¦Â²â€™Ã¦Å“â€°Ã¦Ë†ÂÃ¥Å Å¸Ã¥ÂÆ’Ã¤Â¸â€¹Ã¥Å“â€“Ã§â€°â€¡Ã£â‚¬â€šÃ¨Â«â€¹Ã¥â€¦Ë†Ã¦ËœÅ½Ã§Â¢ÂºÃ¥â€˜Å Ã§Å¸Â¥Ã¥Å“â€“Ã§â€°â€¡Ã§Ââ€ Ã¨Â§Â£Ã¥Â¤Â±Ã¦â€¢â€”Ã¯Â¼Å’Ã¥â€ ÂÃ¦Â Â¹Ã¦â€œÅ¡Ã¦â€“â€¡Ã¥Â­â€”Ã©Å“â‚¬Ã¦Â±â€šÃ¦ÂÂÃ¤Â¾â€ºÃ¦Å“â‚¬Ã¦Å½Â¥Ã¨Â¿â€˜Ã§Å¡â€žÃ¥Ââ€Ã¥Å Â©Ã£â‚¬â€š`,
                    requestHistory
                );
            }

            // 3. Ã¨Â§Â£Ã¦Å¾ÂÃ¨Ë†â€¡Ã¥Â®â€°Ã¥â€¦Â¨Ã©ÂÅ½Ã¦Â¿Â¾
            const actionRegex = /\[ACTION:(.*?)\]/g;
            const actions = [];
            let match;
            while ((match = actionRegex.exec(llmReply)) !== null) {
                actions.push(match[1]);
            }

            // Ã¢â€â‚¬Ã¢â€â‚¬ Ã¥Å¸Â·Ã¨Â¡Å’Ã¥Â®â€°Ã¥â€¦Â¨Ã¦â€â€Ã¦Ë†Âª Ã¢â€â‚¬Ã¢â€â‚¬
            const hasSuggestions = actions.length > 0 && llmReply.includes('[SUGGEST:');
            const isQuestioning = /[\?Ã¯Â¼Å¸]|Ã¦ËœÂ¯Ã¥ÂÂ¦Ã¨Â¦Â|Ã§Â¢ÂºÃ¨ÂªÂÃ©Â»Å¾Ã©ÂÂ¸|Ã¨Â¦ÂÃ¤Â¸ÂÃ¨Â¦ÂÃ¥Å¸Â·Ã¨Â¡Å’|Ã¦â€šÂ¨Ã¦ËœÂ¯Ã¥ÂÂ¦Ã¥ÂÅ’Ã¦â€žÂ/.test(llmReply);

            let executeTaskId = null;
            let hasActionTaken = false;
            let taskListChanged = false;
            let sopChanged = false;

            if (hasSuggestions && isQuestioning) {
                actions.length = 0; // Ã¦â€â€Ã¦Ë†ÂªÃ¥Â¾â€¦Ã§Â¢ÂºÃ¨ÂªÂÃ¥â€¹â€¢Ã¤Â½Å“
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
                                description: `Ã§â€Â± AI Ã¦â„¢ÂºÃ¦â€¦Â§Ã§Â®Â¡Ã¥Â®Â¶Ã¦Å½â€™Ã§Â¨â€¹`,
                                skillId: mSop.id,
                                action: mSop.recommendedAction,
                                category: mSop.category || 'Ã§Â³Â»Ã§ÂµÂ±Ã§Â¶Â­Ã¨Â­Â·',
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

            // 4. Ã¦â€ºÂ´Ã¦â€“Â°Ã¥Â°ÂÃ¨Â©Â±Ã§Â´â‚¬Ã©Å’â€ž
            chatHistory.push({ role: 'user', content: chalkboardAttachment ? `${message}\n\n[Ã¤Â½Â¿Ã§â€Â¨Ã¨â‚¬â€¦Ã§â€¢Â¶Ã¦â„¢â€šÃ©â„¢â€žÃ¤Â¸Å Ã¤Âºâ€  Chalkboard Ã¨Ââ€°Ã¥Å“â€“]` : message });
            const cleanReply = llmReply.replace(/\[ACTION:.*?\]/g, '').replace(/\[SUGGEST:.*?\]/g, '').trim();
            chatHistory.push({ role: 'assistant', content: chalkboardAttachment ? `${cleanReply}\n\n[Ã¦Å“Â¬Ã¥â€ºÅ¾Ã¨Â¦â€ Ã¦â€ºÂ¾Ã¥ÂÆ’Ã¨â‚¬Æ’Ã§â€¢Â¶Ã¨Â¼Âª Chalkboard Ã¨Ââ€°Ã¥Å“â€“]` : cleanReply });
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
            console.error('[LLM] Ã¦â„¢ÂºÃ¦â€¦Â§Ã§Â®Â¡Ã¥Â®Â¶Ã¨â„¢â€¢Ã§Ââ€ Ã¥Â¤Â±Ã¦â€¢â€”:', llmErr);
            llmErrorForFallback = llmErr.message;
            // Ã§â„¢Â¼Ã§â€Å¸Ã©Å’Â¯Ã¨ÂªÂ¤Ã¤Â¸ÂÃ¤Â¸Â­Ã¦â€“Â·Ã¯Â¼Å’Ã¨Â®â€œÃ¥Â®Æ’Ã¥Â¾â‚¬Ã¤Â¸â€¹Ã¨ÂµÂ°Ã¥Ë†Â°Ã©â€”Å“Ã©ÂÂµÃ¥Â­â€”Ã¦Â¯â€Ã¥Â°ÂÃ¦Â¨Â¡Ã¥Â¼Â
        }
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Ã¦Æ’â€¦Ã¥Â¢Æ’ 2Ã¯Â¼Å¡LLM Ã¤Â¸ÂÃ¥ÂÂ¯Ã§â€Â¨ (Ã§Â¡Â¬Ã§Â·Â¨Ã§Â¢Â¼Ã¥â€šâ„¢Ã¦ÂÂ´Ã¦Â¨Â¡Ã¥Â¼Â) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    let matchedSOP = null;
    let taskAdded = null;
    let executeTaskId = null;
    let isActionTaken = false;
    suggestions = ['Ã¥Â¹Â«Ã¦Ë†â€˜Ã¥Â®â€°Ã¨Â£Â Chrome', 'Ã¦Â¸â€¦Ã§Ââ€ Ã¥Â·Â¥Ã¤Â½Å“Ã¦Â¸â€¦Ã¥â€“Â®', 'Ã¦Å¸Â¥Ã§Å“â€¹Ã§Â³Â»Ã§ÂµÂ±Ã§â€¹â‚¬Ã¦â€¦â€¹'];

    const isDeletionIntent = /Ã¥Ë†ÂªÃ©â„¢Â¤|Ã§Â§Â»Ã©â„¢Â¤|Ã§Â§Â»Ã¦Å½â€°|Ã¦Â¸â€¦Ã§Â©Âº|Ã¦Â¸â€¦Ã¦Å½â€°|delete|remove/.test(message);
    const isConfirmation = /Ã¦ËœÂ¯|Ã¥Â¥Â½|Ã§Â¢ÂºÃ¥Â®Å¡|Ã¥Å¸Â·Ã¨Â¡Å’|Ã¥ÂÅ’Ã¦â€žÂ/.test(message);

    // Ã¥â€šâ„¢Ã¦ÂÂ´Ã¦Â¨Â¡Ã¥Â¼ÂÃ§Å¡â€žÃ¥Ë†ÂªÃ©â„¢Â¤Ã©â€šÂÃ¨Â¼Â¯Ã¯Â¼Å¡Ã¤Â¹Å¸Ã¦â€Â¹Ã¦Ë†ÂÃ©Å“â‚¬Ã¨Â¦ÂÃ§Â¢ÂºÃ¨ÂªÂ
    if (isDeletionIntent) {
        if (/Ã¥â€¦Â¨Ã©Æ’Â¨|Ã¦â€°â‚¬Ã¦Å“â€°|Ã¦Â¸â€¦Ã¥â€“Â®|Ã¥Â·Â¥Ã¤Â½Å“Ã¨Â¡Â¨/.test(message) && !/(Ã¥â€“Â®Ã¤Â¸â‚¬|Ã©â‚¬â„¢Ã©Â â€¦|Ã©â€šÂ£Ã¥â‚¬â€¹|Ã¥â‚¬â€¹)/.test(message)) {
            // Ã¤Â¸ÂÃ§â€ºÂ´Ã¦Å½Â¥Ã¥Ë†ÂªÃ©â„¢Â¤Ã¯Â¼Å’Ã¦â€Â¹Ã§â€šÂºÃ¨Â©Â¢Ã¥â€¢Â
            return res.json({
                success: true,
                reply: "Ã§Â¢ÂºÃ¨ÂªÂÃ¨Â¦ÂÃ¦Â¸â€¦Ã§Â©ÂºÃ¦â€°â‚¬Ã¦Å“â€°Ã¤Â»Â»Ã¥â€¹â„¢Ã¦Â¸â€¦Ã¥â€“Â®Ã¥â€”Å½Ã¯Â¼Å¸Ã©â‚¬â„¢Ã©Â â€¦Ã¦â€œÂÃ¤Â½Å“Ã§â€žÂ¡Ã¦Â³â€¢Ã¥Â¾Â©Ã¥Å½Å¸Ã¥â€“â€Ã£â‚¬â€š",
                suggestions: ['Ã§Â¢ÂºÃ¨ÂªÂÃ¦Â¸â€¦Ã§Â©Âº', 'Ã¥Ââ€“Ã¦Â¶Ë†'],
                task: false,
                llmUsed: false
            });
        } else {
            const cleanQuery = message.replace(/Ã¥Ë†ÂªÃ©â„¢Â¤|Ã§Â§Â»Ã©â„¢Â¤|Ã§Â§Â»Ã¦Å½â€°|Ã¦Â¸â€¦Ã§Â©Âº|Ã¦Â¸â€¦Ã¦Å½â€°|Ã©â‚¬â„¢Ã©Â â€¦|Ã¤Â»Â»Ã¥â€¹â„¢|Ã¥Â·Â¥Ã¤Â½Å“|Ã¦Â¸â€¦Ã¥â€“Â®|delete|remove|task|Ã¥Â®â€°Ã¨Â£Â|Ã¥Â¹Â³Ã¥ÂÂ°/g, '').trim().toLowerCase();
            let targetTask = todoList.find(t => t.title.toLowerCase().includes(cleanQuery));
            if (targetTask) {
                return res.json({
                    success: true,
                    reply: `Ã¦Ë†â€˜Ã¦â€°Â¾Ã¥Ë†Â°Ã¤Âºâ€ Ã¤Â»Â»Ã¥â€¹â„¢Ã£â‚¬Å’${targetTask.title}Ã£â‚¬ÂÃ¯Â¼Å’Ã§Â¢ÂºÃ¨ÂªÂÃ¨Â¦ÂÃ§Â§Â»Ã©â„¢Â¤Ã¥Â®Æ’Ã¥â€”Å½Ã¯Â¼Å¸`,
                    suggestions: [`Ã§Â§Â»Ã©â„¢Â¤ ${targetTask.title}`, 'Ã¥â€¦Ë†Ã¤Â¸ÂÃ¨Â¦Â'],
                    task: false,
                    llmUsed: false
                });
            }
        }
    }

    if (isConfirmation) {
        if (message.includes('Ã¦Â¸â€¦Ã§Â©Âº')) {
            todoList = [];
            saveTasks();
            chatHistory = []; // Ã¦Â¸â€¦Ã§Â©ÂºÃ¤Â¹Å¸Ã©Â â€ Ã¤Â¾Â¿Ã¦Â¸â€¦Ã§Â©ÂºÃ¦Â­Â·Ã¥ÂÂ²
            return res.json({ success: true, reply: "Ã¥Â·Â²Ã¦Â¸â€¦Ã§Â©ÂºÃ¦â€°â‚¬Ã¦Å“â€°Ã¤Â»Â»Ã¥â€¹â„¢Ã£â‚¬â€š Ã°Å¸Â§Â¹", suggestions, task: true, llmUsed: false });
        }
        const removeMatch = message.match(/Ã§Â§Â»Ã©â„¢Â¤ (.*)/);
        if (removeMatch) {
            const title = removeMatch[1];
            todoList = todoList.filter(t => !t.title.includes(title));
            saveTasks();
            return res.json({ success: true, reply: `Ã¥Â·Â²Ã§Â§Â»Ã©â„¢Â¤Ã¤Â»Â»Ã¥â€¹â„¢Ã£â‚¬Å’${title}Ã£â‚¬ÂÃ£â‚¬â€š`, suggestions, task: true, llmUsed: false });
        }

        // Ã¥ÂÂªÃ¦Å“â€°Ã£â‚¬Å’Ã¦ËœÅ½Ã§Â¢ÂºÃ£â‚¬ÂÃ¦Æ’Â³Ã¥Å¸Â·Ã¨Â¡Å’Ã¦â€°ÂÃ¥Å¸Â·Ã¨Â¡Å’Ã¯Â¼Å’Ã¤Â¸ÂÃ¥â€ ÂÃ©Å¡Â¨Ã¤Â¾Â¿Ã¥Â°ÂÃ£â‚¬Å’Ã¦ËœÂ¯Ã£â‚¬ÂÃ¥Â°Â±Ã¥Å¸Â·Ã¨Â¡Å’
        if (message.includes('Ã¥Å¸Â·Ã¨Â¡Å’') || message.includes('Ã©â€“â€¹Ã¥Â§â€¹')) {
            const pendingTask = [...todoList].reverse().find(t => t.status === 'pending');
            if (pendingTask) executeTaskId = pendingTask.id;
        }
    }

    if (!isActionTaken && !isConfirmation) {
        if (/Ã¦â€”Â¥Ã¦â€“â€¡|Ã¦â€”Â¥Ã¨ÂªÅ¾|japanese|ja-jp/i.test(message)) matchedSOP = sopsWithState.find((s) => s.id === 'sys_lang_ja_jp');
        if (/Ã¨â€¹Â±Ã¦â€“â€¡|english|en-us/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'sys_lang_en_us');
        if (/Ã§Â¹ÂÃ¤Â¸Â­|Ã§Â¹ÂÃ©Â«â€Ã¤Â¸Â­Ã¦â€“â€¡|traditional chinese|zh-tw/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'sys_lang_zh_tw');
        if (/Ã§Â°Â¡Ã¤Â¸Â­|Ã§Â°Â¡Ã©Â«â€Ã¤Â¸Â­Ã¦â€“â€¡|simplified chinese|zh-cn/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'sys_lang_zh_cn');
        if (/chrome|Ã¨Â°Â·Ã¦Â­Å’|Ã§â‚¬ÂÃ¨Â¦Â½Ã¥â„¢Â¨/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'rec_install_chrome');
        if (/ollama|llm|Ã¨ÂªÅ¾Ã¨Â¨â‚¬Ã¦Â¨Â¡Ã¥Å¾â€¹|aiÃ¥Â¼â€¢Ã¦â€œÅ½/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'rec_install_ollama');
        if (/steam|steam|Ã©ÂÅ Ã¦Ë†Â²/i.test(message)) matchedSOP = matchedSOP || sopsWithState.find((s) => s.id === 'rec_steam');

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
        reply = `Ã¥Â·Â²Ã¥Â¹Â«Ã¤Â½Â Ã¥Â°â€¡Ã£â‚¬Å’${taskAdded.title}Ã£â‚¬ÂÃ¥Å Â Ã¥â€¦Â¥Ã¦Â¸â€¦Ã¥â€“Â®Ã£â‚¬â€šÃ§ÂÂ¾Ã¥Å“Â¨Ã¨Â¦ÂÃ¥Å¸Â·Ã¨Â¡Å’Ã¥â€”Å½Ã¯Â¼Å¸ Ã°Å¸ËœÅ `;
        suggestions = ['Ã¥Å¸Â·Ã¨Â¡Å’Ã¤Â»Â»Ã¥â€¹â„¢', 'Ã¥â€¦Ë†Ã¤Â¸ÂÃ¨Â¦Â'];
    } else if (executeTaskId) {
        reply = `Ã¦Â²â€™Ã¥â€¢ÂÃ©Â¡Å’Ã¯Â¼Å’Ã©â‚¬â„¢Ã¥Â°Â±Ã©â€“â€¹Ã¥Â§â€¹Ã¥Å¸Â·Ã¨Â¡Å’Ã¯Â¼Â Ã°Å¸Å¡â‚¬`;
    } else {
        const errorHint = llmErrorForFallback ? ` (AI Ã¥Â¼â€¢Ã¦â€œÅ½Ã¦â€¢â€¦Ã©Å¡Å“: ${llmErrorForFallback})` : ' (AI Ã¥Â¼â€¢Ã¦â€œÅ½Ã¦Å“ÂªÃ¥Â°Â±Ã§Â·â€™Ã¯Â¼Å’Ã§â€ºÂ®Ã¥â€°ÂÃ§â€šÂºÃ©â€”Å“Ã©ÂÂµÃ¥Â­â€”Ã¦Â¨Â¡Ã¥Â¼Â)';
        reply = `Ã¦â€Â¶Ã¥Ë†Â°Ã¦â€šÂ¨Ã§Å¡â€žÃ¨Â¨Å Ã¦ÂÂ¯Ã¯Â¼Å¡Ã£â‚¬Å’${message}Ã£â‚¬Â${errorHint}`;
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

// GET /api/logs Ã¢â‚¬â€ Ã¥Ââ€“Ã¥Â¾â€”Ã¥â€¦Â¨Ã¥Å¸Å¸ log
app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs });
});

/**
 * Ã¥Â¯Â«Ã¥â€¦Â¥ Debug Log Ã¥Ë†Â° APPDATAÃ¯Â¼Å’Ã¤Â¿Â®Ã¥Â¾Â©Ã¦â€°â€œÃ¥Å’â€¦Ã¥Â¾Å’Ã§Å“â€¹Ã¤Â¸ÂÃ¥Ë†Â° Console Ã§Å¡â€žÃ¥â€¢ÂÃ©Â¡Å’
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
        return res.status(400).json({ success: false, error: 'Ã§Â¼ÂºÃ¥Â°â€˜Ã¥Â¿â€¦Ã¨Â¦ÂÃ¥ÂÆ’Ã¦â€¢Â¸' });
    }
    llm.updateProviderSettings(provider, baseUrl, apiKey, model, authConfig, visionModel);
    res.json({ success: true, message: 'Ã¨Â¨Â­Ã¥Â®Å¡Ã¥Â·Â²Ã¥â€žÂ²Ã¥Â­Ëœ' });
});

// Ã¢â€â‚¬Ã¢â€â‚¬ Start Server Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
app.post('/api/llm/test', async (req, res) => {
    try {
        const { provider, baseUrl, model, authConfig } = req.body;
        if (!provider || !baseUrl || !model) {
            return res.status(400).json({ success: false, error: 'ÃƒÂ§Ã‚Â¼Ã‚ÂºÃƒÂ¥Ã‚Â°Ã¢â‚¬Ëœ providerÃ£â‚¬ÂbaseUrl ÃƒÂ¦Ã‹â€ Ã¢â‚¬â€œ model' });
        }

        const reply = await llm.testProviderConnection({ provider, baseUrl, authConfig, model });
        res.json({ success: true, reply });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.listen(PORT, async () => {
    const startMsg = `AI PC Agent Ã¥Â·Â²Ã¥â€¢Å¸Ã¥â€¹â€¢Ã¯Â¼Â (PID: ${process.pid}, Path: ${process.execPath})`;
    console.log(`\n  Ã°Å¸â€“Â¥Ã¯Â¸Â  ${startMsg}`);
    fileLog(startMsg);
    console.log(`  Ã°Å¸â€œÂ http://localhost:${PORT}`);
    console.log(`  Ã°Å¸â€œâ€š SOPs    Ã§â€ºÂ®Ã©Å’â€ž: ${SOPS_DIR}`);
    console.log(`  Ã°Å¸â€ºÂ Ã¯Â¸Â Skills  Ã§â€ºÂ®Ã©Å’â€ž: ${SKILLS_DIR}`);
    console.log(`  Ã°Å¸â€Å’ Plugins Ã§â€ºÂ®Ã©Å’â€ž: ${PLUGINS_DIR}`);
    fileLog(`SOPs Directory: ${SOPS_DIR}`);
    fileLog(`Skills Directory: ${SKILLS_DIR}`);
    fileLog(`Plugins Directory: ${PLUGINS_DIR}`);

    // Ã¥â€¢Å¸Ã¥â€¹â€¢Ã¦â„¢â€šÃ©ÂÅ¾Ã¥ÂÅ’Ã¦Â­Â¥Ã¦ÂªÂ¢Ã¦Å¸Â¥ LLM Ã§â€¹â‚¬Ã¦â€¦â€¹
    try {
        const result = await llm.checkOllamaStatus();
        const provider = llm.getCurrentProvider();
        if (result.available && result.modelReady) {
            let msg = `Ã°Å¸Â§Â  LLM Ã¥Â°Â±Ã§Â·â€™Ã¯Â¼Å¡${provider}`;
            if (provider === 'Ollama' && result.version) {
                msg += ` v${result.version}`;
            }
            msg += `Ã¯Â¼Å’Ã¦Â¨Â¡Ã¥Å¾â€¹ ${result.modelName} Ã¥Â·Â²Ã¨Â¼â€°Ã¥â€¦Â¥`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        } else if (result.available) {
            const msg = `Ã°Å¸Å¸Â¡ ${provider} Ã©Ââ€¹Ã¤Â½Å“Ã¤Â¸Â­Ã¯Â¼Å’Ã¤Â½â€ Ã¦Â¨Â¡Ã¥Å¾â€¹Ã¥Â°Å¡Ã¦Å“ÂªÃ¥Â°Â±Ã§Â·â€™`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        } else {
            const msg = `Ã°Å¸â€Â´ Ã¦Å“ÂªÃ¥ÂÂµÃ¦Â¸Â¬Ã¥Ë†Â° ${provider} Ã¦Å“ÂÃ¥â€¹â„¢ (${llm.getCurrentBaseUrl()})`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        }
    } catch (e) {
        fileLog(`LLM Check Failed: ${e.message}`);
        console.log(`  Ã°Å¸â€Â´ LLM Ã§â€¹â‚¬Ã¦â€¦â€¹Ã¦ÂªÂ¢Ã¦Å¸Â¥Ã¥Â¤Â±Ã¦â€¢â€”\n`);
    }
});
