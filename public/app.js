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
let sopsList = [];
let pollingInterval = null;
let chatAbortController = null;
let isSidebarCollapsed = false;
let isChatCollapsed = false;
let isLogCollapsed = false; 
let isRecording = false;
let recognition = null;
let currentLogIndex = 0;
let recSearchQuery = '';
let hardwareInterval = null;
let knownTaskStatuses = new Map();
let activeSidebarTab = 'recommend';
let activeBottomTab = 'logs';
let isChalkboardAttachmentEnabled = localStorage.getItem('chat_attach_chalkboard') === 'true';
let expsEntries = [];
let expSearchQuery = '';
let expSopFilter = '';

// Tab State
let activeTab = 'chalkboard';
let openTabs = ['chalkboard', 'hardware']; // Initially chalkboard and hardware

// ── DOM ───────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Panel refs
const sidebar = $('#sidebar');
const recommendListContainer = $('#recommendListContainer');
const sopListContainer = $('#sopListContainer');
const sidebarTabs = $('#sidebarTabs');
const centerCol = document.querySelector('.center-col');
const chatCol = document.querySelector('.chat-col');
const logPanel = $('#logPanel');
const logBody = $('#logBody');
const expsBody = $('#expsBody');
const todoContainer = $('#todoListContainer');
const todoEmpty = $('#todoEmpty');
const todoCount = $('#todoCount');
const recCount = $('#recCount');
const sopCount = $('#sopCount');
const logEntries = $('#logEntries');
const expEntries = $('#expEntries');
const expSearchInput = $('#expSearchInput');
const expSopFilterSelect = $('#expSopFilter');
const btnExpsExport = $('#btnExpsExport');
const statusVersion = $('#statusVersion');
const chatMessages = $('#chatMessages');
const chatInput = $('#chatInput');
const btnSend = $('#btnSend');
const btnMic = $('#btnMic');
const btnChalkAttach = $('#btnChalkAttach');
const btnClearChat = $('#btnClearChat');
const recSearchInput = $('#recSearchInput');
const btnTheme = $('#btnTheme');
const btnExport = $('#btnExport');
const btnImport = $('#btnImport');
const importFileInput = $('#importFileInput');
const btnToggleSidebar = $('#btnToggleSidebar');
const btnTogglePanel = $('#btnTogglePanel');
const btnToggleChat = $('#btnToggleChat');
const btnToggleLog = $('#btnToggleLog');
const modalOverlay = $('#modalOverlay');
const modalTitle = $('#modalTitle');
const modalBody = $('#modalBody');
const btnCloseModal = $('#btnCloseModal');
const chalkboardCanvas = $('#chalkboardCanvas');
const chalkboardSurface = $('#chalkboardSurface');
const chalkboardHeading = $('.chalkboard-heading');
const chalkPlacementGuide = $('#chalkPlacementGuide');
const chalkSelectionBox = $('#chalkSelectionBox');
const chalkTextBox = $('#chalkTextBox');
const chalkTextBoxContent = $('#chalkTextBoxContent');
const chalkTools = $$('.chalk-tool');
const chalkModeButtons = $$('.chalk-mode');
const chalkSizeButtons = $$('.chalk-size');
const chalkSaveButton = $('#chalkSaveButton');
const chalkClearButton = $('#chalkClearButton');
const chalkUndoButton = $('#chalkUndoButton');
const chalkCopyButton = $('#chalkCopyButton');
const chalkCutButton = $('#chalkCutButton');
const chalkPasteButton = $('#chalkPasteButton');
const chalkUploadButton = $('#chalkUploadButton');
const chalkImageInput = $('#chalkImageInput');
const textToolOverlay = $('#textToolOverlay');
const btnCloseTextToolModal = $('#btnCloseTextToolModal');
const btnCancelTextTool = $('#btnCancelTextTool');
const btnApplyTextTool = $('#btnApplyTextTool');
const textToolContent = $('#textToolContent');
const textToolFontFamily = $('#textToolFontFamily');
const textToolFontStyle = $('#textToolFontStyle');
const textToolFontSize = $('#textToolFontSize');
const textToolColor = $('#textToolColor');
const textToolAlign = $('#textToolAlign');
const textToolBold = $('#textToolBold');
const textToolItalic = $('#textToolItalic');

// Provider Settings
const providerSettingsOverlay = $('#providerSettingsOverlay');
const btnCloseProviderModal = $('#btnCloseProviderModal');
const settingProvider = $('#settingProvider');
const settingBaseUrl = $('#settingBaseUrl');
const settingApiKey = $('#settingApiKey');
const authTypeGroup = $('#authTypeGroup');
const settingAuthType = $('#settingAuthType');
const apiKeyGroup = $('#apiKeyGroup');
const settingApiKey2 = $('#settingApiKey2');
const oauthFields = $('#oauthFields');
const settingTokenUrl = $('#settingTokenUrl');
const settingClientId = $('#settingClientId');
const settingClientSecret = $('#settingClientSecret');
const settingScope = $('#settingScope');
const settingAudience = $('#settingAudience');
const settingModelName = $('#settingModelName');
const settingModelSelect = $('#settingModelSelect');
const settingVisionModelName = $('#settingVisionModelName');
const settingVisionModelSelect = $('#settingVisionModelSelect');
const providerHelpTitle = $('#providerHelpTitle');
const providerHelpText = $('#providerHelpText');
const modelHelpText = $('#modelHelpText');
const visionModelHelpText = $('#visionModelHelpText');
const btnTestProviderSettings = $('#btnTestProviderSettings');
const btnSaveProviderSettings = $('#btnSaveProviderSettings');
const btnRefreshModels = $('#btnRefreshModels');

const PROVIDER_DEFAULTS = {
    'OpenAI': 'https://api.openai.com/v1',
    'Anthropic Claude': 'https://api.anthropic.com/v1',
    'Google Gemini': 'https://generativelanguage.googleapis.com/v1beta/openai',
    'Mistral': 'https://api.mistral.ai/v1',
    'Groq': 'https://api.groq.com/openai/v1',
    'xAI（Grok）': 'https://api.x.ai/v1',
    'NVIDIA NIM': 'https://integrate.api.nvidia.com/v1',
    'Together AI': 'https://api.together.xyz/v1',
    'OpenRouter': 'https://openrouter.ai/api/v1',
    'Kilo Gateway': 'https://api.kilo.ai/api/gateway/',
    'Synthetic（Anthropic‑compatible）': 'https://api.synthetic.new/anthropic',
    'Moonshot AI（Kimi）': 'https://api.moonshot.ai/v1',
    'Vercel AI Gateway': 'https://gateway.ai.vercel.com/v1/',
    'Cloudflare AI Gateway': 'https://gateway.ai.cloudflare.com/v1/',
    'Ollama Cloud': 'https://ollama.com',
    'Ollama': 'http://127.0.0.1:11434/v1',
    'vLLM': 'http://127.0.0.1:8000/v1',
    'SGLang': 'http://127.0.0.1:30000/v1',
    'LM Studio': 'http://127.0.0.1:1234/v1',
    'Customer Provider': 'http://127.0.0.1:11434/v1'
};
const llmDot = $('#llmDot');
const llmLabel = $('#llmLabel');
const llmStatus = $('#llmStatus');
const statusLLM = $('#statusLLM');
const statusTasks = $('#statusTasks');
const chatModelBadge = $('#chatModelBadge');

const chalkboardState = {
    tool: 'eraser',
    color: '#f5f1e8',
    size: 4,
    eraserSize: 28,
    drawing: false,
    hasInteracted: false,
    hintDrawn: false,
    ctx: null,
    resizeFrame: null,
    lastPoint: null,
    cssWidth: 0,
    cssHeight: 0,
    dragStart: null,
    dragSnapshot: null,
    pendingImage: null,
    pendingText: null,
    pendingTextRect: null,
    pendingTextSnapshot: null,
    pendingTextPreviewUrl: null,
    selectionRect: null,
    clipboardImage: null,
    hoverPoint: null,
    dragPresetEnd: null,
    pendingShapePreview: false,
    textManipulation: null,
    textToolSettings: {
        content: '',
        fontFamily: '"DFKai-SB", "BiauKai", serif',
        fontStyle: 'chalk',
        fontSize: 28,
        color: '#f5f1e8',
        align: 'left',
        bold: true,
        italic: false
    },
    textToolResolver: null,
    history: [],
    hasUserContent: false
};

const LOCAL_NOAUTH_PROVIDERS = ['Ollama', 'vLLM', 'SGLang', 'LM Studio'];
const API_KEY_ONLY_PROVIDERS = Object.keys(PROVIDER_DEFAULTS).filter(
    p => !LOCAL_NOAUTH_PROVIDERS.includes(p) && p !== 'Customer Provider'
);
const PROVIDER_HELP = {
    'OpenAI': {
        title: 'OpenAI',
        text: '填入 API Key 與模型名稱即可。OpenAI API 目前仍以 API Key 為主。',
        model: '例如 gpt-4.1、gpt-4o-mini。'
    },
    'Google Gemini': {
        title: 'Gemini',
        text: '這裡走 Google 官方 OpenAI compatibility 入口，通常需要 API Key 與 model 名稱。',
        model: '例如 gemini-2.5-flash。'
    },
    'Anthropic Claude': {
        title: 'Anthropic Native',
        text: 'Anthropic 走原生 API，不硬套 OpenAI-compatible。請填 API Key 與 Claude model。',
        model: '例如 claude-sonnet-4-20250514。'
    },
    'Ollama': {
        title: '本地 Ollama',
        text: '通常不需要 API Key。只要本機服務已啟動，就可以直接選模型。',
        model: '建議直接從模型清單選擇。'
    },
    'Customer Provider': {
        title: '自訂 Provider',
        text: '用於企業 Gateway 或自架服務。可選 API Key 或 OAuth 2.0 Client Credentials。',
        model: '請填服務端實際支援的模型名稱。'
    }
};

function getProviderAuthMode(provider) {
    if (LOCAL_NOAUTH_PROVIDERS.includes(provider)) return 'none_only';
    if (API_KEY_ONLY_PROVIDERS.includes(provider)) return 'api_key_only';
    return 'flex';
}

function getProviderDisplayLabel(provider) {
    return provider;
}

function updateProviderHelp(provider) {
    const help = PROVIDER_HELP[provider] || {
        title: getProviderDisplayLabel(provider),
        text: '請填入此 provider 需要的 API Key、連線網址與模型名稱。',
        model: '若服務支援模型清單，可直接刷新後選擇。'
    };

    if (providerHelpTitle) providerHelpTitle.textContent = help.title;
    if (providerHelpText) providerHelpText.textContent = help.text;
    if (modelHelpText) modelHelpText.textContent = help.model;
}

function getAuthPayload() {
    const authType = settingAuthType?.value || 'api_key';
    const authConfig = { type: authType };

    if (authType === 'api_key') {
        authConfig.apiKey = settingApiKey2?.value.trim() || '';
    } else if (authType === 'oauth_client_credentials') {
        authConfig.tokenUrl = settingTokenUrl?.value.trim() || '';
        authConfig.clientId = settingClientId?.value.trim() || '';
        authConfig.clientSecret = settingClientSecret?.value.trim() || '';
        authConfig.scope = settingScope?.value.trim() || '';
        authConfig.audience = settingAudience?.value.trim() || '';
    }

    return authConfig;
}

function updateAuthFields(authType = 'api_key') {
    if (apiKeyGroup) apiKeyGroup.style.display = authType === 'api_key' ? 'block' : 'none';
    if (oauthFields) oauthFields.style.display = authType === 'oauth_client_credentials' ? 'block' : 'none';
    if (settingApiKey) settingApiKey.closest('.form-group').style.display = 'none';
}

function syncProviderAuthUI(provider) {
    const mode = getProviderAuthMode(provider);
    updateProviderHelp(provider);

    if (mode === 'none_only') {
        if (authTypeGroup) authTypeGroup.style.display = 'none';
        if (settingAuthType) settingAuthType.value = 'none';
        updateAuthFields('none');
        return;
    }

    if (mode === 'api_key_only') {
        if (authTypeGroup) authTypeGroup.style.display = 'none';
        if (settingAuthType) settingAuthType.value = 'api_key';
        updateAuthFields('api_key');
        return;
    }

    if (authTypeGroup) authTypeGroup.style.display = 'block';
    updateAuthFields(settingAuthType?.value || 'api_key');
}

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
        if (err.name === 'AbortError') throw err; // 讓呼叫端處理中斷
        console.error('[API]', endpoint, err);
        return { success: false, error: err.message };
    }
}

/**
 * Debounce utility
 */
function debounce(fn, delay) {
    let timer = null;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function markChalkboardUserContent(hasContent = true) {
    chalkboardState.hasUserContent = Boolean(hasContent);
}

function buildChalkboardChatAttachment() {
    if (!chalkboardCanvas || !chalkboardState.ctx || !chalkboardState.hasUserContent) {
        return null;
    }

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = chalkboardCanvas.width;
    exportCanvas.height = chalkboardCanvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) return null;

    exportCtx.fillStyle = '#173b2f';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(chalkboardCanvas, 0, 0);

    return {
        mimeType: 'image/jpeg',
        dataUrl: exportCanvas.toDataURL('image/jpeg', 0.86),
        width: exportCanvas.width,
        height: exportCanvas.height
    };
}

