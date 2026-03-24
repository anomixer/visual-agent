/**
 * AI PC Agent — Local Server
 * 
 * 提供 REST API 給前端 UI 使用，橋接 sop-parser 與 sop-executor。
 * 啟動後會自動開啟瀏覽器。
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { loadAllSOPs } = require('./sop-parser');
const { SOPExecutor } = require('./sop-executor');
const llm = require('./llm');
const { getSystemHealth } = require('./system');

const app = express();
const PORT = 3210;

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

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
const SOPS_DIR = path.join(aipcDir, 'sops');
const SKILLS_DIR = path.join(aipcDir, 'skills');
const PLUGINS_DIR = path.join(aipcDir, 'plugins');

if (!fs.existsSync(SOPS_DIR)) fs.mkdirSync(SOPS_DIR, { recursive: true });
if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });

/**
 * 同步內建的腳本與技能至 AppData
 */
function syncBundledAssets() {
    try {
        const bundledSopsDir = path.join(__dirname, '..', 'sops');
        const bundledSkillsDir = path.join(__dirname, '..', 'skills');

        // 同步 SOPs
        if (fs.existsSync(bundledSopsDir)) {
            const files = fs.readdirSync(bundledSopsDir).filter(f => f.endsWith('.md'));
            files.forEach(file => {
                const dest = path.join(SOPS_DIR, file);
                if (!fs.existsSync(dest)) fs.copyFileSync(path.join(bundledSopsDir, file), dest);
            });
        }

        // 同步 Skills
        if (fs.existsSync(bundledSkillsDir)) {
            const files = fs.readdirSync(bundledSkillsDir).filter(f => f.endsWith('.md'));
            files.forEach(file => {
                const dest = path.join(SKILLS_DIR, file);
                if (!fs.existsSync(dest)) fs.copyFileSync(path.join(bundledSkillsDir, file), dest);
            });
        }

        // 同步 Plugins
        const bundledPluginsDir = path.join(__dirname, '..', 'plugins');
        if (fs.existsSync(bundledPluginsDir)) {
            const files = fs.readdirSync(bundledPluginsDir).filter(f => f.endsWith('.js'));
            files.forEach(file => {
                const dest = path.join(PLUGINS_DIR, file);
                if (!fs.existsSync(dest)) fs.copyFileSync(path.join(bundledPluginsDir, file), dest);
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
        title: '📥 下載語言模型 (Qwen3.5 0.8B)',
        description: '下載輕量語言模型，約 1GB，完成後對話將由 AI 真正理解你的需求',
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
function buildRecommendList() {
    try {
        const skills = loadAllSOPs(SKILLS_DIR);
        const skillIds = new Set(skills.map(s => s.id));
        return RECOMMEND_BASE.map(item => ({
            ...item,
            skillId: skillIds.has(item.id) ? item.id : null,
        }));
    } catch {
        return RECOMMEND_BASE.map(item => ({ ...item, skillId: null }));
    }
}

function getRecommendList() {
    return buildRecommendList();
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

// GET /api/sops — 列出所有 SOP
app.get('/api/sops', (req, res) => {
    try {
        const sops = loadAllSOPs(SOPS_DIR);
        res.json({ success: true, sops });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// GET /api/todo — 取得 To-Do List
app.get('/api/todo', (req, res) => {
    res.json({ success: true, todoList });
});

// POST /api/todo — 新增任務到 To-Do List
app.post('/api/todo', (req, res) => {
    const { title, description, skillId, category } = req.body;
    const sops = loadAllSOPs(SOPS_DIR);
    const matchedSOP = sops.find((s) => s.id === skillId);

    const task = {
        id: `task_${Date.now()}`,
        title: title || (matchedSOP ? matchedSOP.name : '未命名任務'),
        description: description || (matchedSOP ? matchedSOP.name : ''),
        skillId: skillId || null,
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

// GET /api/recommend — 取得推薦清單（動態附帶 skillId）
app.get('/api/recommend', (req, res) => {
    res.json({ success: true, recommendList: getRecommendList() });
});

// GET /api/llm/status — 查詢 Ollama 狀態
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

// GET/POST /api/llm/models — 列出所有可用模型 (支援動態參數預覽)
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

// POST /api/llm/model — 切換模型
app.post('/api/llm/model', (req, res) => {
    const { modelName } = req.body;
    if (!modelName) return res.json({ success: false, error: '缺少 modelName' });
    llm.setCurrentModel(modelName);
    res.json({ success: true, currentModel: llm.getCurrentModel() });
});

// POST /api/execute/:taskId — 執行指定任務
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
        const progressMap = { check: 20, install: 40, verify: 80 };
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
        const result = await executor.execute(sop);
        task.status = result.status;
        task.progress = 100;
        task.completedAt = new Date().toISOString();

        const finishLog = { level: 'success', message: `任務「${task.title}」執行完畢 (狀態: ${result.status})`, timestamp: new Date().toISOString() };
        task.logs.push(finishLog);
        logs.push(finishLog);

        // 針對 AI 引擎相關任務，強制清除快取並重新偵測
        if (sop.id === 'rec_install_ollama' || sop.id === 'rec_pull_llm_model' || task.skillId === 'rec_pull_llm_model' || task.dynamicCmd?.includes('ollama')) {
            console.log(`[Server] 偵測到 AI 相關任務完成: ${sop.id || 'dynamic'}，執行快取更新...`);
            fileLog(`AI Task Completed: ${sop.id || 'dynamic'}, invalidating cache.`);
            llm.invalidateCache();
        }
    } catch (err) {
        task.status = 'failed';
        const errLog = { level: 'error', message: `任務執行崩潰: ${err.message}`, timestamp: new Date().toISOString() };
        task.logs.push(errLog);
        logs.push(errLog);
    } finally {
        runningSOP = null;
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

// POST /api/chat — 處理對話輸入（LLM 優先，fallback 到關鍵字比對）
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    if (!message) return res.json({ success: false, error: '請輸入訊息' });

    const sops = loadAllSOPs(SOPS_DIR);
    let suggestions = ['幫我安裝 Chrome', '清理工作清單', '查看系統狀態']; // 提升作用域
    let llmErrorForFallback = null;
    // 1. 快速蒐集背景資訊 (不使用 await 耗時操作，使用快取或 OS 基本資訊)
    const sopCatalog = sops.map(s => `- ID: ${s.id}, 名稱: ${s.name}`).join('\n');
    const taskContext = todoList.map(t => `- ID: ${t.id}, 標題: ${t.title}, 狀態: ${t.status}`).join('\n');
    const ramUsage = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
    
    // 取得快取的狀態 (不強制刷新，約 5ms 以內)
    const llmStatus = await llm.checkOllamaStatus();

    // ── 情境 1：AI 引擎就緒 (驅動模式) ───────────────────────
    if (llmStatus.available && llmStatus.modelReady) {
        try {
            const contextNote = `
[[當前系統環境]]
1. 硬體簡報: CPU: ${os.cpus()[0].model.trim()}, RAM: ${Math.round(os.totalmem()/1024/1024/1024)}GB (Usage: ${ramUsage}%)
2. 可用 SOP (ID 列表):
${sopCatalog || '(無)'}
3. 待辦任務清單:
${taskContext || '(空)'}
4. 當前使用的 AI 模型: ${llm.getCurrentModel()}
`;

            // 2. 呼叫 LLM (附帶歷史紀錄)
            let llmReply = await llm.chatWithLLM(message + "\n\n" + contextNote, chatHistory);

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

            if (hasSuggestions && isQuestioning) {
                actions.length = 0; // 攔截待確認動作
            }

            for (const actionStr of actions) {
                if (actionStr.startsWith('ADD_TASK')) {
                    const idMatch = actionStr.match(/sop_id="(.*?)"/);
                    if (idMatch) {
                        const mSop = sops.find(s => s.id === idMatch[1]);
                        if (mSop) {
                            todoList.push({
                                id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                                title: `📦 ${mSop.name}`,
                                description: `由 AI 智慧管家排程`,
                                skillId: mSop.id,
                                category: mSop.category || '系統維護',
                                status: 'pending', progress: 0, logs: [],
                                createdAt: new Date().toISOString()
                            });
                            hasActionTaken = true;
                        }
                    }
                }
                if (actionStr.startsWith('REMOVE_TASK')) {
                    const idMatch = actionStr.match(/task_id="(.*?)"/);
                    if (idMatch) {
                        todoList = todoList.filter(t => t.id !== idMatch[1]);
                        hasActionTaken = true;
                    }
                }
                if (actionStr.startsWith('EXECUTE_TASK')) {
                    const idMatch = actionStr.match(/task_id="(.*?)"/);
                    if (idMatch) executeTaskId = idMatch[1];
                }
                if (actionStr === 'CLEAR_ALL') {
                    todoList = [];
                    hasActionTaken = true;
                }
                if (actionStr.startsWith('SWITCH_MODEL')) {
                    const nameMatch = actionStr.match(/name="(.*?)"/);
                    if (nameMatch) llm.setCurrentModel(nameMatch[1]);
                }
            }
            if (hasActionTaken) saveTasks();

            // 4. 更新對話紀錄
            chatHistory.push({ role: 'user', content: message });
            const cleanReply = llmReply.replace(/\[ACTION:.*?\]/g, '').replace(/\[SUGGEST:.*?\]/g, '').trim();
            chatHistory.push({ role: 'assistant', content: cleanReply });
            if (chatHistory.length > 6) chatHistory = chatHistory.slice(-6);

            const suggestMatch = llmReply.match(/\[SUGGEST:(.*?)\]/);
            let finalSuggestions = suggestMatch ? suggestMatch[1].split(',').map(s => s.trim()) : suggestions;

            return res.json({
                success: true,
                reply: cleanReply,
                suggestions: finalSuggestions,
                task: actions.length > 0,
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
        if (/日文|日語|japanese|ja-jp/i.test(message)) matchedSOP = sops.find((s) => s.id === 'sys_lang_ja_jp');
        if (/chrome|谷歌|瀏覽器/i.test(message)) matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_install_chrome');
        if (/ollama|llm|語言模型|ai引擎/i.test(message)) matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_install_ollama');
        if (/steam|steam|遊戲/i.test(message)) matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_steam');

        if (matchedSOP) {
            taskAdded = { id: `task_${Date.now()}`, title: `📦 ${matchedSOP.name}`, skillId: matchedSOP.id, status: 'pending', progress: 0, logs: [] };
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

// GET /api/logs — 取得全域 log
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
        model: llm.getCurrentModel()
    });
});

app.post('/api/llm/config', (req, res) => {
    const { provider, baseUrl, apiKey, model, authConfig } = req.body;
    if (!provider || !baseUrl) {
        return res.status(400).json({ success: false, error: '缺少必要參數' });
    }
    llm.updateProviderSettings(provider, baseUrl, apiKey, model, authConfig);
    res.json({ success: true, message: '設定已儲存' });
});

// ── Start Server ────────────────────────────────────────────────────
app.post('/api/llm/test', async (req, res) => {
    try {
        const { provider, baseUrl, model, authConfig } = req.body;
        if (!provider || !baseUrl || !model) {
            return res.status(400).json({ success: false, error: 'ç¼ºå°‘ provider、baseUrl æˆ– model' });
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
