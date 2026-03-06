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

const API = '';

// ── State ─────────────────────────────────────────────────────────
let todoList = [];
let recommendList = [];
let pollingInterval = null;
let isLogCollapsed = false;
let isRecording = false;
let recognition = null;

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
    applyTheme(localStorage.getItem('theme') || 'dark');
    restoreLayout();
    setupResizers();
    setupEventListeners();
    setupSpeechRecognition();

    await Promise.all([loadTodo(), loadRecommend()]);
    startPolling();
    checkLLMStatus();
}

// ════════════════════════════════════════════════════════
//  DATA LOADING
// ════════════════════════════════════════════════════════
async function loadTodo() {
    const data = await api('/api/todo');
    if (data.success) { todoList = data.todoList; renderTodoList(); }
}

async function loadRecommend() {
    const data = await api('/api/recommend');
    if (data.success) { recommendList = data.recommendList; renderRecommendList(); }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
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
        const lastLog = data.logs[data.logs.length - 1];
        const lastEl = logEntries.lastElementChild;
        const lastElText = lastEl?.dataset.msg;
        if (lastLog.message !== lastElText) {
            data.logs.slice(-50).forEach(addLogEntry);
        }
    }
}

// ════════════════════════════════════════════════════════
//  LLM STATUS
// ════════════════════════════════════════════════════════
async function checkLLMStatus() {
    try {
        const data = await api('/api/llm/status');
        updateLLMIndicator(data);

        if (!data.available) {
            const hasTask = todoList.some(t => t.skillId === 'rec_install_ollama' && (t.status === 'pending' || t.status === 'running'));
            if (!hasTask) {
                appendChatBubble('ai', '🔴 未偵測到本地 AI 引擎（Ollama）。正在自動為您下載與安裝...');
                addUILog('🔴 Ollama 尚未安裝，自動觸發安裝流程');
                const rec = recommendList.find(r => r.id === 'rec_install_ollama');
                if (rec) addAndExecuteRecommend(rec);
            }
        } else if (!data.modelReady) {
            const hasTask = todoList.some(t => t.skillId === 'rec_pull_llm_model' && (t.status === 'pending' || t.status === 'running'));
            if (!hasTask) {
                appendChatBubble('ai', '🟡 Ollama 已就緒！正在自動為您下載輕量語言模型，請稍候...');
                addUILog('🟡 模型尚未準備好，自動觸發下載流程');
                const rec = recommendList.find(r => r.id === 'rec_pull_llm_model');
                if (rec) addAndExecuteRecommend(rec);
            }
        } else {
            // Already ready, only show if it was just installed/ready this session
            if (!window._llmWelcomed) {
                appendChatBubble('ai', '🧠 AI 引擎就緒！模型 qwen3.5:0.8b 已載入，可以直接用中文告訴我你需要什麼 🚀');
                addUILog('🧠 Ollama qwen3.5:0.8b 就緒', 'success');
                window._llmWelcomed = true;
            }
        }
    } catch {
        updateLLMIndicator({ available: false, modelReady: false });
    }
}

function updateLLMIndicator(status) {
    if (!llmDot || !llmLabel) return;
    if (status.available && status.modelReady) {
        llmDot.style.cssText = 'background:#4ec9b0;box-shadow:0 0 6px rgba(78,201,176,0.7)';
        llmLabel.textContent = 'AI 就緒';
        if (statusLLM) statusLLM.textContent = '🟢 AI 就緒';
    } else if (status.available) {
        llmDot.style.cssText = 'background:#dcdcaa;box-shadow:0 0 6px rgba(220,220,170,0.6)';
        llmLabel.textContent = '模型未就緒';
        if (statusLLM) statusLLM.textContent = '🟡 模型未下載';
    } else {
        llmDot.style.cssText = 'background:#f44747;box-shadow:0 0 6px rgba(244,71,71,0.5)';
        llmLabel.textContent = '未安裝 AI';
        if (statusLLM) statusLLM.textContent = '🔴 AI 未就緒';
    }
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
    recCount.textContent = recommendList.length;

    // Group by category
    const groups = {};
    recommendList.forEach(item => {
        const cat = item.category || '其他';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(item);
    });

    Object.entries(groups).forEach(([cat, items]) => {
        // Category header
        const header = document.createElement('div');
        header.className = 'sidebar-section-header';
        header.style.cssText = 'padding:8px 10px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);';
        header.textContent = cat;
        sidebarBody.appendChild(header);

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'recommend-card';
            card.innerHTML = `
                <div class="recommend-card-top">
                  <div class="recommend-title">${item.title}</div>
                  ${item.skillId ? `<div class="recommend-btn-group">
                    <button class="btn-add-todo" title="加入清單">＋</button>
                    <button class="btn-run-now" title="立即執行">▶</button>
                  </div>` : `<div class="recommend-btn-group">
                    <button class="btn-add-todo" title="加入清單">＋</button>
                  </div>`}
                </div>
                <div class="recommend-desc">${item.description || ''}</div>
                <div class="recommend-meta">
                  <span class="recommend-category">${item.category}</span>
                  ${item.skillId ? '<span class="recommend-skill-badge">⚡ 可自動執行</span>' : ''}
                </div>
            `;
            // 加入
            card.querySelector('.btn-add-todo')?.addEventListener('click', (e) => {
                e.stopPropagation();
                addRecommendToTodo(item);
            });
            // 立即執行
            card.querySelector('.btn-run-now')?.addEventListener('click', (e) => {
                e.stopPropagation();
                addAndExecuteRecommend(item);
            });
            sidebarBody.appendChild(card);
        });
    });
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
        if (data.task) { await loadTodo(); expandLog(); }
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

// ════════════════════════════════════════════════════════
//  LOG PANEL
// ════════════════════════════════════════════════════════
function addLogEntry(logItem) {
    const existing = logEntries.querySelector(`[data-msg="${CSS.escape(logItem.message)}"]`);
    if (existing) return;

    const emptyEl = logEntries.querySelector('.log-empty');
    if (emptyEl) emptyEl.remove();

    const level = logItem.level || 'info';
    const time = logItem.timestamp ? new Date(logItem.timestamp).toLocaleTimeString('zh-TW', { hour12: false }) : '';
    const el = document.createElement('div');
    el.className = `log-entry ${level}`;
    el.dataset.msg = logItem.message;
    el.innerHTML = `<span class="log-time">${time}</span><span>${escapeHtml(logItem.message)}</span>`;
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
          <span class="task-detail-label">Skill ID</span>
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

    // Theme
    btnTheme?.addEventListener('click', cycleTheme);

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

// ── Start ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
