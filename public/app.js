/**
 * AI PC Agent — Frontend Application
 * 
 * 處理 UI 互動、API 呼叫、狀態更新
 */

const API = '';

// ── State ─────────────────────────────────────────────────────────
let todoList = [];
let recommendList = [];
let logExpanded = false;
let pollingInterval = null;

// ── DOM Elements ──────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const todoContainer = $('#todoListContainer');
const todoEmpty = $('#todoEmpty');
const todoCount = $('#todoCount');
const recContainer = $('#recommendListContainer');
const recCount = $('#recCount');
const chatInput = $('#chatInput');
const chatResponse = $('#chatResponse');
const btnSend = $('#btnSend');
const btnMic = $('#btnMic');
const btnTheme = $('#btnTheme');
const btnLang = $('#btnLang');
const logPanel = $('#logPanel');
const logToggle = $('#logToggle');
const logEntries = $('#logEntries');
const btnToggleLog = $('#btnToggleLog');
const btnExport = $('#btnExport');
const btnImport = $('#btnImport');
const importFileInput = $('#importFileInput');
const modalOverlay = $('#modalOverlay');
const modalTitle = $('#modalTitle');
const modalBody = $('#modalBody');
const btnCloseModal = $('#btnCloseModal');

// ── API Helpers ───────────────────────────────────────────────────

async function api(endpoint, options = {}) {
    const res = await fetch(`${API}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    return res.json();
}

// ── Init ──────────────────────────────────────────────────────────

async function init() {
    await Promise.all([loadTodo(), loadRecommend()]);
    setupEventListeners();
    startPolling();
}

async function loadTodo() {
    const data = await api('/api/todo');
    if (data.success) {
        todoList = data.todoList;
        renderTodoList();
    }
}

async function loadRecommend() {
    const data = await api('/api/recommend');
    if (data.success) {
        recommendList = data.recommendList;
        renderRecommendList();
    }
}

// ── Rendering ─────────────────────────────────────────────────────

const STATUS_LABELS = {
    pending: '待處理',
    running: '執行中',
    success: '已完成',
    skipped: '已跳過',
    failed: '失敗',
};

function renderTodoList() {
    todoCount.textContent = todoList.length;

    if (todoList.length === 0) {
        todoContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✨</div>
        <p>還沒有任務</p>
        <p class="empty-hint">從下方輸入需求，或從推薦清單加入</p>
      </div>`;
        return;
    }

    todoContainer.innerHTML = todoList
        .map(
            (task) => `
    <div class="task-card" data-status="${task.status}" data-id="${task.id}" onclick="showTaskDetail('${task.id}')">
      <div class="task-card-top">
        <span class="task-title">${escHtml(task.title)}</span>
        <div class="task-actions">
          ${task.status === 'pending' && task.skillId
                    ? `<button class="btn-task run" title="執行" onclick="event.stopPropagation(); executeTask('${task.id}')">▶</button>`
                    : ''
                }
          ${task.status === 'running'
                    ? `<span class="spinner"></span>`
                    : ''
                }
          <button class="btn-task delete" title="移除" onclick="event.stopPropagation(); deleteTask('${task.id}')">✕</button>
        </div>
      </div>
      ${task.description ? `<div class="recommend-desc">${escHtml(task.description)}</div>` : ''}
      <div class="task-meta">
        <span class="task-category">${escHtml(task.category || '一般')}</span>
        <span class="task-status" data-status="${task.status}">${STATUS_LABELS[task.status] || task.status}</span>
      </div>
      ${task.status === 'running' || task.progress > 0
                    ? `<div class="task-progress">
               <div class="task-progress-bar ${task.status === 'success' ? 'success' : task.status === 'failed' ? 'failed' : ''}" style="width: ${task.progress}%"></div>
             </div>`
                    : ''
                }
    </div>`
        )
        .join('');
}

function renderRecommendList() {
    recCount.textContent = recommendList.length;

    recContainer.innerHTML = recommendList
        .map(
            (item) => `
    <div class="recommend-card" onclick="addRecommendToTodo('${item.id}')">
      <div class="recommend-card-top">
        <span class="recommend-title">${escHtml(item.title)}</span>
        <button class="btn-add-todo" onclick="event.stopPropagation(); addRecommendToTodo('${item.id}')">＋ 加入</button>
      </div>
      <div class="recommend-desc">${escHtml(item.description)}</div>
      <div class="recommend-meta">
        <span class="recommend-category">${escHtml(item.category)}</span>
      </div>
    </div>`
        )
        .join('');
}

