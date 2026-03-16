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

    if (!task.skillId) {
        return res.json({ success: false, error: '此任務沒有對應的 SOP，無法自動執行' });
    }

    const sops = loadAllSOPs(SOPS_DIR);
    const sop = sops.find((s) => s.id === task.skillId);
    if (!sop) {
        return res.json({ success: false, error: `找不到 SOP: ${task.skillId}` });
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
        if (sop.id === 'rec_install_ollama' || sop.id === 'rec_pull_llm_model' || task.skillId === 'rec_pull_llm_model') {
            console.log(`[Server] 偵測到 AI 相關任務完成: ${sop.id}，執行快取更新...`);
            fileLog(`AI Task Completed: ${sop.id}, invalidating cache.`);
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
    if (!message) {
        return res.json({ success: false, error: '請輸入訊息' });
    }

    const sops = loadAllSOPs(SOPS_DIR);

    // ── 意圖判斷 ──
    let isActionTaken = false;
    let matchedSOP = null;
    let taskAdded = null;
    let executeTaskId = null;

    // 1. 優先檢查是否為「清空/刪除」意圖
    const isDeletionIntent = /刪除|移除|移掉|清空|清掉|delete|remove/.test(message);

    if (isDeletionIntent && /全部|所有|清單|工作表/.test(message) && !/(單一|這項|那個|個)/.test(message)) {
        todoList = [];
        saveTasks();
        executeTaskId = 'CLEAR_ALL';
        isActionTaken = true;
    } else if (isDeletionIntent) {
        // [精細化比對] 移除動詞後的剩餘字串
        const cleanQuery = message.replace(/刪除|移除|移掉|清空|清掉|這項|任務|工作|清單|delete|remove|task|安裝|平台/g, '').trim().toLowerCase();

        let targetTask = null;
        if (cleanQuery) {
            targetTask = todoList.find(t => {
                const title = t.title.toLowerCase().replace('📦 ', '');
                return title.includes(cleanQuery) || cleanQuery.includes(title.replace('安裝', '').trim());
            });
        }

        if (!targetTask && /這個|單一|這項|剛剛那個/i.test(message)) {
            targetTask = todoList[todoList.length - 1];
        }

        if (targetTask) {
            todoList = todoList.filter(t => t.id !== targetTask.id);
            saveTasks();
            executeTaskId = `DELETE_${targetTask.id}`;
            isActionTaken = true;
        } else {
            // 只要有刪除關鍵字，即使沒找到目標也不應進入「新增」邏輯
            isActionTaken = true;
            executeTaskId = 'NOT_FOUND';
        }
    }

    // 2. 如果沒有執行刪除行動，才檢查「新增任務」或「確認現有任務」
    if (!isActionTaken) {
        if (/日文|日語|japanese|ja-jp/i.test(message)) {
            matchedSOP = sops.find((s) => s.id === 'sys_lang_ja_jp');
        }
        if (/chrome|谷歌|瀏覽器/i.test(message)) {
            matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_install_chrome');
        }
        if (/copilot|科皮/i.test(message)) {
            matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_remove_copilot');
        }
        if (/備份|還原點|backup/i.test(message)) {
            matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_backup');
        }
        if (/ollama|llm|語言模型|ai引擎/i.test(message)) {
            matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_install_ollama');
        }
        if (/steam|steam|遊戲/i.test(message)) {
            matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_steam');
        }
        if (/office|辦公|word|excel|powerpoint/i.test(message)) {
            matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_office');
        }
        if (/driver|驅動|更新|顯示卡/i.test(message)) {
            matchedSOP = matchedSOP || sops.find((s) => s.id === 'rec_driver_check');
        }

        if (matchedSOP) {
            taskAdded = {
                id: `task_${Date.now()}`,
                title: `📦 ${matchedSOP.name}`,
                description: `由對話建立：「${message}」`,
                skillId: matchedSOP.id,
                category: matchedSOP.category || '系統設定',
                status: 'pending',
                progress: 0,
                logs: [],
                createdAt: new Date().toISOString(),
                completedAt: null,
            };
            todoList.push(taskAdded);
            saveTasks();
            // 不再自動執行，改由下方的 contextNote 讓 LLM 問使用者
        } else {
            // 檢查是否是「確認執行」
            if (/是|好|確定|執行|開始|跑|處理|ok|yes|do it/i.test(message)) {
                const pendingTask = [...todoList].reverse().find(t => t.status === 'pending' && t.skillId);
                if (pendingTask) {
                    executeTaskId = pendingTask.id;
                }
            }
        }
    }

    // ── 建立給 LLM 的任務背景資訊 ───────────────────────────────────
    const recentTasks = todoList.slice(-3).map(t => {
        let logSummary = t.logs.slice(-5).map(l => `[${l.level}] ${l.message}`).join('\n');
        return `任務: ${t.title} (ID: ${t.id})
狀態: ${t.status}
進度: ${t.progress}%
日誌摘要:
${logSummary || '(尚無日誌)'}`;
    }).join('\n---\n');

    let contextNote = `\n\n[[任務狀態與日誌]]\n${recentTasks || '目前無任務。'}`;

    if (taskAdded) {
        contextNote += `\n\n[[系統提示：我剛剛幫使用者新增了任務「${taskAdded.title}」，請問他是否要現在執行。]]`;
    } else if (executeTaskId === 'CLEAR_ALL') {
        contextNote += `\n\n[[系統提示：我已經清空了所有工作清單，請口語回覆說好的，已幫你清空了。]]`;
    } else if (executeTaskId === 'NOT_FOUND') {
        contextNote += `\n\n[[系統提示：使用者想執行刪除或操作，但我找不到對應的任務，請口語回覆說找不到該項任務。]]`;
    } else if (executeTaskId && executeTaskId.startsWith('DELETE_')) {
        contextNote += `\n\n[[系統提示：我已經刪除了該項任務，請回報已移除成功。]]`;
    } else if (executeTaskId) {
        const t = todoList.find(x => x.id === executeTaskId);
        if (t) {
            contextNote += `\n\n[[系統提示：使用者同意執行「${t.title}」，我已經開始執行了，請口語回覆說好的並祝他順利。]]`;
        } else {
            contextNote += `\n\n[[系統提示：我找不到該任務，請口語回覆說找不到。]]`;
        }
    }

    // ── LLM 優先回覆 ─────────────────────────────────────────────────
    try {
        const llmStatus = await checkOllamaStatus();
        if (llmStatus.available && llmStatus.modelReady) {
            const llmReply = await chatWithLLM(message + contextNote);
            return res.json({ success: true, reply: llmReply, task: true, executeTaskId, llmUsed: true });
        }
    } catch (llmErr) {
        console.warn('[LLM] 呼叫失敗，切換為關鍵字模式:', llmErr.message);
    }

    // ── Fallback：關鍵字回覆 ─────────────────────────────────────────
    let reply = '';
    if (executeTaskId === 'CLEAR_ALL') {
        reply = `好的！我已經幫你清空所有工作清單了。 🧹`;
    } else if (executeTaskId === 'NOT_FOUND') {
        reply = `抱歉，我在工作清單中找不到您提到的這項任務。 🔍`;
    } else if (executeTaskId && executeTaskId.startsWith('DELETE_')) {
        reply = `沒問題，該任務已從清單中移除。`;
    } else if (executeTaskId) {
        const targetTask = todoList.find(t => t.id === executeTaskId);
        if (targetTask) {
            reply = `沒問題！我這就幫你執行「${targetTask.title}」🚀`;
        } else {
            reply = `抱歉，我找不到對應的任務。`;
        }
    } else if (taskAdded) {
        reply = `我了解了！已幫你將「${taskAdded.title}」加入工作清單。請問現在要幫你執行嗎？ 😊`;
    } else if (/成功|結果|好了沒|完成了嗎/i.test(message)) {
        const last = todoList[todoList.length - 1];
        if (last) {
            reply = `最後一個任務「${last.title}」目前的狀態是：${last.status}。`;
            if (last.status === 'failed') reply += ` 好像出了一點問題，你可以看下方日誌了解詳情。`;
        } else {
            reply = `目前沒有看到任何任務紀錄喔。`;
        }
    } else {
        reply = `收到！「${message}」— 目前 AI 語意引擎尚未就緒，使用關鍵字模式。請先從推薦清單安裝 Ollama + 語言模型，即可升級為完整 AI 對話體驗！ 🚧`;
    }

    res.json({ success: true, reply, task: true, executeTaskId, llmUsed: false });
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
            const msg = `🧠 LLM 引擎就緒：Ollama v${llm.version}，模型 qwen3.5:0.8b 已載入`;
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