function getNormalizedRect(start, end) {
    const left = Math.max(0, Math.min(start.x, end.x));
    const top = Math.max(0, Math.min(start.y, end.y));
    const right = Math.min(chalkboardState.cssWidth, Math.max(start.x, end.x));
    const bottom = Math.min(chalkboardState.cssHeight, Math.max(start.y, end.y));
    return {
        left,
        top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top)
    };
}

function getChalkSurfaceInset() {
    if (!chalkboardSurface) {
        return { left: 0, top: 0 };
    }

    const style = window.getComputedStyle(chalkboardSurface);
    return {
        left: parseFloat(style.borderLeftWidth || '0') || 0,
        top: parseFloat(style.borderTopWidth || '0') || 0
    };
}

function syncSelectionBox() {
    if (!chalkSelectionBox || !chalkboardState.selectionRect) {
        chalkSelectionBox?.classList.remove('visible');
        return;
    }

    const rect = chalkboardState.selectionRect;
    const inset = getChalkSurfaceInset();
    chalkSelectionBox.style.left = `${rect.left + inset.left}px`;
    chalkSelectionBox.style.top = `${rect.top + inset.top}px`;
    chalkSelectionBox.style.width = `${rect.width}px`;
    chalkSelectionBox.style.height = `${rect.height}px`;
    chalkSelectionBox.classList.add('visible');
}

function clearSelectionBox() {
    chalkboardState.selectionRect = null;
    chalkSelectionBox?.classList.remove('visible');
}

function getSelectionCanvas() {
    const rect = chalkboardState.selectionRect;
    if (!rect || !chalkboardCanvas) return null;

    const scaleX = chalkboardState.cssWidth > 0 ? (chalkboardCanvas.width / chalkboardState.cssWidth) : 1;
    const scaleY = chalkboardState.cssHeight > 0 ? (chalkboardCanvas.height / chalkboardState.cssHeight) : 1;
    const sourceX = Math.max(0, Math.round(rect.left * scaleX));
    const sourceY = Math.max(0, Math.round(rect.top * scaleY));
    const sourceWidth = Math.max(1, Math.round(rect.width * scaleX));
    const sourceHeight = Math.max(1, Math.round(rect.height * scaleY));
    const canvas = document.createElement('canvas');
    canvas.width = sourceWidth;
    canvas.height = sourceHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(
        chalkboardCanvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        canvas.width,
        canvas.height
    );
    return canvas;
}

async function writeCanvasToClipboard(canvas) {
    if (!canvas || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        return false;
    }

    try {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) return false;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch {
        return false;
    }
}

async function copySelectionToClipboard(cut = false) {
    const canvas = getSelectionCanvas();
    if (!canvas || !chalkboardState.selectionRect) return;

    chalkboardState.clipboardImage = canvas;
    await writeCanvasToClipboard(canvas);

    if (cut && chalkboardState.ctx) {
        pushChalkHistory();
        const rect = chalkboardState.selectionRect;
        chalkboardState.ctx.clearRect(rect.left, rect.top, rect.width, rect.height);
        markChalkboardUserContent(true);
        clearSelectionBox();
    }
}

async function pasteClipboardImage() {
    let imageBlob = null;

    if (navigator.clipboard?.read) {
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (imageType) {
                    imageBlob = await item.getType(imageType);
                    break;
                }
            }
        } catch {
            imageBlob = null;
        }
    }

    if (!imageBlob && chalkboardState.clipboardImage) {
        imageBlob = await new Promise(resolve => chalkboardState.clipboardImage.toBlob(resolve, 'image/png'));
    }

    if (!imageBlob) return;

    const objectUrl = URL.createObjectURL(imageBlob);
    const img = new Image();
    img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        chalkboardState.pendingImage = img;
        chalkboardState.tool = 'image';
        clearSelectionBox();
        syncChalkboardUI();
        updatePlacementGuide({
            x: chalkboardState.cssWidth / 2,
            y: chalkboardState.cssHeight / 2
        });
    };
    img.src = objectUrl;
}

function syncChalkAttachButton() {
    if (!btnChalkAttach) return;
    btnChalkAttach.classList.toggle('active', isChalkboardAttachmentEnabled);
    btnChalkAttach.setAttribute('aria-pressed', isChalkboardAttachmentEnabled ? 'true' : 'false');
    btnChalkAttach.title = isChalkboardAttachmentEnabled ? '已啟用 Chalkboard 附圖' : '附上 Chalkboard';
}

function toggleChalkboardAttachment() {
    isChalkboardAttachmentEnabled = !isChalkboardAttachmentEnabled;
    localStorage.setItem('chat_attach_chalkboard', String(isChalkboardAttachmentEnabled));
    syncChalkAttachButton();
}

function isVisionCapableModelName(modelName) {
    return /(vision|vlm|multimodal|nano-vl|paligemma|kosmos|fuyu|neva|vila|deplot|-vl\b)/i.test(String(modelName || ''));
}

function syncVisionModelInputs(useDropdown, visionModel = '', models = []) {
    if (!settingVisionModelName || !settingVisionModelSelect) return;

    if (useDropdown) {
        settingVisionModelName.style.display = 'none';
        settingVisionModelSelect.style.display = 'block';
        const visionModels = models.filter(model => isVisionCapableModelName(model.name));
        const options = ['<option value="">自動挑選 Vision 模型</option>']
            .concat(visionModels.map(model => `<option value="${model.name}" ${model.name === visionModel ? 'selected' : ''}>${model.name}</option>`));
        settingVisionModelSelect.innerHTML = options.join('');
        if (visionModel && !visionModels.some(model => model.name === visionModel)) {
            settingVisionModelSelect.innerHTML += `<option value="${visionModel}" selected>${visionModel}（目前設定）</option>`;
        }
        if (visionModelHelpText) {
            visionModelHelpText.textContent = visionModels.length > 0
                ? '這裡可指定處理 Chalkboard 與圖片理解的 vision 模型；留空則自動挑選。'
                : '此 Provider 的模型清單裡目前沒有明確辨識出的 vision 模型；可留空自動挑選，或手動填入。';
        }
    } else {
        settingVisionModelName.style.display = 'block';
        settingVisionModelSelect.style.display = 'none';
        settingVisionModelName.value = visionModel;
        if (visionModelHelpText) {
            visionModelHelpText.textContent = '用於讀取 Chalkboard 草圖、上傳圖片與其他多模態內容。留空時，系統會自動挑選同 Provider 的 vision 模型。';
        }
    }
}

function setupChalkboard() {
    if (!chalkboardCanvas || !chalkboardSurface) return;

    chalkboardState.ctx = chalkboardCanvas.getContext('2d');
    resizeChalkboardCanvas();
    syncChalkboardUI();

    chalkModeButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            if (chalkboardState.pendingText && chalkboardState.pendingTextRect) {
                commitPendingTextPlacement();
            }
            cancelPendingChalkPreview();
            clearSelectionBox();
            const tool = btn.dataset.tool || 'chalk';
            if (tool === 'chalk') {
                chalkboardState.tool = 'chalk';
                chalkboardState.color = btn.dataset.color || '#f5f1e8';
                chalkboardState.pendingImage = null;
                chalkboardState.pendingText = null;
            } else {
                chalkboardState.tool = tool;
                if (tool !== 'image') {
                    chalkboardState.pendingImage = null;
                }
                if (tool !== 'text') {
                    chalkboardState.pendingText = null;
                    chalkboardState.pendingTextRect = null;
                    chalkboardState.pendingTextSnapshot = null;
                    chalkboardState.pendingTextPreviewUrl = null;
                }
                if (tool === 'text' && !(await requestPendingChalkText())) {
                    chalkboardState.tool = 'chalk';
                }
            }
            syncChalkboardUI();
        });
    });

    chalkSizeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const size = Number(btn.dataset.size || 4);
            chalkboardState.size = size;
            chalkboardState.eraserSize = Math.max(18, size * 3);
            syncChalkboardUI();
        });
    });

    chalkUploadButton?.addEventListener('click', () => chalkImageInput?.click());
    chalkImageInput?.addEventListener('change', handleChalkImageUpload);
    chalkSaveButton?.addEventListener('click', saveChalkboardImage);
    chalkClearButton?.addEventListener('click', clearChalkboard);
    chalkUndoButton?.addEventListener('click', undoChalkAction);
    chalkCopyButton?.addEventListener('click', () => copySelectionToClipboard(false));
    chalkCutButton?.addEventListener('click', () => copySelectionToClipboard(true));
    chalkPasteButton?.addEventListener('click', pasteClipboardImage);

    chalkboardCanvas.addEventListener('pointerdown', startChalkStroke);
    chalkboardCanvas.addEventListener('pointermove', drawChalkStroke);
    chalkboardCanvas.addEventListener('pointerup', endChalkStroke);
    chalkboardCanvas.addEventListener('pointerleave', handleChalkPointerLeave);
    chalkboardCanvas.addEventListener('pointercancel', endChalkStroke);
    chalkTextBox?.addEventListener('pointerdown', startTextBoxManipulation);
    chalkTextBox?.addEventListener('pointermove', moveTextBoxManipulation);
    chalkTextBox?.addEventListener('pointerup', endTextBoxManipulation);
    chalkTextBox?.addEventListener('pointercancel', endTextBoxManipulation);

    document.addEventListener('keydown', (event) => {
        if (activeTab !== 'chalkboard' || !chalkboardState.hasInteracted) return;
        if (!(event.ctrlKey || event.metaKey)) return;
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) {
            return;
        }
        const key = event.key.toLowerCase();
        if (key === 'c' && chalkboardState.selectionRect) {
            event.preventDefault();
            copySelectionToClipboard(false);
        } else if (key === 'x' && chalkboardState.selectionRect) {
            event.preventDefault();
            copySelectionToClipboard(true);
        } else if (key === 'v') {
            event.preventDefault();
            pasteClipboardImage();
        }
    });
}

function syncChalkboardUI() {
    const toolsLocked = !chalkboardState.hasInteracted;

    chalkModeButtons.forEach(btn => {
        const tool = btn.dataset.tool;
        const active = tool === 'chalk'
            ? chalkboardState.tool === 'chalk' && btn.dataset.color === chalkboardState.color
            : chalkboardState.tool === tool;
        btn.classList.toggle('active', active);
        btn.disabled = toolsLocked;
    });

    chalkSizeButtons.forEach(btn => {
        btn.classList.toggle('active', Number(btn.dataset.size || 0) === chalkboardState.size);
        btn.disabled = toolsLocked;
    });

    chalkSaveButton && (chalkSaveButton.disabled = toolsLocked);
    chalkClearButton && (chalkClearButton.disabled = toolsLocked);
    chalkUndoButton && (chalkUndoButton.disabled = toolsLocked);
    chalkCopyButton && (chalkCopyButton.disabled = toolsLocked || !chalkboardState.selectionRect);
    chalkCutButton && (chalkCutButton.disabled = toolsLocked || !chalkboardState.selectionRect);
    chalkPasteButton && (chalkPasteButton.disabled = toolsLocked);
    chalkUploadButton && (chalkUploadButton.disabled = toolsLocked);

    syncSelectionBox();
    updateChalkboardCursor();
}

function resizeChalkboardCanvas() {
    if (!chalkboardCanvas || !chalkboardSurface || !chalkboardState.ctx) return;

    const rect = getChalkInputRect();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(1, Math.round(rect.width));
    const cssHeight = Math.max(1, Math.round(rect.height));
    const nextWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const nextHeight = Math.max(1, Math.floor(cssHeight * dpr));

    if (chalkboardCanvas.width === nextWidth && chalkboardCanvas.height === nextHeight) return;

    const snapshot = document.createElement('canvas');
    snapshot.width = chalkboardCanvas.width;
    snapshot.height = chalkboardCanvas.height;
    const snapshotCtx = snapshot.getContext('2d');
    if (chalkboardCanvas.width && chalkboardCanvas.height) {
        snapshotCtx.drawImage(chalkboardCanvas, 0, 0);
    }

    chalkboardCanvas.width = nextWidth;
    chalkboardCanvas.height = nextHeight;
    chalkboardState.cssWidth = cssWidth;
    chalkboardState.cssHeight = cssHeight;
    chalkboardState.ctx.setTransform(1, 0, 0, 1, 0, 0);
    chalkboardState.ctx.scale(dpr, dpr);
    chalkboardState.ctx.lineCap = 'round';
    chalkboardState.ctx.lineJoin = 'round';

    if (!chalkboardState.hasInteracted) {
        drawChalkboardWelcome();
    } else if (snapshot.width && snapshot.height) {
        chalkboardState.ctx.drawImage(snapshot, 0, 0, cssWidth, cssHeight);
        if (chalkboardState.pendingText && chalkboardState.pendingTextRect) {
            chalkboardState.pendingTextSnapshot = createCanvasSnapshot();
            syncPendingTextBox();
            return;
        }
        if (chalkboardState.dragStart && chalkboardState.hoverPoint && (
            chalkboardState.pendingShapePreview ||
            ((chalkboardState.tool === 'image' || chalkboardState.tool === 'text') && chalkboardState.drawing)
        )) {
            previewChalkObject(chalkboardState.hoverPoint);
        }
    }
}

function getChalkInputRect() {
    if (!chalkboardSurface) {
        return chalkboardCanvas.getBoundingClientRect();
    }

    const surfaceRect = chalkboardSurface.getBoundingClientRect();
    const style = window.getComputedStyle(chalkboardSurface);
    const borderLeft = parseFloat(style.borderLeftWidth || '0') || 0;
    const borderTop = parseFloat(style.borderTopWidth || '0') || 0;
    const borderRight = parseFloat(style.borderRightWidth || '0') || 0;
    const borderBottom = parseFloat(style.borderBottomWidth || '0') || 0;

    return {
        left: surfaceRect.left + borderLeft,
        top: surfaceRect.top + borderTop,
        width: Math.max(1, surfaceRect.width - borderLeft - borderRight),
        height: Math.max(1, surfaceRect.height - borderTop - borderBottom)
    };
}

