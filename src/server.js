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
const { checkOllamaStatus, chatWithLLM, invalidateCache, listModels, setCurrentModel, getCurrentModel } = require('./llm');

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

if (!fs.existsSync(SOPS_DIR)) {
    fs.mkdirSync(SOPS_DIR, { recursive: true });
}

// Copy default bundled sops to APPDATA if they exist internally (for pkg and pure node)
function syncBundledSOPs() {
    try {
        const possiblePaths = [
            isPkg ? path.join(__dirname, '..', 'sops') : path.resolve(__dirname, '..', 'sops'),
            path.join(process.cwd(), 'sops'),
            path.join(path.dirname(process.execPath), 'sops'), // for sidecar context
        ];

        let bundledSOPsPath = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                bundledSOPsPath = p;
                break;
            }
        }

        if (bundledSOPsPath) {
            console.log(`  📂 偵測到內建 SOPs 路徑: ${bundledSOPsPath}`);
            const files = fs.readdirSync(bundledSOPsPath);
            let copiedCount = 0;
            for (const file of files) {
                if (file.endsWith('.md')) {
                    const srcPath = path.join(bundledSOPsPath, file);
                    const destPath = path.join(SOPS_DIR, file);
                    // 即使資料夾在，如果檔案不在也要補齊
                    if (!fs.existsSync(destPath)) {
                        const content = fs.readFileSync(srcPath);
                        fs.writeFileSync(destPath, content);
                        copiedCount++;
                    }
                }
            }
            if (copiedCount > 0) console.log(`  ✅ 已補齊 ${copiedCount} 個內建 SOP 腳本`);
        } else {
            console.warn(`  ⚠️ 找不到內含的 sops 目錄，請檢查專案結構`);
        }
    } catch (e) {
        console.error("Failed to sync bundled sops", e);
    }
}

syncBundledSOPs();

// ── In-memory state ─────────────────────────────────────────────────
let todoList = [];
let logs = [];
let runningSOP = null;

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
        const skills = loadAllSkills(SKILLS_DIR);
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
        const status = await checkOllamaStatus();
        res.json({ success: true, ...status, currentModel: getCurrentModel() });
    } catch (err) {
        res.json({ success: false, available: false, modelReady: false, error: err.message });
    }
});

