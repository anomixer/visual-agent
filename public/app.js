/**
 * AI PC Agent — Frontend Application (VS Code Layout)
 *
 * 功能：
 *  - 三欄可拖拉 resize（sidebar / center / chat / log）
 *  - 工作清單 CRUD + 執行
 *  - 推薦清單 + 一鍵執行
 *  - AI 對話（LLM + fallback）
 *  - 執行日誌串流
 *  - 深淺色主題切換
 *  - 匯入 / 匯出任務
 */

'use strict';

const API = 'http://localhost:3210';

// ── State ─────────────────────────────────────────────────────────
let todoList = [];
let recommendList = [];
let pollingInterval = null;
let isLogCollapsed = false;
let isRecording = false;
let recognition = null;
let currentLogIndex = 0;
let recSearchQuery = '';

// ── DOM ───────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Panel refs
const sidebar = $('#sidebar');
const sidebarBody = $('#recommendListContainer');
const centerCol = document.querySelector('.center-col');
const chatCol = document.querySelector('.chat-col');
const logPanel = $('#logPanel');
const todoContainer = $('#todoListContainer');
const todoEmpty = $('#todoEmpty');
const todoCount = $('#todoCount');
const recCount = $('#recCount');
const logEntries = $('#logEntries');
const chatMessages = $('#chatMessages');
const chatInput = $('#chatInput');
const btnSend = $('#btnSend');
const btnMic = $('#btnMic');
const btnClearChat = $('#btnClearChat');
const recSearchInput = $('#recSearchInput');
const btnTheme = $('#btnTheme');
const btnExport = $('#btnExport');
const btnImport = $('#btnImport');
const importFileInput = $('#importFileInput');
const btnToggleLog = $('#btnToggleLog');
const modalOverlay = $('#modalOverlay');
const modalTitle = $('#modalTitle');
const modalBody = $('#modalBody');
const btnCloseModal = $('#btnCloseModal');
const llmDot = $('#llmDot');
const llmLabel = $('#llmLabel');
const statusLLM = $('#statusLLM');
const statusTasks = $('#statusTasks');
const chatModelBadge = $('#chatModelBadge');