function getChalkPoint(event) {
    const rect = getChalkInputRect();
    return {
        x: ((event.clientX - rect.left) / rect.width) * chalkboardState.cssWidth,
        y: ((event.clientY - rect.top) / rect.height) * chalkboardState.cssHeight
    };
}

function startChalkStroke(event) {
    const activated = activateChalkboard();
    if (activated) return;

    const point = getChalkPoint(event);
    const tool = chalkboardState.tool;

    if (tool !== 'text' && chalkboardState.pendingText && chalkboardState.pendingTextRect) {
        commitPendingTextPlacement();
    }

    if (tool !== 'select' && chalkboardState.selectionRect) {
        clearSelectionBox();
        syncChalkboardUI();
    }

    if (tool === 'select') {
        chalkboardState.drawing = true;
        chalkboardState.dragStart = point;
        chalkboardState.hoverPoint = point;
        chalkboardState.selectionRect = getNormalizedRect(point, point);
        syncSelectionBox();
        chalkboardCanvas.setPointerCapture?.(event.pointerId);
        return;
    }

    if (tool === 'chalk' || tool === 'eraser') {
        pushChalkHistory();
        chalkboardState.drawing = true;
        chalkboardState.lastPoint = point;
        chalkboardCanvas.setPointerCapture?.(event.pointerId);
        if (tool === 'chalk') {
            drawChalkDot(point);
        } else {
            drawChalkStroke(event);
        }
        return;
    }

    if (tool === 'image') {
        if (tool === 'image' && !chalkboardState.pendingImage) return;
        const rect = tool === 'image' ? getImagePlacementRect(point) : getTextPlacementRect(point);
        if (!rect) return;
        chalkboardState.drawing = true;
        chalkboardState.lastPoint = point;
        chalkboardState.dragStart = {
            x: rect.left,
            y: rect.top
        };
        chalkboardState.dragPresetEnd = {
            x: rect.left + rect.width,
            y: rect.top + rect.height
        };
        chalkboardState.dragSnapshot = createCanvasSnapshot();
        chalkboardState.hoverPoint = chalkboardState.dragPresetEnd;
        hidePlacementGuide();
        chalkboardCanvas.setPointerCapture?.(event.pointerId);
        return;
    }

    if (tool === 'text') {
        if (!chalkboardState.pendingText) return;

        if (!chalkboardState.pendingTextRect) {
            placePendingTextAt(point);
            return;
        }

        commitPendingTextPlacement();
        return;
    }

    if (!chalkboardState.dragStart) {
        chalkboardState.dragStart = point;
        chalkboardState.dragSnapshot = createCanvasSnapshot();
        chalkboardState.hoverPoint = point;
        chalkboardState.pendingShapePreview = true;
        return;
    }

    commitChalkObject(point);
    chalkboardState.dragStart = null;
    chalkboardState.dragSnapshot = null;
    chalkboardState.hoverPoint = null;
    chalkboardState.pendingShapePreview = false;
}