// GET /api/llm/models — 列出所有可用模型
app.get('/api/llm/models', async (req, res) => {
    try {
        const models = await listModels();
        res.json({ success: true, models, currentModel: getCurrentModel() });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/llm/model — 切換模型
app.post('/api/llm/model', (req, res) => {
    const { modelName } = req.body;
    if (!modelName) return res.json({ success: false, error: '缺少 modelName' });
    setCurrentModel(modelName);
    res.json({ success: true, currentModel: getCurrentModel() });
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
            invalidateCache();
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
    const llmStatus = await checkOllamaStatus();

    // ── 情境 1：LLM 在線且就緒 (AI 技能驅動模式) ───────────────────────
    if (llmStatus.available && llmStatus.modelReady) {
        try {
            // 1. 準備背景資訊 (Context)
            const sopCatalog = sops.map(s => `- ID: ${s.id}, 名稱: ${s.name}`).join('\n');
            const taskContext = todoList.map(t => `- ID: ${t.id}, 標題: ${t.title}, 狀態: ${t.status}`).join('\n');
            const installedModels = await listModels();
            const modelListStr = installedModels.map(m => `- ${m.name} (${(m.size / 1024 / 1024 / 1024).toFixed(1)}GB)`).join('\n');

            const contextNote = `
[[當前系統狀態]]
1. 可用 SOP 列表 (使用 ADD_TASK 時請務必對應正確的 ID):
${sopCatalog || '(無可用 SOP)'}

2. 目前工作清單:
${taskContext || '(目前清單為空)'}

3. 目前已安裝模型 ([[目前已安裝模型]]):
${modelListStr || '(無已安裝模型)'}
當前正在使用的模型為: ${getCurrentModel()}

[[任務日誌摘要]]
${todoList.slice(-2).map(t => `任務「${t.title}」日誌:\n${t.logs.slice(-3).map(l => l.message).join('\n')}`).join('\n---\n')}
`;

            // 2. 呼叫 LLM
            let llmReply = await chatWithLLM(message + contextNote);

            // 3. 解析 Action 標籤
            let executeTaskId = null;
            const actionRegex = /\[ACTION:(.*?)\]/g;
            let match;

            while ((match = actionRegex.exec(llmReply)) !== null) {
                const actionStr = match[1];

                // ADD_TASK(sop_id)
                if (actionStr.startsWith('ADD_TASK')) {
                    const idMatch = actionStr.match(/sop_id="(.*?)"/);
                    if (idMatch) {
                        const sopId = idMatch[1];
                        const matchedSOP = sops.find(s => s.id === sopId);
                        if (matchedSOP) {
                            const newTask = {
                                id: `task_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                                title: `📦 ${matchedSOP.name}`,
                                description: `由 AI 技能觸發：「${message}」`,
                                skillId: matchedSOP.id,
                                category: matchedSOP.category || '系統管理',
                                status: 'pending',
                                progress: 0,
                                logs: [],
                                createdAt: new Date().toISOString(),
                                completedAt: null,
                            };
                            todoList.push(newTask);
                            saveTasks();
                        }
                    }
                }

                // REMOVE_TASK(task_id)
                if (actionStr.startsWith('REMOVE_TASK')) {
                    const idMatch = actionStr.match(/task_id="(.*?)"/);
                    if (idMatch) {
                        const tId = idMatch[1];
                        todoList = todoList.filter(t => t.id !== tId);
                        saveTasks();
                    }
                }

                // EXECUTE_TASK(task_id)
                if (actionStr.startsWith('EXECUTE_TASK')) {
                    const idMatch = actionStr.match(/task_id="(.*?)"/);
                    if (idMatch) {
                        executeTaskId = idMatch[1];
                    }
                }

                // CLEAR_ALL
                if (actionStr === 'CLEAR_ALL') {
                    todoList = [];
                    saveTasks();
                }

                // SWITCH_MODEL(name)
                if (actionStr.startsWith('SWITCH_MODEL')) {
                    const nameMatch = actionStr.match(/name="(.*?)"/);
                    if (nameMatch) {
                        const modelName = nameMatch[1];
                        setCurrentModel(modelName);
                    }
                }

                // PULL_MODEL(name)
                if (actionStr.startsWith('PULL_MODEL')) {
                    const nameMatch = actionStr.match(/name="(.*?)"/);
                    if (nameMatch) {
                        const modelName = nameMatch[1];
                        // 建立一個動態任務
                        const pullTask = {
                            id: `task_pull_${Date.now()}`,
                            title: `📥 下載模型: ${modelName}`,
                            description: `由 AI 技能觸發下載從 Ollama 倉庫下載模型`,
                            category: 'AI 引擎',
                            status: 'pending',
                            progress: 0,
                            logs: [],
                            createdAt: new Date().toISOString(),
                            // 特別標註這是一個動態 PowerShell 任務
                            dynamicCmd: `ollama pull ${modelName}` 
                        };
                        todoList.push(pullTask);
                        saveTasks();
                    }
                }
            }

            // 4. 清理回覆內容（移除標籤後傳給前端）
            const cleanReply = llmReply.replace(/\[ACTION:.*?\]/g, '').trim();

            return res.json({
                success: true,
                reply: cleanReply,
                task: true,
                executeTaskId,
                llmUsed: true
            });

        } catch (llmErr) {
            console.error('[LLM] 技能驅動模式失敗，跳轉回關鍵字模式:', llmErr);
        }
    }

    // ── 情境 2：LLM 不可用 (硬編碼備援模式) ───────────────────────────
    // (保留原本的邏輯以確保沒 AI 也能動)
    let matchedSOP = null;
    let taskAdded = null;
    let executeTaskId = null;
    let isActionTaken = false;

    const isDeletionIntent = /刪除|移除|移掉|清空|清掉|delete|remove/.test(message);
    if (isDeletionIntent && /全部|所有|清單|工作表/.test(message) && !/(單一|這項|那個|個)/.test(message)) {
        todoList = [];
        saveTasks();
        executeTaskId = 'CLEAR_ALL';
        isActionTaken = true;
    } else if (isDeletionIntent) {
        const cleanQuery = message.replace(/刪除|移除|移掉|清空|清掉|這項|任務|工作|清單|delete|remove|task|安裝|平台/g, '').trim().toLowerCase();
        let targetTask = todoList.find(t => t.title.toLowerCase().includes(cleanQuery));
        if (targetTask) {
            todoList = todoList.filter(t => t.id !== targetTask.id);
            saveTasks();
            executeTaskId = `DELETE_${targetTask.id}`;
            isActionTaken = true;
        }
    }

    if (!isActionTaken) {
        if (/日文|日語|japanese|ja-jp/i.test(message)) matchedSOP = sops.find((s) => s.id === 'sys_lang_ja_jp');
        if (/chrome|谷歌|瀏覽器/i.test(message)) matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_install_chrome');
        if (/ollama|llm|語言模型|ai引擎/i.test(message)) matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_install_ollama');
        if (/steam|steam|遊戲/i.test(message)) matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_steam');

        if (matchedSOP) {
            taskAdded = { id: `task_${Date.now()}`, title: `📦 ${matchedSOP.name}`, skillId: matchedSOP.id, status: 'pending', progress: 0, logs: [] };
            todoList.push(taskAdded);
            saveTasks();
        } else if (/是|好|確定|執行/i.test(message)) {
            const pendingTask = [...todoList].reverse().find(t => t.status === 'pending');
            if (pendingTask) executeTaskId = pendingTask.id;
        }
    }

    let reply = '';
    if (taskAdded) reply = `已幫你將「${taskAdded.title}」加入清單。現在要執行嗎？ 😊`;
    else if (executeTaskId === 'CLEAR_ALL') reply = `好的！我已經幫你清空所有工作清單了。 🧹`;
    else if (executeTaskId) reply = `沒問題，這就開始執行！ 🚀`;
    else reply = `收到您的訊息：「${message}」— (AI 引擎未就緒，目前為關鍵字比對模式)`;

    return res.json({ success: true, reply, task: true, executeTaskId, llmUsed: false });
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

// ── Start Server ────────────────────────────────────────────────────
app.listen(PORT, async () => {
    const startMsg = `AI PC Agent 已啟動！ (PID: ${process.pid}, Path: ${process.execPath})`;
    console.log(`\n  🖥️  ${startMsg}`);
    fileLog(startMsg);
    console.log(`  📍 http://localhost:${PORT}`);
    console.log(`  📂 SOPs 目錄: ${SOPS_DIR}`);
    fileLog(`SOPs Directory: ${SOPS_DIR}`);

    // 啟動時非同步檢查 LLM 狀態
    try {
        const llm = await checkOllamaStatus();
        if (llm.available && llm.modelReady) {
            const msg = `🧠 LLM 引擎就緒：Ollama v${llm.version}，模型 qwen3.5:4b 已載入`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        } else if (llm.available) {
            const msg = `🟡 Ollama 已安裝但模型尚未下載`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        } else {
            const msg = `🔴 未偵測到 Ollama`;
            console.log(`  ${msg}\n`);
            fileLog(msg);
        }
    } catch (e) {
        fileLog(`LLM Check Failed: ${e.message}`);
        console.log(`  🔴 LLM 狀態檢查失敗\n`);
    }
});
