/**
 * AI PC Agent — Local Server
 * 
 * 提供 REST API 給前端 UI 使用，橋接 skill-parser 與 skill-executor。
 * 啟動後會自動開啟瀏覽器。
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { loadAllSkills } = require('./skill-parser');
const { SkillExecutor } = require('./skill-executor');

const app = express();
const PORT = 3210;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const os = require('os');
const isPkg = typeof process.pkg !== 'undefined';

const appDataDir = process.env.APPDATA || path.join(os.homedir(), '.config');
const aipcDir = path.join(appDataDir, 'aipc-agent');

if (!fs.existsSync(aipcDir)) {
    fs.mkdirSync(aipcDir, { recursive: true });
}

const TASKS_FILE = path.join(aipcDir, 'tasks.json');
const SKILLS_DIR = path.join(aipcDir, 'skills');

if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
}

// Copy default bundled skills to APPDATA if they exist internally (for pkg and pure node)
try {
    const bundledSkillsPath = isPkg ? path.join(__dirname, '..', 'skills') : path.resolve(__dirname, '..', 'skills');
    if (fs.existsSync(bundledSkillsPath)) {
        const files = fs.readdirSync(bundledSkillsPath);
        for (const file of files) {
            if (file.endsWith('.md')) {
                const srcPath = path.join(bundledSkillsPath, file);
                const destPath = path.join(SKILLS_DIR, file);
                if (!fs.existsSync(destPath)) {
                    fs.copyFileSync(srcPath, destPath);
                }
            }
        }
    }
} catch (e) {
    console.error("Failed to copy bundled skills", e);
}

// ── In-memory state ─────────────────────────────────────────────────
let todoList = [];
let logs = [];
let runningSkill = null;

// Default recommend list
const recommendList = [
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
        description: '建立系統還原點或備份重要資料到外接磁碟',
        category: '資料保護',
        priority: 'medium',
    },
    {
        id: 'rec_office',
        title: '📄 安裝 Microsoft Office',
        description: '安裝 Office 365 或替代方案（LibreOffice）',
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

// GET /api/skills — 取得所有可用的 skill
app.get('/api/skills', (req, res) => {
    try {
        const skills = loadAllSkills(SKILLS_DIR);
        res.json({ success: true, skills });
    } catch (err) {
        res.json({ success: false, error: err.message, skills: [] });
    }
});

// GET /api/todo — 取得 To-Do List
app.get('/api/todo', (req, res) => {
    res.json({ success: true, todoList });
});

// POST /api/todo — 新增任務到 To-Do List
app.post('/api/todo', (req, res) => {
    const { title, description, skillId, category } = req.body;
    const task = {
        id: `task_${Date.now()}`,
        title,
        description: description || '',
        skillId: skillId || null,
        category: category || '自訂',
        status: 'pending', // pending | running | success | failed | skipped
        progress: 0,
        logs: [],
        createdAt: new Date().toISOString(),
        completedAt: null,
    };
    todoList.push(task);
    saveTasks();
    res.json({ success: true, task });
});

// DELETE /api/todo/:id — 移除任務
app.delete('/api/todo/:id', (req, res) => {
    todoList = todoList.filter((t) => t.id !== req.params.id);
    saveTasks();
    res.json({ success: true });
});

// POST /api/todo/import — 匯入任務清單
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

// GET /api/todo/export — 匯出任務清單 (Raw JSON)
app.get('/api/todo/export', (req, res) => {
    res.json({
        exportedAt: new Date().toISOString(),
        agentVersion: '1.0.0',
        tasks: todoList,
    });
});

const { execSync } = require('child_process');

// POST /api/todo/export-file — 匯出任務清單 (跳出另存新檔對話框)
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

// GET /api/recommend — 取得推薦清單
app.get('/api/recommend', (req, res) => {
    res.json({ success: true, recommendList });
});

// POST /api/execute/:taskId — 執行指定任務
app.post('/api/execute/:taskId', async (req, res) => {
    const task = todoList.find((t) => t.id === req.params.taskId);
    if (!task) {
        return res.json({ success: false, error: '找不到任務' });
    }

    if (runningSkill) {
        return res.json({ success: false, error: '目前有任務正在執行中，請稍候' });
    }

    if (!task.skillId) {
        return res.json({ success: false, error: '此任務沒有對應的 Skill，無法自動執行' });
    }

    const skills = loadAllSkills(SKILLS_DIR);
    const skill = skills.find((s) => s.id === task.skillId);
    if (!skill) {
        return res.json({ success: false, error: `找不到 Skill: ${task.skillId}` });
    }

    // Start execution
    task.status = 'running';
    task.progress = 10;
    task.logs = [];
    runningSkill = task.id;

    const dryRun = req.body.dryRun ?? false;
    const executor = new SkillExecutor({ dryRun });

    executor.on('log', (event) => {
        task.logs.push({ ...event, timestamp: new Date().toISOString() });
    });

    executor.on('phase:start', (e) => {
        const progressMap = { check: 20, install: 40, verify: 80 };
        task.progress = progressMap[e.phase] || task.progress;
    });

    executor.on('ui:message', (e) => {
        task.logs.push({ level: 'ui', message: e.message, timestamp: new Date().toISOString() });
    });

    // Run async
    res.json({ success: true, message: '任務已開始執行' });

    try {
        const result = await executor.execute(skill);
        task.status = result.status;
        task.progress = 100;
        task.completedAt = new Date().toISOString();
    } catch (err) {
        task.status = 'failed';
        task.logs.push({ level: 'error', message: err.message, timestamp: new Date().toISOString() });
    } finally {
        runningSkill = null;
        saveTasks();
    }
});

// GET /api/task/:taskId/status — 查詢任務執行狀態
app.get('/api/task/:taskId/status', (req, res) => {
    const task = todoList.find((t) => t.id === req.params.taskId);
    if (!task) {
        return res.json({ success: false, error: '找不到任務' });
    }
    res.json({ success: true, task });
});

// POST /api/chat — 處理對話輸入（簡易意圖解析）
app.post('/api/chat', (req, res) => {
    const { message } = req.body;
    if (!message) {
        return res.json({ success: false, error: '請輸入訊息' });
    }

    const skills = loadAllSkills(SKILLS_DIR);
    const lowerMsg = message.toLowerCase();

    // Simple intent matching — future: connect to LLM
    let matchedSkill = null;
    let reply = '';

    // Language-related intents
    if (/日文|日語|japanese|ja-jp/i.test(message)) {
        matchedSkill = skills.find((s) => s.id === 'sys_lang_ja_jp');
        if (matchedSkill) {
            reply = `我了解了！你想安裝日文語系。我已經幫你加到任務清單了，點擊「執行」按鈕就會自動幫你搞定 🎌`;
        }
    }

    // Language check intent
    if (/檢查.*語言|裝了.*語言|哪些語言|language.*check/i.test(message)) {
        reply = reply || `好的！我先幫你檢查系統已安裝的語言包。`;
        // Add a check task
        const checkTask = {
            id: `task_${Date.now()}`,
            title: '🔍 檢查已安裝語言',
            description: '列出系統中已安裝的所有語言包',
            skillId: null, // No skill, just a quick check
            category: '系統查詢',
            status: 'pending',
            progress: 0,
            logs: [],
            createdAt: new Date().toISOString(),
            completedAt: null,
        };
        todoList.push(checkTask);
        saveTasks();
    }

    if (matchedSkill) {
        const task = {
            id: `task_${Date.now()}`,
            title: `📦 ${matchedSkill.name}`,
            description: `由對話建立：「${message}」`,
            skillId: matchedSkill.id,
            category: matchedSkill.category || '系統設定',
            status: 'pending',
            progress: 0,
            logs: [],
            createdAt: new Date().toISOString(),
            completedAt: null,
        };
        todoList.push(task);
        saveTasks();
        return res.json({ success: true, reply, task });
    }

    // Generic fallback
    if (!reply) {
        reply = `收到！「${message}」— 目前我的 Skill 庫還在擴充中，暫時無法自動處理這個需求。你可以手動新增到任務清單，或等待更多 Skill 上線！ 🚧`;
    }

    res.json({ success: true, reply });
});

// GET /api/logs — 取得全域 log
app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs });
});

// ── Start Server ────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n  🖥️  AI PC Agent 已啟動！`);
    console.log(`  📍 http://localhost:${PORT}`);
    console.log(`  📂 Skills 目錄: ${SKILLS_DIR}\n`);
});