function drawChalkDot(point) {
    const ctx = chalkboardState.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = chalkboardState.color;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(1.8, chalkboardState.size * 0.45), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function drawChalkStroke(event) {
    const point = getChalkPoint(event);
    chalkboardState.hoverPoint = point;
    const tool = chalkboardState.tool;
    if (tool === 'text') {
        updateChalkboardCursor();
    }

    if (tool === 'select') {
        if (!chalkboardState.drawing || !chalkboardState.dragStart) return;
        chalkboardState.selectionRect = getNormalizedRect(chalkboardState.dragStart, point);
        syncSelectionBox();
        return;
    }

    if ((tool === 'line' || tool === 'rect' || tool === 'circle') && chalkboardState.dragStart) {
        previewChalkObject(point);
        return;
    }

    if (tool === 'image') {
        if (chalkboardState.drawing && chalkboardState.dragStart) {
            previewChalkObject(point);
        } else {
            updatePlacementGuide(point);
        }
        return;
    }

    if (tool === 'text') {
        if (!chalkboardState.pendingTextRect) {
            updatePlacementGuide(point);
        }
        return;
    }

    if (!chalkboardState.drawing || !chalkboardState.lastPoint) return;

    const ctx = chalkboardState.ctx;
    const isEraser = tool === 'eraser';

    ctx.save();
    ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : chalkboardState.color;
    ctx.lineWidth = isEraser ? chalkboardState.eraserSize : chalkboardState.size;
    ctx.globalAlpha = isEraser ? 1 : 0.88;
    ctx.beginPath();
    ctx.moveTo(chalkboardState.lastPoint.x, chalkboardState.lastPoint.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    if (!isEraser) {
        ctx.lineWidth = Math.max(1, chalkboardState.size * 0.24);
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.moveTo(chalkboardState.lastPoint.x + 1.2, chalkboardState.lastPoint.y - 0.8);
        ctx.lineTo(point.x + 1.2, point.y - 0.8);
        ctx.stroke();
    }
    ctx.restore();

    chalkboardState.lastPoint = point;
    if (!isEraser) {
        spawnChalkDust(point);
    }
}

function spawnChalkDust(point) {
    const ctx = chalkboardState.ctx;
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = chalkboardState.color;
    ctx.globalAlpha = 0.14;
    for (let i = 0; i < 2; i += 1) {
        const offsetX = (Math.random() - 0.5) * 10;
        const offsetY = (Math.random() - 0.5) * 10;
        ctx.beginPath();
        ctx.arc(point.x + offsetX, point.y + offsetY, Math.random() * 1.2 + 0.4, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

function endChalkStroke(event) {
    if (!chalkboardState.drawing) return;
    const eventPoint = event ? getChalkPoint(event) : chalkboardState.lastPoint;
    const point = chalkboardState.hoverPoint || chalkboardState.dragPresetEnd || eventPoint;
    const completedTool = chalkboardState.tool;
    if (completedTool === 'select' && chalkboardState.dragStart) {
        chalkboardState.selectionRect = getNormalizedRect(chalkboardState.dragStart, point);
        syncChalkboardUI();
    }
    if (chalkboardState.tool === 'image' && chalkboardState.dragStart) {
        commitChalkObject(point);
    }
    chalkboardState.drawing = false;
    chalkboardState.lastPoint = null;
    if (chalkboardState.tool === 'image') {
        chalkboardState.dragStart = null;
        chalkboardState.dragSnapshot = null;
        chalkboardState.hoverPoint = null;
        chalkboardState.dragPresetEnd = null;
    }
    if (chalkboardState.tool === 'select') {
        chalkboardState.dragStart = null;
        chalkboardState.hoverPoint = null;
    }
    if (chalkboardState.tool === 'text') {
        chalkboardState.textManipulation = null;
        syncPendingTextBox();
    }
    hidePlacementGuide();
    if (event?.pointerId !== undefined) {
        chalkboardCanvas.releasePointerCapture?.(event.pointerId);
    }
    if (completedTool === 'chalk' || completedTool === 'eraser') {
        markChalkboardUserContent(true);
    }
}

function handleChalkPointerLeave(event) {
    if (chalkboardState.drawing) {
        endChalkStroke(event);
        return;
    }
    hidePlacementGuide();
}

function startTextBoxManipulation(event) {
    if (chalkboardState.tool !== 'text' || !chalkboardState.pendingTextRect) return;

    const handle = event.target instanceof HTMLElement && event.target.dataset.handle
        ? event.target.dataset.handle
        : 'move';
    const point = getChalkPoint(event);

    chalkboardState.textManipulation = {
        mode: handle === 'move' ? 'move' : 'resize',
        handle: handle === 'move' ? null : handle,
        originPoint: point,
        originRect: { ...chalkboardState.pendingTextRect }
    };
    chalkboardState.drawing = true;
    chalkboardState.hoverPoint = point;
    chalkTextBox?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
}

function moveTextBoxManipulation(event) {
    if (chalkboardState.tool !== 'text' || !chalkboardState.drawing || !chalkboardState.textManipulation) return;
    const point = getChalkPoint(event);
    chalkboardState.hoverPoint = point;
    updatePendingTextRect(point);
    event.preventDefault();
    event.stopPropagation();
}

function endTextBoxManipulation(event) {
    if (chalkboardState.tool !== 'text' || !chalkboardState.drawing || !chalkboardState.textManipulation) return;
    chalkboardState.drawing = false;
    chalkboardState.textManipulation = null;
    syncPendingTextBox();
    if (event?.pointerId !== undefined) {
        chalkTextBox?.releasePointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    event.stopPropagation();
}

function openTextToolModal() {
    if (!textToolOverlay) {
        return Promise.resolve(false);
    }

    textToolContent.value = chalkboardState.textToolSettings.content || '';
    textToolFontFamily.value = chalkboardState.textToolSettings.fontFamily || '"DFKai-SB", "BiauKai", serif';
    textToolFontStyle.value = chalkboardState.textToolSettings.fontStyle || 'chalk';
    textToolFontSize.value = String(chalkboardState.textToolSettings.fontSize || 28);
    if (textToolColor) {
        textToolColor.value = chalkboardState.textToolSettings.color || '#f5f1e8';
    }
    if (textToolAlign) {
        textToolAlign.value = chalkboardState.textToolSettings.align || 'left';
    }
    if (textToolBold) {
        textToolBold.checked = chalkboardState.textToolSettings.bold !== false;
    }
    if (textToolItalic) {
        textToolItalic.checked = Boolean(chalkboardState.textToolSettings.italic);
    }
    textToolOverlay.classList.add('visible');
    requestAnimationFrame(() => textToolContent?.focus());

    return new Promise(resolve => {
        chalkboardState.textToolResolver = resolve;
    });
}

function closeTextToolModal(confirmed) {
    if (!textToolOverlay) return;
    textToolOverlay.classList.remove('visible');

    const resolver = chalkboardState.textToolResolver;
    chalkboardState.textToolResolver = null;
    if (resolver) {
        resolver(Boolean(confirmed));
    }
}

function getTextStyleFallback(fontStyle) {
    const styleMap = {
        chalk: '"Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
        board: '"Segoe Print", "Comic Sans MS", cursive',
        clean: '"Segoe UI", "Trebuchet MS", sans-serif',
        serif: 'Georgia, "Times New Roman", serif',
        mono: '"Courier New", monospace'
    };
    return styleMap[fontStyle] || styleMap.chalk;
}

function buildTextFontFamily(baseFamily, fontStyle) {
    const fallback = getTextStyleFallback(fontStyle);
    return `${baseFamily}, ${fallback}`;
}

function undoChalkAction() {
    cancelPendingChalkPreview(false);
    hidePlacementGuide();
    hidePendingTextBox();
    clearSelectionBox();
    chalkboardState.pendingText = null;
    chalkboardState.pendingTextRect = null;
    chalkboardState.pendingTextSnapshot = null;
    chalkboardState.pendingTextPreviewUrl = null;
    chalkboardState.textManipulation = null;

    const snapshot = chalkboardState.history.pop();
    if (!snapshot) return;

    clearChalkboardSurface();
    chalkboardState.ctx.drawImage(snapshot, 0, 0, chalkboardState.cssWidth, chalkboardState.cssHeight);
    markChalkboardUserContent(chalkboardState.history.length > 0);
}

function clearChalkboard() {
    if (!chalkboardState.ctx || !chalkboardCanvas) return;
    chalkboardState.hasInteracted = true;
    chalkboardState.hintDrawn = false;
    pushChalkHistory();
    cancelPendingChalkPreview(false);
    hidePendingTextBox();
    clearSelectionBox();
    chalkboardState.pendingText = null;
    chalkboardState.pendingTextRect = null;
    chalkboardState.pendingTextSnapshot = null;
    chalkboardState.pendingTextPreviewUrl = null;
    chalkboardState.textManipulation = null;
    chalkboardState.ctx.clearRect(0, 0, chalkboardState.cssWidth, chalkboardState.cssHeight);
    markChalkboardUserContent(false);
}

function saveChalkboardImage() {
    if (!chalkboardCanvas) return;
    
    const base64Image = chalkboardCanvas.toDataURL('image/png');
    api('/api/chalkboard/export-file', { method: 'POST', body: { imageBase64: base64Image } }).then((data) => {
        if (data.success) {
            addUILog(`✅ 黑板圖片已匯出：${data.fileName || data.filePath}`, 'success');
        } else if (data.cancelled) {
            addUILog('ℹ️ 已取消匯出黑板圖片', 'info');
        } else {
            // fallback: 若原生另存失敗，仍嘗試瀏覽器下載
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.href = base64Image;
            link.download = `chalkboard-${timestamp}.png`;
            link.click();
            addUILog(`⚠️ 原生匯出圖片失敗，已改用瀏覽器下載：${data.error || 'Unknown error'}`, 'warn');
        }
    });
}

function handleChalkImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        const img = new Image();
        img.onload = () => {
            cancelPendingChalkPreview();
            chalkboardState.pendingImage = img;
            chalkboardState.tool = 'image';
            syncChalkboardUI();
            updatePlacementGuide(chalkboardState.hoverPoint || {
                x: chalkboardState.cssWidth / 2,
                y: chalkboardState.cssHeight / 2
            });
        };
        img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function activateChalkboard() {
    if (chalkboardState.hasInteracted) return false;
    chalkboardState.hasInteracted = true;
    chalkboardState.history = [];
    clearChalkboardSurface();
    drawChalkboardHint();
    syncChalkboardUI();
    return true;
}

function clearChalkboardSurface() {
    if (!chalkboardState.ctx) return;
    chalkboardState.ctx.clearRect(0, 0, chalkboardState.cssWidth, chalkboardState.cssHeight);
}

function pushChalkHistory(snapshot = null) {
    const source = snapshot || createCanvasSnapshot();
    if (!source) return;

    const record = document.createElement('canvas');
    record.width = source.width;
    record.height = source.height;
    const recordCtx = record.getContext('2d');
    recordCtx.drawImage(source, 0, 0);
    chalkboardState.history.push(record);

    if (chalkboardState.history.length > 30) {
        chalkboardState.history.shift();
    }
}

function cancelPendingChalkPreview(restorePreview = true) {
    if (restorePreview && chalkboardState.dragSnapshot && (chalkboardState.pendingShapePreview || chalkboardState.drawing)) {
        restoreCanvasSnapshot(chalkboardState.dragSnapshot);
    }
    chalkboardState.drawing = false;
    chalkboardState.lastPoint = null;
    chalkboardState.dragStart = null;
    chalkboardState.dragSnapshot = null;
    chalkboardState.hoverPoint = null;
    chalkboardState.dragPresetEnd = null;
    chalkboardState.pendingShapePreview = false;
    chalkboardState.textManipulation = null;
    if (!chalkboardState.pendingTextRect) {
        chalkboardState.pendingTextSnapshot = null;
        chalkboardState.pendingTextPreviewUrl = null;
    }
    hidePlacementGuide();
}

function createCanvasSnapshot() {
    const snapshot = document.createElement('canvas');
    snapshot.width = chalkboardCanvas.width;
    snapshot.height = chalkboardCanvas.height;
    const snapshotCtx = snapshot.getContext('2d');
    snapshotCtx.drawImage(chalkboardCanvas, 0, 0);
    return snapshot;
}

function restoreCanvasSnapshot(snapshot) {
    if (!snapshot || !chalkboardState.ctx) return;
    clearChalkboardSurface();
    chalkboardState.ctx.drawImage(snapshot, 0, 0, chalkboardState.cssWidth, chalkboardState.cssHeight);
}

function previewChalkObject(point) {
    if (!chalkboardState.dragStart) return;
    restoreCanvasSnapshot(chalkboardState.dragSnapshot);
    drawChalkObject(chalkboardState.dragStart, point, true);
}

function commitChalkObject(point) {
    if (!chalkboardState.dragStart) return;
    pushChalkHistory(chalkboardState.dragSnapshot);
    restoreCanvasSnapshot(chalkboardState.dragSnapshot);
    drawChalkObject(chalkboardState.dragStart, point, false);
    markChalkboardUserContent(true);
}

function drawChalkObject(start, end, preview) {
    if (!start || !end || !chalkboardState.ctx) return;

    const ctx = chalkboardState.ctx;
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    ctx.save();
    ctx.strokeStyle = chalkboardState.color;
    ctx.fillStyle = chalkboardState.color;
    ctx.lineWidth = chalkboardState.size;
    ctx.globalAlpha = preview ? 0.6 : 0.9;

    if (chalkboardState.tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
    } else if (chalkboardState.tool === 'rect') {
        ctx.strokeRect(left, top, width, height);
    } else if (chalkboardState.tool === 'circle') {
        ctx.beginPath();
        ctx.ellipse(left + width / 2, top + height / 2, Math.max(width / 2, 1), Math.max(height / 2, 1), 0, 0, Math.PI * 2);
        ctx.stroke();
    } else if (chalkboardState.tool === 'image' && chalkboardState.pendingImage) {
        drawPlacedImage(left, top, width, height, preview);
        if (!preview) {
            chalkboardState.pendingImage = null;
            chalkboardState.tool = 'chalk';
            syncChalkboardUI();
        }
    }

    ctx.restore();
}

function drawPlacedImage(left, top, width, height, preview) {
    const img = chalkboardState.pendingImage;
    if (!img || !chalkboardState.ctx) return;

    const ctx = chalkboardState.ctx;
    const targetWidth = Math.max(width, 24);
    const targetHeight = Math.max(height, 24);
    ctx.globalAlpha = preview ? 0.65 : 0.96;
    ctx.drawImage(img, left, top, targetWidth, targetHeight);
    if (preview) {
        ctx.strokeStyle = 'rgba(244, 239, 226, 0.9)';
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(left, top, targetWidth, targetHeight);
        ctx.setLineDash([]);
    }
}

function drawPlacedText(left, top, width, height, preview) {
    const block = chalkboardState.pendingText;
    if (!block || !chalkboardState.ctx) return;

    const targetWidth = Math.max(width, block.baseWidth);
    const targetHeight = Math.max(height, block.baseHeight);
    const image = block.previewCanvas;
    if (!image) return;

    const ctx = chalkboardState.ctx;
    ctx.save();
    ctx.globalAlpha = preview ? 0.7 : 0.96;
    ctx.drawImage(image, left, top, targetWidth, targetHeight);
    ctx.restore();
}

function drawChalkboardWelcome() {
    const ctx = chalkboardState.ctx;
    if (!ctx) return;

    chalkboardState.history = [];
    markChalkboardUserContent(false);
    clearChalkboardSurface();

    const padX = 34;
    const titleY = 62;
    const bodyY = 122;
    const warnY = 206;
    const lineWidth = Math.max(320, chalkboardState.cssWidth - padX * 2);

    drawChalkText('歡迎使用 AI PC Agent', padX, titleY, {
        font: '700 34px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
        color: '#f4efe2',
        alpha: 0.96
    });

    drawWrappedChalkText(
        '這裡可以快速啟動推薦工具與瀏覽器。請從左側推薦清單選擇工具，或是直接與 AI 對話。',
        padX,
        bodyY,
        lineWidth,
        28,
        {
            font: '400 22px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
            color: '#eef0df',
            alpha: 0.9
        }
    );

    drawWrappedChalkText(
        '⚠️ AI Agent 很強大，但也可能犯錯，導致系統有風險，敬請仔細查證並小心下指令。',
        padX,
        warnY,
        lineWidth,
        28,
        {
            font: '700 22px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
            color: '#f4dd63',
            alpha: 0.92
        }
    );
}

function drawChalkboardHint() {
    if (chalkboardState.hintDrawn) return;
    chalkboardState.hintDrawn = true;
    markChalkboardUserContent(false);
    drawChalkText('用粉筆直接畫', 34, 62, {
        font: '700 30px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
        color: '#f4efe2',
        alpha: 0.94
    });
    drawWrappedChalkText(
        '選一支粉筆，直接在黑板上塗寫，板擦可清空畫布。可把想法畫出來給AI看。',
        34,
        108,
        Math.max(280, chalkboardState.cssWidth - 68),
        26,
        {
            font: '400 20px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
            color: '#eef0df',
            alpha: 0.88
        }
    );
}

function drawWrappedChalkText(text, x, y, maxWidth, lineHeight, options) {
    const ctx = chalkboardState.ctx;
    if (!ctx) return;

    ctx.save();
    ctx.font = options.font;
    const chars = Array.from(text);
    let line = '';
    let currentY = y;

    chars.forEach(char => {
        const testLine = line + char;
        if (line && ctx.measureText(testLine).width > maxWidth) {
            drawChalkText(line, x, currentY, options);
            line = char;
            currentY += lineHeight;
        } else {
            line = testLine;
        }
    });

    if (line) {
        drawChalkText(line, x, currentY, options);
    }
    ctx.restore();
}

async function requestPendingChalkText() {
    const confirmed = await openTextToolModal();
    if (!confirmed) return false;

    const content = String(textToolContent?.value || '').trim();
    if (!content) return false;

    const baseFontFamily = textToolFontFamily?.value || '"DFKai-SB", "BiauKai", serif';
    const fontStyle = textToolFontStyle?.value || 'chalk';
    const fontFamily = buildTextFontFamily(baseFontFamily, fontStyle);
    const fontSizeValue = Number(textToolFontSize?.value || 28);
    const fontSize = Math.max(14, Math.min(160, Number.isFinite(fontSizeValue) ? fontSizeValue : 28));
    const color = textToolColor?.value || '#f5f1e8';
    const align = textToolAlign?.value || 'left';
    const bold = textToolBold?.checked !== false;
    const italic = Boolean(textToolItalic?.checked);
    const fontWeight = bold ? '700' : '400';
    const fontVariant = italic ? 'italic' : 'normal';

    chalkboardState.textToolSettings = {
        content,
        fontFamily: baseFontFamily,
        fontStyle,
        fontSize,
        color,
        align,
        bold,
        italic
    };

    const lines = content
        .split(/\r?\n/)
        .map(line => line.trimEnd())
        .filter(Boolean);

    if (!lines.length) return false;
    const lineHeight = Math.round(fontSize * 1.35);
    const font = `${fontVariant} ${fontWeight} ${fontSize}px ${fontFamily}`;
    const width = measureChalkTextWidth(lines, font);
    const height = Math.max(fontSize, lines.length * lineHeight);
    const previewPadding = Math.max(6, Math.round(fontSize * 0.18));
    const previewCanvas = createTextPreviewCanvas(lines, width, height, font, lineHeight, color, previewPadding, align);

    chalkboardState.pendingText = {
        lines,
        fontSize,
        lineHeight,
        textWidth: width,
        textHeight: height,
        baseWidth: width + (previewPadding * 2),
        baseHeight: height + (previewPadding * 2),
        font,
        color,
        align,
        bold,
        italic,
        previewCanvas,
        previewPadding
    };
    chalkboardState.pendingTextRect = null;
    chalkboardState.pendingTextSnapshot = createCanvasSnapshot();
    chalkboardState.pendingTextPreviewUrl = previewCanvas.toDataURL('image/png');
    hidePendingTextBox();

    updatePlacementGuide(chalkboardState.hoverPoint || {
        x: chalkboardState.cssWidth / 2,
        y: chalkboardState.cssHeight / 2
    });
    return true;
}

function createTextPreviewCanvas(lines, width, height, font, lineHeight, color, padding, align = 'left') {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width + (padding * 2)));
    canvas.height = Math.max(1, Math.ceil(height + (padding * 2)));
    const ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.96;

    lines.forEach((line, index) => {
        const y = padding + (index * lineHeight);
        const lineWidth = ctx.measureText(line).width;
        let x = padding;
        if (align === 'center') {
            x = padding + Math.max(0, (width - lineWidth) / 2);
        } else if (align === 'right') {
            x = padding + Math.max(0, width - lineWidth);
        }
        ctx.fillText(line, x, y);
        ctx.globalAlpha = 0.18;
        ctx.fillText(line, x + 1.4, Math.max(0, y - 0.8));
        ctx.globalAlpha = 0.96;
    });

    return canvas;
}

function drawChalkText(text, x, y, options) {
    const ctx = chalkboardState.ctx;
    if (!ctx) return;

    ctx.save();
    ctx.font = options.font;
    ctx.textBaseline = options.baseline || 'alphabetic';
    ctx.fillStyle = options.color;
    ctx.globalAlpha = options.alpha ?? 0.9;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 0.18;
    ctx.fillText(text, x + 1.4, y - 0.8);
    ctx.restore();
}

function measureChalkTextWidth(lines, font) {
    const ctx = chalkboardState.ctx;
    if (!ctx) return 160;

    ctx.save();
    ctx.font = font;
    const width = lines.reduce((maxWidth, line) => Math.max(maxWidth, ctx.measureText(line).width), 0);
    ctx.restore();
    return Math.max(48, Math.ceil(width));
}

function getImagePlacementRect(point) {
    const img = chalkboardState.pendingImage;
    if (!img) return null;

    const naturalWidth = Math.max(1, img.naturalWidth || img.width || 1);
    const naturalHeight = Math.max(1, img.naturalHeight || img.height || 1);
    const maxWidth = Math.min(chalkboardState.cssWidth * 0.26, 220);
    const minWidth = 72;
    const guideWidth = Math.max(minWidth, Math.min(maxWidth, naturalWidth));
    const guideHeight = Math.max(54, guideWidth * (naturalHeight / naturalWidth));
    const boundedWidth = Math.min(guideWidth, chalkboardState.cssWidth);
    const boundedHeight = Math.min(guideHeight, chalkboardState.cssHeight);
    const left = Math.max(0, Math.min(point.x - boundedWidth / 2, chalkboardState.cssWidth - boundedWidth));
    const top = Math.max(0, Math.min(point.y - boundedHeight / 2, chalkboardState.cssHeight - boundedHeight));

    return {
        left,
        top,
        width: boundedWidth,
        height: boundedHeight
    };
}

function getTextPlacementRect(point) {
    const block = chalkboardState.pendingText;
    if (!block) return null;

    const boundedWidth = Math.min(block.baseWidth, chalkboardState.cssWidth);
    const boundedHeight = Math.min(block.baseHeight, chalkboardState.cssHeight);
    const left = Math.max(0, Math.min(point.x - boundedWidth / 2, chalkboardState.cssWidth - boundedWidth));
    const top = Math.max(0, Math.min(point.y - boundedHeight / 2, chalkboardState.cssHeight - boundedHeight));

    return {
        left,
        top,
        width: boundedWidth,
        height: boundedHeight
    };
}

function placePendingTextAt(point) {
    const rect = getTextPlacementRect(point);
    if (!rect) return;
    chalkboardState.pendingTextRect = rect;
    hidePlacementGuide();
    syncPendingTextBox();
}

function getTextBoxHit(point) {
    const rect = chalkboardState.pendingTextRect;
    if (!rect) return null;

    const margin = 12;
    const nearLeft = Math.abs(point.x - rect.left) <= margin;
    const nearRight = Math.abs(point.x - (rect.left + rect.width)) <= margin;
    const nearTop = Math.abs(point.y - rect.top) <= margin;
    const nearBottom = Math.abs(point.y - (rect.top + rect.height)) <= margin;
    const withinX = point.x >= rect.left && point.x <= rect.left + rect.width;
    const withinY = point.y >= rect.top && point.y <= rect.top + rect.height;

    if (nearTop && nearLeft) return 'nw';
    if (nearTop && nearRight) return 'ne';
    if (nearBottom && nearRight) return 'se';
    if (nearBottom && nearLeft) return 'sw';
    if (nearTop && withinX) return 'n';
    if (nearBottom && withinX) return 's';
    if (nearLeft && withinY) return 'w';
    if (nearRight && withinY) return 'e';
    if (withinX && withinY) return 'move';
    return null;
}

function updatePendingTextRect(point) {
    const interaction = chalkboardState.textManipulation;
    const rect = interaction?.originRect;
    if (!interaction || !rect) return;

    const dx = point.x - interaction.originPoint.x;
    const dy = point.y - interaction.originPoint.y;
    const minWidth = Math.max(60, (chalkboardState.pendingText?.baseWidth || 60) * 0.5);
    const minHeight = Math.max(32, (chalkboardState.pendingText?.baseHeight || 32) * 0.5);
    let nextLeft = rect.left;
    let nextTop = rect.top;
    let nextWidth = rect.width;
    let nextHeight = rect.height;

    if (interaction.mode === 'move') {
        nextLeft = rect.left + dx;
        nextTop = rect.top + dy;
    } else {
        const handle = interaction.handle || 'se';
        let right = rect.left + rect.width;
        let bottom = rect.top + rect.height;

        if (handle.includes('w')) {
            nextLeft = Math.min(rect.left + dx, right - minWidth);
        }
        if (handle.includes('e')) {
            right = Math.max(rect.left + minWidth, right + dx);
        }
        if (handle.includes('n')) {
            nextTop = Math.min(rect.top + dy, bottom - minHeight);
        }
        if (handle.includes('s')) {
            bottom = Math.max(rect.top + minHeight, bottom + dy);
        }

        nextWidth = right - nextLeft;
        nextHeight = bottom - nextTop;
    }

    nextWidth = Math.max(minWidth, Math.min(nextWidth, chalkboardState.cssWidth));
    nextHeight = Math.max(minHeight, Math.min(nextHeight, chalkboardState.cssHeight));
    nextLeft = Math.max(0, Math.min(nextLeft, chalkboardState.cssWidth - nextWidth));
    nextTop = Math.max(0, Math.min(nextTop, chalkboardState.cssHeight - nextHeight));

    chalkboardState.pendingTextRect = {
        left: nextLeft,
        top: nextTop,
        width: nextWidth,
        height: nextHeight
    };
    syncPendingTextBox();
}

function syncPendingTextBox() {
    if (!chalkTextBox || !chalkboardState.pendingText || !chalkboardState.pendingTextRect) {
        hidePendingTextBox();
        return;
    }

    const rect = chalkboardState.pendingTextRect;
    chalkTextBox.style.left = `${rect.left}px`;
    chalkTextBox.style.top = `${rect.top}px`;
    chalkTextBox.style.width = `${rect.width}px`;
    chalkTextBox.style.height = `${rect.height}px`;
    chalkTextBox.classList.add('visible');
    if (chalkboardState.pendingTextSnapshot) {
        restoreCanvasSnapshot(chalkboardState.pendingTextSnapshot);
    }
    if (chalkTextBoxContent) {
        chalkTextBoxContent.src = chalkboardState.pendingTextPreviewUrl || '';
        chalkTextBoxContent.style.opacity = '0.96';
    }
}

function hidePendingTextBox() {
    chalkTextBox?.classList.remove('visible');
    if (chalkTextBoxContent) {
        chalkTextBoxContent.removeAttribute('src');
    }
}

function commitPendingTextPlacement() {
    if (!chalkboardState.pendingText || !chalkboardState.pendingTextRect) return;
    const snapshot = chalkboardState.pendingTextSnapshot || createCanvasSnapshot();
    pushChalkHistory(snapshot);
    restoreCanvasSnapshot(snapshot);
    const rect = chalkboardState.pendingTextRect;
    drawPlacedText(rect.left, rect.top, rect.width, rect.height, false);
    markChalkboardUserContent(true);
    chalkboardState.pendingText = null;
    chalkboardState.pendingTextRect = null;
    chalkboardState.pendingTextSnapshot = null;
    chalkboardState.pendingTextPreviewUrl = null;
    chalkboardState.textManipulation = null;
    hidePendingTextBox();
    chalkboardState.tool = 'chalk';
    syncChalkboardUI();
}

function updatePlacementGuide(point) {
    if (!chalkPlacementGuide || !point || chalkboardState.drawing || chalkboardState.pendingTextRect) {
        hidePlacementGuide();
        return;
    }

    let rect = null;
    if (chalkboardState.tool === 'image' && chalkboardState.pendingImage) {
        rect = getImagePlacementRect(point);
    } else if (chalkboardState.tool === 'text' && chalkboardState.pendingText) {
        rect = getTextPlacementRect(point);
    }

    if (!rect) {
        hidePlacementGuide();
        return;
    }

    chalkPlacementGuide.style.left = `${rect.left}px`;
    chalkPlacementGuide.style.top = `${rect.top}px`;
    chalkPlacementGuide.style.width = `${rect.width}px`;
    chalkPlacementGuide.style.height = `${rect.height}px`;
    chalkPlacementGuide.classList.add('visible');
}

function hidePlacementGuide() {
    chalkPlacementGuide?.classList.remove('visible');
}

function updateChalkboardCursor() {
    if (!chalkboardCanvas) return;
    if (chalkboardState.tool === 'select') {
        chalkboardCanvas.style.cursor = 'crosshair';
        return;
    }
    if (chalkboardState.tool === 'image' && chalkboardState.pendingImage) {
        chalkboardCanvas.style.cursor = 'copy';
        return;
    }
    if (chalkboardState.tool === 'text' && chalkboardState.pendingText) {
        const hit = chalkboardState.pendingTextRect && chalkboardState.hoverPoint
            ? getTextBoxHit(chalkboardState.hoverPoint)
            : null;
        const cursorMap = {
            move: 'move',
            nw: 'nwse-resize',
            se: 'nwse-resize',
            ne: 'nesw-resize',
            sw: 'nesw-resize',
            n: 'ns-resize',
            s: 'ns-resize',
            e: 'ew-resize',
            w: 'ew-resize'
        };
        chalkboardCanvas.style.cursor = cursorMap[hit] || 'text';
        return;
    }
    hidePlacementGuide();
    if (chalkboardState.tool === 'eraser') {
        chalkboardCanvas.style.cursor = 'cell';
        return;
    }
    chalkboardCanvas.style.cursor = 'crosshair';
}

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════
async function init() {
    loadAppMeta();
    checkFirstRun();
    applyTheme(localStorage.getItem('theme') || 'dark');
    restoreLayout();
    setupResizers();
    setupEventListeners();
    setupChalkboard();
    setupSpeechRecognition();

    // 並行載入資料，不要等待啟動畫面
    await Promise.all([loadTodo(), loadRecommend(), loadSops(), loadExps()]);
    
    // 硬體監控改為「顯示時才執行」，避免啟動延遲
    if (activeTab === 'hardware') {
        startHardwarePolling();
    }

    // 若有任務，自動開啟工作列表 (處理刷新時的需求)
    if (todoList.length > 0) {
        openTab('todolist');
    }

    // 隱藏啟動畫面（立即隱藏，不要延遲）
    hideSplash();

    startPolling();

    // 首次檢查 LLM 狀態（會觸發 bootstrap 或顯示歡迎訊息）
    await checkLLMStatus();
}

async function loadAppMeta() {
    const data = await api('/api/meta');
    if (data.success && statusVersion) {
        statusVersion.textContent = `AI PC Agent v${data.version || 'dev'}`;
    }
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
    if (data.success) {
        announceTaskStatusChanges(todoList, data.todoList);
        todoList = data.todoList;
        syncKnownTaskStatuses(todoList);
        renderTodoList();
    }
}

async function loadRecommend() {
    try {
        const data = await api('/api/recommend');
        if (data.success && data.recommendList?.length > 0) {
            recommendList = data.recommendList;
            renderSidebarTab();
            hideSplash(); // 抓到資料後隱藏
        }
    } catch (e) {
        console.error("Load recommend failed", e);
    }
}

async function loadSops() {
    try {
        const data = await api('/api/sops');
        if (data.success && Array.isArray(data.sops)) {
            sopsList = data.sops;
            renderSidebarTab();
        }
    } catch (e) {
        console.error('Load sops failed', e);
    }
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(async () => {
        // 嘗試載入資料，但不應該阻塞後續的 Log 與 AI 狀態檢查
        if (!recommendList || recommendList.length === 0) {
            loadRecommend();
        }

        await loadTodo();
        pollLogs();
        loadExps();
        checkLLMStatus();
    }, 2000);
}

function syncKnownTaskStatuses(tasks) {
    knownTaskStatuses = new Map(tasks.map(task => [task.id, task.status]));
}

function buildTaskCompletionMessage(task) {
    if (task.status === 'success') {
        return `✅「${task.title}」已安裝/執行完成。`;
    }
    if (task.status === 'skipped') {
        return `ℹ️「${task.title}」已經存在，所以我幫你跳過了。`;
    }
    if (task.status === 'failed') {
        return `❌「${task.title}」執行失敗。你可以看一下下方工作日誌，我再幫你排除。`;
    }
    return '';
}

function announceTaskStatusChanges(previousTasks, nextTasks) {
    if (!Array.isArray(nextTasks) || nextTasks.length === 0) return;

    // 首次載入只建立狀態，不補歷史訊息
    if (!Array.isArray(previousTasks) || previousTasks.length === 0 && knownTaskStatuses.size === 0) {
        return;
    }

    nextTasks.forEach(task => {
        const previousStatus = knownTaskStatuses.get(task.id);
        if (!previousStatus || previousStatus === task.status) return;

        if (!['success', 'failed', 'skipped'].includes(task.status)) return;
        if (!['pending', 'running'].includes(previousStatus)) return;

        const message = buildTaskCompletionMessage(task);
        if (message) {
            appendChatBubble('ai', message);
        }
    });
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
            // await bootstrapOllama(); // [2026.03.17] 暫時停用自動偵測安裝，避免干擾其他 Provider
        } else if (!data.modelReady) {
            // Case 2: Ollama 好了，但模型沒好
            // await bootstrapModel(); // [2026.03.17] 暫時停用自動模型下載
        } else {
            // Case 3: 全都好了 — 顯示初始訊息和徽章
            if (!window._llmWelcomed) {
                // 顯示初始訊息
                appendChatBubble('ai', '你好！我是你的 AI PC Agent，可以輸入文字、用嘴巴說，或是畫圖，來告訴我你需要安裝什麼軟體，或是調整系統設定喔！');
                const versionStr = data.version ? ` (v${data.version})` : '';
                appendChatBubble('ai', `🧠 AI 引擎就緒！${data.provider || 'Ollama'}${versionStr} 模型 ${data.modelName || '預設'} 已載入，可以直接用中文告訴我你需要什麼 🚀`);
                addUILog(`🧠 AI 引擎就緒${versionStr}：${data.modelName || '已載入'}`, 'success');
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
        renderSidebarTab();
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
    
    // Search Box
    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'model-menu-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = '搜尋模型...';
    searchInput.autocomplete = 'off';
    searchWrapper.appendChild(searchInput);
    menu.appendChild(searchWrapper);

    const listContainer = document.createElement('div');
    listContainer.className = 'model-menu-list';
    menu.appendChild(listContainer);

    const renderMenuContent = (filter = '') => {
        listContainer.innerHTML = '';
        const filtered = data.models.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()));
        
        if (filtered.length === 0) {
            const noRes = document.createElement('div');
            noRes.style.cssText = 'padding:12px; font-size:11px; color:var(--text-muted); text-align:center;';
            noRes.textContent = '找不到相符的模型';
            listContainer.appendChild(noRes);
            return;
        }

        filtered.forEach(m => {
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
            listContainer.appendChild(item);
        });
    };

    renderMenuContent();

    searchInput.onclick = (e) => e.stopPropagation();
    searchInput.oninput = (e) => renderMenuContent(e.target.value);

    document.querySelector('.chat-history').appendChild(menu);
    // Focus search input on open
    setTimeout(() => searchInput.focus(), 50);

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
    recommendListContainer.innerHTML = '';
    if (!recommendList.length) {
        recommendListContainer.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:11px;">推薦清單載入中...</div>';
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
        recommendListContainer.appendChild(empty);
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
        recommendListContainer.appendChild(header);

        items.forEach(item => {
            recommendListContainer.appendChild(createRecommendCard(item, false));
        });
    });

    // 2. Render Installed items at the absolute bottom
    if (installed.length > 0) {
        const header = document.createElement('div');
        header.className = 'sidebar-section-header';
        header.style.cssText = 'padding:20px 10px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent-green);opacity:0.8;';
        header.textContent = '── 已就緒 / 已安裝 ──';
        recommendListContainer.appendChild(header);

        installed.forEach(item => {
            recommendListContainer.appendChild(createRecommendCard(item, true));
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

function renderSidebarTab() {
    renderRecommendList();
    renderSopList();
    syncSidebarTabUI();
}

function syncSidebarTabUI() {
    $$('.sidebar-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.sidebarTab === activeSidebarTab);
    });
    recommendListContainer?.classList.toggle('active', activeSidebarTab === 'recommend');
    sopListContainer?.classList.toggle('active', activeSidebarTab === 'sops');
    if (recSearchInput) {
        recSearchInput.placeholder = activeSidebarTab === 'recommend'
            ? '搜尋推薦項目...'
            : '搜尋 SOP 名稱、ID 或分類...';
    }
}

function renderSopList() {
    if (!sopListContainer) return;
    sopListContainer.innerHTML = '';
    if (sopCount) sopCount.textContent = String(sopsList.length);

    if (!sopsList.length) {
        sopListContainer.innerHTML = '<div class="sidebar-empty">SOP 清單載入中...</div>';
        return;
    }

    const filtered = sopsList.filter(sop => {
        if (!recSearchQuery) return true;
        const searchStr = `${sop.name || ''} ${sop.id || ''} ${sop.category || ''}`.toLowerCase();
        return searchStr.includes(recSearchQuery);
    });

    if (sopCount) sopCount.textContent = String(filtered.length);

    if (!filtered.length) {
        sopListContainer.appendChild(createSidebarEmptyState('找不到相符的 SOP'));
        return;
    }

    const groups = {};
    filtered.forEach(sop => {
        const cat = sop.category || '其他';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(sop);
    });

    Object.entries(groups).forEach(([cat, items]) => {
        sopListContainer.appendChild(createSidebarSectionHeader(cat));
        items.forEach(sop => {
            sopListContainer.appendChild(createSopCard(sop));
        });
    });
}

function createSidebarSectionHeader(title, accented = false) {
    const header = document.createElement('div');
    header.className = `sidebar-section-header${accented ? ' accented' : ''}`;
    header.textContent = accented ? `-- ${title} --` : title;
    return header;
}

function createSidebarEmptyState(text) {
    const empty = document.createElement('div');
    empty.className = 'sidebar-empty';
    empty.textContent = text;
    return empty;
}

function createSopCard(sop) {
    const card = document.createElement('div');
    card.className = 'recommend-card sop-card';
    const requiresAdmin = /administrator|admin|uac/i.test(sop?.prerequisites?.permissions || '');
    const riskLabel = sop.riskLevel || '未標示';

    card.innerHTML = `
        <div class="recommend-card-top">
          <div class="recommend-title">${sop.name || sop.id}</div>
          <div class="recommend-btn-group sop-btn-group">
            <button class="btn-add-todo" title="加入清單">＋</button>
            <button class="btn-run-now" title="立即執行">▶</button>
          </div>
        </div>
        <div class="recommend-desc sop-id">${sop.id || ''}</div>
        <div class="recommend-meta">
          <span class="recommend-category">${sop.category || '其他'}</span>
          <span class="recommend-skill-badge">${requiresAdmin ? 'UAC / Admin' : '一般權限'}</span>
          <span class="recommend-skill-badge">風險 ${riskLabel}</span>
        </div>
    `;

    card.querySelector('.btn-add-todo')?.addEventListener('click', (e) => {
        e.stopPropagation();
        addSopToTodo(sop);
    });
    card.querySelector('.btn-run-now')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await addAndExecuteSop(sop);
    });
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
    if (data.success) { 
        todoList = data.todoList; 
        renderTodoList(); 
        addUILog(`＋ 已加入：${item.title}`, 'info'); 
        openTab('todolist');
    }
}

async function addAndExecuteRecommend(item) {
    const data = await api('/api/todo', {
        method: 'POST',
        body: { title: item.title, description: item.description, category: item.category, skillId: item.id },
    });
    if (data.success) {
        todoList = data.todoList;
        renderTodoList();
        openTab('todolist');
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
    // 如果目前正在處理中，點擊就是「中斷」
    if (btnSend.classList.contains('stop')) {
        if (chatAbortController) {
            chatAbortController.abort();
            chatAbortController = null;
        }
        return;
    }

    const msg = chatInput.value.trim();
    if (!msg) return;
    const chalkboardAttachment = isChalkboardAttachmentEnabled ? buildChalkboardChatAttachment() : null;
    chatInput.value = '';
    chatInput.style.height = '';

    appendChatBubble('user', chalkboardAttachment ? `${msg}\n\n[已附上 Chalkboard 草圖供 AI 參考]` : msg);
    const thinkId = appendThinking();

    // 初始化中斷控制
    chatAbortController = new AbortController();

    // 切換按鈕狀態為 Stop
    const iconSend = btnSend.querySelector('.icon-send');
    const iconStop = btnSend.querySelector('.icon-stop');
    btnSend.classList.add('stop');
    btnSend.title = '停止';
    iconSend?.classList.add('hidden');
    iconStop?.classList.remove('hidden');

    try {
        const data = await api('/api/chat', { 
            method: 'POST', 
            body: { message: msg, chalkboard: chalkboardAttachment },
            signal: chatAbortController.signal
        });

        removeThinking(thinkId);

        if (data.success) {
            // 移除舊的建議按鈕
            $$('.suggestions-container').forEach(el => el.remove());
            
            appendChatBubble('ai', data.reply, data.suggestions);
            if (data.task) {
                await loadTodo();
                openTab('todolist');
                if (todoList.length > 0) expandLog();
            }
            if (data.executeTaskId && !data.executeTaskId.includes('CLEAR') && !data.executeTaskId.includes('DELETE')) {
                executeTask(data.executeTaskId);
            }
        } else {
            appendChatBubble('ai', '抱歉，出現了點問題，請再試一次。');
        }
    } catch (err) {
        removeThinking(thinkId);
        if (err.name === 'AbortError') {
            appendChatBubble('ai', '使用者中斷');
        } else {
            console.error('[Chat] Error:', err);
            appendChatBubble('ai', '對話連線發生錯誤。');
        }
    } finally {
        // 恢復按鈕狀態
        btnSend.classList.remove('stop');
        btnSend.title = '送出';
        iconSend?.classList.remove('hidden');
        iconStop?.classList.add('hidden');
        chatAbortController = null;
    }
}

function appendChatBubble(role, text, suggestions = []) {
    const isAI = role === 'ai';
    const div = document.createElement('div');
    div.className = `message ${isAI ? 'ai-message' : 'user-message'}`;
    
    if (isAI) {
        // 設定 marked 選項 (若 library 已載入)
        const htmlContent = typeof marked !== 'undefined' ? marked.parse(text) : escapeHtml(text).replace(/\n/g, '<br>');
        
        let suggestionsHtml = '';
        if (suggestions && suggestions.length > 0) {
            suggestionsHtml = `
                <div class="suggestions-container">
                    ${suggestions.map(s => `<button class="btn-suggest">${escapeHtml(s)}</button>`).join('')}
                </div>`;
        }

        div.innerHTML = `
            <div class="msg-avatar-col">
                <div class="msg-avatar">🤖</div>
                <button class="btn-speak" title="宣讀回覆">
                    <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12">
                        <path fill-rule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.983 5.983 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.984 3.984 0 00-1.172-2.828 1 1 0 010-1.415z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>
            <div class="msg-bubble-wrapper">
                <div class="msg-bubble markdown-body">${htmlContent}</div>
                ${suggestionsHtml}
            </div>
        `;
        div.querySelector('.btn-speak').addEventListener('click', () => speakText(text, div.querySelector('.btn-speak')));
        
        // 建議按鈕點擊事件
        div.querySelectorAll('.btn-suggest').forEach(btn => {
            btn.addEventListener('click', () => {
                chatInput.value = btn.textContent;
                sendChat();
            });
        });
    } else {
        div.innerHTML = `
            <div class="msg-avatar">👤</div>
            <div class="msg-bubble">${escapeHtml(text)}</div>
        `;
    }
    
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
}

let speechSynth = window.speechSynthesis;
let currentUtterance = null;

function speakText(text, btn) {
    if (speechSynth.speaking) {
        speechSynth.cancel();
        if (currentUtterance && currentUtterance._btn) {
            currentUtterance._btn.classList.remove('speaking');
        }
        return;
    }

    // 移除 [ACTION:...] 標籤與 Emoji 再朗讀
    let cleanText = text.replace(/\[ACTION:.*?\]/g, '');
    // 移除常見的 Unicode Emoji
    cleanText = cleanText.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]/gu, '');
    cleanText = cleanText.trim();
    
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'zh-TW';
    utterance.rate = 1.0;
    utterance._btn = btn;

    utterance.onstart = () => btn.classList.add('speaking');
    utterance.onend = () => btn.classList.remove('speaking');
    utterance.onerror = () => btn.classList.remove('speaking');

    currentUtterance = utterance;
    speechSynth.speak(utterance);
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

function isLogPinnedToBottom() {
    const threshold = 24;
    if (activeBottomTab !== 'logs') return false;
    return logBody.scrollTop + logBody.clientHeight >= logBody.scrollHeight - threshold;
}

function isProgressLogMessage(message) {
    return /%|#{3,}|pulling|downloading|extracting|verifying|MB\s*\/|GB\s*\/|^\.\.\.\s*[\\\/|~-]$|[█▏▎▍▌▋▊▉]/i.test(message);
}

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
    const shouldStickToBottom = isLogPinnedToBottom();
    if (emptyEl) emptyEl.remove();

    // 檢查是否為進度條或是相似內容的重複更新 (Progress Update)
    // 判斷邏輯：包含百分比、或是包含一連串的 # 字符、或是有明確的 progress 標記
    // 加入 common 關鍵字如 pulling, downloading, extracting 等
    const isProgress = isProgressLogMessage(cleanMsg);
    const lastEntry = logEntries.lastElementChild;

    if (isProgress && lastEntry) {
        // 如果內容相似度高（例如都是下載進度）或最後一筆也是進度條，則原地更新
        const lastMsg = stripAnsi(lastEntry.querySelector('span:last-child')?.textContent || '');
        const isLastProgress = isProgressLogMessage(lastMsg);

        if (isLastProgress) {
            const time = logItem.timestamp ? new Date(logItem.timestamp).toLocaleTimeString('zh-TW', { hour12: false }) : '';
            lastEntry.className = `log-entry ${logItem.level || 'info'}`;
            lastEntry.innerHTML = `<span class="log-time">${time}</span><span>${escapeHtml(cleanMsg)}</span>`;
            if (shouldStickToBottom) {
                logBody.scrollTop = logBody.scrollHeight;
            }
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
    if (shouldStickToBottom) {
        logBody.scrollTop = logBody.scrollHeight;
    }
}

async function addSopToTodo(sop) {
    const data = await api('/api/todo', {
        method: 'POST',
        body: {
            title: sop.name || sop.id,
            description: sop.id || '',
            category: sop.category || 'SOP',
            skillId: sop.id
        },
    });
    if (data.success) {
        todoList = data.todoList;
        renderTodoList();
        addUILog(`＋ 已加入 SOP：${sop.name || sop.id}`, 'info');
        openTab('todolist');
    }
}

async function addAndExecuteSop(sop) {
    const data = await api('/api/todo', {
        method: 'POST',
        body: {
            title: sop.name || sop.id,
            description: sop.id || '',
            category: sop.category || 'SOP',
            skillId: sop.id
        },
    });
    if (data.success) {
        todoList = data.todoList;
        renderTodoList();
        openTab('todolist');
        const newTask = data.task || data.todoList[data.todoList.length - 1];
        if (newTask?.id) {
            addUILog(`▶ 開始執行 SOP：${sop.name || sop.id}`, 'info');
            appendChatBubble('ai', `🚀 正在啟動「${sop.name || sop.id}」...`);
            expandLog();
            await executeTask(newTask.id);
        }
    }
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

function switchBottomTab(tabId) {
    activeBottomTab = tabId === 'exps' ? 'exps' : 'logs';
    $$('.tab-row .tab[data-bottom-tab]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.bottomTab === activeBottomTab);
    });
    logBody?.classList.toggle('active', activeBottomTab === 'logs');
    expsBody?.classList.toggle('active', activeBottomTab === 'exps');
}

function renderExps() {
    if (!expEntries) return;
    expEntries.innerHTML = '';

    const filtered = (Array.isArray(expsEntries) ? expsEntries : []).filter((entry) => {
        const text = `${entry.title || ''} ${entry.content || ''} ${entry.sopId || ''}`.toLowerCase();
        const matchSearch = !expSearchQuery || text.includes(expSearchQuery);
        const matchSop = !expSopFilter || (entry.sopId || '') === expSopFilter;
        return matchSearch && matchSop;
    });

    if (expSopFilterSelect) {
        const sopIds = [...new Set((expsEntries || []).map((entry) => entry.sopId).filter(Boolean))].sort();
        expSopFilterSelect.innerHTML = '';
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = '全部 SOP';
        expSopFilterSelect.appendChild(allOption);
        sopIds.forEach((sopId) => {
            const option = document.createElement('option');
            option.value = sopId;
            option.textContent = sopId;
            expSopFilterSelect.appendChild(option);
        });
        if (!sopIds.includes(expSopFilter)) {
            expSopFilter = '';
        }
        expSopFilterSelect.value = expSopFilter;
    }

    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'log-empty';
        empty.textContent = expsEntries.length ? '找不到符合條件的經驗。' : '尚未累積安裝經驗...';
        expEntries.appendChild(empty);
        return;
    }

    filtered.forEach((entry) => {
        const card = document.createElement('article');
        card.className = 'exp-card';
        const htmlContent = typeof marked !== 'undefined'
            ? marked.parse(entry.content || '')
            : escapeHtml(entry.content || '').replace(/\n/g, '<br>');
        const updatedAt = entry.updatedAt
            ? new Date(entry.updatedAt).toLocaleString('zh-TW', { hour12: false })
            : '';

        card.innerHTML = `
            <div class="exp-card-header">
              <div class="exp-card-title">${escapeHtml(entry.title || entry.fileName || '未命名經驗')}</div>
              <div class="exp-card-meta">${escapeHtml(entry.sopId || 'dynamic')}<br>${escapeHtml(updatedAt)}</div>
            </div>
            <div class="exp-card-body">${htmlContent}</div>
        `;
        card.addEventListener('click', () => showExpDetail(entry));
        expEntries.appendChild(card);
    });
}

async function loadExps() {
    const data = await api('/api/exps');
    if (data.success) {
        expsEntries = Array.isArray(data.entries) ? data.entries : [];
        renderExps();
    }
}

function exportExps() {
    if (!expsEntries || expsEntries.length === 0) {
        addUILog('ℹ️ 目前沒有可匯出的 exps', 'info');
        return;
    }
    const md = expsEntries.map(e => {
        const ts = e.updatedAt ? new Date(e.updatedAt).toLocaleString('zh-TW', { hour12: false }) : '';
        return `# ${e.title || e.fileName || '未命名'}\n> SOP: ${e.sopId || 'dynamic'} | ${ts}\n\n${e.content || ''}\n\n---`;
    }).join('\n\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aipc-exps-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    addUILog(`✅ exps 已匯出 (${expsEntries.length} 筆)`, 'success');
}

function showExpDetail(entry) {
    modalTitle.textContent = entry.title || entry.fileName || '經驗詳情';
    const htmlContent = typeof marked !== 'undefined'
        ? marked.parse(entry.content || '')
        : escapeHtml(entry.content || '').replace(/\n/g, '<br>');
    const updatedAt = entry.updatedAt
        ? new Date(entry.updatedAt).toLocaleString('zh-TW', { hour12: false })
        : '';
    modalBody.innerHTML = `
        <div class="task-detail-row">
          <span class="task-detail-label">SOP</span>
          <span class="task-detail-value">${escapeHtml(entry.sopId || 'dynamic')}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">來源</span>
          <span class="task-detail-value">${escapeHtml(entry.fileName || '')}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">更新時間</span>
          <span class="task-detail-value">${escapeHtml(updatedAt)}</span>
        </div>
        <div style="margin-top:12px" class="exp-card-body">${htmlContent}</div>
    `;
    modalOverlay.classList.add('visible');
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
    const isLight = theme === 'light';
    if (isLight) document.documentElement.classList.add('theme-light');
    else document.documentElement.classList.remove('theme-light');
    
    // 更新圖示：暗色時顯示太陽，亮色時顯示月亮
    if (btnTheme) {
        if (isLight) {
            btnTheme.innerHTML = `
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>`;
            btnTheme.title = '切換至深色模式';
        } else {
            btnTheme.innerHTML = `
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4.243 3.05a1 1 0 010 1.414l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM14.243 14.95a1 1 0 01-1.414 0l-.707-.707a1 1 0 111.414-1.414l.707.707a1 1 0 010 1.414zM10 18a1 1 0 01-1-1v-1a1 1 0 112 0v1a1 1 0 01-1 1zm-4.243-3.05a1 1 0 010-1.414l.707-.707a1 1 0 111.414 1.414l-.707.707a1 1 0 01-1.414 0zM3 10a1 1 0 011-1h1a1 1 0 110 2H4a1 1 0 01-1-1zm3.05-4.243a1 1 0 011.414 0l.707.707a1 1 0 01-1.414 1.414l-.707-.707a1 1 0 010-1.414zM10 6a4 4 0 100 8 4 4 0 000-8z" clip-rule="evenodd" />
                </svg>`;
            btnTheme.title = '切換至淺色模式';
        }
    }
    
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
    api('/api/todo/export-file', { method: 'POST' }).then((data) => {
        if (data.success) {
            addUILog(`✅ 任務清單已匯出：${data.fileName || data.filePath}`, 'success');
            appendChatBubble('ai', `✅ 任務清單已匯出成功。`);
            return;
        }

        if (data.cancelled) {
            addUILog('ℹ️ 已取消匯出任務清單', 'info');
            return;
        }

        // fallback: 若原生另存失敗，仍嘗試瀏覽器下載
        const json = JSON.stringify(todoList, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aipc-tasks-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        addUILog(`⚠️ 原生匯出失敗，已改用瀏覽器下載：${data.error || 'Unknown error'}`, 'warn');
    });
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
        const transcript = e.results[0][0].transcript;
        const start = chatInput.selectionStart;
        const end = chatInput.selectionEnd;
        const text = chatInput.value;
        const before = text.substring(0, start);
        const after = text.substring(end);

        chatInput.value = before + transcript + after;

        // Move cursor to the end of the newly inserted text
        const newCursorPos = start + transcript.length;
        chatInput.setSelectionRange(newCursorPos, newCursorPos);
        chatInput.focus();

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
        220, () => getChatMaxWidth(),
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
            const maxWidth = typeof max === 'function' ? max() : max;
            const newW = Math.max(min, Math.min(maxWidth, startW + dx));
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
        if (saved.chatW) chatCol.style.width = Math.min(saved.chatW, getChatMaxWidth()) + 'px';
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
        renderSidebarTab();
    });

    sidebarTabs?.addEventListener('click', (e) => {
        const tab = e.target.closest('.sidebar-tab');
        if (!tab) return;
        activeSidebarTab = tab.dataset.sidebarTab || 'recommend';
        syncSidebarTabUI();
    });

    window.addEventListener('resize', () => {
        const maxChatWidth = getChatMaxWidth();
        if (chatCol.offsetWidth > maxChatWidth) {
            chatCol.style.width = maxChatWidth + 'px';
            saveLayout();
        }
        if (chalkboardState.resizeFrame) cancelAnimationFrame(chalkboardState.resizeFrame);
        chalkboardState.resizeFrame = requestAnimationFrame(() => {
            resizeChalkboardCanvas();
            chalkboardState.resizeFrame = null;
        });
    });

    // Theme
    btnTheme?.addEventListener('click', cycleTheme);
    btnChalkAttach?.addEventListener('click', toggleChalkboardAttachment);
    btnExpsExport?.addEventListener('click', exportExps);
    syncChalkAttachButton();

    // AI Provider 點擊打開設定
    llmStatus?.addEventListener('click', openProviderSettings);
    chatModelBadge?.addEventListener('click', toggleModelMenu);
    btnCloseProviderModal?.addEventListener('click', () => providerSettingsOverlay.classList.remove('visible'));
    providerSettingsOverlay?.addEventListener('click', (e) => { if (e.target === providerSettingsOverlay) providerSettingsOverlay.classList.remove('visible'); });
    btnCloseTextToolModal?.addEventListener('click', () => closeTextToolModal(false));
    btnCancelTextTool?.addEventListener('click', () => closeTextToolModal(false));
    btnApplyTextTool?.addEventListener('click', () => closeTextToolModal(true));
    textToolOverlay?.addEventListener('click', (e) => { if (e.target === textToolOverlay) closeTextToolModal(false); });
    textToolContent?.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            closeTextToolModal(true);
        }
    });
    btnTestProviderSettings?.addEventListener('click', testProviderSettings);
    btnSaveProviderSettings?.addEventListener('click', saveProviderSettings);

    // Layout Toggles
    btnToggleSidebar?.addEventListener('click', toggleSidebar);
    btnTogglePanel?.addEventListener('click', toggleLog);
    btnToggleChat?.addEventListener('click', toggleChat);
    updateLayoutButtons();

    // 初始化 Provider 下拉選單
    if (settingProvider) {
        const providerOptions = Object.keys(PROVIDER_DEFAULTS).map(p => `<option value="${p}">${getProviderDisplayLabel(p)}</option>`).join('');
        settingProvider.innerHTML = providerOptions;
        
        // 當切換 Provider 時，自動帶入預設 URL
        settingProvider.addEventListener('change', (e) => {
            const val = e.target.value;
            if (PROVIDER_DEFAULTS[val]) {
                settingBaseUrl.value = PROVIDER_DEFAULTS[val];
            }
            syncProviderAuthUI(val);
            onProviderChange(val);
        });

        // 當 URL 或 API Key 改變時，自動刷新模型清單 (Debounced)
        const debouncedRefresh = debounce(() => onProviderChange(settingProvider.value), 800);
        settingBaseUrl?.addEventListener('input', debouncedRefresh);
        settingApiKey?.addEventListener('input', debouncedRefresh);
        settingApiKey2?.addEventListener('input', debouncedRefresh);
        settingTokenUrl?.addEventListener('input', debouncedRefresh);
        settingClientId?.addEventListener('input', debouncedRefresh);
        settingClientSecret?.addEventListener('input', debouncedRefresh);
        settingScope?.addEventListener('input', debouncedRefresh);
        settingAudience?.addEventListener('input', debouncedRefresh);
        settingAuthType?.addEventListener('change', () => {
            syncProviderAuthUI(settingProvider.value);
            onProviderChange(settingProvider.value);
        });
        btnRefreshModels?.addEventListener('click', () => onProviderChange(settingProvider.value));
    }

    // Export / Import
    btnExport?.addEventListener('click', exportTasks);
    btnImport?.addEventListener('click', () => importFileInput?.click());
    importFileInput?.addEventListener('change', (e) => { if (e.target.files[0]) importTasks(e.target.files[0]); });

    // Toggle log
    btnToggleLog?.addEventListener('click', toggleLog);
    $$('.tab-row .tab[data-bottom-tab]').forEach((tab) => {
        tab.addEventListener('click', () => switchBottomTab(tab.dataset.bottomTab));
    });
    expSearchInput?.addEventListener('input', (e) => {
        expSearchQuery = String(e.target.value || '').trim().toLowerCase();
        renderExps();
    });
    expSopFilterSelect?.addEventListener('change', (e) => {
        expSopFilter = e.target.value || '';
        renderExps();
    });

    // Modal close
    btnCloseModal?.addEventListener('click', () => modalOverlay.classList.remove('visible'));
    modalOverlay?.addEventListener('click', (e) => { if (e.target === modalOverlay) modalOverlay.classList.remove('visible'); });

    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            modalOverlay.classList.remove('visible');
            closeTextToolModal(false);
        }
    });

    // Center Tabs
    $('#centerTabStrip')?.addEventListener('click', (e) => {
        const item = e.target.closest('.tab-item');
        if (!item) return;
        const tabId = item.dataset.tab;
        
        if (tabId === 'hardware') {
            updateHardwareStatus();
        }
        
        if (e.target.closest('.tab-close')) {
            e.stopPropagation();
            closeTab(tabId);
            return;
        }
        switchTab(tabId);
    });

    // Menu Bar
    $('#menuView')?.addEventListener('click', toggleViewMenu);
    switchBottomTab(activeBottomTab);
}