function renderLogEntries(logs) {
    if (!logs || logs.length === 0) {
        logEntries.innerHTML = '<div class="log-empty">等待任務執行...</div>';
        return;
    }

    logEntries.innerHTML = logs
        .map(
            (log) => `
    <div class="log-entry ${log.level}">
      <span class="log-time">${formatTime(log.timestamp)}</span>
      <span>${log.phase ? `[${log.phase}]` : ''} ${escHtml(log.message)}</span>
    </div>`
        )
        .join('');

    // Auto-scroll to bottom
    const logBody = $('#logBody');
    logBody.scrollTop = logBody.scrollHeight;
}

// ── Actions ───────────────────────────────────────────────────────

async function sendChat() {
    const message = chatInput.value.trim();
    if (!message) return;

    chatInput.value = '';
    showChatResponse('🤔 思考中...');

    const data = await api('/api/chat', {
        method: 'POST',
        body: { message },
    });

    if (data.success) {
        showChatResponse(data.reply);
        await loadTodo(); // Refresh todo list
    } else {
        showChatResponse(`❌ ${data.error}`);
    }
}

function showChatResponse(text) {
    chatResponse.innerHTML = `<div class="chat-response-text">${escHtml(text)}</div>`;
    chatResponse.classList.add('visible');

    // Auto-hide after 8 seconds
    clearTimeout(chatResponse._timer);
    chatResponse._timer = setTimeout(() => {
        chatResponse.classList.remove('visible');
    }, 8000);
}

async function executeTask(taskId) {
    const data = await api(`/api/execute/${taskId}`, {
        method: 'POST',
        body: { dryRun: false },
    });

    if (data.success) {
        showChatResponse('🚀 任務已開始執行，請查看進度條...');
        // Expand log panel
        logPanel.classList.add('expanded');
        logExpanded = true;
        btnToggleLog.textContent = '收起 ▲';
    } else {
        showChatResponse(`❌ ${data.error}`);
    }

    await loadTodo();
}

async function deleteTask(taskId) {
    await api(`/api/todo/${taskId}`, { method: 'DELETE' });
    await loadTodo();
}

async function addRecommendToTodo(recId) {
    const item = recommendList.find((r) => r.id === recId);
    if (!item) return;

    await api('/api/todo', {
        method: 'POST',
        body: {
            title: item.title,
            description: item.description,
            category: item.category,
        },
    });

    showChatResponse(`已加入「${item.title}」到工作清單 ✅`);
    await loadTodo();
}

function showTaskDetail(taskId) {
    const task = todoList.find((t) => t.id === taskId);
    if (!task) return;

    modalTitle.textContent = task.title;

    let logsHtml = '';
    if (task.logs && task.logs.length > 0) {
        logsHtml = `
      <h4 style="margin-top:16px; font-size:13px; color:var(--text-secondary)">執行日誌</h4>
      <ul class="task-log-list">
        ${task.logs
                .map(
                    (log) =>
                        `<li class="task-log-item log-entry ${log.level}">${formatTime(log.timestamp)} ${log.phase ? `[${log.phase}]` : ''} ${escHtml(log.message)}</li>`
                )
                .join('')}
      </ul>`;
    }

    modalBody.innerHTML = `
    <div class="task-detail-row"><span class="task-detail-label">任務 ID</span><span class="task-detail-value">${task.id}</span></div>
    <div class="task-detail-row"><span class="task-detail-label">狀態</span><span class="task-detail-value"><span class="task-status" data-status="${task.status}">${STATUS_LABELS[task.status]}</span></span></div>
    <div class="task-detail-row"><span class="task-detail-label">分類</span><span class="task-detail-value">${escHtml(task.category || '-')}</span></div>
    <div class="task-detail-row"><span class="task-detail-label">Skill ID</span><span class="task-detail-value">${task.skillId || '(無)'}</span></div>
    <div class="task-detail-row"><span class="task-detail-label">建立時間</span><span class="task-detail-value">${task.createdAt || '-'}</span></div>
    <div class="task-detail-row"><span class="task-detail-label">完成時間</span><span class="task-detail-value">${task.completedAt || '-'}</span></div>
    ${task.description ? `<div class="task-detail-row"><span class="task-detail-label">說明</span><span class="task-detail-value">${escHtml(task.description)}</span></div>` : ''}
    ${logsHtml}
  `;

    modalOverlay.classList.add('visible');
}

function closeModal() {
    modalOverlay.classList.remove('visible');
}

// ── Export / Import ───────────────────────────────────────────────