// ── API Helpers ────────────────────────────────────────────────────
async function api(endpoint, options = {}) {
    try {
        const res = await fetch(`${API}${endpoint}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
            body: options.body ? JSON.stringify(options.body) : undefined,
        });
        return res.json();
    } catch (err) {
        console.error('[API]', endpoint, err);
        return { success: false, error: err.message };
    }
}

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════
async function init() {
    checkFirstRun();
    applyTheme(localStorage.getItem('theme') || 'dark');
    restoreLayout();
    setupResizers();
    setupEventListeners();
    setupSpeechRecognition();

    // 並行載入資料，不要等待啟動畫面
    await Promise.all([loadTodo(), loadRecommend()]);

    // 隱藏啟動畫面（立即隱藏，不要延遲）
    hideSplash();

    startPolling();

    // 首次檢查 LLM 狀態（會觸發 bootstrap 或顯示歡迎訊息）
    await checkLLMStatus();
}

function checkFirstRun() {
    const splashText = document.getElementById('splashText');
    if (!splashText) return;

    // 檢查 localStorage 標記
    const hasRun = localStorage.getItem('aipc_has_run');
    console.log('[Init] hasRun flag:', hasRun);

    if (!hasRun) {
        splashText.innerText = '首次執行本程式，正設定環境中，請稍候...';
    } else {
        splashText.innerText = '啟動後端伺服器中，請稍候...';
    }
}

function hideSplash() {
    const splash = document.getElementById('splashOverlay');
    if (splash && !splash.classList.contains('hidden')) {
        splash.classList.add('hidden');
        // 真正隱藏後才標記「已執行過」，確保下次進來才顯示「啟動中」
        localStorage.setItem('aipc_has_run', 'true');
        setTimeout(() => splash.style.display = 'none', 600);
    }
}

// ════════════════════════════════════════════════════════
//  DATA LOADING
// ════════════════════════════════════════════════════════
async function loadTodo() {
    const data = await api('/api/todo');
    if (data.success) { todoList = data.todoList; renderTodoList(); }
}

async function loadRecommend() {
    try {
        const data = await api('/api/recommend');
        if (data.success && data.recommendList?.length > 0) {
            recommendList = data.recommendList;
            renderRecommendList();
            hideSplash(); // 抓到資料後隱藏
        }
    } catch (e) {
        console.error("Load recommend failed", e);
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        // 嘗試載入資料，但不應該阻塞後續的 Log 與 AI 狀態檢查
        if (!recommendList || recommendList.length === 0) {
            loadRecommend();
        }

        const data = await api('/api/todo');
        if (data.success && JSON.stringify(data.todoList) !== JSON.stringify(todoList)) {
            todoList = data.todoList;
            renderTodoList();
        }
        pollLogs();
        checkLLMStatus();
    }, 2000);
}

async function pollLogs() {
    const data = await api('/api/logs');
    if (data.success && data.logs?.length) {
        if (data.logs.length > currentLogIndex) {
            const newLogs = data.logs.slice(currentLogIndex);
            newLogs.forEach(addLogEntry);
            currentLogIndex = data.logs.length;
        }
    }
}

// ════════════════════════════════════════════════════════
//  LLM STATUS
// ════════════════════════════════════════════════════════
// --- Auto-Bootstrap Helpers ---
async function bootstrapOllama() {
    if (window._ollamaBootstrapping) return;
    window._ollamaBootstrapping = true;

    const recOllama = recommendList.find(r => r.id === 'rec_install_ollama');
    if (!recOllama) return;

    // 檢查是否已經在清單中
    let task = todoList.find(t => t.skillId === 'rec_install_ollama');
    if (!task && !todoList.some(t => t.skillId === 'rec_install_ollama')) {
        addUILog('🔴 未偵測到 Ollama，自動加入安裝任務', 'warn');
        const res = await api('/api/todo', {
            method: 'POST',
            body: { title: recOllama.title, description: recOllama.description, category: recOllama.category, skillId: recOllama.id }
        });
        if (res.success) {
            todoList = res.todoList;
            renderTodoList();
            task = res.task || todoList.find(t => t.skillId === 'rec_install_ollama');
        }
    }

    if (task && task.status === 'pending') {
        const isRunning = todoList.some(t => t.status === 'running');
        if (!isRunning) {
            appendChatBubble('ai', '🔴 未偵測到本地 AI 引擎（Ollama）。系統正自動為您安裝，請在出現提示時允許權限。');
            addUILog(`▶ 自動執行：${task.title}`, 'info');
            executeTask(task.id);
        }
    }
    window._ollamaBootstrapping = false;
}

async function bootstrapModel() {
    if (window._modelBootstrapping) return;
    window._modelBootstrapping = true;

    const recModel = recommendList.find(r => r.id === 'rec_pull_llm_model');
    if (!recModel) return;

    let task = todoList.find(t => t.skillId === 'rec_pull_llm_model');
    if (!task && !todoList.some(t => t.skillId === 'rec_pull_llm_model')) {
        addUILog('🟡 Ollama 已就緒，自動加入模型下載任務', 'info');
        const res = await api('/api/todo', {
            method: 'POST',
            body: { title: recModel.title, description: recModel.description, category: recModel.category, skillId: recModel.id }
        });
        if (res.success) {
            todoList = res.todoList;
            renderTodoList();
            task = res.task || todoList.find(t => t.skillId === 'rec_pull_llm_model');
        }
    }

    if (task && task.status === 'pending') {
        const isRunning = todoList.some(t => t.status === 'running');
        if (!isRunning) {
            appendChatBubble('ai', '🟡 Ollama 已就緒！正自動為您下載 qwen3.5 語言模型，模型約 1GB 請稍候...');
            addUILog(`▶ 自動執行：${task.title}`, 'info');
            executeTask(task.id);
        }
    }
    window._modelBootstrapping = false;
}

async function checkLLMStatus() {
    try {
        const data = await api('/api/llm/status');
        updateLLMIndicator(data);

        // 如果推薦清單還沒載入，就先不進行自動腳本，避免抓不到 Skill 資訊
        if (!recommendList || recommendList.length === 0) return;

        // 防止重複觸發：檢查是否有任務正在執行
        const isRunning = todoList.some(t => t.status === 'running');
        if (isRunning) return;

        if (!data.available) {
            // Case 1: Ollama 未安裝或未啟動 -> 只有在真的沒有時才 bootstrap
            await bootstrapOllama();
        } else if (!data.modelReady) {
            // Case 2: Ollama 好了，但模型沒好
            await bootstrapModel();
        } else {
            // Case 3: 全都好了 — 顯示初始訊息和徽章
            if (!window._llmWelcomed) {
                // 顯示初始訊息
                appendChatBubble('ai', '你好！我是你的 AI PC Agent，可以用口語直接告訴我你需要安裝什麼軟體或是調整系統設定喔！');
                appendChatBubble('ai', `🧠 AI 引擎就緒！模型 ${data.modelName || 'qwen3.5:0.8b'} 已載入，可以直接用中文告訴我你需要什麼 🚀`);
                addUILog(`🧠 Ollama ${data.modelName || 'qwen3.5:0.8b'} 就緒`, 'success');
                window._llmWelcomed = true;
            }

            // [優化] 若已經就緒，主動移除 list 中還在 pending 的 bootstrap 任務
            const bootstrapTasks = todoList.filter(t => t.status === 'pending' && (t.skillId === 'rec_install_ollama' || t.skillId === 'rec_pull_llm_model'));
            for (const t of bootstrapTasks) {
                 deleteTask(t.id);
            }
        }
    } catch (e) {
        console.error('[LLM Check Fail]', e);
        updateLLMIndicator({ available: false, modelReady: false });
    }
}

function updateLLMIndicator(status) {
    if (!llmDot || !llmLabel) return;

    window._installedStatus = window._installedStatus || {};
    let shouldRender = false;

    if (window._installedStatus['rec_install_ollama'] !== status.available) {
        window._installedStatus['rec_install_ollama'] = status.available;
        shouldRender = true;
    }
    if (window._installedStatus['rec_pull_llm_model'] !== status.modelReady) {
        window._installedStatus['rec_pull_llm_model'] = status.modelReady;
        shouldRender = true;
    }

    // 更新模型徽章
    const chatModelBadge = document.getElementById('chatModelBadge');
    if (chatModelBadge) {
        chatModelBadge.style.display = status.modelReady ? 'inline-block' : 'none';
        if (status.modelReady && status.modelName) {
            chatModelBadge.textContent = status.modelName;
            chatModelBadge.title = `當前模型: ${status.modelName} (點擊切換)`;
        }
    }

    if (status.available && status.modelReady) {
        llmDot.style.cssText = 'background:#4ec9b0;box-shadow:0 0 6px rgba(78,201,176,0.7)';
        llmLabel.textContent = 'AI 就緒';
        if (statusLLM) statusLLM.textContent = '🟢 AI 就緒';
    } else if (status.available) {
        llmDot.style.cssText = 'background:#dcdcaa;box-shadow:0 0 6px rgba(220,220,170,0.6)';
        llmLabel.textContent = '模型未就緒';
        if (statusLLM) statusLLM.textContent = '🟡 模型未就緒';
    } else {
        llmDot.style.cssText = 'background:#f44747;box-shadow:0 0 6px rgba(244,71,71,0.5)';
        llmLabel.textContent = 'AI 引擎未就緒';
        if (statusLLM) statusLLM.textContent = '🔴 AI 引擎未就緒';
    }

    if (shouldRender) {
        renderRecommendList();
    }
}

// ── Model Selection Logic ──────────────────────────────
async function toggleModelMenu() {
    let menu = document.querySelector('.model-menu');
    if (menu) {
        menu.remove();
        return;
    }

    const data = await api('/api/llm/models');
    if (!data.success) return;

    menu = document.createElement('div');
    menu.className = 'model-menu';
    
    // Header label
    const head = document.createElement('div');
    head.style.cssText = 'padding:8px 12px; font-size:10px; color:var(--text-muted); border-bottom:1px solid var(--border-subtle); background:var(--bg-sidebar);';
    head.textContent = '選擇語言模型 (ollama list)';
    menu.appendChild(head);

    data.models.forEach(m => {
        const item = document.createElement('div');
        item.className = `model-menu-item ${m.name === data.currentModel ? 'active' : ''}`;
        item.innerHTML = `<span>${m.name}</span> <span style="font-size:9px;opacity:0.6">${(m.size / 1024 / 1024 / 1024).toFixed(1)}GB</span>`;
        item.onclick = async () => {
            const res = await api('/api/llm/model', { method: 'POST', body: { modelName: m.name } });
            if (res.success) {
                addUILog(`🧠 模型已切換至: ${m.name}`, 'success');
                appendChatBubble('ai', `🧠 我現在切換到 **${m.name}** 囉！隨時可以開始對話。`);
                checkLLMStatus();
            }
            menu.remove();
        };
        menu.appendChild(item);
    });

    document.querySelector('.chat-history').appendChild(menu);

    // Click outside to close
    setTimeout(() => {
        const closer = (e) => {
            if (!menu.contains(e.target) && e.target.id !== 'chatModelBadge') {
                menu.remove();
                document.removeEventListener('click', closer);
            }
        };
        document.addEventListener('click', closer);
    }, 0);
}

// ════════════════════════════════════════════════════════
//  RENDER — RECOMMEND LIST (sidebar)
// ════════════════════════════════════════════════════════
function renderRecommendList() {
    sidebarBody.innerHTML = '';
    if (!recommendList.length) {
        sidebarBody.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:11px;">推薦清單載入中...</div>';
        return;
    }

    const filtered = recommendList.filter(item => {
        if (!recSearchQuery) return true;
        const searchStr = `${item.title} ${item.description} ${item.category}`.toLowerCase();
        return searchStr.includes(recSearchQuery);
    });

    recCount.textContent = filtered.length;
    window._installedStatus = window._installedStatus || {};

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:16px;color:var(--text-muted);font-size:11px;text-align:center;';
        empty.textContent = '找不到相符的項目 🔍';
        sidebarBody.appendChild(empty);
        return;
    }

    const pending = filtered.filter(item => !window._installedStatus[item.id]);
    const installed = filtered.filter(item => window._installedStatus[item.id]);

    // 1. Render Pending items by category
    const pendingGroups = {};
    pending.forEach(item => {
        const cat = item.category || '其他';
        if (!pendingGroups[cat]) pendingGroups[cat] = [];
        pendingGroups[cat].push(item);
    });

    Object.entries(pendingGroups).forEach(([cat, items]) => {
        const header = document.createElement('div');
        header.className = 'sidebar-section-header';
        header.style.cssText = 'padding:12px 10px 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);';
        header.textContent = cat;
        sidebarBody.appendChild(header);

        items.forEach(item => {
            sidebarBody.appendChild(createRecommendCard(item, false));
        });
    });

    // 2. Render Installed items at the absolute bottom
    if (installed.length > 0) {
        const header = document.createElement('div');
        header.className = 'sidebar-section-header';
        header.style.cssText = 'padding:20px 10px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent-green);opacity:0.8;';
        header.textContent = '── 已就緒 / 已安裝 ──';
        sidebarBody.appendChild(header);

        installed.forEach(item => {
            sidebarBody.appendChild(createRecommendCard(item, true));
        });
    }
}

function createRecommendCard(item, isInstalled) {
    const card = document.createElement('div');
    card.className = `recommend-card ${isInstalled ? 'installed' : ''}`;
    if (isInstalled) card.style.opacity = '0.5';

    card.innerHTML = `
        <div class="recommend-card-top">
          <div class="recommend-title">
              ${item.title}
              ${isInstalled ? '<span style="font-size:10px; color:#4ec9b0; margin-left:6px; font-weight:normal;">✅ 已安裝</span>' : ''}
          </div>
          ${!isInstalled ? `
              ${item.skillId ? `<div class="recommend-btn-group">
                <button class="btn-add-todo" title="加入清單">＋</button>
                <button class="btn-run-now" title="立即執行">▶</button>
              </div>` : `<div class="recommend-btn-group">
                <button class="btn-add-todo" title="加入清單">＋</button>
              </div>`}
          ` : ''}
        </div>
        <div class="recommend-desc">${item.description || ''}</div>
        <div class="recommend-meta">
          <span class="recommend-category">${item.category}</span>
          ${item.skillId && !isInstalled ? '<span class="recommend-skill-badge">⚡ 可自動執行 (SOP)</span>' : ''}
        </div>
    `;

    if (!isInstalled) {
        card.querySelector('.btn-add-todo')?.addEventListener('click', (e) => {
            e.stopPropagation();
            addRecommendToTodo(item);
        });
        card.querySelector('.btn-run-now')?.addEventListener('click', (e) => {
            e.stopPropagation();
            addAndExecuteRecommend(item);
        });
    }
    return card;
}

// ════════════════════════════════════════════════════════
//  RENDER — TODO LIST (center top)
// ════════════════════════════════════════════════════════
const STATUS_LABELS = {
    pending: '待執行', running: '執行中',
    success: '已完成', skipped: '已跳過', failed: '失敗',
};

function renderTodoList() {
    const pending = todoList.filter(t => t.status !== 'success' && t.status !== 'failed' && t.status !== 'skipped');
    const done = todoList.filter(t => t.status === 'success' || t.status === 'failed' || t.status === 'skipped');

    todoCount.textContent = todoList.length;
    if (statusTasks) statusTasks.textContent = `${todoList.length} 個任務`;

    if (!todoList.length) {
        todoContainer.innerHTML = '';
        todoEmpty?.classList.remove('hidden');
        return;
    }
    todoEmpty?.classList.add('hidden');

    todoContainer.innerHTML = '';
    [...pending, ...done].forEach(task => {
        todoContainer.appendChild(renderTaskCard(task));
    });
}

function renderTaskCard(task) {
    const card = document.createElement('div');
    card.className = 'task-card';
    card.dataset.id = task.id;
    card.dataset.status = task.status;

    const progress = task.status === 'success' ? 100 : (task.status === 'failed' ? 100 : (task.progress || 0));
    const progressBarClass = task.status === 'success' ? 'success' : (task.status === 'failed' ? 'failed' : '');
    const spinner = task.status === 'running' ? '<span class="spinner"></span>' : '';

    card.innerHTML = `
        <div class="task-card-top">
          <span class="task-title">${task.title}</span>
          <div class="task-actions">
            ${spinner}
            ${task.skillId && task.status === 'pending' ? `<button class="btn-task run" title="執行" data-id="${task.id}">▶</button>` : ''}
            ${task.status !== 'running' ? `<button class="btn-task delete" title="刪除" data-id="${task.id}">✕</button>` : ''}
          </div>
        </div>
        <div class="task-meta">
          <span class="task-category">${task.category || '一般'}</span>
          <span class="task-status" data-status="${task.status}">${STATUS_LABELS[task.status] || task.status}</span>
        </div>
        <div class="task-progress">
          <div class="task-progress-bar ${progressBarClass}" style="width:${progress}%"></div>
        </div>
    `;

    card.querySelector('.run')?.addEventListener('click', (e) => { e.stopPropagation(); executeTask(task.id); });
    card.querySelector('.delete')?.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task.id); });
    card.addEventListener('click', () => showTaskModal(task));

    return card;
}

// ════════════════════════════════════════════════════════
//  TASK ACTIONS
// ════════════════════════════════════════════════════════
async function addRecommendToTodo(item) {
    const data = await api('/api/todo', {
        method: 'POST',
        body: { title: item.title, description: item.description, category: item.category, skillId: item.id },
    });
    if (data.success) { todoList = data.todoList; renderTodoList(); addUILog(`＋ 已加入：${item.title}`, 'info'); }
}

async function addAndExecuteRecommend(item) {
    const data = await api('/api/todo', {
        method: 'POST',
        body: { title: item.title, description: item.description, category: item.category, skillId: item.id },
    });
    if (data.success) {
        todoList = data.todoList;
        renderTodoList();
        const newTask = data.task || data.todoList[data.todoList.length - 1];
        if (newTask?.id) {
            addUILog(`▶ 開始執行：${item.title}`, 'info');
            appendChatBubble('ai', `🚀 正在啟動「${item.title}」...`);
            expandLog();
            await executeTask(newTask.id);
        }
    }
}

async function executeTask(taskId) {
    const task = todoList.find(t => t.id === taskId);
    if (task) appendChatBubble('ai', `🚀「${task.title}」已開始執行！請查看下方進度與日誌...`);
    expandLog();
    await api(`/api/execute/${taskId}`, { method: 'POST' });
}

async function deleteTask(taskId) {
    const data = await api(`/api/todo/${taskId}`, { method: 'DELETE' });
    if (data.success) { todoList = data.todoList; renderTodoList(); }
}

// ════════════════════════════════════════════════════════
//  CHAT
// ════════════════════════════════════════════════════════
async function sendChat() {
    const msg = chatInput.value.trim();
    if (!msg) return;
    chatInput.value = '';
    chatInput.style.height = '';

    appendChatBubble('user', msg);
    const thinkId = appendThinking();

    const data = await api('/api/chat', { method: 'POST', body: { message: msg } });

    removeThinking(thinkId);
    if (data.success) {
        appendChatBubble('ai', data.reply);
        if (data.task) {
            await loadTodo();
            // 如果清單被清空了，不需要展開 log
            if (todoList.length > 0) expandLog();
        }
        if (data.executeTaskId && !data.executeTaskId.includes('CLEAR') && !data.executeTaskId.includes('DELETE')) {
            // 自動執行指定的任務
            executeTask(data.executeTaskId);
        }
    } else {
        appendChatBubble('ai', '抱歉，出現了點問題，請再試一次。');
    }
}

function appendChatBubble(role, text) {
    const isAI = role === 'ai';
    const div = document.createElement('div');
    div.className = `message ${isAI ? 'ai-message' : 'user-message'}`;
    div.innerHTML = `
        <div class="msg-avatar">${isAI ? '🤖' : '👤'}</div>
        <div class="msg-bubble">${escapeHtml(text)}</div>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
}

function appendThinking() {
    const id = 'thinking-' + Date.now();
    const div = document.createElement('div');
    div.className = 'message ai-message';
    div.id = id;
    div.innerHTML = `<div class="msg-avatar">🤖</div><div class="msg-bubble thinking-dots">思考中</div>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return id;
}
function removeThinking(id) { document.getElementById(id)?.remove(); }

function clearChatMessages() {
    if (confirm('確定要清除所有對話紀錄嗎？')) {
        chatMessages.innerHTML = '';
        addUILog('💬 對話紀錄已清除', 'info');
    }
}

// ════════════════════════════════════════════════════════
//  LOG PANEL
// ════════════════════════════════════════════════════════
function addLogEntry(logItem) {
    const cleanMsg = stripAnsi(logItem.message);
    const emptyEl = logEntries.querySelector('.log-empty');
    if (emptyEl) emptyEl.remove();

    // 檢查是否為進度條或是相似內容的重複更新 (Progress Update)
    // 判斷邏輯：包含百分比、或是包含一連串的 # 字符、或是有明確的 progress 標記
    // 加入 common 關鍵字如 pulling, downloading, extracting 等
    const isProgress = /%|#{3,}|pulling|downloading|extracting|verifying/i.test(cleanMsg);
    const lastEntry = logEntries.lastElementChild;

    if (isProgress && lastEntry) {
        // 如果內容相似度高（例如都是下載進度）或最後一筆也是進度條，則原地更新
        const lastMsg = stripAnsi(lastEntry.querySelector('span:last-child')?.textContent || '');
        const isLastProgress = /%|#{3,}|pulling|downloading|extracting|verifying/i.test(lastMsg);

        if (isLastProgress) {
            const time = logItem.timestamp ? new Date(logItem.timestamp).toLocaleTimeString('zh-TW', { hour12: false }) : '';
            lastEntry.className = `log-entry ${logItem.level || 'info'}`;
            lastEntry.innerHTML = `<span class="log-time">${time}</span><span>${escapeHtml(cleanMsg)}</span>`;
            logEntries.scrollTop = logEntries.scrollHeight;
            return;
        }
    }

    // 避免非進度條的完全相同訊息重複出現（舊邏輯保留並優化）
    if (!isProgress && lastEntry && stripAnsi(lastEntry.querySelector('span:last-child')?.textContent) === cleanMsg) {
        return;
    }

    const level = logItem.level || 'info';
    const time = logItem.timestamp ? new Date(logItem.timestamp).toLocaleTimeString('zh-TW', { hour12: false }) : '';
    const el = document.createElement('div');
    el.className = `log-entry ${level}`;
    el.innerHTML = `<span class="log-time">${time}</span><span>${escapeHtml(cleanMsg)}</span>`;
    logEntries.appendChild(el);
    logEntries.scrollTop = logEntries.scrollHeight;
}

function addUILog(msg, level = 'info') {
    addLogEntry({ message: msg, level, timestamp: new Date().toISOString() });
}

function expandLog() {
    if (isLogCollapsed) {
        isLogCollapsed = false;
        logPanel.classList.remove('collapsed');
        if (btnToggleLog) btnToggleLog.textContent = '收起 ▼';
    }
}

// ════════════════════════════════════════════════════════
//  TASK MODAL
// ════════════════════════════════════════════════════════
function showTaskModal(task) {
    modalTitle.textContent = task.title;
    modalBody.innerHTML = `
        <div class="task-detail-row">
          <span class="task-detail-label">狀態</span>
          <span class="task-detail-value task-status" data-status="${task.status}">${STATUS_LABELS[task.status] || task.status}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">分類</span>
          <span class="task-detail-value">${task.category || '—'}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">SOP ID</span>
          <span class="task-detail-value" style="font-family:var(--font-mono);font-size:11px">${task.skillId || '（無）'}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">建立時間</span>
          <span class="task-detail-value">${task.createdAt ? new Date(task.createdAt).toLocaleString('zh-TW') : '—'}</span>
        </div>
        ${task.logs?.length ? `
          <div style="margin-top:10px;font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.06em;">執行記錄</div>
          <div class="task-log-list">
            ${task.logs.map(l => `<div class="task-log-item log-entry ${l.type || 'info'}" style="font-family:var(--font-mono);font-size:10px;padding:2px 6px">${escapeHtml(l.message || l)}</div>`).join('')}
          </div>` : ''}
    `;
    modalOverlay.classList.add('visible');
}

// ════════════════════════════════════════════════════════
//  THEME
// ════════════════════════════════════════════════════════
function applyTheme(theme) {
    if (theme === 'light') document.documentElement.classList.add('theme-light');
    else document.documentElement.classList.remove('theme-light');
    localStorage.setItem('theme', theme);
}

function cycleTheme() {
    const current = localStorage.getItem('theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ════════════════════════════════════════════════════════
//  EXPORT / IMPORT
// ════════════════════════════════════════════════════════
function exportTasks() {
    const json = JSON.stringify(todoList, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aipc-tasks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importTasks(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const tasks = JSON.parse(e.target.result);
            const data = await api('/api/import', { method: 'POST', body: { tasks } });
            if (data.success) { todoList = data.todoList; renderTodoList(); addUILog('✅ 任務清單已匯入', 'success'); }
        } catch { addUILog('❌ 匯入失敗：JSON 格式錯誤', 'error'); }
    };
    reader.readAsText(file);
}

// ════════════════════════════════════════════════════════
//  SPEECH RECOGNITION
// ════════════════════════════════════════════════════════
function setupSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    recognition = new SR();
    recognition.lang = 'zh-TW';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (e) => {
        chatInput.value = e.results[0][0].transcript;
        stopRecording();
    };
    recognition.onend = () => stopRecording();
    recognition.onerror = () => stopRecording();
}

function startRecording() {
    if (!recognition) return;
    isRecording = true;
    btnMic?.classList.add('recording');
    recognition.start();
}
function stopRecording() {
    isRecording = false;
    btnMic?.classList.remove('recording');
    try { recognition?.stop(); } catch { }
}

// ════════════════════════════════════════════════════════
//  RESIZABLE PANELS (VS Code style)
// ════════════════════════════════════════════════════════
function setupResizers() {
    setupHorizontalResizer(
        'sidebarResizer',
        () => sidebar.offsetWidth,
        (w) => { sidebar.style.width = w + 'px'; saveLayout(); },
        120, 500
    );

    // Chat column resizer (right edge): insert a resizer before chat-col
    const chatResizer = document.createElement('div');
    chatResizer.id = 'chatResizer';
    chatResizer.className = 'resize-handle';
    chatCol.parentNode.insertBefore(chatResizer, chatCol);

    setupHorizontalResizer(
        'chatResizer',
        () => chatCol.offsetWidth,
        (w) => { chatCol.style.width = w + 'px'; saveLayout(); },
        220, 600,
        true // inverted (drag left = wider)
    );

    // Log panel vertical resizer
    const logResizer = document.createElement('div');
    logResizer.id = 'logResizer';
    logResizer.style.cssText = 'height:4px;cursor:row-resize;background:transparent;flex-shrink:0;transition:background 150ms ease;';
    logResizer.addEventListener('mouseenter', () => { logResizer.style.background = 'var(--accent-indigo)'; });
    logResizer.addEventListener('mouseleave', () => { logResizer.style.background = 'transparent'; });
    logPanel.parentNode.insertBefore(logResizer, logPanel);

    setupVerticalResizer(
        logResizer,
        () => logPanel.offsetHeight,
        (h) => { logPanel.style.minHeight = h + 'px'; logPanel.style.maxHeight = h + 'px'; saveLayout(); },
        60, 400,
        true // dragging up = taller
    );
}

function setupHorizontalResizer(id, getSize, setSize, min, max, inverted = false) {
    const el = document.getElementById(id);
    if (!el) return;
    let startX, startW;

    el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = getSize();
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMove = (e) => {
            const dx = inverted ? startX - e.clientX : e.clientX - startX;
            const newW = Math.max(min, Math.min(max, startW + dx));
            setSize(newW);
        };
        const onUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

function setupVerticalResizer(el, getSize, setSize, min, max, inverted = false) {
    let startY, startH;

    el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        startY = e.clientY;
        startH = getSize();
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        const onMove = (e) => {
            const dy = inverted ? startY - e.clientY : e.clientY - startY;
            const newH = Math.max(min, Math.min(max, startH + dy));
            setSize(newH);
        };
        const onUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

// ── Layout persistence ─────────────────────────────────
function saveLayout() {
    localStorage.setItem('layout', JSON.stringify({
        sidebarW: sidebar.offsetWidth,
        chatW: chatCol.offsetWidth,
        logH: logPanel.offsetHeight,
    }));
}

function restoreLayout() {
    try {
        const saved = JSON.parse(localStorage.getItem('layout') || '{}');
        if (saved.sidebarW) sidebar.style.width = saved.sidebarW + 'px';
        if (saved.chatW) chatCol.style.width = saved.chatW + 'px';
        if (saved.logH) {
            logPanel.style.minHeight = saved.logH + 'px';
            logPanel.style.maxHeight = saved.logH + 'px';
        }
    } catch { }
}

// ════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ════════════════════════════════════════════════════════
function setupEventListeners() {
    // Send chat
    btnSend?.addEventListener('click', sendChat);
    chatInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    // Auto-resize textarea
    chatInput?.addEventListener('input', () => {
        chatInput.style.height = '';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    // Mic
    btnMic?.addEventListener('click', () => isRecording ? stopRecording() : startRecording());

    // Clear Chat
    btnClearChat?.addEventListener('click', clearChatMessages);

    // Sidebar Search
    recSearchInput?.addEventListener('input', (e) => {
        recSearchQuery = e.target.value.trim().toLowerCase();
        renderRecommendList();
    });

    // Theme
    btnTheme?.addEventListener('click', cycleTheme);

    // Model selection
    document.getElementById('chatModelBadge')?.addEventListener('click', toggleModelMenu);

    // Export / Import
    btnExport?.addEventListener('click', exportTasks);
    btnImport?.addEventListener('click', () => importFileInput?.click());
    importFileInput?.addEventListener('change', (e) => { if (e.target.files[0]) importTasks(e.target.files[0]); });

    // Toggle log
    btnToggleLog?.addEventListener('click', () => {
        isLogCollapsed = !isLogCollapsed;
        logPanel.classList.toggle('collapsed', isLogCollapsed);
        btnToggleLog.textContent = isLogCollapsed ? '展開 ▲' : '收起 ▼';
    });

    // Modal close
    btnCloseModal?.addEventListener('click', () => modalOverlay.classList.remove('visible'));
    modalOverlay?.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('visible'); });

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') modalOverlay.classList.remove('visible');
    });
}

// ════════════════════════════════════════════════════════
//  UTIL
// ════════════════════════════════════════════════════════
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/\n/g, '<br>');
}

function stripAnsi(str) {
    if (!str) return '';
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~]*)*|[a-zA-Z\d])/g, '');
}

// ── Start ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