// ── Tab Management ─────────────────────────────────────
function switchTab(tabId) {
    if (!openTabs.includes(tabId)) return;
    activeTab = tabId;
    
    // Update tabs UI
    $$('.tab-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tab === tabId);
    });
    
    // Update content UI
    $$('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `content-${tabId}`);
    });

    // 硬體監控：切換到該分頁時才啟動，切離則關閉
    if (tabId === 'hardware') {
        startHardwarePolling();
    } else {
        stopHardwarePolling();
    }

    if (tabId === 'chalkboard') {
        requestAnimationFrame(() => resizeChalkboardCanvas());
    }
}

function openTab(tabId) {
    if (!openTabs.includes(tabId)) {
        openTabs.push(tabId);
        const tabEl = $(`#tab-${tabId}`);
        if (tabEl) tabEl.classList.remove('hidden');
    }
    switchTab(tabId);
}

function closeTab(tabId) {
    if (tabId === 'chalkboard') return; // Cannot close chalkboard
    
    openTabs = openTabs.filter(id => id !== tabId);
    const tabEl = $(`#tab-${tabId}`);
    if (tabEl) tabEl.classList.add('hidden');
    
    if (activeTab === tabId) {
        switchTab('chalkboard');
    }

    if (tabId === 'hardware') {
        stopHardwarePolling();
    }
}