async function exportTasks() {
    const data = await api('/api/todo/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aipc-agent-tasks-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showChatResponse('📥 任務清單已匯出！');
}

async function importTasks(file) {
    const text = await file.text();
    try {
        const data = JSON.parse(text);
        const tasks = data.tasks || data.todoList || data;
        if (!Array.isArray(tasks)) throw new Error('格式錯誤');

        const result = await api('/api/todo/import', {
            method: 'POST',
            body: { tasks },
        });

        if (result.success) {
            showChatResponse(`📤 已匯入 ${result.count} 個任務！`);
            await loadTodo();
        } else {
            showChatResponse(`❌ 匯入失敗: ${result.error}`);
        }
    } catch (err) {
        showChatResponse(`❌ 匯入失敗: ${err.message}`);
    }
}

// ── Polling for running tasks ─────────────────────────────────────

function startPolling() {
    pollingInterval = setInterval(async () => {
        const hasRunning = todoList.some((t) => t.status === 'running');
        if (hasRunning) {
            await loadTodo();

            // Update log panel with running task logs
            const running = todoList.find((t) => t.status === 'running');
            if (running && running.logs) {
                renderLogEntries(running.logs);
            }

            // Check if just finished
            const justFinished = todoList.find(
                (t) => (t.status === 'success' || t.status === 'failed' || t.status === 'skipped') && t.logs && t.logs.length > 0
            );
            if (justFinished && !todoList.some((t) => t.status === 'running')) {
                renderLogEntries(justFinished.logs);
            }
        }
    }, 1500);
}

// ── Event Listeners ───────────────────────────────────────────────

let currentTheme = 'system';
const themes = ['dark', 'light', 'system'];

function addUILog(message, level = 'ui') {
    const emptyMsg = logEntries.querySelector('.log-empty');
    if (emptyMsg) emptyMsg.remove();

    const div = document.createElement('div');
    div.className = `log-entry ${level}`;
    div.innerHTML = `
      <span class="log-time">${formatTime(new Date().toISOString())}</span>
      <span>[System] ${escHtml(message)}</span>
    `;
    logEntries.appendChild(div);

    const logBody = $('#logBody');
    logBody.scrollTop = logBody.scrollHeight;

    if (!logExpanded) {
        logExpanded = true;
        logPanel.classList.add('expanded');
        btnToggleLog.textContent = '收起 ▲';
    }
}

function toggleTheme() {
    const currentIdx = themes.indexOf(currentTheme);
    currentTheme = themes[(currentIdx + 1) % themes.length];

    if (currentTheme === 'light') {
        document.documentElement.classList.add('theme-light');
    } else if (currentTheme === 'dark') {
        document.documentElement.classList.remove('theme-light');
    } else {
        // system
        const isSystemLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
        if (isSystemLight) {
            document.documentElement.classList.add('theme-light');
        } else {
            document.documentElement.classList.remove('theme-light');
        }
    }

    addUILog(`🌗 主題切換為：${currentTheme}`);
}

// 監聽系統主題變化
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (currentTheme === 'system') {
        document.documentElement.classList.toggle('theme-light', e.matches);
    }
});

let SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;

function toggleSpeech() {
    if (!SpeechRecognition) {
        showChatResponse('❌ 目前環境不支援語音輸入功能。');
        return;
    }

    if (isRecording) {
        recognition.stop();
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.interimResults = false;

    recognition.onstart = () => {
        isRecording = true;
        btnMic.classList.add('recording');
        chatInput.placeholder = '正在聆聽...';
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        chatInput.value = transcript;
    };

    recognition.onerror = (event) => {
        btnMic.classList.remove('recording');
        chatInput.placeholder = '告訴我你需要什麼... 例如「幫我加裝日文語系」';
        isRecording = false;
        showChatResponse(`❌ 語音輸入錯誤: ${event.error}`);
    };

    recognition.onend = () => {
        btnMic.classList.remove('recording');
        chatInput.placeholder = '告訴我你需要什麼... 例如「幫我加裝日文語系」';
        isRecording = false;
    };

    recognition.start();
}

function setupEventListeners() {
    btnSend.addEventListener('click', sendChat);
    btnMic.addEventListener('click', toggleSpeech);
    btnTheme.addEventListener('click', toggleTheme);
    btnLang.addEventListener('click', () => {
        addUILog('🌐 語言切換中：目前鎖定為繁體中文');
    });

    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChat();
        }
    });

    logToggle.addEventListener('click', () => {
        logExpanded = !logExpanded;
        logPanel.classList.toggle('expanded', logExpanded);
        btnToggleLog.textContent = logExpanded ? '收起 ▲' : '展開 ▼';
    });

    btnExport.addEventListener('click', exportTasks);

    btnImport.addEventListener('click', () => importFileInput.click());

    importFileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            importTasks(e.target.files[0]);
            e.target.value = '';
        }
    });

    btnCloseModal.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
    });
}

// ── Utilities ─────────────────────────────────────────────────────

function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

// ── Boot ──────────────────────────────────────────────────────────
init();