// ── View Menu Logic ─────────────────────────────────────
function toggleViewMenu(e) {
    let menu = document.querySelector('.view-dropdown');
    if (menu) { menu.remove(); return; }

    menu = document.createElement('div');
    menu.className = 'view-dropdown menu-dropdown';
    
    const items = [
        { id: 'chalkboard', label: '🎨 Chalkboard', icon: '🎨' },
        { id: 'hardware', label: '🌡️ 硬體狀態', icon: '🌡️' },
        { id: 'todolist', label: '📋 工作清單', icon: '📋' }
    ];

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'menu-dropdown-item';
        const isOpen = openTabs.includes(item.id);
        div.innerHTML = `
            <span>${item.label}</span>
            <span style="font-size:10px; opacity:0.6">${isOpen ? '（已開啟）' : ''}</span>
        `;
        div.onclick = () => {
            openTab(item.id);
            menu.remove();
        };
        menu.appendChild(div);
    });

    document.body.appendChild(menu);
    const rect = e.target.getBoundingClientRect();
    menu.style.top = rect.bottom + 'px';
    menu.style.left = rect.left + 'px';

    // Close on outside click
    setTimeout(() => {
        const closer = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', closer);
            }
        };
        document.addEventListener('click', closer);
    }, 0);
}

// ════════════════════════════════════════════════════════
//  UTIL
// ════════════════════════════════════════════════════════
/**
 * 開啟 AI 設定視窗
 */
async function openProviderSettings() {
    const data = await api('/api/llm/config');
    if (data.success) {
        settingProvider.value = data.provider || 'Ollama';
        settingBaseUrl.value = data.baseUrl || 'http://127.0.0.1:11434/v1';
        settingApiKey.value = data.apiKey || '';
        settingAuthType.value = data.authType || ((data.apiKey || '').trim() ? 'api_key' : 'none');
        settingApiKey2.value = data.apiKey || '';
        settingTokenUrl.value = data.authConfig?.tokenUrl || '';
        settingClientId.value = data.authConfig?.clientId || '';
        settingClientSecret.value = data.authConfig?.clientSecret || '';
        settingScope.value = data.authConfig?.scope || '';
        settingAudience.value = data.authConfig?.audience || '';
        if (settingVisionModelName) settingVisionModelName.value = data.visionModel || '';
        syncProviderAuthUI(settingProvider.value);
        
        // 切換 UI 狀態
        await onProviderChange(data.provider, data.model, data.visionModel || '');
        
        providerSettingsOverlay.classList.add('visible');
    }
}

/**
 * 當 Provider 改變時處理 Model 名稱欄位
 */
async function onProviderChange(provider, currentModel = '', currentVisionModel = '') {
    syncProviderAuthUI(provider);
    // 判斷哪些 Provider 支援模型下拉清單
    const supportList = ['Ollama', 'Ollama Cloud', 'NVIDIA NIM', 'Mistral', 'Together AI', 'Groq', 'OpenAI', 'DeepSeek'];
    
    // 如果沒帶 currentModel，嘗試抓取目前下拉選單的值（保留選取項）
    if (!currentModel && settingModelSelect.value) {
        currentModel = settingModelSelect.value;
    }
    if (!currentVisionModel) {
        const isVisionDropdown = settingVisionModelSelect?.style.display === 'block';
        currentVisionModel = isVisionDropdown ? (settingVisionModelSelect?.value || '') : (settingVisionModelName?.value.trim() || '');
    }

    const baseUrl = settingBaseUrl.value.trim();
    const authConfig = getAuthPayload();

    if (supportList.includes(provider)) {
        settingModelName.style.display = 'none';
        settingModelSelect.style.display = 'block';
        if (btnRefreshModels) btnRefreshModels.style.display = 'inline-block';
        
        // 抓取模型清單
        settingModelSelect.innerHTML = '<option value="">正在載入模型清單...</option>';
        try {
            // 切換為 POST 請求以支援帶有特殊符號的 API Key 並避免長 URL 問題
            const data = await api('/api/llm/models', {
                method: 'POST',
                body: { provider, baseUrl, authConfig }
            });
            
            if (data.success && data.models.length > 0) {
                settingModelSelect.innerHTML = data.models.map(m => 
                    `<option value="${m.name}" ${m.name === currentModel ? 'selected' : ''}>${m.name}</option>`
                ).join('');
                syncVisionModelInputs(true, currentVisionModel, data.models);
            } else {
                settingModelSelect.innerHTML = '<option value="">(無可用模型，請手動確認)</option>';
                // 若無清單，切換回手動輸入以防萬一
                settingModelName.style.display = 'block';
                settingModelSelect.style.display = 'none';
                settingModelName.value = currentModel;
                syncVisionModelInputs(false, currentVisionModel);
                if (btnRefreshModels) btnRefreshModels.style.display = 'none';
            }
        } catch (e) {
            settingModelSelect.innerHTML = `<option value="">(無法連線至 ${provider})</option>`;
            settingModelName.style.display = 'block';
            settingModelSelect.style.display = 'none';
            settingModelName.value = currentModel;
            syncVisionModelInputs(false, currentVisionModel);
            if (btnRefreshModels) btnRefreshModels.style.display = 'none';
        }
    } else {
        settingModelName.style.display = 'block';
        settingModelSelect.style.display = 'none';
        settingModelName.value = currentModel;
        syncVisionModelInputs(false, currentVisionModel);
        if (btnRefreshModels) btnRefreshModels.style.display = 'none';
    }
}

/**
 * 儲存 AI 設定
 */
async function saveProviderSettings() {
    const provider = settingProvider.value;
    const baseUrl = settingBaseUrl.value.trim();
    const authConfig = getAuthPayload();
    const isDropdown = (settingModelSelect.style.display === 'block');
    const model = isDropdown ? settingModelSelect.value : settingModelName.value.trim();
    const isVisionDropdown = (settingVisionModelSelect?.style.display === 'block');
    const visionModel = isVisionDropdown ? settingVisionModelSelect.value : settingVisionModelName.value.trim();

    if (!baseUrl) return alert('請輸入 API Base URL');
    if (authConfig.type === 'oauth_client_credentials' && (!authConfig.tokenUrl || !authConfig.clientId || !authConfig.clientSecret)) {
        return alert('OAuth 模式請完整填入 Token URL、Client ID、Client Secret');
    }

    const data = await api('/api/llm/config', {
        method: 'POST',
        body: { provider, baseUrl, authConfig, model, visionModel }
    });

    if (data.success) {
        providerSettingsOverlay.classList.remove('visible');
        addUILog('🚀 AI 引擎設定已更新，正在重新啟動服務...', 'success');

        // 立即更新 UI 上的模型名稱
        if (chatModelBadge && model) {
            chatModelBadge.textContent = model;
            chatModelBadge.style.display = 'inline-block';
            chatModelBadge.title = `當前模型: ${model} (點擊切換)`;
        }

        // 重新整理頁面以套用新設定
        setTimeout(() => location.reload(), 1000);
    } else {
        alert('儲存失敗: ' + (data.error || '不明錯誤'));
    }
}

async function testProviderSettings() {
    const provider = settingProvider.value;
    const baseUrl = settingBaseUrl.value.trim();
    const authConfig = getAuthPayload();
    const isDropdown = (settingModelSelect.style.display === 'block');
    const model = isDropdown ? settingModelSelect.value : settingModelName.value.trim();

    if (!baseUrl) return alert('請輸入 API Base URL');
    if (!model) return alert('請先輸入或選擇模型名稱');
    if (authConfig.type === 'oauth_client_credentials' && (!authConfig.tokenUrl || !authConfig.clientId || !authConfig.clientSecret)) {
        return alert('OAuth 模式請完整填入 Token URL、Client ID、Client Secret');
    }

    btnTestProviderSettings.disabled = true;
    btnTestProviderSettings.textContent = '測試中...';

    const data = await api('/api/llm/test', {
        method: 'POST',
        body: { provider, baseUrl, authConfig, model }
    });

    btnTestProviderSettings.disabled = false;
    btnTestProviderSettings.textContent = '測試模型';

    if (data.success) {
        addUILog(`🧪 模型測試成功：${provider} / ${model}`, 'success');
        alert(`測試成功\n\nProvider: ${provider}\nModel: ${model}\nReply: ${data.reply || 'OK'}`);
    } else {
        addUILog(`🧪 模型測試失敗：${provider} / ${model} - ${data.error || 'Unknown error'}`, 'error');
        alert(`測試失敗\n\n${data.error || 'Unknown error'}`);
    }
}

function getChatMaxWidth() {
    const workspace = document.querySelector('.workspace');
    if (!workspace) return 600;
    return Math.max(220, Math.floor(workspace.clientWidth / 2));
}

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

/**
 * 佈局切換功能
 */
function updateLayoutButtons() {
    btnToggleSidebar?.classList.toggle('active', !isSidebarCollapsed);
    btnTogglePanel?.classList.toggle('active', !isLogCollapsed);
    btnToggleChat?.classList.toggle('active', !isChatCollapsed);
}

function toggleSidebar() {
    isSidebarCollapsed = !isSidebarCollapsed;
    sidebar.classList.toggle('collapsed', isSidebarCollapsed);
    $('#sidebarResizer')?.classList.toggle('hidden', isSidebarCollapsed);
    updateLayoutButtons();
    addUILog(isSidebarCollapsed ? '側邊欄已收起' : '側邊欄已展開', 'info');
}

function toggleLog() {
    isLogCollapsed = !isLogCollapsed;
    logPanel.classList.toggle('collapsed', isLogCollapsed);
    $('#logResizer')?.classList.toggle('hidden', isLogCollapsed);
    updateLayoutButtons();
    if (btnToggleLog) btnToggleLog.textContent = isLogCollapsed ? '展開 ▲' : '收起 ▼';
    addUILog(isLogCollapsed ? '日誌面板已收起' : '日誌面板已展開', 'info');
}

function toggleChat() {
    isChatCollapsed = !isChatCollapsed;
    chatCol.classList.toggle('collapsed', isChatCollapsed);
    $('#chatResizer')?.classList.toggle('hidden', isChatCollapsed);
    updateLayoutButtons();
    addUILog(isChatCollapsed ? '對話欄已收起' : '對話欄已展開', 'info');
}

function startHardwarePolling() {
    if (hardwareInterval) return;
    updateHardwareStatus(); // 立即執行一次
    hardwareInterval = setInterval(updateHardwareStatus, 5000);
    console.log('[System] Hardware polling started.');
}

function stopHardwarePolling() {
    if (hardwareInterval) {
        clearInterval(hardwareInterval);
        hardwareInterval = null;
        console.log('[System] Hardware polling stopped.');
    }
}

/**
 * 獲取並更新硬體狀態 UI
 */
async function updateHardwareStatus() {
    try {
        const res = await fetch(`${API}/api/system/health`);
        const data = await res.json();
        if (data.success) {
            const h = data.health;
            const CIRCUMFERENCE = 251.2;

            const setGauge = (id, percent) => {
                const el = document.getElementById(`gauge-${id}`);
                const txt = document.getElementById(`hw-${id}-load`) || document.getElementById(`hw-${id}-usage`);
                if (el) {
                    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
                    el.style.strokeDashoffset = offset;
                }
                if (txt) txt.textContent = `${percent}%`;
            };

            // CPU
            setGauge('cpu', h.cpu.load);
            if ($('#hw-cpu-model')) $('#hw-cpu-model').textContent = h.cpu.model;
            if ($('#hw-cpu-temp')) $('#hw-cpu-temp').textContent = h.cpu.temp ? `${h.cpu.temp}°C` : '';

            // GPU
            setGauge('gpu', h.gpu.load);
            if ($('#hw-gpu-name')) $('#hw-gpu-name').textContent = h.gpu.name || 'N/A';
            if ($('#hw-gpu-temp')) $('#hw-gpu-temp').textContent = h.gpu.temp ? `${h.gpu.temp}°C` : '';

            // RAM
            setGauge('ram', h.ram.usage);
            const ramTotalGB = Math.round(h.ram.total / 1024 / 1024 / 1024);
            const ramUsedGB = (h.ram.total - h.ram.free) / 1024 / 1024 / 1024;
            if ($('#hw-ram-total')) $('#hw-ram-total').textContent = `${ramUsedGB.toFixed(1)} GB of ${ramTotalGB}GB`;

            // Disk (以第一個硬碟為代表)
            if (h.disk.drives && h.disk.drives.length > 0) {
                const mainDisk = h.disk.drives[0];
                const diskGauge = document.getElementById('gauge-disk');
                const mainVolume = Array.isArray(h.disk.volumes) && h.disk.volumes.length > 0 ? h.disk.volumes[0] : null;
                
                // 健康 = 100%, 警告 = 50%, 危險 = 20%
                let healthScore = 100;
                if (mainDisk.health === 'Warning') healthScore = 50;
                if (mainDisk.health === 'Unhealthy' || h.disk.status === 'Warning') healthScore = 20;

                if (diskGauge) {
                    diskGauge.style.strokeDashoffset = CIRCUMFERENCE - (healthScore / 100) * CIRCUMFERENCE;
                    diskGauge.style.stroke = healthScore === 100 ? 'var(--accent-green)' : (healthScore === 50 ? 'orange' : 'var(--accent-red)');
                }
                if ($('#hw-disk-status')) $('#hw-disk-status').textContent = `${healthScore}%`;
                if ($('#hw-disk-name')) {
                    $('#hw-disk-name').textContent = mainVolume
                        ? `S.M.A.R.T: ${mainDisk.name} | ${mainVolume.name} free ${Math.round(mainVolume.free / 1024 / 1024 / 1024)}GB`
                        : `S.M.A.R.T: ${mainDisk.name}`;
                }
            }

            if ($('#hw-last-update')) {
                const now = new Date();
                $('#hw-last-update').textContent = `上次更新: ${now.toLocaleTimeString()}`;
            }
        }
    } catch (e) {
        console.error('[System] Update hardware status failed:', e);
    }
}

// ── Start ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

// Hotkeys
document.addEventListener('keydown', (e) => {
    // Ctrl+B: Toggle Sidebar
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyB') {
        e.preventDefault();
        toggleSidebar();
    }
    // Ctrl+J: Toggle Panel
    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyJ') {
        e.preventDefault();
        toggleLog();
    }
    // Ctrl+Alt+B: Toggle Chat
    if (e.ctrlKey && e.altKey && e.code === 'KeyB') {
        e.preventDefault();
        toggleChat();
    }
});
