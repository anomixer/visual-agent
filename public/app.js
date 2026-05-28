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
let skillsList = [];
let pollingInterval = null;
let chatAbortController = null;
let localChatAbortController = null;
let remoteChatAbortController = null;
let localThinkingId = '';
let remoteThinkingId = '';
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
let currentLocale = localStorage.getItem('ui_locale') || 'zh-TW';
let activeChatMode = 'local';
let remoteProfile = null;
let remoteProfileDirty = false;
let remoteState = { sessions: [], pendingApprovals: [], localIps: [], port: 19168 };
let selectedRemoteSessionId = localStorage.getItem('selected_remote_session_id') || '';

let remoteStateInterval = null;
let pendingRemoteRequestId = '';
let localChatSessions = [];
let selectedLocalChatSessionId = localStorage.getItem('selected_local_chat_session_id') || '';
let mentionCandidates = [];
let activeMentionIndex = 0;
let remotePendingRoles = { local: false, remote: false };
let browserInstallQueued = false;
let pendingModelShareSessionId = '';
let remoteToolbarCollapsed = localStorage.getItem('remote_toolbar_collapsed') === '1';
let chalkboardHintTimer = null;
let chalkboardHintClickDismissHandler = null;
let suppressRemoteChalkboardSync = false;
let remoteChalkboardSyncTimer = null;
let remoteChalkboardApplyTimer = null;
let queuedRemoteChalkboardMessage = null;
const appliedRemoteChalkboardMessageIds = new Set();
const appliedRemoteDraftMessageIds = new Set();
const handledRemoteAiActionMessageIds = new Set();
const recentRemoteDirectiveExecutions = new Map();
const remoteSessionsOpenedOnChalkboard = new Set();
const notifiedRemoteDisconnectSessionIds = new Set();
const REMOTE_DIRECTIVE_DEDUP_WINDOW_MS = 8000;
let lastRemoteRenderSignature = '';

// Tab State
let activeTab = 'chalkboard';
let openTabs = ['chalkboard', 'hardware']; // Browser tab appears after Chromium is installed
let browserTabState = {
    started: false,
    currentUrl: '',
    snapshotTimer: null,
};
let browserRuntimeReady = false;

// ── DOM ───────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Panel refs
const sidebar = $('#sidebar');
const recommendListContainer = $('#recommendListContainer');
const sopListContainer = $('#sopListContainer');
const skillListContainer = $('#skillListContainer');
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
const skillCount = $('#skillCount');
const logEntries = $('#logEntries');
const expEntries = $('#expEntries');
const expSearchInput = $('#expSearchInput');
const expSopFilterSelect = $('#expSopFilter');
const btnExpsExport = $('#btnExpsExport');
const statusVersion = $('#statusVersion');
const btnLang = $('#btnLang');
const chatMessages = $('#chatMessages');
const remoteChatMessages = $('#remoteChatMessages');
const chatInput = $('#chatInput');
const mentionMenu = $('#mentionMenu');
const btnSend = $('#btnSend');
const btnMic = $('#btnMic');
const btnChalkAttach = $('#btnChalkAttach');
const btnNewLocalSession = $('#btnNewLocalSession');
const btnClearChat = $('#btnClearChat');
const chatModeTabs = $('#chatModeTabs');
const localChatTabs = $('#localChatTabs');
const localChatPane = $('#localChatPane');
const remoteChatPane = $('#remoteChatPane');
const remoteSessionStatus = $('#remoteSessionStatus');
const remoteHostInput = $('#remoteHostInput');
const remoteAgentNameInput = $('#remoteAgentNameInput');
const remoteUserNameInput = $('#remoteUserNameInput');
const remoteSessionSelect = $('#remoteSessionSelect');
const remoteSendMode = $('#remoteSendMode');
const remoteChatHint = $('#remoteChatHint');
const remoteSessionQuickList = $('#remoteSessionQuickList');
const remoteChatToolbar = $('#remoteChatToolbar');
const btnRemoteToolbarToggle = $('#btnRemoteToolbarToggle');
const remoteToolbarBody = $('#remoteToolbarBody');
const btnRemoteConnect = $('#btnRemoteConnect');
const btnSaveRemoteProfile = $('#btnSaveRemoteProfile');
const btnShareScreen = $('#btnShareScreen');
const btnRemoteAttachFile = $('#btnRemoteAttachFile');
const remoteFileInput = $('#remoteFileInput');
const btnDisconnectRemote = $('#btnDisconnectRemote');
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
const chalkRedoButton = $('#chalkRedoButton');
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
const remoteRequestOverlay = $('#remoteRequestOverlay');
const remoteRequestTitle = $('#remoteRequestTitle');
const remoteRequestSummary = $('#remoteRequestSummary');
const remoteRequestDetails = $('#remoteRequestDetails');
const remoteRequestTimeout = $('#remoteRequestTimeout');
const btnAcceptRemoteRequest = $('#btnAcceptRemoteRequest');
const btnRejectRemoteRequest = $('#btnRejectRemoteRequest');
const chalkboardFloatHint = $('#chalkboardFloatHint');
const browserBackBtn = $('#browserBackBtn');
const browserForwardBtn = $('#browserForwardBtn');
const browserReloadBtn = $('#browserReloadBtn');
const browserGoBtn = $('#browserGoBtn');
const browserOpenExternalBtn = $('#browserOpenExternalBtn');
const browserUrlInput = $('#browserUrlInput');
const browserStatusText = $('#browserStatusText');
const browserStatusAction = $('#browserStatusAction');
const browserPageTitle = $('#browserPageTitle');
const browserSnapshotImage = $('#browserSnapshotImage');
const browserEmptyState = $('#browserEmptyState');

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

const I18N = {
    'zh-TW': {
        localeLabel: '繁體中文',
        splash: {
            firstRun: '首次執行本程式，正設定環境中，請稍候...',
            starting: '啟動後端伺服器中，請稍候...',
        },
        titlebar: {
            file: '檔案',
            view: '檢視',
            help: '說明',
            aiReady: 'AI 就緒',
            modelNotReady: '模型未就緒',
            engineNotReady: 'AI 引擎未就緒',
            aiSettings: '設定 AI 引擎',
            toggleSidebar: '切換側邊欄 (Ctrl+B)',
            toggleLog: '切換任務日誌 (Ctrl+J)',
            toggleChat: '切換 AI 對話 (Ctrl+Alt+B)',
            refresh: 'Refresh畫面',
            exit: 'Exit',
        },
        footer: {
            tasks: '{count} 個任務',
            switchTo: '切換成 English',
            importTasks: '匯入任務清單',
            exportTasks: '匯出任務清單',
        },
        tabs: {
            recommend: '💡 推薦清單',
            sops: '📚 SOP 清單',
            hardware: '硬體狀態',
            todolist: '工作清單',
            logs: '📝 任務日誌',
            emptyMessage: '等待任務執行...',
            exps: '🧠 經驗庫',
            aiChat: '💬 AI 對話',
            chalkboard: 'Chalkboard',
        },
        chalkboardWelcome: {
            title: '歡迎使用 AI PC Agent',
            body: '這裡可以快速啟動推薦工具與瀏覽器。請從左側推薦清單選擇工具，或是直接與 AI 對話。',
            warn: '⚠️ AI Agent 很強大，但也可能犯錯，導致系統有風險，敬請仔細查證並小心下指令。',
            hintTitle: '用粉筆直接畫',
            hintBody: '選一支粉筆，直接在黑板上塗寫，板擦可清空畫布。也可把想法畫出來給 AI 看。',
        },
        ui: {
            opened: '（已開啟）',
        },
        chat: {
            clear: '清除對話',
            mic: '語音輸入',
            attachChalkboard: '附上 Chalkboard',
            hint: 'Enter 送出 · Shift+Enter 換行',
            modelBadge: 'AI 模型',
            switchModel: '切換模型',
            placeholder: '告訴我你需要什麼... 例如「幫我移除 Copilot」',
            send: '送出',
            connectionError: '對話連線發生錯誤。',
            localSessionNew: '新增對話',
            localSessionDefault: '本機對話',
            pendingRowLocal: '本地 AI',
            pendingRowRemote: '遠端 AI',
            pendingIdle: '待命',
            pendingBusy: '思考中',
        },
        remote: {
            localTab: '💬 本機 AI',
            remoteTab: '遠端 AI',
            disconnected: '未連線',
            connecting: '連線中',
            connected: '已連線',
            pending: '等待允許',
            connect: '連線',
            saveProfile: '儲存名稱',
            disconnect: '中斷',
            disconnectConfirm: '確定要中斷目前遠端連線嗎？',
            deleteRemoteSessionConfirm: '確定要刪除此遠端對話 tab 嗎？',
            keepActiveRemoteSession: '目前連線中的遠端 tab 不能刪除，請先中斷連線。',
            shareScreen: '傳送畫面',
            attachFile: '附上檔案',
            connectionSettings: '連線設定',
            shareScreenConfirm: '對方將能查看你分享的畫面內容。\n\n注意：別分享機敏資訊。',
            hostPlaceholder: '輸入對方 IP，例如 192.168.1.88',
            agentPlaceholder: 'AI 名稱',
            userPlaceholder: '使用者名稱',
            waitingHint: '等待遠端連線。Port: 19168',
            acceptedHint: '您已接受對話。請開始聊天或支援',
            requestTitle: '遠端連線請求',
            requestSummary: '有另一台 AI PC Agent 想要與您通訊',
            accept: '允許',
            reject: '拒絕',
            requestAccepted: '您已接受對話。請開始聊天或支援',
            profileSaved: '遠端身份設定已儲存',
            connectSuccess: '已送出連線請求，等待對方允許',
            connectFailed: '遠端連線失敗：{error}',
            invitationTimeout: '連線邀請已逾時。',
            invitationCancelled: '連線邀請已取消。',
            peerCancelledInvitation: '對方已取消連線邀請。',
            inviteCountdown: '剩餘 {seconds} 秒',
            bannedRemaining: '暫時無法連線，{seconds} 秒後解除限制。',
            noSession: '請先建立或選擇遠端連線',
            screenShared: '畫面已傳送給對方',
            screenFailed: '畫面傳送失敗：{error}',
            saveImage: '另存圖片',
            imageSaved: '共享畫面已儲存：{fileName}',
            modeUser: '以我發送',
            modeLocalAi: '以本機 AI 發送',
            remoteAiTarget: '遠端 AI',
            remoteUserTarget: '遠端使用者',
            connectDetails: '機器名稱：{machineName}\n使用者名稱：{userName}\nAI 名稱：{agentName}\nIP：{ip}\n說明：是否接受對方連線？接受後，你們雙方與 AI 對話就能互通有無。',
            peerDisconnected: '對方已斷線',
            fileAttached: '已附上檔案：{fileName}',
            fileTooLarge: '檔案太大，請選擇 256KB 以下文字檔',
        },
        exps: {
            searchPlaceholder: '搜尋經驗、關鍵字...',
            exportButton: '⬇ 匯出',
            exportTooltip: '匯出所有 exps 為 Markdown',
            emptyMessage: '尚未累積安裝經驗...',
            noExpsToExport: '目前沒有可匯出的 exps',
            exportSuccess: 'exps 已匯出：{fileName}',
            exportCancelled: '已取消匯出 exps',
            exportFallback: '原生匯出 exps 失敗，已改用瀏覽器下載：{error}',
        },
        settings: {
            title: 'AI 引擎設定',
            provider: 'AI Provider',
            helpTitle: '快速設定',
            helpText: '選擇 AI 引擎後，系統會提示你需要 API Key、模型名稱，或本地服務網址。',
            baseUrl: '連線網址 (Base URL)',
            baseUrlPlaceholder: '例如: http://localhost:11434/v1',
            authType: '認證方式',
            authNone: '無認證',
            authApiKey: 'API Key',
            authOAuth: 'OAuth 2.0 Client Credentials',
            apiKey: 'API Key',
            apiKeyPlaceholder: 'Bearer Token / API Key',
            modelName: '模型名稱 (Model Name)',
            modelNamePlaceholder: '例如: qwen3.5:4b',
            visionModel: 'Vision 多模態模型',
            visionModelPlaceholder: '留空則自動挑選可看圖模型',
            refresh: '🔄 刷新清單',
            modelHelp: '雲端模型通常需要手動填入 model 名稱，本地引擎可直接從清單選擇。',
            visionHelp: currentLocale === "en-US" ? "Used for reading Chalkboard sketches and multi-modal content. Leave empty for auto-selection." : "用於讀取 Chalkboard 草圖、上傳圖片與其他多模態內容。留空時，系統會自動挑選同 Provider 的 vision 模型。",
            test: '測試模型',
            textToolTitle: '文字工具',
            save: '儲存並刷新',
            updated: 'AI 引擎設定已更新，正在重新啟動服務...',
        },
        llm: {
            modelSwitched: '模型已切換至: {modelName}',
            modelSwitchedChat: '我現在切換到 **{modelName}** 囉！隨時可以開始對話。',
        },
        textTool: {
            title: '文字工具',
            content: '文字內容',
            contentPlaceholder: '輸入要放上黑板的文字',
            fontFamily: '字型',
            fontStyle: '字型風格',
            fontSize: '字級',
            color: '文字顏色',
            align: '對齊方式',
            bold: '粗體',
            italic: '斜體',
            usage: '使用方式',
            usageText: '按下「建立文字框」後，到黑板上點一下放出文字框，再拖曳移動或拉 8 個控制點縮放，點框外即可定稿。',
            cancel: '取消',
            apply: '建立文字框',
            fontOptions: {
                kaiti: '標楷體',
                jhenghei: '微軟正黑體',
                yahei: '黑體',
                mingliu: '細明體',
                arial: 'Arial',
                timesnewroman: 'Times New Roman',
                couriernew: 'Courier New',
            },
            styleOptions: {
                chalk: '粉筆手寫',
                board: '板書感',
                clean: '清晰無襯線',
                serif: '經典襯線',
                mono: '等寬打字',
            },
            alignOptions: {
                left: '靠左',
                center: '置中',
                right: '靠右',
            },
        },
        chalkboard: {
            exportSuccess: '黑板圖片已匯出：{fileName}',
            exportCancelled: '已取消匯出黑板圖片',
            exportFallback: '原生匯出圖片失敗，已改用瀏覽器下載：{error}',
            tools: {
                eraser: '局部板擦',
                chalkWhite: '白粉筆',
                chalkRed: '紅粉筆',
                chalkYellow: '黃粉筆',
                chalkGreen: '綠粉筆',
                chalkBlue: '藍粉筆',
                sizeSmall: '細',
                sizeMedium: '中',
                sizeLarge: '粗',
                select: '選取',
                line: '直線',
                rect: '矩形',
                circle: '圓形',
                text: '文字',
                copy: '複製',
                cut: '剪下',
                paste: '貼上',
                clear: '清空',
                clearConfirm: '確定要清空黑板內容嗎？此動作無法直接復原。',
                undo: 'Undo',
                upload: '上傳圖片',
                save: '存成圖片',
            },
        },
        ollama: {
            notDetected: '未偵測到 Ollama，自動加入安裝任務',
            installing: '未偵測到本地 AI 引擎（Ollama）。系統正自動為您安裝，請在出現提示時允許權限。',
            ready: 'Ollama 已就緒，自動加入模型下載任務',
            downloading: 'Ollama 已就緒，正在自動為您下載 qwen3.5 語言模型，請稍候...',
        },
        status: {
            llmReady: '🟢 AI 就緒',
            modelNotReady: '🟡 模型未就緒',
            engineNotReady: '🔴 AI 未就緒',
        },
        tasks: {
            exportSuccess: '任務清單已匯出：{fileName}',
            exportSuccessChat: '任務清單已匯出成功。',
            exportCancelled: '已取消匯出任務清單',
            exportFallback: '原生匯出失敗，已改用瀏覽器下載：{error}',
            importSuccess: '任務清單已匯入',
            importFailed: '匯入失敗：JSON 格式錯誤',
        },
        buttons: {
            collapse: '收起 ▼',
            execute: '執行',
            delete: '刪除',
        },
        task: {
            general: '一般',
            unnamedItem: '未命名項目',
            autoExecute: '自動執行：{title}',
            addActionTask: '加入{action}清單',
            runActionNow: '立即{action}',
            installCompleted: '{title} 安裝 / 執行完成',
            uninstallCompleted: '{title} 解除安裝完成',
            installSkipped: '{title} 已經存在，所以我幫你跳過了',
            uninstallSkipped: '{title} 對應的項目目前已不在系統中，所以我幫你跳過了',
            executionFailed: '{title} 執行失敗。你可以看一下下方任務日誌，我再幫你排除',
            startingProcess: '正在啟動「{title}」流程...',
            executionStarted: '「{title}」已開始執行！請查看下方進度與日誌...',
            startingSOPProcess: '正在啟動「{name}」的{action}流程...',
            exportCancelled: '已取消匯出任務清單',
            addedToList: '已加入{action}：{title}',
            addedSOPToList: '已加入{action} SOP：{name}',
            startingAction: '開始{action}：{title}',
            startingSOPAction: '開始{action} SOP：{name}',
        },
        sidebar: {
            recommendLoading: '推薦清單載入中...',
            recommendEmpty: '找不到相符的項目',
            sopLoading: 'SOP 清單載入中...',
            skillLoading: 'Skills 清單載入中...',
            sopEmpty: '找不到相符的 SOP',
            skillEmpty: '找不到相符的 Skill',
            installedHeader: '── 已就緒 / 已安裝 ──',
            recommendPlaceholder: '搜尋推薦項目...',
            sopPlaceholder: '搜尋 SOP 名稱、ID 或分類...',
            skillPlaceholder: '搜尋 Skill 名稱、描述或標籤...',
            readyBadge: '✅ 已安裝',
            uninstallBadge: '🗑 可解除安裝',
            actionable: '⚡ 可{action} (SOP)',
            actionableShort: '⚡ 可{action}',
            normalPermission: '一般權限',
            risk: '風險 {value}',
            unknownRisk: '未標示',
            otherCategory: '其他',
        },
        actions: {
            install: '安裝',
            uninstall: '解除安裝',
            installTitle: '安裝 {title}',
            uninstallTitle: '解除安裝 {title}',
        },
        categories: {
            'AI Engine': 'AI 引擎',
            Productivity: '工作效率',
            Browser: '瀏覽器',
            Entertainment: '娛樂',
            'Data Protection': '資料保護',
            'System Cleanup': '系統清理',
            'System Optimization': '系統優化',
            'System Settings / Language': '系統設定 / 語言',
        },
        risks: {
            Low: '低',
            Medium: '中',
            High: '高',
        },
        statuses: {
            pending: '待執行',
            running: '執行中',
            success: '已完成',
            skipped: '已跳過',
            failed: '失敗',
        },
        sopUi: {
            rec_install_ollama: { title: '安裝 Ollama 本地 AI 引擎', description: '下載並安裝 Ollama，讓 AI PC Agent 具備本地語意理解能力', category: 'AI 引擎' },
            rec_pull_llm_model: { title: '下載語言模型 (Qwen3.5 4B)', description: '下載 Qwen3.5 4B 語言模型，約 2.6GB，完成後即可開始本地對話', category: 'AI 引擎' },
            rec_driver_check: { title: '檢查並安裝驅動程式', description: '掃描硬體裝置並確認驅動程式是否為最新版本', category: '系統優化' },
            rec_remove_copilot: { title: '移除 Windows Copilot', description: '停用並移除 Windows 內建的 Copilot 功能', category: '系統清理' },
            rec_install_chrome: { title: '安裝 Google Chrome', description: '下載並安裝 Chrome 瀏覽器，設為預設瀏覽器', category: '瀏覽器' },
            rec_backup: { title: '建立系統還原點', description: '建立系統還原點，保護重要系統狀態', category: '資料保護' },
            rec_office: { title: '安裝 LibreOffice', description: '安裝免費開源辦公套件，支援 Microsoft Office 格式', category: '工作效率' },
            rec_steam: { title: '安裝 Steam', description: '安裝 Steam 遊戲平台，擴充你的遊戲庫', category: '娛樂' },
            sys_lang_en_us: { title: '安裝英文語言包與輸入法', category: '系統設定 / 語言' },
            sys_lang_ja_jp: { title: '安裝日文語言包與輸入法', category: '系統設定 / 語言' },
            sys_lang_zh_cn: { title: '安裝簡體中文語言包與輸入法', category: '系統設定 / 語言' },
            sys_lang_zh_tw: { title: '安裝繁體中文語言包與輸入法', category: '系統設定 / 語言' },
        }
    },
    'en-US': {
        localeLabel: 'English',
        splash: {
            firstRun: 'First launch. Preparing the environment, please wait...',
            starting: 'Starting backend server, please wait...',
        },
        titlebar: {
            file: 'File',
            view: 'View',
            help: 'Help',
            aiReady: 'AI Ready',
            modelNotReady: 'Model Not Ready',
            engineNotReady: 'AI Engine Not Ready',
            aiSettings: 'Configure AI Engine',
            toggleSidebar: 'Toggle Sidebar (Ctrl+B)',
            toggleLog: 'Toggle Task Log (Ctrl+J)',
            toggleChat: 'Toggle AI Chat (Ctrl+Alt+B)',
            refresh: 'Refresh',
            exit: 'Exit',
        },
        footer: {
            tasks: '{count} tasks',
            switchTo: 'Switch to 繁體中文',
            importTasks: 'Import Task List',
            exportTasks: 'Export Task List',
        },
        tabs: {
            recommend: '💡 Recommended',
            sops: '📚 SOPs',
            hardware: 'Hardware',
            todolist: 'Tasks',
            logs: '📝 Task Log',
            emptyMessage: 'Waiting for task execution...',
            exps: '🧠 Exp. Log',
            aiChat: '💬 AI Chat',
            chalkboard: 'Chalkboard',
        },
        chalkboardWelcome: {
            title: 'Welcome to AI PC Agent',
            body: 'Launch recommended tools and browse quickly. Select tools from the sidebar or start a conversation with AI.',
            warn: '⚠️ AI is powerful but may make mistakes. Please verify and issue commands carefully.',
            hintTitle: 'Chalkboard Interactive',
            hintBody: 'Pick a chalk and start writing. Use the eraser to clear the board. Share your drawings with AI.',
        },
        ui: {
            opened: ' (Opened)',
        },
        chat: {
            clear: 'Clear Chat',
            mic: 'Voice Input',
            attachChalkboard: 'Attach Chalkboard',
            hint: 'Enter to send · Shift+Enter for newline',
            modelBadge: 'AI Model',
            switchModel: 'Switch Model',
            placeholder: 'Tell me what you need... e.g., "help me remove Copilot"',
            send: 'Send',
            connectionError: 'Chat connection error occurred.',
            localSessionNew: 'New Chat',
            localSessionDefault: 'Local Chat',
            pendingRowLocal: 'Local AI',
            pendingRowRemote: 'Remote AI',
            pendingIdle: 'Idle',
            pendingBusy: 'Thinking',
        },
        remote: {
            localTab: '💬 Local AI',
            remoteTab: 'Remote AI',
            disconnected: 'Disconnected',
            connecting: 'Connecting',
            connected: 'Connected',
            pending: 'Pending',
            connect: 'Connect',
            saveProfile: 'Save Names',
            disconnect: 'Disconnect',
            disconnectConfirm: 'Disconnect the current remote session?',
            deleteRemoteSessionConfirm: 'Delete this remote chat tab?',
            keepActiveRemoteSession: 'The active remote tab cannot be deleted. Disconnect it first.',
            shareScreen: 'Send Screen',
            attachFile: 'Attach File',
            connectionSettings: 'Connection Settings',
            shareScreenConfirm: 'The peer will be able to view the screen image you send.\n\nWarning: do not share sensitive information.',
            hostPlaceholder: 'Enter peer IP, e.g. 192.168.1.88',
            agentPlaceholder: 'AI Name',
            userPlaceholder: 'User Name',
            waitingHint: 'Waiting for remote connection. Port: 19168',
            acceptedHint: 'You accepted the conversation. Start chatting or supporting now.',
            requestTitle: 'Remote Connection Request',
            requestSummary: 'Another AI PC Agent wants to talk to you',
            accept: 'Allow',
            reject: 'Reject',
            requestAccepted: 'You accepted the conversation. Start chatting or supporting now.',
            profileSaved: 'Remote identity saved',
            connectSuccess: 'Connection request sent. Waiting for approval.',
            connectFailed: 'Remote connection failed: {error}',
            invitationTimeout: 'Connection invitation timed out.',
            invitationCancelled: 'Connection invitation cancelled.',
            peerCancelledInvitation: 'The peer cancelled the connection invitation.',
            inviteCountdown: '{seconds}s remaining',
            bannedRemaining: 'Temporarily blocked. Try again in {seconds}s.',
            noSession: 'Please create or select a remote session first',
            screenShared: 'Screen image sent to remote peer',
            screenFailed: 'Screen send failed: {error}',
            saveImage: 'Save Image',
            imageSaved: 'Shared image saved: {fileName}',
            modeUser: 'Send as Me',
            modeLocalAi: 'Send as Local AI',
            remoteAiTarget: 'Remote AI',
            remoteUserTarget: 'Remote User',
            connectDetails: 'Machine: {machineName}\nUser: {userName}\nAI: {agentName}\nIP: {ip}\nNote: accept this peer connection? If accepted, both sides and their AI chats can communicate.',
            peerDisconnected: 'Peer disconnected',
            fileAttached: 'Attached file: {fileName}',
            fileTooLarge: 'File too large. Choose a text file under 256KB.',
        },
        exps: {
            searchPlaceholder: 'Search experiences, keywords...',
            exportButton: '⬇ Export',
            exportTooltip: 'Export all exps as Markdown',
            emptyMessage: 'No installation experience accumulated yet...',
            noExpsToExport: 'No exps available to export',
            exportSuccess: 'exps exported: {fileName}',
            exportCancelled: 'Export exps cancelled',
            exportFallback: 'Native export failed, fallback to browser download: {error}',
        },
        settings: {
            title: 'AI Engine Settings',
            provider: 'AI Provider',
            helpTitle: 'Quick Setup',
            helpText: 'After choosing a provider, the system will prompt for API Key, Model Name, or Local URL.',
            baseUrl: 'Base URL',
            baseUrlPlaceholder: 'e.g., http://localhost:11434/v1',
            authType: 'Authentication',
            authNone: 'No Auth',
            authApiKey: 'API Key',
            authOAuth: 'OAuth 2.0 Client Credentials',
            apiKey: 'API Key',
            apiKeyPlaceholder: 'Bearer Token / API Key',
            modelName: 'Model Name',
            modelNamePlaceholder: 'e.g., qwen3.5:4b',
            visionModel: 'Vision Model',
            visionModelPlaceholder: 'Leave empty for auto-selection',
            refresh: '🔄 Refresh',
            modelHelp: 'Cloud models usually need a manual name. Local models can be picked from the list.',
            visionHelp: 'Used for reading Chalkboard sketches and multi-modal content. Leave empty for auto-selection.',
            test: 'Test Model',
            textToolTitle: 'Text Tool',
            save: 'Save & Refresh',
            updated: 'AI engine settings updated, restarting services...',
        },
        llm: {
            modelSwitched: 'Model switched to: {modelName}',
            modelSwitchedChat: 'I have now switched to **{modelName}**! Ready to start the conversation.',
        },
        textTool: {
            title: 'Text Tool',
            content: 'Text Content',
            contentPlaceholder: 'Enter text to place on the chalkboard',
            fontFamily: 'Font',
            fontStyle: 'Font Style',
            fontSize: 'Font Size',
            color: 'Text Color',
            align: 'Alignment',
            bold: 'Bold',
            italic: 'Italic',
            usage: 'How to Use',
            usageText: 'Click "Create Text Box" then click on the chalkboard to place it. Drag to move or pull the 8 handles to resize. Click outside to finalize.',
            cancel: 'Cancel',
            apply: 'Create Text Box',
            fontOptions: {
                kaiti: 'Kai Ti',
                jhenghei: 'Jhenghei',
                yahei: 'YaHei',
                mingliu: 'MingLiU',
                arial: 'Arial',
                timesnewroman: 'Times New Roman',
                couriernew: 'Courier New',
            },
            styleOptions: {
                chalk: 'Chalk Handwriting',
                board: 'Blackboard',
                clean: 'Clean Sans-serif',
                serif: 'Classic Serif',
                mono: 'Monospace',
            },
            alignOptions: {
                left: 'Left',
                center: 'Center',
                right: 'Right',
            },
        },
        chalkboard: {
            exportSuccess: 'Chalkboard image exported: {fileName}',
            exportCancelled: 'Chalkboard export cancelled',
            exportFallback: 'Native export failed, fallback to browser download: {error}',
            tools: {
                eraser: 'Eraser',
                chalkWhite: 'White Chalk',
                chalkRed: 'Red Chalk',
                chalkYellow: 'Yellow Chalk',
                chalkGreen: 'Green Chalk',
                chalkBlue: 'Blue Chalk',
                sizeSmall: 'Small',
                sizeMedium: 'Medium',
                sizeLarge: 'Large',
                select: 'Select',
                line: 'Line',
                rect: 'Rectangle',
                circle: 'Circle',
                text: 'Text',
                copy: 'Copy',
                cut: 'Cut',
                paste: 'Paste',
                clear: 'Clear',
                clearConfirm: 'Clear the Chalkboard? This cannot be directly undone.',
                undo: 'Undo',
                upload: 'Upload Image',
                save: 'Save Image',
            },
        },
        ollama: {
            notDetected: 'Ollama not detected, automatically adding installation task',
            installing: 'Local AI engine (Ollama) not detected. System is automatically installing it, please allow permissions when prompted.',
            ready: 'Ollama is ready, automatically adding model download task',
            downloading: 'Ollama is ready, automatically downloading qwen3.5 language model, please wait...',
        },
        status: {
            llmReady: '🟢 AI Ready',
            modelNotReady: '🟡 Model Not Ready',
            engineNotReady: '🔴 AI Not Ready',
        },
        tasks: {
            exportSuccess: 'Task list exported: {fileName}',
            exportSuccessChat: 'Task list exported successfully.',
            exportCancelled: 'Task list export cancelled',
            exportFallback: 'Native export failed, fallback to browser download: {error}',
            importSuccess: 'Task list imported',
            importFailed: 'Import failed: JSON format error',
        },
        buttons: {
            collapse: 'Collapse ▼',
            execute: 'Run',
            delete: 'Delete',
        },
        task: {
            general: 'General',
            unnamedItem: 'Untitled Item',
            autoExecute: 'Auto-executing: {title}',
            addActionTask: 'Add {action} task',
            runActionNow: '{action} now',
            installCompleted: '{title} installed / executed successfully',
            uninstallCompleted: '{title} uninstalled successfully',
            installSkipped: '{title} already exists, so I skipped it',
            uninstallSkipped: '{title} is not currently in the system, so I skipped it',
            executionFailed: '{title} execution failed. You can check the task log below and I\'ll help you troubleshoot',
            startingProcess: 'Starting {title} process...',
            executionStarted: '{title} execution started! Please check the progress and logs below...',
            startingSOPProcess: 'Starting {action} process for {name}...',
            exportCancelled: 'Task list export cancelled',
            addedToList: 'Added {action}: {title}',
            addedSOPToList: 'Added {action} SOP: {name}',
            startingAction: 'Starting {action}: {title}',
            startingSOPAction: 'Starting {action} SOP: {name}',
        },
        sidebar: {
            recommendLoading: 'Loading recommendations...',
            recommendEmpty: 'No matching items found',
            sopLoading: 'Loading SOP list...',
            skillLoading: 'Loading Skills...',
            sopEmpty: 'No matching SOP found',
            skillEmpty: 'No matching Skills found',
            installedHeader: '-- Ready / Installed --',
            recommendPlaceholder: 'Search recommendations...',
            sopPlaceholder: 'Search SOP name, ID, or category...',
            skillPlaceholder: 'Search Skill name, description, or tags...',
            readyBadge: '✅ Installed',
            uninstallBadge: '🗑 Uninstall available',
            actionable: '⚡ {action} available (SOP)',
            actionableShort: '⚡ {action} available',
            normalPermission: 'Standard User',
            risk: 'Risk {value}',
            unknownRisk: 'Unspecified',
            otherCategory: 'Other',
        },
        actions: {
            install: 'Install',
            uninstall: 'Uninstall',
            installTitle: 'Install {title}',
            uninstallTitle: 'Uninstall {title}',
        },
        categories: {
            'AI Engine': 'AI Engine',
            Productivity: 'Productivity',
            Browser: 'Browser',
            Entertainment: 'Entertainment',
            'Data Protection': 'Data Protection',
            'System Cleanup': 'System Cleanup',
            'System Optimization': 'System Optimization',
            'System Settings / Language': 'System Settings / Language',
            'AI 引擎': 'AI Engine',
            '工作效率': 'Productivity',
            '瀏覽器': 'Browser',
            '娛樂': 'Entertainment',
            '資料保護': 'Data Protection',
            '系統清理': 'System Cleanup',
            '系統優化': 'System Optimization',
            '系統設定 / 語言': 'System Settings / Language',
        },
        risks: {
            Low: 'Low',
            Medium: 'Medium',
            High: 'High',
            '低': 'Low',
            '中': 'Medium',
            '高': 'High',
        },
        statuses: {
            pending: 'Pending',
            running: 'Running',
            success: 'Completed',
            skipped: 'Skipped',
            failed: 'Failed',
        },
        sopUi: {
            rec_install_ollama: { title: 'Install Ollama Local AI Engine', description: 'Install Ollama to give AI PC Agent local language understanding.', category: 'AI Engine' },
            rec_pull_llm_model: { title: 'Download Language Model (Qwen3.5 4B)', description: 'Download the Qwen3.5 4B model, about 2.6 GB, for local chat.', category: 'AI Engine' },
            rec_driver_check: { title: 'Scan and Install Drivers', description: 'Check hardware devices and update missing or outdated drivers.', category: 'System Optimization' },
            rec_remove_copilot: { title: 'Remove Windows Copilot', description: 'Disable and remove the built-in Windows Copilot feature.', category: 'System Cleanup' },
            rec_install_chrome: { title: 'Install Google Chrome', description: 'Install Chrome and set it as the default browser.', category: 'Browser' },
            rec_backup: { title: 'Create a Restore Point', description: 'Create a Windows restore point before major system changes.', category: 'Data Protection' },
            rec_office: { title: 'Install LibreOffice', description: 'Install the free office suite with Microsoft Office compatibility.', category: 'Productivity' },
            rec_steam: { title: 'Install Steam', description: 'Install Steam and expand your game library.', category: 'Entertainment' },
            sys_lang_en_us: { title: 'Install English Language Pack and Input Method', category: 'System Settings / Language' },
            sys_lang_ja_jp: { title: 'Install Japanese Language Pack and Input Method', category: 'System Settings / Language' },
            sys_lang_zh_cn: { title: 'Install Simplified Chinese Language Pack and Input Method', category: 'System Settings / Language' },
            sys_lang_zh_tw: { title: 'Install Traditional Chinese Language Pack and Input Method', category: 'System Settings / Language' },
        }
    }
};

Object.assign(I18N['zh-TW'].remote, {
    cancelConnect: '取消連線',
    connectingTo: 'connecting to {host}.',
    waitingResponse: 'waiting for response.',
});

Object.assign(I18N['en-US'].remote, {
    cancelConnect: 'Cancel Connect',
    connectingTo: 'connecting to {host}.',
    waitingResponse: 'waiting for response.',
});

function getLocalePack() {
    return I18N[currentLocale] || I18N['zh-TW'];
}

function formatI18n(template, vars = {}) {
    return String(template || '').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

function t(path, vars = {}) {
    const parts = path.split('.');
    let value = getLocalePack();
    for (const part of parts) {
        value = value?.[part];
    }
    if (typeof value === 'string') {
        return formatI18n(value, vars);
    }
    return value;
}
const llmDot = $('#llmDot');
const llmLabel = $('#llmLabel');
const llmStatus = $('#llmStatus');
const statusLLM = $('#statusLLM');
const statusTasks = $('#statusTasks');
const chatModelBadge = $('#chatModelBadge');

const chalkboardState = {
    tool: 'none',
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
    future: [],
    hasUserContent: false
};

const LOCAL_NOAUTH_PROVIDERS = ['Ollama', 'vLLM', 'SGLang', 'LM Studio'];
const API_KEY_ONLY_PROVIDERS = Object.keys(PROVIDER_DEFAULTS).filter(
    p => !LOCAL_NOAUTH_PROVIDERS.includes(p) && p !== 'Customer Provider'
);
const PROVIDER_HELP = {
    'OpenAI': {
        title: 'OpenAI',
        text: currentLocale === 'en-US' ? 'Just fill in API Key and model name. OpenAI focuses on API Key.' : '填入 API Key 與模型名稱即可。OpenAI API 目前仍以 API Key 為主。',
        model: '例如 gpt-4.1、gpt-4o-mini。'
    },
    'Google Gemini': {
        title: 'Gemini',
        text: currentLocale === 'en-US' ? 'Uses Google official OpenAI compatibility endpoint. Usually needs API Key and model.' : '這裡走 Google 官方 OpenAI compatibility 入口，通常需要 API Key 與 model 名稱。',
        model: '例如 gemini-2.5-flash。'
    },
    'Anthropic Claude': {
        title: 'Anthropic Native',
        text: currentLocale === 'en-US' ? 'Uses Anthropic native API. Please provide API Key and Claude model.' : 'Anthropic 走原生 API，不硬套 OpenAI-compatible。請填 API Key 與 Claude model。',
        model: currentLocale === 'en-US' ? 'e.g. claude-sonnet-4-20250514.' : '例如 claude-sonnet-4-20250514。'
    },
    'Ollama': {
        title: currentLocale === 'en-US' ? 'Local Ollama' : '本地 Ollama',
        text: currentLocale === 'en-US' ? 'Usually no API Key needed. If local service is up, just select a model.' : '通常不需要 API Key。只要本機服務已啟動，就可以直接選模型。',
        model: currentLocale === 'en-US' ? 'Recommended to pick directly from list.' : '建議直接從模型清單選擇。'
    },
    'Customer Provider': {
        title: currentLocale === 'en-US' ? 'Custom Provider' : '自訂 Provider',
        text: currentLocale === 'en-US' ? 'For Enterprise Gateway or self-hosted. Choose API Key or OAuth 2.0 Client Credentials.' : '用於企業 Gateway 或自架服務。可選 API Key 或 OAuth 2.0 Client Credentials。',
        model: currentLocale === 'en-US' ? 'Please fill in the exact model name supported by the server.' : '請填服務端實際支援的模型名稱。'
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
        text: currentLocale === 'en-US'
            ? 'Fill in the API Key, connection URL, and model name required by this provider.'
            : '請填入此 provider 需要的 API Key、連線網址與模型名稱。',
        model: currentLocale === 'en-US'
            ? 'If the service supports a model list, you can refresh and select directly.'
            : '若服務支援模型清單，可直接刷新後選擇。'
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

function renderMarkdown(text = '') {
    if (typeof marked !== 'undefined') {
        return marked.parse(text);
    }

    const escaped = escapeHtml(String(text || ''));
    const lines = escaped.split('\n');
    const html = [];
    let inList = false;
    let inCode = false;

    const closeList = () => {
        if (inList) {
            html.push('</ul>');
            inList = false;
        }
    };

    lines.forEach((line) => {
        if (line.startsWith('```')) {
            closeList();
            html.push(inCode ? '</code></pre>' : '<pre><code>');
            inCode = !inCode;
            return;
        }
        if (inCode) {
            html.push(`${line}\n`);
            return;
        }
        const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
        if (headingMatch) {
            closeList();
            html.push(`<h${headingMatch[1].length}>${headingMatch[2]}</h${headingMatch[1].length}>`);
            return;
        }
        const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
        if (listMatch) {
            if (!inList) {
                html.push('<ul>');
                inList = true;
            }
            html.push(`<li>${listMatch[1]}</li>`);
            return;
        }
        closeList();
        if (!line.trim()) {
            html.push('<br>');
            return;
        }
        html.push(`<p>${line}</p>`);
    });
    closeList();
    let output = html.join('');
    output = output
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*(.+?)\*/g, '$1<em>$2</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return output;
}

function linkifyPlainUrls(text = '') {
    const src = String(text || '');
    // Convert bare URLs to markdown links, but keep existing markdown links untouched.
    const protectedText = src.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m) => `__MDLINK__${btoa(unescape(encodeURIComponent(m)))}__`);
    const linked = protectedText.replace(/(^|[\s(])((https?:\/\/)[^\s<>()]+)/gi, (m, prefix, url) => {
        return `${prefix}[${url}](${url})`;
    });
    return linked.replace(/__MDLINK__([A-Za-z0-9+/=]+)__/g, (_, b64) => {
        try {
            return decodeURIComponent(escape(atob(b64)));
        } catch {
            return '';
        }
    });
}

async function openExternalUrl(url = '') {
    const target = String(url || '').trim();
    if (!/^https?:\/\//i.test(target)) return;
    try {
        const result = await api('/api/open-external-url', {
            method: 'POST',
            body: { url: target },
        });
        if (result?.success) return;
    } catch {
        // fallback below
    }
    try {
        window.open(target, '_blank', 'noopener,noreferrer');
    } catch {
        // ignore
    }
}

function bindExternalLinks(root) {
    if (!root) return;
    root.querySelectorAll('a[href]').forEach((anchor) => {
        if (anchor.dataset.externalBound === '1') return;
        anchor.dataset.externalBound = '1';
        anchor.addEventListener('click', (event) => {
            const href = String(anchor.getAttribute('href') || '').trim();
            if (!/^https?:\/\//i.test(href)) return;
            event.preventDefault();
            event.stopPropagation();
            openExternalUrl(href);
        });
    });
}

function setBrowserStatus(text = '', actionEl = null) {
    if (browserStatusText) browserStatusText.textContent = String(text || '').trim();
    if (browserStatusAction) {
        browserStatusAction.innerHTML = '';
        browserStatusAction.style.display = actionEl ? 'inline-flex' : 'none';
        if (actionEl) browserStatusAction.appendChild(actionEl);
    }
}

function getSopById(sopId = '') {
    const target = String(sopId || '').trim();
    if (!target) return null;
    return sopsList.find((item) => String(item.id || '').trim() === target) || null;
}

function createBrowserInstallButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'browser-btn primary';
    button.textContent = browserInstallQueued ? 'Added to task' : 'Install Chromium';
    button.disabled = browserInstallQueued;
    button.addEventListener('click', async () => {
        if (browserInstallQueued) return;
        browserInstallQueued = true;
        button.disabled = true;
        button.textContent = 'Added to task';
        try {
            let sop = getSopById('install_playwright_chromium');
            if (!sop) {
                await loadSops();
                sop = getSopById('install_playwright_chromium');
            }
            if (!sop) {
                browserInstallQueued = false;
                setBrowserStatus('Browser unavailable: install SOP not found');
                return;
            }
            setBrowserStatus('Running Playwright Chromium install SOP...');
            await addAndExecuteSop(sop);
        } catch (error) {
            browserInstallQueued = false;
            button.disabled = false;
            button.textContent = 'Install Chromium';
            throw error;
        }
    });
    return button;
}

function setBrowserUnavailableStatus(errorMessage = '') {
    const message = String(errorMessage || '').trim();
    if (message.includes('install_playwright_chromium')) {
        setBrowserStatus(`Browser unavailable: ${message}`, createBrowserInstallButton());
        return;
    }
    setBrowserStatus(`Browser unavailable: ${message || 'unknown error'}`);
}

function syncBrowserTabAvailability(isReady) {
    browserRuntimeReady = !!isReady;
    const tabEl = $('#tab-browser');
    if (tabEl) tabEl.classList.toggle('hidden', !browserRuntimeReady);
    if (!browserRuntimeReady) {
        openTabs = openTabs.filter((id) => id !== 'browser');
        if (activeTab === 'browser') {
            switchTab('chalkboard');
        }
    } else if (!openTabs.includes('browser')) {
        openTabs.push('browser');
    }
}

async function refreshBrowserRuntimeAvailability() {
    try {
        const data = await api('/api/meta');
        if (data.success) {
            syncBrowserTabAvailability(!!data.browserAvailable);
            if (data.browserAvailable) {
                browserInstallQueued = false;
            }
        }
    } catch (e) {
        console.error('Refresh browser runtime failed', e);
    }
}

async function waitForTaskCompletion(taskId, timeoutMs = 10 * 60 * 1000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        await loadTodo();
        const task = todoList.find((item) => String(item.id || '') === String(taskId || ''));
        if (task && ['success', 'failed', 'skipped'].includes(task.status)) {
            return task;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
}

async function runBrowserInstallWorkflow() {
    if (browserInstallQueued) {
        setBrowserStatus('Browser install task already queued.');
        return false;
    }
    browserInstallQueued = true;
    let sop = getSopById('install_playwright_chromium');
    if (!sop) {
        await loadSops();
        sop = getSopById('install_playwright_chromium');
    }
    if (!sop) {
        browserInstallQueued = false;
        setBrowserStatus('Browser unavailable: install SOP not found');
        return false;
    }
    setBrowserStatus('Running Playwright Chromium install SOP...');
    try {
        await addAndExecuteSop(sop);
    } catch (error) {
        browserInstallQueued = false;
        throw error;
    }
    const doneTask = await waitForTaskCompletion(todoList.find((task) => String(task.skillId || '') === 'install_playwright_chromium')?.id || '');
    await refreshBrowserRuntimeAvailability();
    if (doneTask?.status !== 'success') {
        browserInstallQueued = false;
    }
    if (doneTask?.status === 'success' && browserRuntimeReady) {
        openTab('browser');
        await ensureBrowserSessionStarted();
        await refreshBrowserSnapshot();
        startBrowserSnapshotPolling();
    }
    return true;
}

function updateBrowserSnapshot(snapshotDataUrl = '', pageTitle = '', pageUrl = '') {
    if (browserPageTitle) browserPageTitle.textContent = pageTitle || '';
    if (browserSnapshotImage) {
        if (snapshotDataUrl) {
            browserSnapshotImage.src = snapshotDataUrl;
            browserSnapshotImage.style.display = 'block';
            if (browserEmptyState) browserEmptyState.style.display = 'none';
        } else {
            browserSnapshotImage.removeAttribute('src');
            browserSnapshotImage.style.display = 'none';
            if (browserEmptyState) browserEmptyState.style.display = 'flex';
        }
    }
    if (pageUrl) {
        browserTabState.currentUrl = pageUrl;
        if (browserUrlInput && document.activeElement !== browserUrlInput) {
            browserUrlInput.value = pageUrl;
        }
    }
}

async function ensureBrowserSessionStarted() {
    if (browserTabState.started) return true;
    setBrowserStatus('Starting Playwright session...');
    const result = await api('/api/browser/session/start', { method: 'POST', body: {} });
    if (!result?.success) {
        setBrowserUnavailableStatus(result?.error || 'unknown error');
        return false;
    }
    browserTabState.started = true;
    setBrowserStatus('Browser session ready');
    return true;
}

async function refreshBrowserSnapshot() {
    if (!browserTabState.started) return;
    const data = await api('/api/browser/session/snapshot');
    if (!data?.success) {
        setBrowserStatus(`Snapshot failed: ${data?.error || 'unknown error'}`);
        return;
    }
    updateBrowserSnapshot(data.snapshotDataUrl || '', data.title || '', data.url || '');
    setBrowserStatus(data.url ? `Viewing: ${data.url}` : 'Browser session ready');
}

function startBrowserSnapshotPolling() {
    if (browserTabState.snapshotTimer) return;
    browserTabState.snapshotTimer = setInterval(() => {
        if (activeTab !== 'browser') return;
        refreshBrowserSnapshot();
    }, 2000);
}

function stopBrowserSnapshotPolling() {
    if (!browserTabState.snapshotTimer) return;
    clearInterval(browserTabState.snapshotTimer);
    browserTabState.snapshotTimer = null;
}

async function browserNavigate(url = '') {
    const target = String(url || '').trim();
    if (!target) return;
    const ok = await ensureBrowserSessionStarted();
    if (!ok) return;
    setBrowserStatus(`Navigating: ${target}`);
    const data = await api('/api/browser/session/navigate', {
        method: 'POST',
        body: { url: target },
    });
    if (!data?.success) {
        setBrowserStatus(`Navigate failed: ${data?.error || 'unknown error'}`);
        return;
    }
    updateBrowserSnapshot(data.snapshotDataUrl || '', data.title || '', data.url || target);
    setBrowserStatus(`Loaded: ${data.url || target}`);
}

async function browserAction(action = '') {
    const ok = await ensureBrowserSessionStarted();
    if (!ok) return;
    const data = await api('/api/browser/session/action', {
        method: 'POST',
        body: { action },
    });
    if (!data?.success) {
        setBrowserStatus(`${action} failed: ${data?.error || 'unknown error'}`);
        return;
    }
    updateBrowserSnapshot(data.snapshotDataUrl || '', data.title || '', data.url || '');
    setBrowserStatus(`Done: ${action}`);
}

function getMentionHighlightNames() {
    const session = getActiveRemoteSession();
    return [
        remoteProfile?.userName,
        remoteProfile?.agentName,
        session?.peer?.userName,
        session?.peer?.agentName,
    ]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item, index, array) => array.findIndex((value) => value.toLowerCase() === item.toLowerCase()) === index);
}

function highlightMentionsInHtml(html = '', names = []) {
    if (!html || !names.length) return html;
    const template = document.createElement('template');
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const escapedNames = names
        .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .sort((a, b) => b.length - a.length);
    if (!escapedNames.length) return html;
    const mentionRegex = new RegExp(`@(${escapedNames.join('|')})(?=\\b|\\s|$)`, 'gi');
    const nodes = [];
    while (walker.nextNode()) {
        nodes.push(walker.currentNode);
    }
    nodes.forEach((node) => {
        if (!node.nodeValue || !mentionRegex.test(node.nodeValue)) return;
        mentionRegex.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        node.nodeValue.replace(mentionRegex, (match, name, offset) => {
            if (offset > lastIndex) {
                fragment.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex, offset)));
            }
            const span = document.createElement('span');
            span.className = 'mention-highlight';
            span.textContent = `@${name}`;
            fragment.appendChild(span);
            lastIndex = offset + match.length;
            return match;
        });
        if (lastIndex < node.nodeValue.length) {
            fragment.appendChild(document.createTextNode(node.nodeValue.slice(lastIndex)));
        }
        node.parentNode?.replaceChild(fragment, node);
    });
    return template.innerHTML;
}

function getSortedRemoteSessions() {
    return [...(remoteState.sessions || [])].sort((a, b) => {
        const aTime = new Date(a.lastEventAt || a.createdAt || 0).getTime();
        const bTime = new Date(b.lastEventAt || b.createdAt || 0).getTime();
        return bTime - aTime;
    });
}

function ensureRemoteSessionQuickList() {
    if (remoteSessionQuickList) return remoteSessionQuickList;
    if (!remoteChatHint?.parentElement) return null;
    let el = remoteChatHint.parentElement.querySelector('#remoteSessionQuickList');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'remoteSessionQuickList';
    el.className = 'remote-session-quick-list';
    remoteChatHint.insertAdjacentElement('afterend', el);
    return el;
}

function createLocalChatSession(title = '') {
    return {
        id: `local_chat_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        title: String(title || '').trim() || t('chat.localSessionDefault'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
        history: [],
    };
}

function normalizeLocalChatSessions() {
    if (!Array.isArray(localChatSessions) || !localChatSessions.length) {
        localChatSessions = [createLocalChatSession()];
    }
    if (!selectedLocalChatSessionId || !localChatSessions.some((item) => item.id === selectedLocalChatSessionId)) {
        selectedLocalChatSessionId = localChatSessions[0].id;
    }
}

function saveLocalChatSessions() {
    normalizeLocalChatSessions();
    localStorage.setItem('local_chat_sessions_v1', JSON.stringify(localChatSessions.slice(0, 24)));
    localStorage.setItem('selected_local_chat_session_id', selectedLocalChatSessionId || '');
}

function loadLocalChatSessions() {
    try {
        const raw = JSON.parse(localStorage.getItem('local_chat_sessions_v1') || '[]');
        localChatSessions = Array.isArray(raw) ? raw.map((item) => ({
            id: String(item.id || ''),
            title: String(item.title || '').trim() || t('chat.localSessionDefault'),
            createdAt: item.createdAt || new Date().toISOString(),
            updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
            messages: Array.isArray(item.messages) ? item.messages : [],
            history: Array.isArray(item.history) ? item.history : [],
        })).filter((item) => item.id) : [];
    } catch {
        localChatSessions = [];
    }
    normalizeLocalChatSessions();
    saveLocalChatSessions();
}

function getSortedLocalChatSessions() {
    normalizeLocalChatSessions();
    return [...localChatSessions].sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
}

function getActiveLocalChatSession() {
    normalizeLocalChatSessions();
    return localChatSessions.find((item) => item.id === selectedLocalChatSessionId) || localChatSessions[0] || null;
}

function touchLocalChatSession(sessionId = selectedLocalChatSessionId) {
    const session = localChatSessions.find((item) => item.id === sessionId);
    if (!session) return;
    session.updatedAt = new Date().toISOString();
    saveLocalChatSessions();
}

function removeLocalChatSession(sessionId = '') {
    const targetId = String(sessionId || '').trim();
    if (!targetId || localChatSessions.length <= 1) return;
    localChatSessions = localChatSessions.filter((item) => item.id !== targetId);
    if (!localChatSessions.length) {
        localChatSessions = [createLocalChatSession()];
    }
    if (selectedLocalChatSessionId === targetId || !localChatSessions.some((item) => item.id === selectedLocalChatSessionId)) {
        selectedLocalChatSessionId = localChatSessions[0].id;
    }
    saveLocalChatSessions();
    renderLocalSessionControls();
    renderLocalChatMessages();
    switchChatMode('local');
}

function ensureChatPendingStatusRow() {
    const header = document.querySelector('.chat-panel-header');
    if (!header?.parentElement) return null;
    let row = header.parentElement.querySelector('#chatPendingStatusRow');
    if (row) return row;
    row = document.createElement('div');
    row.id = 'chatPendingStatusRow';
    row.className = 'chat-pending-status-row';
    header.insertAdjacentElement('afterend', row);
    return row;
}

function getActiveAbortController(mode = activeChatMode) {
    return mode === 'remote' ? remoteChatAbortController : localChatAbortController;
}

function setActiveAbortController(controller, mode = activeChatMode) {
    if (mode === 'remote') {
        remoteChatAbortController = controller;
    } else {
        localChatAbortController = controller;
    }
    chatAbortController = controller;
}

function getThinkingIdForMode(mode = 'local') {
    return mode === 'remote' ? remoteThinkingId : localThinkingId;
}

function setThinkingIdForMode(mode = 'local', id = '') {
    if (mode === 'remote') {
        remoteThinkingId = id;
    } else {
        localThinkingId = id;
    }
}

function setRemotePendingRoles(nextRoles = {}) {
    remotePendingRoles = {
        local: !!nextRoles.local,
        remote: !!nextRoles.remote,
    };
}

function isModePending(mode = 'local') {
    return Boolean(mode === 'remote' ? remoteChatAbortController : localChatAbortController);
}

function updateChatModeBadges() {
    renderLocalSessionControls();
    updatePendingStatusRow();
}

function updateSendButtonState() {
    const iconSend = btnSend?.querySelector('.icon-send');
    const iconStop = btnSend?.querySelector('.icon-stop');
    const pending = isModePending(activeChatMode);
    btnSend?.classList.toggle('stop', pending);
    if (btnSend) btnSend.title = pending ? (currentLocale === 'en-US' ? 'Stop' : '停止') : t('chat.send');
    iconSend?.classList.toggle('hidden', pending);
    iconStop?.classList.toggle('hidden', !pending);
    updateChatModeBadges();
}

function updatePendingStatusRow() {
    const row = ensureChatPendingStatusRow();
    if (!row) return;
    const session = getActiveRemoteSession();
    const aiStatus = session?.aiStatus || {};
    const localBusy = isModePending('local') || remotePendingRoles.local || aiStatus.localAi === 'thinking';
    const remoteBusy = remotePendingRoles.remote || aiStatus.remoteAi === 'thinking';
    const localLabel = currentLocale === 'en-US' ? 'Local AI' : '本地 AI';
    const remoteLabel = currentLocale === 'en-US' ? 'Remote AI' : '遠端 AI';
    row.innerHTML = `
        <div class="chat-pending-pill local-pending-pill ${localBusy ? 'busy' : ''}">${escapeHtml(localLabel)}: ${escapeHtml(localBusy ? t('chat.pendingBusy') : t('chat.pendingIdle'))}</div>
        <div class="chat-pending-pill remote-pending-pill ${remoteBusy ? 'busy' : ''}">${escapeHtml(remoteLabel)}: ${escapeHtml(remoteBusy ? t('chat.pendingBusy') : t('chat.pendingIdle'))}</div>
    `;
}

function updateChatModelBadgeDisplay(lastStatus = null) {
    if (!chatModelBadge) return;
    const currentModel = lastStatus?.modelName || chatModelBadge.dataset.baseModel || '';
    const badgeText = currentModel || t('chat.modelBadge');
    chatModelBadge.textContent = badgeText;
    chatModelBadge.style.display = (lastStatus?.modelReady && currentModel) ? 'inline-block' : 'none';
    chatModelBadge.title = t('chat.switchModel');
}

function getMentionParticipants() {
    const session = getActiveRemoteSession();
    const candidates = [];
    const addCandidate = (name, role) => {
        const normalized = String(name || '').trim();
        if (!normalized) return;
        if (candidates.some((item) => item.name.toLowerCase() === normalized.toLowerCase())) return;
        candidates.push({ name: normalized, role });
    };

    addCandidate(remoteProfile?.agentName || remoteProfile?.machineName, 'Local AI');
    addCandidate(session?.peer?.userName, 'Remote User');
    addCandidate(session?.peer?.agentName, 'Remote AI');
    return candidates.filter((item) => item.name.toLowerCase() !== String(remoteProfile?.userName || '').trim().toLowerCase());
}

function hideMentionMenu() {
    activeMentionIndex = 0;
    mentionCandidates = [];
    mentionMenu?.classList.remove('visible');
    if (mentionMenu) mentionMenu.innerHTML = '';
}

function insertMention(name) {
    if (!chatInput) return;
    const value = chatInput.value;
    const cursor = chatInput.selectionStart;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    if (!match) return;
    const startIndex = cursor - match[0].length + match[1].length;
    chatInput.value = `${value.slice(0, startIndex)}@${name} ${after}`;
    const nextCursor = startIndex + name.length + 2;
    chatInput.setSelectionRange(nextCursor, nextCursor);
    chatInput.focus();
    hideMentionMenu();
}

function updateMentionMenu() {
    if (!chatInput || !mentionMenu) return;
    const before = chatInput.value.slice(0, chatInput.selectionStart);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    if (!match) {
        hideMentionMenu();
        return;
    }
    const keyword = String(match[2] || '').toLowerCase();
    mentionCandidates = getMentionParticipants().filter((item) => item.name.toLowerCase().includes(keyword));
    if (!mentionCandidates.length) {
        hideMentionMenu();
        return;
    }
    activeMentionIndex = Math.min(activeMentionIndex, mentionCandidates.length - 1);
    mentionMenu.innerHTML = mentionCandidates.map((item, index) => `
        <div class="mention-item ${index === activeMentionIndex ? 'active' : ''}" data-mention-name="${escapeHtml(item.name)}">
            <span>@${escapeHtml(item.name)}</span>
            <span class="mention-role">${escapeHtml(item.role)}</span>
        </div>
    `).join('');
    mentionMenu.classList.add('visible');
    mentionMenu.querySelectorAll('.mention-item').forEach((el) => {
        el.addEventListener('mousedown', (event) => {
            event.preventDefault();
            insertMention(el.dataset.mentionName);
        });
    });
}

function getActiveRemoteSession() {
    const sessions = remoteState.sessions || [];
    return sessions.find((session) => session.id === selectedRemoteSessionId) || null;
}

function getSecondsRemaining(isoTime = '') {
    const target = Date.parse(String(isoTime || ''));
    if (!Number.isFinite(target)) return 0;
    return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

function formatRemoteCountdown(isoTime = '') {
    const seconds = getSecondsRemaining(isoTime);
    return seconds > 0 ? t('remote.inviteCountdown', { seconds }) : '';
}

function getRemoteStatusText(session = null) {
    if (!session) return t('remote.disconnected');
    if (session.status === 'active') return t('remote.connected');
    if (session.status === 'pending_approval') {
        const countdown = formatRemoteCountdown(session.pendingExpiresAt);
        return countdown ? `${t('remote.pending')} · ${countdown}` : t('remote.pending');
    }
    if (session.bannedUntil && getSecondsRemaining(session.bannedUntil) > 0) {
        return t('remote.bannedRemaining', { seconds: getSecondsRemaining(session.bannedUntil) });
    }
    return t('remote.disconnected');
}

function isContainerPinnedToBottom(container) {
    const threshold = 24;
    if (!container) return true;
    return container.scrollTop + container.clientHeight >= container.scrollHeight - threshold;
}

function getRemoteConnectButtonText(session = null) {
    if (!session) return t('remote.connect');
    if (session.status === 'pending_approval') return t('remote.cancelConnect');
    if (session.status === 'active') return t('remote.disconnect');
    return t('remote.connect');
}

function buildRemoteHintText(session = null) {
    if (!session) return t('remote.waitingHint');
    const host = session.peer?.ip || session.host || '';
    const machine = session.peer?.machineName || session.host || '';
    const user = session.peer?.userName || '';

    if (session.status === 'pending_approval') {
        const countdown = formatRemoteCountdown(session.pendingExpiresAt);
        return `${t('remote.connectingTo', { host })} ${t('remote.waitingResponse')}${countdown ? ` · ${countdown}` : ''}`;
    }
    if (session.disconnectReason === 'timed_out') {
        return t('remote.invitationTimeout');
    }
    if (session.disconnectReason === 'remote_cancelled') {
        return t('remote.peerCancelledInvitation');
    }
    if (session.disconnectReason === 'local_cancelled') {
        return t('remote.invitationCancelled');
    }
    if (session.bannedUntil && getSecondsRemaining(session.bannedUntil) > 0) {
        return t('remote.bannedRemaining', { seconds: getSecondsRemaining(session.bannedUntil) });
    }
    return `${machine} / ${user} / ${host}`;
}

function syncRemoteProfileDirty(isDirty = remoteProfileDirty) {
    remoteProfileDirty = Boolean(isDirty);
    if (btnSaveRemoteProfile) {
        btnSaveRemoteProfile.disabled = !remoteProfileDirty;
    }
}

function isRemoteProfileEditing() {
    return document.activeElement === remoteAgentNameInput || document.activeElement === remoteUserNameInput;
}

function updateRemoteToolbarToggle() {
    if (!remoteChatToolbar || !btnRemoteToolbarToggle) return;
    remoteChatToolbar.classList.toggle('collapsed', remoteToolbarCollapsed);
    btnRemoteToolbarToggle.setAttribute('aria-expanded', String(!remoteToolbarCollapsed));
    btnRemoteToolbarToggle.textContent = `${t('remote.connectionSettings')} ${remoteToolbarCollapsed ? '▼' : '▲'}`;
}

function toggleRemoteToolbar() {
    remoteToolbarCollapsed = !remoteToolbarCollapsed;
    localStorage.setItem('remote_toolbar_collapsed', remoteToolbarCollapsed ? '1' : '0');
    updateRemoteToolbarToggle();
}

function switchChatMode(mode) {
    activeChatMode = mode === 'remote' ? 'remote' : 'local';
    hideMentionMenu();
    localChatPane?.classList.toggle('active', activeChatMode === 'local');
    remoteChatPane?.classList.toggle('active', activeChatMode === 'remote');
    if (btnChalkAttach) btnChalkAttach.style.display = activeChatMode === 'local' ? '' : 'none';
    if (btnClearChat) btnClearChat.style.display = activeChatMode === 'local' ? '' : 'none';
    btnRemoteAttachFile?.classList.toggle('visible', activeChatMode === 'remote');
    btnDisconnectRemote?.classList.toggle('visible', activeChatMode === 'remote');
    if (btnClearChat) btnClearChat.title = t('chat.clear');
    chatInput.placeholder = activeChatMode === 'local'
        ? t('chat.placeholder')
        : (getActiveRemoteSession()
            ? `${t('remote.connected')} - ${getActiveRemoteSession()?.peer?.machineName || getActiveRemoteSession()?.host || ''}`
            : t('remote.waitingHint'));
    if (activeChatMode === 'local') {
        renderLocalSessionControls();
        renderLocalChatMessages();
    }
    updateSendButtonState();
}

function renderRemotePopup() {
    const pending = remoteState.pendingApprovals?.[0];
    if (!pending) {
        pendingRemoteRequestId = '';
        if (remoteRequestTimeout) remoteRequestTimeout.textContent = '';
        remoteRequestOverlay?.classList.remove('visible');
        return;
    }

    pendingRemoteRequestId = pending.id;
    remoteRequestTitle.textContent = t('remote.requestTitle');
    remoteRequestSummary.textContent = t('remote.requestSummary');
    remoteRequestDetails.textContent = t('remote.connectDetails', {
        machineName: pending.peer?.machineName || 'Unknown',
        userName: pending.peer?.userName || 'Unknown',
        agentName: pending.peer?.agentName || 'Unknown',
        ip: pending.peer?.ip || pending.host || 'Unknown',
    });
    if (remoteRequestTimeout) {
        remoteRequestTimeout.textContent = formatRemoteCountdown(pending.pendingExpiresAt);
    }
    remoteRequestOverlay?.classList.add('visible');
}

function formatRemoteSender(message = {}) {
    if (message.senderType === 'system') return 'System';
    return message.senderLabel || (message.senderType === 'ai' ? (currentLocale === 'en-US' ? 'AI' : 'AI') : (currentLocale === 'en-US' ? 'User' : '使用者'));
}

function shouldRenderRemoteMessage(message = {}) {
    if (!message || message.type !== 'chat_message') return true;
    if (message.target !== 'remote-ai') return true;
    return message.senderType !== 'ai';
}

function buildRemoteRenderSignature(session = null) {
    if (!session) return 'no-session';
    const lastMessage = Array.isArray(session.messages) && session.messages.length > 0 ? session.messages[session.messages.length - 1] : null;
    return [
        session.id || '',
        session.status || '',
        session.messages?.length || 0,
        lastMessage?.id || '',
        session.aiStatus?.localAi || '',
        session.aiStatus?.remoteAi || '',
        session.aiStatus?.updatedAt || '',
    ].join('|');
}

function renderRemoteMessages() {
    if (!remoteChatMessages) return;
    const shouldStick = isContainerPinnedToBottom(remoteChatMessages);
    const previousScrollTop = remoteChatMessages.scrollTop;
    remoteChatMessages.innerHTML = '';
    const session = getActiveRemoteSession();
    if (!session) {
        const empty = document.createElement('div');
        empty.className = 'log-empty';
        empty.textContent = t('remote.waitingHint');
        remoteChatMessages.appendChild(empty);
        return;
    }

    session.messages.forEach((message) => {
        if (message.type === 'chalkboard_state') {
            applyRemoteChalkboardState(message);
            return;
        }
        if (!shouldRenderRemoteMessage(message)) {
            return;
        }
        const remoteText = message.type === 'screen_share'
            ? (message.caption || (currentLocale === 'en-US' ? 'Screen image sent' : '已傳送畫面'))
            : message.text;
        const chalkControl = message.type === 'chat_message' ? extractChalkboardControlFromReply(remoteText || '') : { displayText: remoteText, draft: null };
        const suggestionControl = message.type === 'chat_message'
            ? extractSuggestionsFromReply(chalkControl.displayText || remoteText || '')
            : { displayText: chalkControl.displayText || remoteText, suggestions: [] };
        const actionDirectives = message.type === 'chat_message'
            ? extractActionDirectivesFromReply(suggestionControl.displayText || chalkControl.displayText || remoteText || '')
            : [];
        if (message.senderType === 'ai' && actionDirectives.length > 0 && !handledRemoteAiActionMessageIds.has(message.id)) {
            handledRemoteAiActionMessageIds.add(message.id);
            addUILog(currentLocale === 'en-US'
                ? `Remote AI directive received [msg:${message.id || 'unknown'}] (${actionDirectives.map((item) => buildDirectiveDebugLabel(item)).join(', ')})`
                : `收到遠端 AI 指令 [msg:${message.id || 'unknown'}]（${actionDirectives.map((item) => buildDirectiveDebugLabel(item)).join('、')}）`, 'info');
            actionDirectives.forEach((directive) => {
                if (shouldSkipDuplicateRemoteDirective(session.id, directive)) {
                    const skipMessage = currentLocale === 'en-US'
                        ? `Skipped duplicate remote directive: ${buildDirectiveDebugLabel(directive)}`
                        : `已略過重複的遠端指令：${buildDirectiveDebugLabel(directive)}`;
                    addUILog(skipMessage, 'warn');
                    appendChatBubble('system', skipMessage, [], {
                        container: remoteChatMessages,
                        forceSystem: true,
                    });
                    return;
                }
                handleDirectiveAction(directive).then((result) => {
                    if (!result?.summary) return;
                    addUILog(result.summary, 'success');
                    appendChatBubble('system', result.summary, [], {
                        container: remoteChatMessages,
                        forceSystem: true,
                    });
                }).catch((error) => {
                    addUILog(currentLocale === 'en-US'
                        ? `❌ Remote AI directive failed: ${error.message || 'unknown error'}`
                        : `❌ 遠端 AI 指令失敗：${error.message || '未知錯誤'}`, 'error');
                    appendChatBubble('system', error.message || 'Remote AI action failed', [], {
                        container: remoteChatMessages,
                        forceSystem: true,
                    });
                });
            });
        }
        if (chalkControl.draft && !appliedRemoteDraftMessageIds.has(message.id)) {
            appliedRemoteDraftMessageIds.add(message.id);
            applyAgentChalkboardDraft(chalkControl.draft, {
                actorScope: message.direction === 'incoming' ? 'remote' : 'local',
            });
        }
        appendChatBubble(
            message.senderType === 'system' ? 'system' : (message.senderType === 'ai' ? 'ai' : 'user'),
            (suggestionControl.displayText || chalkControl.displayText || remoteText)
                .replace(/\[(?:ACTION\s*[:=]\s*|Action\s*=\s*).*?\]/gs, '')
                .trim(),
            suggestionControl.suggestions,
            {
                container: remoteChatMessages,
                senderLabel: formatRemoteSender(message),
                actorScope: message.direction === 'incoming' ? 'remote' : 'local',
                forceSystem: message.senderType === 'system',
                imageDataUrl: message.type === 'screen_share' ? message.imageDataUrl : '',
            }
        );
    });







    if (session.status === 'disconnected') {
        appendChatBubble('system', t('remote.peerDisconnected'), [], {
            container: remoteChatMessages,
            forceSystem: true,
        });
    }
    if (getThinkingIdForMode('remote')) {
        appendThinking(remoteChatMessages, getThinkingIdForMode('remote'));
    }
    remoteChatMessages.scrollTop = shouldStick
        ? remoteChatMessages.scrollHeight
        : previousScrollTop;
}

function addLocalSessionMessage(role, text, suggestions = [], options = {}) {
    const session = getActiveLocalChatSession();
    if (!session) return;
    if (role === 'user' && (!session.messages.length || /^本機對話\b|^Local Chat\b/i.test(session.title || ''))) {
        session.title = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 18) || session.title;
    }
    session.messages.push({
        id: `local_msg_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        role,
        text,
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        senderLabel: options.senderLabel || '',
        forceSystem: !!options.forceSystem,
        imageDataUrl: options.imageDataUrl || '',
        createdAt: new Date().toISOString(),
    });
    session.messages = session.messages.slice(-120);
    touchLocalChatSession(session.id);
    if (activeChatMode === 'local') {
        renderLocalSessionControls();
    }
}

function renderLocalChatMessages() {
    if (!chatMessages) return;
    const shouldStick = isContainerPinnedToBottom(chatMessages);
    const previousScrollTop = chatMessages.scrollTop;
    chatMessages.innerHTML = '';
    const session = getActiveLocalChatSession();
    (session?.messages || []).forEach((message) => {
        appendChatBubble(message.role, message.text, message.suggestions || [], {
            container: chatMessages,
            senderLabel: message.senderLabel || '',
            forceSystem: !!message.forceSystem,
            imageDataUrl: message.imageDataUrl || '',
            fromRender: true,
        });
    });
    if (getThinkingIdForMode('local')) {
        appendThinking(chatMessages, getThinkingIdForMode('local'));
    }
    chatMessages.scrollTop = shouldStick ? chatMessages.scrollHeight : previousScrollTop;
}

function renderLocalSessionControls() {
    if (!localChatTabs) return;
    const sessions = getSortedLocalChatSessions();
    localChatTabs.innerHTML = sessions.map((session) => {
        const isSelected = session.id === selectedLocalChatSessionId;
        const isActive = activeChatMode === 'local' && isSelected;
        const activeClass = isActive ? 'active' : '';
        const pendingClass = isSelected && isModePending('local') ? 'pending' : '';
        const canClose = sessions.length > 1;
        const title = escapeHtml(session.title || t('chat.localSessionDefault'));
        return `
            <button type="button" class="chat-mode-tab local-chat-tab ${activeClass} ${pendingClass}" data-chat-mode="local" data-local-session-id="${session.id}">
                <span class="local-chat-tab-title">${title}</span>
                ${canClose ? `<span class="local-chat-tab-close" data-local-close-id="${session.id}" title="Close">×</span>` : ''}
            </button>
        `;
    }).join('');
    const remoteBtn = chatModeTabs?.querySelector('.chat-mode-tab[data-chat-mode="remote"]');
    if (remoteBtn) {
        remoteBtn.classList.toggle('active', activeChatMode === 'remote');
        remoteBtn.classList.toggle('pending', isModePending('remote'));
        remoteBtn.textContent = t('remote.remoteTab');
    }
}

async function saveSharedImage(imageDataUrl) {
    const data = await api('/api/remote/save-image-file', {
        method: 'POST',
        body: { imageDataUrl }
    });
    if (data.success) {
        addUILog(t('remote.imageSaved', { fileName: data.fileName || data.filePath }), 'success');
    } else if (!data.cancelled) {
        addUILog(t('remote.screenFailed', { error: data.error || 'unknown' }), 'error');
    }
}

function renderRemoteSessionControls() {
    if (!remoteSessionSelect) return;
    const sessions = getSortedRemoteSessions();
    if (selectedRemoteSessionId && !sessions.some((item) => item.id === selectedRemoteSessionId)) {
        selectedRemoteSessionId = '';
    }
    if (!selectedRemoteSessionId) {
        selectedRemoteSessionId = sessions.find((item) => item.status === 'active')?.id || sessions[0]?.id || '';
    }
    localStorage.setItem('selected_remote_session_id', selectedRemoteSessionId || '');
    remoteSessionSelect.innerHTML = sessions.length
        ? sessions.map((session) => {
            const peerUser = session.peer?.userName ? ` / ${session.peer.userName}` : '';
            const label = `${session.peer?.machineName || session.host || session.id}${peerUser} · ${getRemoteStatusText(session)}`;
            return `<option value="${session.id}" ${session.id === selectedRemoteSessionId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
        }).join('')
        : '<option value="">No session</option>';
    const quickListEl = ensureRemoteSessionQuickList();
    if (quickListEl) {
        quickListEl.innerHTML = sessions.map((session) => {
            const activeClass = session.id === selectedRemoteSessionId ? 'active' : '';
            const pendingClass = session.status === 'pending_approval' ? 'pending' : '';
            const canClose = session.status !== 'active';
            const label = session.peer?.machineName || session.host || session.id;
            return `
                <button type="button" class="remote-session-chip ${activeClass} ${pendingClass}" data-session-id="${session.id}">
                    <span class="remote-session-chip-title">${escapeHtml(label)}</span>
                    ${canClose ? `<span class="remote-session-chip-close" data-remote-close-id="${session.id}" title="Close">×</span>` : ''}
                </button>
            `;
        }).join('');
        quickListEl.querySelectorAll('.remote-session-chip').forEach((button) => {
            button.addEventListener('click', () => {
                selectedRemoteSessionId = button.dataset.sessionId || '';
                localStorage.setItem('selected_remote_session_id', selectedRemoteSessionId || '');
                renderRemoteSessionControls();
                switchChatMode('remote');
            });
        });
        quickListEl.querySelectorAll('[data-remote-close-id]').forEach((closeBtn) => {
            closeBtn.addEventListener('click', async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await deleteRemoteSessionTab(closeBtn.dataset.remoteCloseId || '');
            });
        });
    }
    const activeSession = getActiveRemoteSession();
    remoteSessionStatus.textContent = getRemoteStatusText(activeSession);
    remoteChatHint.textContent = buildRemoteHintText(activeSession);
    if (btnRemoteConnect) btnRemoteConnect.textContent = getRemoteConnectButtonText(activeSession);
    if (btnShareScreen) btnShareScreen.disabled = !activeSession || activeSession.status !== 'active';
    btnDisconnectRemote?.classList.toggle('visible', activeChatMode === 'remote');
    updateChatModelBadgeDisplay(window.__lastLLMStatus || null);
    updatePendingStatusRow();
    const renderSignature = buildRemoteRenderSignature(activeSession);
    if (renderSignature !== lastRemoteRenderSignature) {
        lastRemoteRenderSignature = renderSignature;
        renderRemoteMessages();
    }
}

async function loadRemoteProfileAndState() {
    const previousSessions = new Map((remoteState.sessions || []).map((session) => [session.id, session]));
    const data = await api('/api/remote/state');
    if (!data.success) return;
    remoteState = data;
    remoteProfile = data.profile;
    (remoteState.sessions || []).forEach((session) => {
        const wasDisconnected = previousSessions.get(session.id)?.status === 'disconnected';
        if (session.status !== 'disconnected' || wasDisconnected || notifiedRemoteDisconnectSessionIds.has(session.id)) return;
        notifiedRemoteDisconnectSessionIds.add(session.id);
        const peerName = session.peer?.machineName || session.peer?.userName || session.host || '';
        const text = peerName ? `${t('remote.peerDisconnected')}：${peerName}` : t('remote.peerDisconnected');
        appendChatBubble('system', text, [], {
            container: activeChatMode === 'remote' ? remoteChatMessages : chatMessages,
            forceSystem: true,
        });
    });
    if (!remoteProfileDirty && !isRemoteProfileEditing() && remoteAgentNameInput) {
        remoteAgentNameInput.value = data.profile?.agentName || '';
    }
    if (!remoteProfileDirty && !isRemoteProfileEditing() && remoteUserNameInput) {
        remoteUserNameInput.value = data.profile?.userName || '';
    }
    syncRemoteProfileDirty(remoteProfileDirty);
    renderRemoteSessionControls();
    renderRemotePopup();
    const activeSession = getActiveRemoteSession();
    if (activeSession?.status === 'active' && !remoteSessionsOpenedOnChalkboard.has(activeSession.id)) {
        remoteSessionsOpenedOnChalkboard.add(activeSession.id);
        openTab('chalkboard');
        if (activeSession.direction === 'outgoing' && chalkboardState.hasUserContent) {
            scheduleRemoteChalkboardSync(true);
        }
    }
}

function resolveRemoteTargets(messageText = '') {
    const names = getMentionParticipants();
    const lowerText = String(messageText || '').toLowerCase();
    const targets = new Set();
    names.forEach((item) => {
        if (!lowerText.includes(`@${item.name.toLowerCase()}`)) return;
        if (item.role === 'Remote AI') targets.add('remote-ai');
        if (item.role === 'Local AI') targets.add('local-ai');
        if (item.role === 'Remote User') targets.add('remote-user');
    });
    if (!targets.size) {
        const mentionsPeerMachine = /(\u5c0d\u65b9|\u9060\u7aef|remote|peer|\u53e6\u4e00\u53f0|\u5225\u53f0)/i.test(lowerText);
        const isHardwareQuestion = /(this pc|my pc|local machine|free space|disk space|\u78c1\u789f|\u786c\u789f|\u5bb9\u91cf|\u5269\u9918\u7a7a\u9593|ram|\u8a18\u61b6\u9ad4|cpu|gpu)/i.test(lowerText);
        if (isHardwareQuestion && !mentionsPeerMachine) {
            targets.add('local-ai');
            return [...targets];
        }
        const asksOwnMachine = /(自己|本機|本地|我的電腦|我這台|this pc|my pc|local machine|free space|disk space|磁碟|硬碟|容量|剩餘空間|ram|記憶體|cpu|gpu)/i.test(lowerText)
            && !/(對方|遠端|remote|peer|另一台|別台)/i.test(lowerText);
        if (/(只問|只叫|only|just).{0,8}(遠端|remote)/i.test(lowerText)) {
            targets.add('remote-ai');
        } else if (/(只問|只叫|only|just).{0,8}(本地|本機|local)/i.test(lowerText)) {
            targets.add('local-ai');
        } else if (asksOwnMachine) {
            targets.add('local-ai');
        } else {
            targets.add('local-ai');
            targets.add('remote-ai');
        }
    }
    return [...targets];
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
    syncChalkboardUI();
    if (hasContent || chalkboardState.hasInteracted) {
        scheduleRemoteChalkboardSync(Boolean(hasContent));
    }
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

function buildRemoteChalkboardPayload(hasContent = true) {
    if (!chalkboardCanvas || !chalkboardState.ctx) return null;

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = chalkboardCanvas.width;
    exportCanvas.height = chalkboardCanvas.height;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) return null;

    exportCtx.fillStyle = '#173b2f';
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    if (hasContent) {
        exportCtx.drawImage(chalkboardCanvas, 0, 0);
    }

    return {
        imageDataUrl: exportCanvas.toDataURL('image/png'),
        width: exportCanvas.width,
        height: exportCanvas.height,
        hasContent,
    };
}

function scheduleRemoteChalkboardSync(hasContent = true) {
    if (suppressRemoteChalkboardSync) return;
    const session = getActiveRemoteSession();
    if (!session || session.status !== 'active') return;
    if (remoteChalkboardSyncTimer) clearTimeout(remoteChalkboardSyncTimer);
    remoteChalkboardSyncTimer = setTimeout(() => {
        remoteChalkboardSyncTimer = null;
        if (isChalkboardInteractionBusy()) {
            scheduleRemoteChalkboardSync(chalkboardState.hasUserContent);
            return;
        }
        sendRemoteChalkboardSnapshot(hasContent);
    }, 1000);
}

async function sendRemoteChalkboardSnapshot(hasContent = true) {
    const session = getActiveRemoteSession();
    const payload = buildRemoteChalkboardPayload(hasContent);
    if (!session || !payload) return;
    try {
        await api(`/api/remote/session/${session.id}/chalkboard-sync`, {
            method: 'POST',
            body: {
                ...payload,
                senderLabel: remoteProfile?.userName || '',
                caption: currentLocale === 'en-US' ? 'Chalkboard updated' : 'Chalkboard 已更新',
            }
        });
    } catch (error) {
        console.warn('[Remote Chalkboard] sync failed:', error.message);
    }
}

function applyRemoteChalkboardState(message = {}) {
    if (!message?.id || appliedRemoteChalkboardMessageIds.has(message.id)) return;
    if (!message.imageDataUrl || !message.imageDataUrl.startsWith('data:image/')) return;
    if (isChalkboardInteractionBusy()) {
        queuedRemoteChalkboardMessage = message;
        scheduleQueuedRemoteChalkboardApply();
        return;
    }
    appliedRemoteChalkboardMessageIds.add(message.id);

    const img = new Image();
    img.onload = () => {
        openTab('chalkboard');
        const applyImage = (attempt = 0) => {
            if (!chalkboardState.ctx || chalkboardState.cssWidth <= 0 || chalkboardState.cssHeight <= 0) {
                if (attempt < 8) setTimeout(() => applyImage(attempt + 1), 120);
                return;
            }
            suppressRemoteChalkboardSync = true;
            cancelPendingChalkPreview(false);
            hidePendingTextBox();
            clearSelectionBox();
            chalkboardState.hasInteracted = true;
            chalkboardState.hintDrawn = true;
            pushChalkHistory(null, { preserveFuture: true });
            clearChalkboardSurface();
            chalkboardState.ctx.drawImage(img, 0, 0, chalkboardState.cssWidth, chalkboardState.cssHeight);
            chalkboardState.hasUserContent = message.hasContent !== false;
            syncChalkboardUI();
            suppressRemoteChalkboardSync = false;
            showChalkboardFloatHint(currentLocale === 'en-US' ? 'Remote Chalkboard updated' : '遠端 Chalkboard 已同步');
        };
        applyImage(0);
    };
    img.src = message.imageDataUrl;
}

function isChalkboardInteractionBusy() {
    return Boolean(
        chalkboardState.drawing ||
        chalkboardState.pendingShapePreview ||
        chalkboardState.textManipulation ||
        chalkboardState.pendingText ||
        chalkboardState.pendingImage
    );
}

function scheduleQueuedRemoteChalkboardApply() {
    if (remoteChalkboardApplyTimer) clearTimeout(remoteChalkboardApplyTimer);
    remoteChalkboardApplyTimer = setTimeout(() => {
        remoteChalkboardApplyTimer = null;
        if (isChalkboardInteractionBusy()) {
            scheduleQueuedRemoteChalkboardApply();
            return;
        }
        const message = queuedRemoteChalkboardMessage;
        queuedRemoteChalkboardMessage = null;
        if (message) applyRemoteChalkboardState(message);
    }, 1000);
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
    chalkSelectionBox.style.left = `${rect.left}px`;
    chalkSelectionBox.style.top = `${rect.top}px`;
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
        const autoSelectText = currentLocale === 'en-US' ? 'Auto-select Vision Model' : '自動挑選 Vision 模型';
        const options = [`<option value="">${autoSelectText}</option>`]
            .concat(visionModels.map(model => `<option value="${model.name}" ${model.name === visionModel ? 'selected' : ''}>${model.name}</option>`));
        settingVisionModelSelect.innerHTML = options.join('');
        if (visionModel && !visionModels.some(model => model.name === visionModel)) {
            const currentText = currentLocale === 'en-US' ? '(current setting)' : '（目前設定）';
            settingVisionModelSelect.innerHTML += `<option value="${visionModel}" selected>${visionModel}${currentText}</option>`;
        }
        if (visionModelHelpText) {
            visionModelHelpText.textContent = visionModels.length > 0
                ? (currentLocale === 'en-US'
                    ? 'Specify a vision model for processing Chalkboard sketches and image understanding; leave empty to auto-select.'
                    : '這裡可指定處理 Chalkboard 與圖片理解的 vision 模型；留空則自動挑選。')
                : (currentLocale === 'en-US'
                    ? 'No vision models detected in this provider\'s model list; you can leave empty to auto-select or enter manually.'
                    : '此 Provider 的模型清單裡目前沒有明確辨識出的 vision 模型；可留空自動挑選，或手動填入。');
        }
    } else {
        settingVisionModelName.style.display = 'block';
        settingVisionModelSelect.style.display = 'none';
        settingVisionModelName.value = visionModel;
        if (visionModelHelpText) {
            visionModelHelpText.textContent = currentLocale === "en-US" ? "Used for reading Chalkboard sketches and multi-modal content. Leave empty for auto-selection." : "用於讀取 Chalkboard 草圖、上傳圖片與其他多模態內容。留空時，系統會自動挑選同 Provider 的 vision 模型。";
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
    chalkRedoButton?.addEventListener('click', redoChalkAction);
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
    chalkUndoButton && (chalkUndoButton.disabled = toolsLocked || !chalkboardState.history.length);
    chalkRedoButton && (chalkRedoButton.disabled = toolsLocked || !chalkboardState.future.length);
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

    // 記住舊的 CSS 尺寸，用於 pendingTextRect 比例映射
    const prevCssWidth = chalkboardState.cssWidth || cssWidth;
    const prevCssHeight = chalkboardState.cssHeight || cssHeight;

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
        chalkboardState.ctx.save();
        chalkboardState.ctx.imageSmoothingEnabled = false;
        chalkboardState.ctx.drawImage(snapshot, 0, 0, cssWidth, cssHeight);
        chalkboardState.ctx.restore();
        if (prevCssWidth > 0 && prevCssHeight > 0) {
            const scaleX = cssWidth / prevCssWidth;
            const scaleY = cssHeight / prevCssHeight;
            const scaleRect = (rectValue) => {
                if (!rectValue) return rectValue;
                return {
                    left: rectValue.left * scaleX,
                    top: rectValue.top * scaleY,
                    width: rectValue.width * scaleX,
                    height: rectValue.height * scaleY,
                };
            };
            const scalePoint = (pointValue) => {
                if (!pointValue) return pointValue;
                return {
                    x: pointValue.x * scaleX,
                    y: pointValue.y * scaleY,
                };
            };
            const scaleTextManipulation = (manipulationValue) => {
                if (!manipulationValue) return manipulationValue;
                return {
                    ...manipulationValue,
                    originPoint: scalePoint(manipulationValue.originPoint),
                    originRect: scaleRect(manipulationValue.originRect),
                    anchorLeft: typeof manipulationValue.anchorLeft === 'number' ? (manipulationValue.anchorLeft * scaleX) : manipulationValue.anchorLeft,
                    anchorTop: typeof manipulationValue.anchorTop === 'number' ? (manipulationValue.anchorTop * scaleY) : manipulationValue.anchorTop,
                    anchorRight: typeof manipulationValue.anchorRight === 'number' ? (manipulationValue.anchorRight * scaleX) : manipulationValue.anchorRight,
                    anchorBottom: typeof manipulationValue.anchorBottom === 'number' ? (manipulationValue.anchorBottom * scaleY) : manipulationValue.anchorBottom,
                };
            };
            chalkboardState.pendingTextRect = scaleRect(chalkboardState.pendingTextRect);
            chalkboardState.selectionRect = scaleRect(chalkboardState.selectionRect);
            chalkboardState.dragStart = scalePoint(chalkboardState.dragStart);
            chalkboardState.hoverPoint = scalePoint(chalkboardState.hoverPoint);
            chalkboardState.dragPresetEnd = scalePoint(chalkboardState.dragPresetEnd);
            chalkboardState.textManipulation = scaleTextManipulation(chalkboardState.textManipulation);
        }
        if (chalkboardState.pendingText && chalkboardState.pendingTextRect) {
            refreshPendingTextPreview();
            chalkboardState.pendingTextSnapshot = createCanvasSnapshot();
            syncPendingTextBox();
            syncSelectionBox();
            return;
        }
        syncSelectionBox();
        if (chalkboardState.dragStart && chalkboardState.hoverPoint && (
            chalkboardState.pendingShapePreview ||
            ((chalkboardState.tool === 'image' || chalkboardState.tool === 'text') && chalkboardState.drawing)
        )) {
            previewChalkObject(chalkboardState.hoverPoint);
        }
    }
}

function getChalkInputRect() {
    // 直接使用 canvas 的 bounding rect，因為 canvas 已經是 inset: 0 填滿 surface 的內容區域
    return chalkboardCanvas.getBoundingClientRect();
}

function getChalkPoint(event) {
    const rect = getChalkInputRect();
    const normalizedX = rect.width > 0 ? ((event.clientX - rect.left) / rect.width) : 0;
    const normalizedY = rect.height > 0 ? ((event.clientY - rect.top) / rect.height) : 0;
    const clampedX = Math.max(0, Math.min(1, normalizedX));
    const clampedY = Math.max(0, Math.min(1, normalizedY));
    return {
        x: clampedX * chalkboardState.cssWidth,
        y: clampedY * chalkboardState.cssHeight
    };
}

function startChalkStroke(event) {
    const activated = activateChalkboard();
    if (activated) return;

    const point = getChalkPoint(event);
    const tool = chalkboardState.tool;
    if (tool === 'none') {
        updatePlacementGuide(point);
        return;
    }

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
        originRect: { ...chalkboardState.pendingTextRect },
        anchorLeft: chalkboardState.pendingTextRect.left,
        anchorTop: chalkboardState.pendingTextRect.top,
        anchorRight: chalkboardState.pendingTextRect.left + chalkboardState.pendingTextRect.width,
        anchorBottom: chalkboardState.pendingTextRect.top + chalkboardState.pendingTextRect.height
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
    pushChalkFuture();

    clearChalkboardSurface();
    chalkboardState.ctx.drawImage(snapshot, 0, 0, chalkboardState.cssWidth, chalkboardState.cssHeight);
    chalkboardState.hasInteracted = true;
    markChalkboardUserContent(chalkboardState.history.length > 0);
}

function redoChalkAction() {
    cancelPendingChalkPreview(false);
    hidePlacementGuide();
    hidePendingTextBox();
    clearSelectionBox();
    chalkboardState.pendingText = null;
    chalkboardState.pendingTextRect = null;
    chalkboardState.pendingTextSnapshot = null;
    chalkboardState.pendingTextPreviewUrl = null;
    chalkboardState.textManipulation = null;

    const snapshot = chalkboardState.future.pop();
    if (!snapshot) return;

    const currentSnapshot = createCanvasSnapshot();
    if (currentSnapshot) {
        chalkboardState.history.push(currentSnapshot);
        if (chalkboardState.history.length > 30) {
            chalkboardState.history.shift();
        }
    }

    clearChalkboardSurface();
    chalkboardState.ctx.drawImage(snapshot, 0, 0, chalkboardState.cssWidth, chalkboardState.cssHeight);
    chalkboardState.hasInteracted = true;
    markChalkboardUserContent(true);
}

function clearChalkboard() {
    if (!chalkboardState.ctx || !chalkboardCanvas) return;
    if (!confirm(t('chalkboard.tools.clearConfirm'))) return;
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
            addUILog('✅ ' + t('chalkboard.exportSuccess', { fileName: data.fileName || data.filePath }), 'success');
        } else if (data.cancelled) {
            addUILog('ℹ️ ' + t('chalkboard.exportCancelled'), 'info');
        } else {
            // fallback: 若原生另存失敗，仍嘗試瀏覽器下載
            const link = document.createElement('a');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.href = base64Image;
            link.download = `chalkboard-${timestamp}.png`;
            link.click();
            addUILog('⚠️ ' + t('chalkboard.exportFallback', { error: data.error || 'Unknown error' }), 'warn');
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
    chalkboardState.tool = 'none';
    clearChalkboardSurface();
    drawChalkboardHint();
    syncChalkboardUI();
    return true;
}

function clearChalkboardSurface() {
    if (!chalkboardState.ctx) return;
    chalkboardState.ctx.clearRect(0, 0, chalkboardState.cssWidth, chalkboardState.cssHeight);
}

function pushChalkHistory(snapshot = null, options = {}) {
    const source = snapshot || createCanvasSnapshot();
    if (!source) return;

    const record = document.createElement('canvas');
    record.width = source.width;
    record.height = source.height;
    const recordCtx = record.getContext('2d');
    recordCtx.drawImage(source, 0, 0);
    chalkboardState.history.push(record);
    if (!options.preserveFuture) {
        chalkboardState.future = [];
    }

    if (chalkboardState.history.length > 30) {
        chalkboardState.history.shift();
    }
}

function pushChalkFuture(snapshot = null) {
    const source = snapshot || createCanvasSnapshot();
    if (!source) return;

    const record = document.createElement('canvas');
    record.width = source.width;
    record.height = source.height;
    const recordCtx = record.getContext('2d');
    recordCtx.drawImage(source, 0, 0);
    chalkboardState.future.push(record);

    if (chalkboardState.future.length > 30) {
        chalkboardState.future.shift();
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

    const targetWidth = Math.max(1, width);
    const targetHeight = Math.max(1, height);
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

    drawChalkText(t('chalkboardWelcome.title'), padX, titleY, {
        font: '700 28px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
        color: '#f4efe2',
        alpha: 0.96
    });

    drawWrappedChalkText(
        t('chalkboardWelcome.body'),
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
        t('chalkboardWelcome.warn'),
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
    showChalkboardFloatHint(`${t('chalkboardWelcome.hintTitle')} · ${t('chalkboardWelcome.hintBody')}`);
}

function showChalkboardFloatHint(message) {
    if (!chalkboardFloatHint) return;
    const text = String(message || '').trim();
    if (!text) return;
    chalkboardFloatHint.textContent = text;
    chalkboardFloatHint.classList.add('visible');

    if (chalkboardHintTimer) {
        clearTimeout(chalkboardHintTimer);
        chalkboardHintTimer = null;
    }
    if (chalkboardHintClickDismissHandler) {
        window.removeEventListener('pointerdown', chalkboardHintClickDismissHandler, true);
        chalkboardHintClickDismissHandler = null;
    }

    const hide = () => {
        chalkboardFloatHint.classList.remove('visible');
    };

    chalkboardHintTimer = setTimeout(() => {
        hide();
        chalkboardHintTimer = null;
    }, 3000);

    const onceDismiss = () => {
        if (chalkboardHintTimer) {
            clearTimeout(chalkboardHintTimer);
            chalkboardHintTimer = null;
        }
        hide();
        if (chalkboardHintClickDismissHandler) {
            window.removeEventListener('pointerdown', chalkboardHintClickDismissHandler, true);
            chalkboardHintClickDismissHandler = null;
        }
    };
    chalkboardHintClickDismissHandler = onceDismiss;
    window.addEventListener('pointerdown', chalkboardHintClickDismissHandler, true);
}

function normalizeCollaborativeChalkboardDraft(draft = {}, options = {}) {
    const session = getActiveRemoteSession();
    const inRemoteSession = Boolean(session && session.status === 'active');
    const actorScope = options.actorScope || draft.actorScope || (activeChatMode === 'remote' ? 'remote' : 'local');
    const normalized = { ...draft };
    if (inRemoteSession) {
        normalized.clear = false;
        if (!normalized.position || normalized.position === 'full') {
            normalized.position = actorScope === 'remote' ? 'right' : 'left';
        }
    }
    return normalized;
}

async function applyAgentChalkboardDraft(draft, options = {}) {
    if (!draft) return;
    const collaborativeDraft = normalizeCollaborativeChalkboardDraft(draft, options);
    const title = String(collaborativeDraft.title || '').trim();
    const bullets = Array.isArray(collaborativeDraft.bullets)
        ? collaborativeDraft.bullets.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [];
    if (!title && bullets.length === 0) return;

    try {
        let normalizedDraft = {
            title,
            bullets,
            position: collaborativeDraft.position,
            clear: collaborativeDraft.clear,
        };
        try {
            const normalized = await api('/api/chalkboard/draft', {
                method: 'POST',
                body: normalizedDraft,
            });
            if (normalized.success && normalized.draft) {
                normalizedDraft = normalizeCollaborativeChalkboardDraft(normalized.draft, options);
            }
        } catch {
            // fallback: still render locally even if draft API is unavailable
        }

        openTab('chalkboard');
        const renderDraft = (attempt = 0) => {
            if (!chalkboardState.ctx || chalkboardState.cssWidth <= 0 || chalkboardState.cssHeight <= 0) {
                if (attempt < 8) {
                    setTimeout(() => renderDraft(attempt + 1), 120);
                }
                return;
            }
            resizeChalkboardCanvas();
            if (!chalkboardState.ctx) return;
            if (!chalkboardState.hasInteracted) {
                activateChalkboard();
            }
            cancelPendingChalkPreview(false);
            hidePlacementGuide();
            hidePendingTextBox();
            clearSelectionBox();
            chalkboardState.pendingText = null;
            chalkboardState.pendingTextRect = null;
            chalkboardState.pendingTextSnapshot = null;
            chalkboardState.pendingTextPreviewUrl = null;
            chalkboardState.textManipulation = null;
            pushChalkHistory();
            const clear = normalizedDraft.clear !== false;
            if (clear) {
                clearChalkboardSurface();
            }

            const finalTitle = String(normalizedDraft.title || title || 'Chalkboard Draft').trim();
            const finalBullets = Array.isArray(normalizedDraft.bullets)
                ? normalizedDraft.bullets
                : bullets;
            showChalkboardFloatHint(finalTitle);

            const pos = normalizedDraft.position || 'full';
            let padX = 34;
            let maxWidth = Math.max(280, chalkboardState.cssWidth - 68);

            if (pos === 'right') {
                padX = chalkboardState.cssWidth / 2 + 20;
                maxWidth = Math.max(200, chalkboardState.cssWidth / 2 - 40);
            } else if (pos === 'left') {
                maxWidth = Math.max(200, chalkboardState.cssWidth / 2 - 40);
            }

            let cursorY = 62;
            drawChalkText(finalTitle, padX, cursorY, {
                font: '700 28px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
                color: '#f4efe2',
                alpha: 0.95,
            });
            cursorY += 40;
            const linesToDraw = finalBullets.length > 0 ? finalBullets : [currentLocale === 'en-US' ? 'No bullet points. See chat panel for details.' : '暫無條列摘要，請看右側聊天內容。'];
            linesToDraw.forEach((line, index) => {
                const wrappedLines = drawWrappedChalkText(
                    `${index + 1}. ${line}`,
                    padX,
                    cursorY,
                    maxWidth,
                    28,
                    {
                        font: '600 22px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
                        color: '#eef0df',
                        alpha: 0.9,
                    }
                );
                cursorY += Math.max(40, wrappedLines * 28 + 10);
            });
            markChalkboardUserContent(true);
            addUILog(currentLocale === 'en-US' ? 'Agent draft rendered on Chalkboard.' : '已將 Agent 摘要寫入 Chalkboard。', 'success');
        };
        requestAnimationFrame(() => renderDraft(0));
    } catch (err) {
        console.error('[Chalkboard Draft] failed:', err);
    }
}

function extractChalkboardControlFromReply(text = '') {
    const raw = String(text || '');
    const marker = '##CHALKBOARD##';
    const endMarker = '##ENDCHALKBOARD##';
    const markerIndex = raw.indexOf(marker);
    if (markerIndex < 0) {
        return {
            displayText: raw.trim(),
            draft: null,
        };
    }

    const before = raw.slice(0, markerIndex);
    const afterMarker = raw.slice(markerIndex + marker.length);
    const endIndex = afterMarker.indexOf(endMarker);
    const blockText = (endIndex >= 0 ? afterMarker.slice(0, endIndex) : afterMarker).trim();
    const after = endIndex >= 0 ? afterMarker.slice(endIndex + endMarker.length) : '';
    const displayText = `${before}\n${after}`.replace(/\n{3,}/g, '\n\n').trim()
        || (currentLocale === 'en-US' ? 'Key points were written to Chalkboard.' : '重點已寫到 Chalkboard。');

    const rawLines = blockText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!rawLines.length) {
        return { displayText, draft: null };
    }

    let title = '';
    const bullets = [];
    let position = 'full';
    let clear = true;
    rawLines.forEach((line) => {
        if (!title && /^title\s*:/i.test(line)) {
            title = line.replace(/^title\s*:/i, '').trim();
            return;
        }
        if (/^position\s*:/i.test(line)) {
            position = line.replace(/^position\s*:/i, '').trim().toLowerCase();
            return;
        }
        if (/^clear\s*:/i.test(line)) {
            clear = line.replace(/^clear\s*:/i, '').trim().toLowerCase() !== 'false';
            return;
        }
        if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
            bullets.push(line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim());
            return;
        }
        if (!title) {
            title = line.replace(/^#{1,3}\s+/, '').trim();
        } else {
            bullets.push(line);
        }
    });

    const compactBullets = bullets
        .map((line) => line.slice(0, 72))
        .filter(Boolean)
        .slice(0, 6);
    const finalTitle = (title || (currentLocale === 'en-US' ? 'AI Chalkboard Notes' : 'AI 黑板重點')).slice(0, 52);
    const draft = compactBullets.length > 0
        ? { title: finalTitle, bullets: compactBullets, position, clear }
        : null;
    return {
        displayText,
        draft,
    };
}

function drawWrappedChalkText(text, x, y, maxWidth, lineHeight, options) {
    const ctx = chalkboardState.ctx;
    if (!ctx) return 0;

    ctx.save();
    ctx.font = options.font;
    const chars = Array.from(text);
    let line = '';
    let currentY = y;
    let lineCount = 0;

    chars.forEach(char => {
        const testLine = line + char;
        if (line && ctx.measureText(testLine).width > maxWidth) {
            drawChalkText(line, x, currentY, options);
            line = char;
            currentY += lineHeight;
            lineCount += 1;
        } else {
            line = testLine;
        }
    });

    if (line) {
        drawChalkText(line, x, currentY, options);
        lineCount += 1;
    }
    ctx.restore();
    return lineCount;
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
        baseFontSize: fontSize,
        lineHeight,
        baseLineHeight: lineHeight,
        textWidth: width,
        baseTextWidth: width,
        textHeight: height,
        baseTextHeight: height,
        baseWidth: width + (previewPadding * 2),
        baseHeight: height + (previewPadding * 2),
        font,
        fontFamily,
        fontWeight,
        fontVariant,
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
        // 檢測是否包含中文字符，如果有則添加補償
        const hasChinese = /[\u4e00-\u9fff]/.test(line);
        const compensatedLineWidth = hasChinese ? lineWidth * 1.05 : lineWidth;
        let x = padding;
        if (align === 'center') {
            x = padding + Math.max(0, (width - compensatedLineWidth) / 2);
        } else if (align === 'right') {
            x = padding + Math.max(0, width - compensatedLineWidth);
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
    let width = 0;
    lines.forEach(line => {
        const lineWidth = ctx.measureText(line).width;
        // 檢測是否包含中文字符，如果有則添加補償
        const hasChinese = /[\u4e00-\u9fff]/.test(line);
        const compensatedWidth = hasChinese ? lineWidth * 1.05 : lineWidth;
        width = Math.max(width, compensatedWidth);
    });
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
    refreshPendingTextPreview();
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
        let right = interaction.anchorRight ?? (rect.left + rect.width);
        let bottom = interaction.anchorBottom ?? (rect.top + rect.height);

        if (handle.includes('w')) {
            nextLeft = Math.min(point.x, right - minWidth);
        }
        if (handle.includes('e')) {
            nextLeft = interaction.anchorLeft ?? rect.left;
            right = Math.max(nextLeft + minWidth, point.x);
        }
        if (handle.includes('n')) {
            nextTop = Math.min(point.y, bottom - minHeight);
        }
        if (handle.includes('s')) {
            nextTop = interaction.anchorTop ?? rect.top;
            bottom = Math.max(nextTop + minHeight, point.y);
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
    refreshPendingTextPreview();
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

function refreshPendingTextPreview() {
    const block = chalkboardState.pendingText;
    if (!block || !Array.isArray(block.lines) || !block.lines.length) return;
    const previewPadding = Math.max(6, Number(block.previewPadding) || 0);
    let previewWidth = Number(block.baseTextWidth || block.textWidth) || 1;
    let previewHeight = Number(block.baseTextHeight || block.textHeight) || 1;
    const baseTextWidth = Math.max(1, Number(block.baseTextWidth || block.textWidth) || 1);
    const baseTextHeight = Math.max(1, Number(block.baseTextHeight || block.textHeight) || 1);
    const baseFontSize = Math.max(8, Number(block.baseFontSize || block.fontSize) || 8);
    const baseLineHeight = Math.max(10, Number(block.baseLineHeight || block.lineHeight) || 10);
    let nextFontSize = baseFontSize;
    let nextLineHeight = baseLineHeight;
    if (chalkboardState.pendingTextRect) {
        const innerWidth = Math.max(1, chalkboardState.pendingTextRect.width - (previewPadding * 2));
        const innerHeight = Math.max(1, chalkboardState.pendingTextRect.height - (previewPadding * 2));
        const scaleX = innerWidth / baseTextWidth;
        const scaleY = innerHeight / baseTextHeight;
        const scale = Math.max(0.25, Math.min(scaleX, scaleY));
        nextFontSize = Math.max(8, Math.round(baseFontSize * scale));
        nextLineHeight = Math.max(10, Math.round(baseLineHeight * scale));
        previewWidth = innerWidth;
        previewHeight = innerHeight;
    }
    const fontVariant = block.fontVariant || (block.italic ? 'italic' : 'normal');
    const fontWeight = block.fontWeight || (block.bold ? '700' : '400');
    const fontFamily = block.fontFamily || (String(block.font || '').split('px ').slice(1).join('px ') || 'sans-serif');
    const dynamicFont = `${fontVariant} ${fontWeight} ${nextFontSize}px ${fontFamily}`;
    const previewCanvas = createTextPreviewCanvas(
        block.lines,
        previewWidth,
        previewHeight,
        dynamicFont,
        nextLineHeight,
        block.color,
        previewPadding,
        block.align || 'left'
    );
    block.previewCanvas = previewCanvas;
    block.font = dynamicFont;
    block.fontSize = nextFontSize;
    block.lineHeight = nextLineHeight;
    block.textWidth = previewWidth;
    block.textHeight = previewHeight;
    block.baseWidth = previewCanvas.width;
    block.baseHeight = previewCanvas.height;
    chalkboardState.pendingTextPreviewUrl = previewCanvas.toDataURL('image/png');
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
    if (chalkboardState.tool === 'none') {
        chalkboardCanvas.style.cursor = 'crosshair';
        return;
    }
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
    // Ensure locale is loaded from localStorage before updating UI
    currentLocale = localStorage.getItem('ui_locale') || 'zh-TW';
    loadLocalChatSessions();
    updateLocaleUI();
    checkFirstRun();
    applyTheme(localStorage.getItem('theme') || 'dark');
    restoreLayout();
    setupResizers();
    setupEventListeners();
    setupChalkboard();
    setupSpeechRecognition();

    // 並行載入資料，不要等待啟動畫面
    await Promise.all([loadTodo(), loadRecommend(), loadSops(), loadSkills(), loadExps(), loadRemoteProfileAndState()]);
    renderLocalSessionControls();
    renderLocalChatMessages();
    updatePendingStatusRow();
    if (remoteStateInterval) clearInterval(remoteStateInterval);
    remoteStateInterval = setInterval(loadRemoteProfileAndState, 2000);
    
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
    syncBrowserTabAvailability(!!data.browserAvailable);
}

function checkFirstRun() {
    const splashText = document.getElementById('splashText');
    if (!splashText) return;

    // 檢查 localStorage 標記
    const hasRun = localStorage.getItem('aipc_has_run');
    console.log('[Init] hasRun flag:', hasRun);

    if (!hasRun) {
        splashText.innerText = t('splash.firstRun');
    } else {
        splashText.innerText = t('splash.starting');
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

function extractSuggestionsFromReply(text = '') {
    const raw = String(text || '');
    const match = raw.match(/\[SUGGEST:(.*?)\]/s);
    if (!match) {
        return {
            displayText: raw.trim(),
            suggestions: [],
        };
    }
    const body = String(match[1] || '').trim();
    const attrLabel = body.match(/button_text="(.*?)"/);
    const attrAction = body.match(/action="(.*?)"/);
    const attrSopId = body.match(/sop_id="(.*?)"/);
    const attrTaskId = body.match(/task_id="(.*?)"/);
    const attrMode = body.match(/mode="(.*?)"/);
    let suggestions;
    if (attrLabel) {
        suggestions = [{
            label: attrLabel[1],
            action: attrAction ? attrAction[1] : '',
            sopId: attrSopId ? attrSopId[1] : '',
            taskId: attrTaskId ? attrTaskId[1] : '',
            mode: attrMode ? attrMode[1] : '',
        }];
    } else {
        suggestions = body
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((label) => ({ label, action: '', sopId: '', taskId: '', mode: '' }));
    }
    return {
        displayText: raw.replace(/\[SUGGEST:.*?\]/g, '').replace(/\n{3,}/g, '\n\n').trim(),
        suggestions,
    };
}

function extractActionDirectivesFromReply(text = '') {
    const raw = String(text || '');
    const directives = [];
    const regex = /\[(?:ACTION\s*[:=]\s*|Action\s*=\s*)(.*?)\]/g;
    let match;
    while ((match = regex.exec(raw)) !== null) {
        const body = String(match[1] || '').trim();
        const nameMatch = body.match(/^([A-Za-z_]+)/);
        if (!nameMatch) continue;
        const getArg = (key) => {
            const m = body.match(new RegExp(`${key}="(.*?)"`));
            return m ? m[1] : '';
        };
        directives.push({
            type: nameMatch[1].toUpperCase(),
            sopId: getArg('sop_id'),
            taskId: getArg('task_id'),
            mode: getArg('mode'),
            path: getArg('path') || getArg('file_path'),
            url: getArg('url'),
            arguments: getArg('arguments') || getArg('args'),
        });
    }
    return directives;
}

function buildDirectiveDebugLabel(action = {}) {
    const normalized = String(action?.action || action?.type || '').trim().toLowerCase();
    const detail = action.sopId || action.taskId || action.mode || action.path || action.url || 'unknown';
    return `${normalized || 'unknown'}:${detail}`;
}

function resolveLanguageSopIdFromDirective(action = {}, contextText = '') {
    const haystack = [
        action.sopId,
        action.mode,
        action.language,
        action.arguments,
        action.label,
        contextText,
    ].filter(Boolean).join(' ').toLowerCase();
    if (/sys_lang_zh_cn|zh-cn|simplified chinese|\u7c21\u9ad4\u4e2d\u6587|\u7c21\u4e2d/.test(haystack)) return 'sys_lang_zh_cn';
    if (/sys_lang_zh_tw|zh-tw|traditional chinese|\u7e41\u9ad4\u4e2d\u6587|\u7e41\u4e2d/.test(haystack)) return 'sys_lang_zh_tw';
    if (/sys_lang_ja_jp|ja-jp|japanese|\u65e5\u6587|\u65e5\u8a9e/.test(haystack)) return 'sys_lang_ja_jp';
    if (/sys_lang_en_us|en-us|english|\u82f1\u6587|\u82f1\u8a9e/.test(haystack)) return 'sys_lang_en_us';
    return '';
}

function buildRemoteDirectiveExecutionKey(sessionId = '', action = {}) {
    const normalized = String(action?.action || action?.type || '').trim().toLowerCase();
    return [
        sessionId || 'no-session',
        normalized || 'unknown',
        action.sopId || '',
        action.taskId || '',
        action.mode || '',
        action.path || '',
        action.url || '',
        action.arguments || '',
    ].join('|');
}

function shouldSkipDuplicateRemoteDirective(sessionId = '', action = {}) {
    const key = buildRemoteDirectiveExecutionKey(sessionId, action);
    const now = Date.now();
    const lastSeen = recentRemoteDirectiveExecutions.get(key) || 0;
    if (now - lastSeen < REMOTE_DIRECTIVE_DEDUP_WINDOW_MS) {
        return true;
    }
    recentRemoteDirectiveExecutions.set(key, now);
    if (recentRemoteDirectiveExecutions.size > 200) {
        for (const [entryKey, timestamp] of recentRemoteDirectiveExecutions.entries()) {
            if (now - timestamp > REMOTE_DIRECTIVE_DEDUP_WINDOW_MS * 4) {
                recentRemoteDirectiveExecutions.delete(entryKey);
            }
        }
    }
    return false;
}

async function loadSkills() {
    try {
        const data = await api('/api/skills');
        if (data.success && Array.isArray(data.skills)) {
            skillsList = data.skills;
            renderSidebarTab();
        }
    } catch (e) {
        console.error('Load skills failed', e);
    }
}

async function queueSopTaskById(sopId = '', executeNow = false) {
    const target = sopsList.find((item) => item.id === sopId);
    if (!target) throw new Error(`SOP not found: ${sopId}`);
    const action = target.recommendedAction || 'install';
    const existingTask = [...todoList].reverse().find((item) => item.skillId === target.id && item.action === action && ['pending', 'running'].includes(item.status));
    if (existingTask) {
        if (executeNow && existingTask.status === 'pending') {
            await executeTask(existingTask.id);
        }
        return { task: existingTask, reused: true };
    }
    const data = await api('/api/todo', {
        method: 'POST',
        body: {
            title: target.name,
            description: target.description || '',
            category: target.category || 'Maintenance',
            skillId: target.id,
            action,
        }
    });
    if (!data.success) throw new Error(data.error || 'Failed to create task');
    todoList = data.todoList || todoList;
    renderTodoList();
    const task = data.task || todoList[todoList.length - 1];
    if (executeNow && task?.id) {
        await executeTask(task.id);
    }
    return { task, reused: false };
}

async function handleDirectiveAction(action = {}) {
    const normalized = String(action?.action || action?.type || '').trim().toLowerCase();
    if (normalized === 'install_sop') {
        addUILog(currentLocale === 'en-US'
            ? `▶ Remote directive: install_sop (${action.sopId || 'unknown'})`
            : `▶ 遠端指令：install_sop（${action.sopId || 'unknown'}）`, 'info');
        const { task, reused } = await queueSopTaskById(action.sopId, true);
        if (task?.id) await loadTodo();
        return {
            success: true,
            summary: currentLocale === 'en-US'
                ? `${reused ? 'Reused' : 'Started'} SOP task: ${task?.title || action.sopId}`
                : `${reused ? '沿用' : '已開始'} SOP 任務：${task?.title || action.sopId}`,
        };
    }
    if (normalized === 'add_task') {
        addUILog(currentLocale === 'en-US'
            ? `＋ Remote directive: add_task (${action.sopId || 'unknown'})`
            : `＋ 遠端指令：add_task（${action.sopId || 'unknown'}）`, 'info');
        const { task, reused } = await queueSopTaskById(action.sopId, false);
        await loadTodo();
        return {
            success: true,
            summary: currentLocale === 'en-US'
                ? `${reused ? 'Reused' : 'Added'} task: ${task?.title || action.sopId}`
                : `${reused ? '沿用' : '已加入'}任務：${task?.title || action.sopId}`,
        };
    }
    if (normalized === 'execute_task' && action.taskId) {
        const targetTask = todoList.find((item) => item.id === action.taskId);
        if (!targetTask) throw new Error(`Task not found: ${action.taskId}`);
        addUILog(currentLocale === 'en-US'
            ? `▶ Remote directive: execute_task (${targetTask.title})`
            : `▶ 遠端指令：execute_task（${targetTask.title}）`, 'info');
        await executeTask(action.taskId);
        return {
            success: true,
            summary: currentLocale === 'en-US'
                ? `Started task: ${targetTask.title}`
                : `已開始任務：${targetTask.title}`,
        };
    }
    if (normalized === 'computer_use') {
        const languageSopId = /install[_-]?language[_-]?pack/i.test(action.mode || '')
            ? resolveLanguageSopIdFromDirective(action, action.contextText || '')
            : '';
        if (languageSopId) {
            addUILog(currentLocale === 'en-US'
                ? `＋ Remote directive converted to task (${languageSopId})`
                : `＋ 遠端指令已轉為工作清單任務（${languageSopId}）`, 'info');
            const { task, reused } = await queueSopTaskById(languageSopId, false);
            await loadTodo();
            return {
                success: true,
                summary: currentLocale === 'en-US'
                    ? `${reused ? 'Reused' : 'Added'} task: ${task?.title || languageSopId}. Please run it from the task list when ready.`
                    : `${reused ? '沿用' : '已加入'}任務：${task?.title || languageSopId}。請到工作清單確認後再執行。`,
            };
        }
        addUILog(currentLocale === 'en-US'
            ? `🧭 Remote directive: computer_use (${action.mode || 'unknown'})`
            : `🧭 遠端指令：computer_use（${action.mode || 'unknown'}）`, 'info');
        const result = await api('/api/agent/computer-use', {
            method: 'POST',
            body: {
                mode: action.mode || '',
                sopId: action.sopId || '',
                path: action.path || '',
                filePath: action.path || '',
                url: action.url || '',
                arguments: action.arguments || '',
                vmSafeByDefault: false,
            }
        });
        if (result?.success && result?.result?.taskId) {
            await executeTask(result.result.taskId);
        }
        if (!result?.success) {
            throw new Error(result?.error || result?.result?.error || 'Computer Use failed');
        }
        return {
            success: true,
            summary: currentLocale === 'en-US'
                ? `Computer Use executed${result?.result?.mode ? ` (${result.result.mode})` : ''}.`
                : `已執行 Computer Use${result?.result?.mode ? `（${result.result.mode}）` : ''}。`,
        };
    }
    throw new Error(`Unsupported directive action: ${normalized || 'unknown'}`);
}

let sidebarRefreshTimer = null;
function refreshSidebarDataSoon() {
    if (sidebarRefreshTimer) clearTimeout(sidebarRefreshTimer);
    sidebarRefreshTimer = setTimeout(() => {
        sidebarRefreshTimer = null;
        loadRecommend();
        loadSops();
        loadSkills();
    }, 250);
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
    const actionLabel = getActionLabel(task.action || 'install');
    if (task.status === 'success') {
        const completionText = actionLabel === t('actions.uninstall') 
            ? t('task.uninstallCompleted', { title: task.title })
            : t('task.installCompleted', { title: task.title });
        return `✅${completionText}`;
    }
    if (task.status === 'skipped') {
        return actionLabel === t('actions.uninstall')
            ? t('task.uninstallSkipped', { title: task.title })
            : t('task.installSkipped', { title: task.title });
    }
    if (task.status === 'failed') {
        return `❌${t('task.executionFailed', { title: task.title })}`;
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

        if (task.skillId) {
            refreshSidebarDataSoon();
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
        addUILog('🔴 ' + t('ollama.notDetected'), 'warn');
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
            appendChatBubble('ai', '🔴 ' + t('ollama.installing'));
            addUILog('▶ ' + t('task.autoExecute', { title: task.title }), 'info');
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
        addUILog('🟡 ' + t('ollama.ready'), 'info');
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
            appendChatBubble('ai', '🟡 ' + t('ollama.downloading'));
            addUILog('▶ ' + t('task.autoExecute', { title: task.title }), 'info');
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
            // Case 3: 全都好了 → 顯示初始訊息和徽章
            if (!window._llmWelcomed) {
                // 顯示初始訊息（根據語系）
                const welcomeMsg = currentLocale === 'en-US'
                    ? 'Hello! I\'m your AI PC Agent. You can type, speak, or draw to tell me what software you need to install or what system settings to adjust.'
                    : '你好！我是你的 AI PC Agent，可以輸入文字、用嘴巴說，或是畫圖，來告訴我你需要安裝什麼軟體，或是調整系統設定喔！';
                appendChatBubble('ai', welcomeMsg);
                const versionStr = data.version ? ` (v${data.version})` : '';
                const readyMsg = currentLocale === 'en-US'
                    ? `🧠 AI Engine Ready! ${data.provider || 'Ollama'}${versionStr} model ${data.modelName || 'default'} loaded. You can start chatting in English.`
                    : `🧠 AI 引擎就緒！${data.provider || 'Ollama'}${versionStr} 模型 ${data.modelName || '預設'} 已載入，可以直接用中文告訴我你需要什麼。`;
                appendChatBubble('ai', readyMsg);
                const logMsg = currentLocale === 'en-US'
                    ? `🧠 AI Engine Ready${versionStr}: ${data.modelName || 'loaded'}`
                    : `🧠 AI 引擎就緒${versionStr}：${data.modelName || '已載入'}`;
                addUILog(logMsg, 'success');
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
            chatModelBadge.title = currentLocale === 'en-US' ? `Current model: ${status.modelName} (Click to switch)` : `當前模型: ${status.modelName} (點擊切換)`;
        }
    }

    if (status.available && status.modelReady) {
        llmDot.style.cssText = 'background:#4ec9b0;box-shadow:0 0 6px rgba(78,201,176,0.7)';
    } else if (status.available) {
        llmDot.style.cssText = 'background:#dcdcaa;box-shadow:0 0 6px rgba(220,220,170,0.6)';
    } else {
        llmDot.style.cssText = 'background:#f44747;box-shadow:0 0 6px rgba(244,71,71,0.5)';
    }
    updateLLMStatusText(status);

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
                    addUILog(`🧠 ${t('llm.modelSwitched', { modelName: m.name })}`, 'success');
                    appendChatBubble('ai', `🧠 ${t('llm.modelSwitchedChat', { modelName: m.name })}`);
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
//  RENDER � RECOMMEND LIST (sidebar)
// ════════════════════════════════════════════════════════
function localizeCategory(category) {
    return t(`categories.${category}`) || category || t('sidebar.otherCategory');
}

function localizeRiskLevel(riskLevel) {
    return t(`risks.${riskLevel}`) || riskLevel || t('sidebar.unknownRisk');
}

function localizeStatus(status) {
    return t(`statuses.${status}`) || status;
}

function getLocalizedItem(item) {
    const preset = getLocalePack().sopUi?.[item?.id] || getLocalePack().sopUi?.[item?.skillId] || {};
    return {
        ...item,
        title: preset.title || item?.title || item?.name || item?.id || t('task.unnamedItem'),
        name: preset.title || item?.name || item?.title || item?.id || t('task.unnamedItem'),
        description: preset.description || item?.description || '',
        category: preset.category || localizeCategory(item?.category),
        riskLevel: localizeRiskLevel(item?.riskLevel),
    };
}

function renderRecommendList() {
    recommendListContainer.innerHTML = '';
    if (!recommendList.length) {
        recommendListContainer.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:11px;">${t('sidebar.recommendLoading')}</div>`;
        return;
    }

    const localizedList = recommendList.map(getLocalizedItem);
    const filtered = localizedList.filter((item) => {
        if (!recSearchQuery) return true;
        const searchStr = `${item.title} ${item.description} ${item.category}`.toLowerCase();
        return searchStr.includes(recSearchQuery);
    });

    recCount.textContent = filtered.length;
    if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding:16px;color:var(--text-muted);font-size:11px;text-align:center;';
        empty.textContent = t('sidebar.recommendEmpty');
        recommendListContainer.appendChild(empty);
        return;
    }

    const getInstalledState = (item) => {
        if (window._installedStatus && Object.prototype.hasOwnProperty.call(window._installedStatus, item.id)) {
            return Boolean(window._installedStatus[item.id]);
        }
        return Boolean(item.installed);
    };

    const pending = filtered.filter((item) => !getInstalledState(item));
    const installed = filtered.filter((item) => getInstalledState(item));
    const pendingGroups = {};

    pending.forEach((item) => {
        const cat = item.category || t('sidebar.otherCategory');
        if (!pendingGroups[cat]) pendingGroups[cat] = [];
        pendingGroups[cat].push(item);
    });

    Object.entries(pendingGroups).forEach(([cat, items]) => {
        const header = document.createElement('div');
        header.className = 'sidebar-section-header';
        header.style.cssText = 'padding:12px 10px 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);';
        header.textContent = cat;
        recommendListContainer.appendChild(header);

        items.forEach((item) => {
            recommendListContainer.appendChild(createRecommendCard({ ...item, installed: false }));
        });
    });

    if (installed.length > 0) {
        const header = document.createElement('div');
        header.className = 'sidebar-section-header';
        header.style.cssText = 'padding:20px 10px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent-green);opacity:0.8;';
        header.textContent = t('sidebar.installedHeader');
        recommendListContainer.appendChild(header);

        installed.forEach((item) => {
            recommendListContainer.appendChild(createRecommendCard({ ...item, installed: true }));
        });
    }
}

function getActionLabel(action) {
    return action === 'uninstall' ? t('actions.uninstall') : t('actions.install');
}

function getActionTitle(title, action) {
    if (!title) return t('task.unnamedItem');
    const normalizedAction = action === 'uninstall' ? 'uninstall' : 'install';
    
    // 提取主體：移掉開頭的表情符號與常見動詞
    let subject = String(title)
        .replace(/^[^\p{L}\p{N}]+/u, '') // 移掉開頭符號/表情
        .replace(/^(安裝|下載|建立|解除安裝|移除|清理|優化|檢測|設定)\s*/gi, '') // 中文動詞
        .replace(/^(Install|Download|Create|Uninstall|Remove|Setup|Set up|Set|Get|Pull|Check|Add|Add-AppxPackage)\s+/gi, '') // 英文動詞
        .trim();

    // 如果主體為空（例如標題本來就只有一個動詞），就退回到原始標題
    if (!subject) return title;

    return t(`actions.${normalizedAction}Title`, { title: subject });
}

function createRecommendCard(item) {
    const localized = getLocalizedItem(item);
    const isInstalled = Boolean(localized.installed);
    const action = isInstalled && localized.supportsUninstall ? 'uninstall' : 'install';
    const actionLabel = getActionLabel(action);
    const isActionable = Boolean(localized.skillId) && (!isInstalled || localized.supportsUninstall);
    const card = document.createElement('div');
    card.className = `recommend-card ${isInstalled && !localized.supportsUninstall ? 'installed' : ''}`;
    if (isInstalled && !localized.supportsUninstall) card.style.opacity = '0.5';

    card.innerHTML = `
        <div class="recommend-card-top">
          <div class="recommend-title">
              ${getActionTitle(localized.title, action)}
              ${isInstalled
                ? `<span style="font-size:10px; color:${localized.supportsUninstall ? '#f59e0b' : '#4ec9b0'}; margin-left:6px; font-weight:normal;">${localized.supportsUninstall ? t('sidebar.uninstallBadge') : t('sidebar.readyBadge')}</span>`
                : ''}
          </div>
          ${isActionable ? `
              <div class="recommend-btn-group">
                <button class="btn-add-todo" title="${t('task.addActionTask', { action: actionLabel })}">＋</button>
                <button class="btn-run-now" title="${t('task.runActionNow', { action: actionLabel })}">▶</button>
              </div>
          ` : ''}
        </div>
        <div class="recommend-desc">${localized.description || ''}</div>
        <div class="recommend-meta">
          <span class="recommend-category">${localized.category}</span>
          ${isActionable ? `<span class="recommend-skill-badge">${t('sidebar.actionable', { action: actionLabel })}</span>` : ''}
        </div>
    `;

    if (isActionable) {
        card.querySelector('.btn-add-todo')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await addRecommendToTodo({ ...localized, recommendedAction: action }); } finally { btn.disabled = false; }
        });
        card.querySelector('.btn-run-now')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await addAndExecuteRecommend({ ...localized, recommendedAction: action }); } finally { btn.disabled = false; }
        });
    }
    return card;
}

function renderSidebarTab() {
    renderRecommendList();
    renderSopList();
    renderSkillList();
    syncSidebarTabUI();
}

function syncSidebarTabUI() {
    $$('.sidebar-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.sidebarTab === activeSidebarTab);
    });
    recommendListContainer?.classList.toggle('active', activeSidebarTab === 'recommend');
    sopListContainer?.classList.toggle('active', activeSidebarTab === 'sops');
    skillListContainer?.classList.toggle('active', activeSidebarTab === 'skills');
    if (recSearchInput) {
        recSearchInput.placeholder = activeSidebarTab === 'recommend'
            ? t('sidebar.recommendPlaceholder')
            : activeSidebarTab === 'skills'
                ? t('sidebar.skillPlaceholder')
                : t('sidebar.sopPlaceholder');
    }
}

function renderSopList() {
    if (!sopListContainer) return;
    sopListContainer.innerHTML = '';
    if (sopCount) sopCount.textContent = String(sopsList.length);

    if (!sopsList.length) {
        sopListContainer.innerHTML = `<div class="sidebar-empty">${t('sidebar.sopLoading')}</div>`;
        return;
    }

    const localizedSops = sopsList.map(getLocalizedItem);
    const filtered = localizedSops.filter((sop) => {
        if (!recSearchQuery) return true;
        const searchStr = `${sop.name || ''} ${sop.id || ''} ${sop.category || ''}`.toLowerCase();
        return searchStr.includes(recSearchQuery);
    });

    if (sopCount) sopCount.textContent = String(filtered.length);

    if (!filtered.length) {
        sopListContainer.appendChild(createSidebarEmptyState(t('sidebar.sopEmpty')));
        return;
    }

    const groups = {};
    filtered.forEach((sop) => {
        const cat = sop.category || t('sidebar.otherCategory');
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(sop);
    });

    Object.entries(groups).forEach(([cat, items]) => {
        sopListContainer.appendChild(createSidebarSectionHeader(cat));
        items.forEach((sop) => {
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
    const riskLabel = sop.riskLevel || t('sidebar.unknownRisk');
    const action = sop.installed && sop.supportsUninstall ? 'uninstall' : 'install';
    const actionLabel = getActionLabel(action);
    const isActionable = !sop.installed || sop.supportsUninstall;

    card.innerHTML = `
        <div class="recommend-card-top">
          <div class="recommend-title">${getActionTitle(sop.name || sop.id, action)}${sop.installed ? `<span style="font-size:10px; color:${sop.supportsUninstall ? '#f59e0b' : '#4ec9b0'}; margin-left:6px; font-weight:normal;">${sop.supportsUninstall ? t('sidebar.uninstallBadge') : t('sidebar.readyBadge')}</span>` : ''}</div>
          ${isActionable ? `<div class="recommend-btn-group sop-btn-group">
            <button class="btn-add-todo" title="${t('task.addActionTask', { action: actionLabel })}">＋</button>
            <button class="btn-run-now" title="${t('task.runActionNow', { action: actionLabel })}">▶</button>
          </div>` : ''}
        </div>
        <div class="recommend-desc sop-id">${sop.id || ''}</div>
        <div class="recommend-meta">
          <span class="recommend-category">${sop.category || t('sidebar.otherCategory')}</span>
          <span class="recommend-skill-badge">${requiresAdmin ? 'UAC / Admin' : t('sidebar.normalPermission')}</span>
          <span class="recommend-skill-badge">${t('sidebar.risk', { value: riskLabel })}</span>
          ${isActionable ? `<span class="recommend-skill-badge">${t('sidebar.actionableShort', { action: actionLabel })}</span>` : ''}
        </div>
    `;

    if (isActionable) {
        card.querySelector('.btn-add-todo')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await addSopToTodo({ ...sop, recommendedAction: action }); } finally { btn.disabled = false; }
        });
        card.querySelector('.btn-run-now')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            btn.disabled = true;
            try { await addAndExecuteSop({ ...sop, recommendedAction: action }); } finally { btn.disabled = false; }
        });
    }
    return card;
}

function renderSkillList() {
    if (!skillListContainer) return;
    skillListContainer.innerHTML = '';
    if (skillCount) skillCount.textContent = String(skillsList.length);

    if (!skillsList.length) {
        skillListContainer.innerHTML = `<div class="sidebar-empty">${t('sidebar.skillLoading')}</div>`;
        return;
    }

    const filtered = skillsList.filter((skill) => {
        if (!recSearchQuery) return true;
        const searchStr = `${skill.name || ''} ${skill.slug || ''} ${skill.description || ''} ${skill.tags || ''}`.toLowerCase();
        return searchStr.includes(recSearchQuery);
    });

    if (skillCount) skillCount.textContent = String(filtered.length);
    if (!filtered.length) {
        skillListContainer.appendChild(createSidebarEmptyState(t('sidebar.skillEmpty')));
        return;
    }

    const groups = {};
    filtered.forEach((skill) => {
        const cat = skill.category || t('sidebar.otherCategory');
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(skill);
    });

    Object.entries(groups).forEach(([cat, items]) => {
        skillListContainer.appendChild(createSidebarSectionHeader(cat));
        items.forEach((skill) => {
            skillListContainer.appendChild(createSkillCard(skill));
        });
    });
}

function createSkillCard(skill) {
    const card = document.createElement('div');
    card.className = 'recommend-card skill-card';
    const tags = Array.isArray(skill.tags) ? skill.tags.join(', ') : (skill.tags || '');
    card.innerHTML = `
        <div class="recommend-card-top">
          <div class="recommend-title">${escapeHtml(skill.name || skill.slug || t('task.unnamedItem'))}</div>
        </div>
        <div class="recommend-desc">${escapeHtml(skill.description || '')}</div>
        <div class="recommend-meta">
          <span class="recommend-category">${escapeHtml(skill.slug || '')}</span>
          ${tags ? `<span class="recommend-skill-badge">${escapeHtml(tags)}</span>` : ''}
        </div>
    `;
    return card;
}

function updateLocaleUI() {
    document.documentElement.lang = currentLocale;
    if (btnLang) {
        btnLang.textContent = t('localeLabel');
        btnLang.title = t('footer.switchTo');
    }
    const splashText = document.getElementById('splashText');
    if (splashText && !document.getElementById('splashOverlay')?.classList.contains('hidden')) {
        splashText.textContent = localStorage.getItem('aipc_has_run') ? t('splash.starting') : t('splash.firstRun');
    }
    const menuFile = document.getElementById('menuFile');
    const menuView = document.getElementById('menuView');
    const menuHelp = document.getElementById('menuHelp');
    if (menuFile) menuFile.textContent = t('titlebar.file');
    if (menuView) menuView.textContent = t('titlebar.view');
    if (menuHelp) menuHelp.textContent = t('titlebar.help');
    const llmTitle = document.getElementById('llmStatus');
    if (llmTitle) llmTitle.title = t('titlebar.aiSettings');
    if (btnToggleSidebar) btnToggleSidebar.title = t('titlebar.toggleSidebar');
    if (btnTogglePanel) btnTogglePanel.title = t('titlebar.toggleLog');
    if (btnToggleChat) btnToggleChat.title = t('titlebar.toggleChat');
    const sidebarTabRecommend = document.querySelector('.sidebar-tab[data-sidebar-tab="recommend"] span');
    const sidebarTabSops = document.querySelector('.sidebar-tab[data-sidebar-tab="sops"] span');
    const sidebarTabSkills = document.querySelector('.sidebar-tab[data-sidebar-tab="skills"] span');
    if (sidebarTabRecommend) sidebarTabRecommend.textContent = t('tabs.recommend');
    if (sidebarTabSops) sidebarTabSops.textContent = t('tabs.sops');
    if (sidebarTabSkills) sidebarTabSkills.textContent = '🧩 Skills';
    const tabHardware = document.querySelector('#tab-hardware .tab-title');
    const tabBrowser = document.querySelector('#tab-browser .tab-title');
    const tabTodo = document.querySelector('#tab-todolist .tab-title');
    if (tabHardware) tabHardware.textContent = t('tabs.hardware');
    if (tabBrowser) tabBrowser.textContent = 'Browser';
    if (tabTodo) tabTodo.textContent = t('tabs.todolist');
    const logTab = document.querySelector('[data-bottom-tab="logs"]');
    const expsTab = document.querySelector('[data-bottom-tab="exps"]');
    if (logTab) logTab.textContent = t('tabs.logs');
    if (expsTab) expsTab.textContent = t('tabs.exps');
    const remoteChatTab = document.querySelector('.chat-mode-tab[data-chat-mode="remote"]');
    if (remoteChatTab) remoteChatTab.textContent = t('remote.remoteTab');
    if (chatModelBadge) {
        if (!chatModelBadge.textContent || chatModelBadge.textContent === 'AI 模型' || chatModelBadge.textContent === 'AI Model') {
            chatModelBadge.textContent = t('chat.modelBadge');
        }
        chatModelBadge.title = t('chat.switchModel');
    }
    if (btnMic) btnMic.title = t('chat.mic');
    if (btnChalkAttach) btnChalkAttach.title = t('chat.attachChalkboard');
    if (btnNewLocalSession) btnNewLocalSession.title = t('chat.localSessionNew');
    if (btnRemoteAttachFile) btnRemoteAttachFile.title = t('remote.attachFile');
    if (btnClearChat) btnClearChat.title = t('chat.clear');
    if (btnDisconnectRemote) btnDisconnectRemote.title = t('remote.disconnect');
    if (remoteSessionStatus) remoteSessionStatus.textContent = getRemoteStatusText(getActiveRemoteSession());
    if (remoteHostInput) remoteHostInput.placeholder = t('remote.hostPlaceholder');
    if (remoteAgentNameInput) remoteAgentNameInput.placeholder = t('remote.agentPlaceholder');
    if (remoteUserNameInput) remoteUserNameInput.placeholder = t('remote.userPlaceholder');
    if (btnRemoteConnect) btnRemoteConnect.textContent = getRemoteConnectButtonText(getActiveRemoteSession());
    if (btnSaveRemoteProfile) btnSaveRemoteProfile.textContent = t('remote.saveProfile');
    if (btnShareScreen) btnShareScreen.textContent = t('remote.shareScreen');
    updateRemoteToolbarToggle();
    if (remoteChatHint) remoteChatHint.textContent = buildRemoteHintText(getActiveRemoteSession());
    if (remoteSendMode?.options?.[0]) remoteSendMode.options[0].text = t('remote.modeUser');
    if (remoteSendMode?.options?.[1]) remoteSendMode.options[1].text = t('remote.modeLocalAi');
    if (remoteRequestTitle) remoteRequestTitle.textContent = t('remote.requestTitle');
    if (remoteRequestSummary) remoteRequestSummary.textContent = t('remote.requestSummary');
    if (btnAcceptRemoteRequest) btnAcceptRemoteRequest.textContent = t('remote.accept');
    if (btnRejectRemoteRequest) btnRejectRemoteRequest.textContent = t('remote.reject');
    
    // Update experience search placeholder
    if (expSearchInput) expSearchInput.placeholder = t('exps.searchPlaceholder');
    if (btnExpsExport) {
        btnExpsExport.textContent = t('exps.exportButton');
        btnExpsExport.title = t('exps.exportTooltip');
    }

    // Update log empty message
    const logEmptyMessage = document.getElementById('logEmptyMessage');
    if (logEmptyMessage) logEmptyMessage.textContent = t('logs.emptyMessage');
    
    // Update exps empty message
    const expsEmptyMessage = document.getElementById('expsEmptyMessage');
    if (expsEmptyMessage) expsEmptyMessage.textContent = t('exps.emptyMessage');
    
    // Update menu elements
    const menuFileText = document.getElementById('menuFileText');
    if (menuFileText) menuFileText.textContent = t('titlebar.file');
    
    const menuViewText = document.getElementById('menuView');
    if (menuViewText) menuViewText.textContent = t('titlebar.view');
    
    const menuHelpText = document.getElementById('menuHelp');
    if (menuHelpText) menuHelpText.textContent = t('titlebar.help');
    
    const importTasksText = document.getElementById('importTasksText');
    if (importTasksText) importTasksText.textContent = t('footer.importTasks');
    
    const exportTasksText = document.getElementById('exportTasksText');
    if (exportTasksText) exportTasksText.textContent = t('footer.exportTasks');
    
    const menuRefreshText = document.getElementById('menuRefreshText');
    if (menuRefreshText) menuRefreshText.textContent = t('titlebar.refresh');
    
    const menuExitText = document.getElementById('menuExitText');
    if (menuExitText) menuExitText.textContent = t('titlebar.exit');
    
    // Update LLM status
    const llmLabel = document.getElementById('llmLabel');
    if (llmLabel) llmLabel.textContent = t('titlebar.llmReady');

    // Chat Input Area
    if (chatInput) chatInput.placeholder = t('chat.placeholder');
    if (btnSend) btnSend.title = t('chat.send');
    const inputHint = document.querySelector('.input-hint');
    if (inputHint) inputHint.textContent = t('chat.hint');
    switchChatMode(activeChatMode);

    // AI Settings Modal
    const settingsTitle = document.querySelector('.provider-modal .modal-header h3');
    if (settingsTitle) settingsTitle.textContent = t('settings.title');
    
    const labels = document.querySelectorAll('.provider-modal .form-group label');
    if (labels.length > 0) {
        labels.forEach(l => {
            const txt = l.firstChild?.textContent?.trim();
            if (txt === 'AI Provider') l.firstChild.textContent = t('settings.provider');
            if (txt === '連線網址 (Base URL)' || txt === 'Base URL') l.firstChild.textContent = t('settings.baseUrl');
            if (txt === '認證方式' || txt === 'Authentication') l.firstChild.textContent = t('settings.authType');
            if (txt === 'API Key') l.firstChild.textContent = t('settings.apiKey');
            if (txt === 'Token URL') l.firstChild.textContent = 'Token URL';
            if (txt === 'Client ID') l.firstChild.textContent = 'Client ID';
            if (txt === 'Client Secret') l.firstChild.textContent = 'Client Secret';
            if (txt === 'Scope') l.firstChild.textContent = 'Scope';
            if (txt === 'Audience / Resource (選填)' || txt === 'Audience / Resource (Optional)') l.firstChild.textContent = 'Audience / Resource' + (currentLocale === 'zh-TW' ? ' (選填)' : ' (Optional)');
            if (txt === 'Vision 多模態模型' || txt === 'Vision Model') l.firstChild.textContent = t('settings.visionModel');
        });
    }

    const modelNameLabel = document.querySelector('label[style*="display:flex"] span');
    if (modelNameLabel) modelNameLabel.textContent = t('settings.modelName');
    
    if (btnRefreshModels) btnRefreshModels.textContent = t('settings.refresh');
    if (settingBaseUrl) settingBaseUrl.placeholder = t('settings.baseUrlPlaceholder');
    if (settingApiKey2) settingApiKey2.placeholder = t('settings.apiKeyPlaceholder');
    if (settingModelName) settingModelName.placeholder = t('settings.modelNamePlaceholder');
    if (settingVisionModelName) settingVisionModelName.placeholder = t('settings.visionModelPlaceholder');
    
    if (providerHelpTitle && providerHelpTitle.id === 'providerHelpTitle') providerHelpTitle.textContent = t('settings.helpTitle');
    if (providerHelpText && providerHelpText.id === 'providerHelpText') providerHelpText.textContent = t('settings.helpText');
    const mHelp = document.getElementById('modelHelpText');
    if (mHelp) mHelp.textContent = t('settings.modelHelp');
    const vHelp = document.getElementById('visionModelHelpText');
    if (vHelp) vHelp.textContent = t('settings.visionHelp');

    if (btnTestProviderSettings) btnTestProviderSettings.textContent = t('settings.test');
    if (btnSaveProviderSettings) btnSaveProviderSettings.textContent = t('settings.save');
    
    // Model Name & Vision Model Labels
    const labelModelName = document.getElementById('labelModelName');
    if (labelModelName) labelModelName.textContent = t('settings.modelName');
    const labelVisionModel = document.getElementById('labelVisionModel');
    if (labelVisionModel) labelVisionModel.textContent = t('settings.visionModel');
    
    // Auth Type Options
    const authOptions = document.querySelectorAll('#settingAuthType option');
    if (authOptions.length >= 3) {
        authOptions[0].textContent = t('settings.authNone');
        authOptions[1].textContent = t('settings.authApiKey');
        authOptions[2].textContent = t('settings.authOAuth');
    }
    
    // Text Tool Modal
    const textToolTitle = document.querySelector('.text-tool-modal h3');
    if (textToolTitle) textToolTitle.textContent = t('textTool.title');
    
    const textToolContentLabel = document.getElementById('textToolContentLabel');
    if (textToolContentLabel) textToolContentLabel.textContent = t('textTool.content');
    
    const textToolContent = document.getElementById('textToolContent');
    if (textToolContent) textToolContent.placeholder = t('textTool.contentPlaceholder');
    
    const textToolFontFamilyLabel = document.getElementById('textToolFontFamilyLabel');
    if (textToolFontFamilyLabel) textToolFontFamilyLabel.textContent = t('textTool.fontFamily');
    
    const textToolFontStyleLabel = document.getElementById('textToolFontStyleLabel');
    if (textToolFontStyleLabel) textToolFontStyleLabel.textContent = t('textTool.fontStyle');
    
    const textToolFontSizeLabel = document.getElementById('textToolFontSizeLabel');
    if (textToolFontSizeLabel) textToolFontSizeLabel.textContent = t('textTool.fontSize');
    
    const textToolColorLabel = document.getElementById('textToolColorLabel');
    if (textToolColorLabel) textToolColorLabel.textContent = t('textTool.color');
    
    const textToolAlignLabel = document.getElementById('textToolAlignLabel');
    if (textToolAlignLabel) textToolAlignLabel.textContent = t('textTool.align');
    
    const textToolBoldLabel = document.getElementById('textToolBoldLabel');
    if (textToolBoldLabel) textToolBoldLabel.textContent = t('textTool.bold');
    
    const textToolItalicLabel = document.getElementById('textToolItalicLabel');
    if (textToolItalicLabel) textToolItalicLabel.textContent = t('textTool.italic');
    
    const textToolUsageTitle = document.getElementById('textToolUsageTitle');
    if (textToolUsageTitle) textToolUsageTitle.textContent = t('textTool.usage');
    
    const textToolUsageText = document.getElementById('textToolUsageText');
    if (textToolUsageText) textToolUsageText.textContent = t('textTool.usageText');
    
    const btnCancelTextTool = document.getElementById('btnCancelTextTool');
    if (btnCancelTextTool) btnCancelTextTool.textContent = t('textTool.cancel');
    
    const btnApplyTextTool = document.getElementById('btnApplyTextTool');
    if (btnApplyTextTool) btnApplyTextTool.textContent = t('textTool.apply');
    
    // Text Tool Font Style Options
    const textToolStyleChalk = document.getElementById('textToolStyleChalk');
    if (textToolStyleChalk) textToolStyleChalk.textContent = t('textTool.styleOptions.chalk');
    
    const textToolStyleBoard = document.getElementById('textToolStyleBoard');
    if (textToolStyleBoard) textToolStyleBoard.textContent = t('textTool.styleOptions.board');
    
    const textToolStyleClean = document.getElementById('textToolStyleClean');
    if (textToolStyleClean) textToolStyleClean.textContent = t('textTool.styleOptions.clean');
    
    const textToolStyleSerif = document.getElementById('textToolStyleSerif');
    if (textToolStyleSerif) textToolStyleSerif.textContent = t('textTool.styleOptions.serif');
    
    const textToolStyleMono = document.getElementById('textToolStyleMono');
    if (textToolStyleMono) textToolStyleMono.textContent = t('textTool.styleOptions.mono');
    
    // Text Tool Alignment Options
    const textToolAlignLeft = document.getElementById('textToolAlignLeft');
    if (textToolAlignLeft) textToolAlignLeft.textContent = t('textTool.alignOptions.left');
    
    const textToolAlignCenter = document.getElementById('textToolAlignCenter');
    if (textToolAlignCenter) textToolAlignCenter.textContent = t('textTool.alignOptions.center');
    
    const textToolAlignRight = document.getElementById('textToolAlignRight');
    if (textToolAlignRight) textToolAlignRight.textContent = t('textTool.alignOptions.right');
    
    // Chalkboard Tools Tooltips
    const chalkEraser = document.getElementById('chalkEraser');
    if (chalkEraser) chalkEraser.title = t('chalkboard.tools.eraser');
    
    const chalkWhite = document.getElementById('chalkWhite');
    if (chalkWhite) chalkWhite.title = t('chalkboard.tools.chalkWhite');
    
    const chalkRed = document.getElementById('chalkRed');
    if (chalkRed) chalkRed.title = t('chalkboard.tools.chalkRed');
    
    const chalkYellow = document.getElementById('chalkYellow');
    if (chalkYellow) chalkYellow.title = t('chalkboard.tools.chalkYellow');
    
    const chalkGreen = document.getElementById('chalkGreen');
    if (chalkGreen) chalkGreen.title = t('chalkboard.tools.chalkGreen');
    
    const chalkBlue = document.getElementById('chalkBlue');
    if (chalkBlue) chalkBlue.title = t('chalkboard.tools.chalkBlue');
    
    const chalkSizeSmall = document.getElementById('chalkSizeSmall');
    if (chalkSizeSmall) chalkSizeSmall.title = t('chalkboard.tools.sizeSmall');
    
    const chalkSizeMedium = document.getElementById('chalkSizeMedium');
    if (chalkSizeMedium) chalkSizeMedium.title = t('chalkboard.tools.sizeMedium');
    
    const chalkSizeLarge = document.getElementById('chalkSizeLarge');
    if (chalkSizeLarge) chalkSizeLarge.title = t('chalkboard.tools.sizeLarge');
    
    const chalkSelectButton = document.getElementById('chalkSelectButton');
    if (chalkSelectButton) chalkSelectButton.title = t('chalkboard.tools.select');
    
    const chalkLineButton = document.getElementById('chalkLineButton');
    if (chalkLineButton) chalkLineButton.title = t('chalkboard.tools.line');
    
    const chalkRectButton = document.getElementById('chalkRectButton');
    if (chalkRectButton) chalkRectButton.title = t('chalkboard.tools.rect');
    
    const chalkCircleButton = document.getElementById('chalkCircleButton');
    if (chalkCircleButton) chalkCircleButton.title = t('chalkboard.tools.circle');
    
    const chalkTextButton = document.getElementById('chalkTextButton');
    if (chalkTextButton) chalkTextButton.title = t('chalkboard.tools.text');
    
    const chalkCopyButton = document.getElementById('chalkCopyButton');
    if (chalkCopyButton) chalkCopyButton.title = t('chalkboard.tools.copy');
    
    const chalkCutButton = document.getElementById('chalkCutButton');
    if (chalkCutButton) chalkCutButton.title = t('chalkboard.tools.cut');
    
    const chalkPasteButton = document.getElementById('chalkPasteButton');
    if (chalkPasteButton) chalkPasteButton.title = t('chalkboard.tools.paste');
    
    const chalkClearButton = document.getElementById('chalkClearButton');
    if (chalkClearButton) chalkClearButton.title = t('chalkboard.tools.clear');
    
    const chalkUndoButton = document.getElementById('chalkUndoButton');
    if (chalkUndoButton) chalkUndoButton.title = t('chalkboard.tools.undo');
    const chalkRedoButton = document.getElementById('chalkRedoButton');
    if (chalkRedoButton) chalkRedoButton.title = currentLocale === 'en-US' ? 'Redo' : '重做';
    
    const chalkUploadButton = document.getElementById('chalkUploadButton');
    if (chalkUploadButton) chalkUploadButton.title = t('chalkboard.tools.upload');
    
    const chalkSaveButton = document.getElementById('chalkSaveButton');
    if (chalkSaveButton) chalkSaveButton.title = t('chalkboard.tools.save');
    
    if (btnToggleLog) btnToggleLog.textContent = t('buttons.collapse');
    if (statusTasks) statusTasks.textContent = t('footer.tasks', { count: todoList.length });
    // Title and menu i18n
    document.title = currentLocale === 'en-US' ? 'AI PC Agent - System Butler' : 'AI PC Agent - 系統管家';
    const _appTitle = document.getElementById('appTitle');
    if (_appTitle) _appTitle.textContent = document.title;
    const _menuHelp = document.getElementById('menuHelp');
    if (_menuHelp) _menuHelp.textContent = currentLocale === 'en-US' ? 'Help' : '說明';
    const _menuView = document.getElementById('menuView');
    if (_menuView) _menuView.textContent = currentLocale === 'en-US' ? 'View' : '檢視';
    
    // File Menu i18n
    const isEn = currentLocale === 'en-US';
    const _mft = document.getElementById('menuFileText'); if (_mft) _mft.textContent = isEn ? 'File' : '檔案';
    const _itt = document.getElementById('importTasksText'); if (_itt) _itt.textContent = isEn ? 'Import Tasks' : '匯入任務清單';
    const _ett = document.getElementById('exportTasksText'); if (_ett) _ett.textContent = isEn ? 'Export Tasks' : '匯出任務清單';
    const _mrt = document.getElementById('menuRefreshText'); if (_mrt) _mrt.textContent = isEn ? 'Refresh' : 'Refresh 畫面';
    updateLLMStatusText(window.__lastLLMStatus);
    renderSidebarTab();
    renderTodoList();
    updateChatModeBadges();
    updateChatModelBadgeDisplay(window.__lastLLMStatus || null);
    renderLocalSessionControls();
    renderLocalChatMessages();
}

function setLocale(locale) {
    currentLocale = locale === 'en-US' ? 'en-US' : 'zh-TW';
    localStorage.setItem('ui_locale', currentLocale);
    updateLocaleUI();
}

function toggleLocale() {
    setLocale(currentLocale === 'zh-TW' ? 'en-US' : 'zh-TW');
}

function updateLLMStatusText(status = {}) {
    if (!llmDot || !llmLabel) return;
    window.__lastLLMStatus = status || {};
    if (chatModelBadge && status.modelName) {
        chatModelBadge.dataset.baseModel = status.modelName;
    }
    if (status.available && status.modelReady) {
        llmLabel.textContent = t('titlebar.aiReady');
        if (statusLLM) statusLLM.textContent = `🟢 ${t('titlebar.aiReady')}`;
    } else if (status.available) {
        llmLabel.textContent = t('titlebar.modelNotReady');
        if (statusLLM) statusLLM.textContent = `🟡 ${t('titlebar.modelNotReady')}`;
    } else {
        llmLabel.textContent = t('titlebar.engineNotReady');
        if (statusLLM) statusLLM.textContent = `🔴 ${t('titlebar.engineNotReady')}`;
    }
    updateChatModelBadgeDisplay(status);
}

// ════════════════════════════════════════════════════════
//  RENDER � TODO LIST (center top)
// ════════════════════════════════════════════════════════
function renderTodoList() {
    const pending = todoList.filter(t => t.status !== 'success' && t.status !== 'failed' && t.status !== 'skipped');
    const done = todoList.filter(t => t.status === 'success' || t.status === 'failed' || t.status === 'skipped');

    todoCount.textContent = todoList.length;
    if (statusTasks) statusTasks.textContent = t('footer.tasks', { count: todoList.length });

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
            ${task.skillId && task.status === 'pending' ? `<button class="btn-task run" title="${t('buttons.execute')}" data-id="${task.id}">▶</button>` : ''}
            ${task.status !== 'running' ? `<button class="btn-task delete" title="${t('buttons.delete')}" data-id="${task.id}">✕</button>` : ''}
          </div>
        </div>
        <div class="task-meta">
          <span class="task-category">${task.category || t('task.general')}</span>
          <span class="task-category">${getActionLabel(task.action || 'install')}</span>
          <span class="task-status" data-status="${task.status}">${localizeStatus(task.status)}</span>
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
    const localized = getLocalizedItem(item);
    const action = localized.recommendedAction || 'install';
    const data = await api('/api/todo', {
        method: 'POST',
        body: { title: localized.title, description: localized.description, category: localized.category, skillId: localized.id, action },
    });
    if (data.success) { 
        todoList = data.todoList; 
        renderTodoList(); 
        addUILog(`＋ ${t('task.addedToList', { action: getActionLabel(action), title: getActionTitle(localized.title, action) })}`, 'info'); 
        openTab('todolist');
    }
}

async function addAndExecuteRecommend(item) {
    const localized = getLocalizedItem(item);
    const action = localized.recommendedAction || 'install';
    const data = await api('/api/todo', {
        method: 'POST',
        body: { title: localized.title, description: localized.description, category: localized.category, skillId: localized.id, action },
    });
    if (data.success) {
        todoList = data.todoList;
        renderTodoList();
        openTab('todolist');
        const newTask = data.task || data.todoList[data.todoList.length - 1];
        if (newTask?.id) {
            addUILog(`▶ ${t('task.startingAction', { action: getActionLabel(action), title: getActionTitle(localized.title, action) })}`, 'info');
            appendChatBubble('ai', `🚀 ${t('task.startingProcess', { title: getActionTitle(localized.title, action) })}`);
            expandLog();
            await executeTask(newTask.id);
            if (String(localized.id || '').trim() === 'install_playwright_chromium') {
                await refreshBrowserRuntimeAvailability();
            }
        }
    }
}

async function executeTask(taskId) {
    const task = todoList.find(t => t.id === taskId);
    if (task) appendChatBubble('ai', `🚀 ${t('task.executionStarted', { title: task.title })}`);
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
    if (isModePending(activeChatMode)) {
        const controller = getActiveAbortController(activeChatMode);
        controller?.abort();
        setActiveAbortController(null, activeChatMode);
        updateSendButtonState();
        return;
    }

    const msg = chatInput.value.trim();
    if (!msg) return;
    if (activeChatMode === 'local' && getActiveRemoteSession() && /(^|\s)@/.test(msg)) {
        switchChatMode('remote');
    }
    if (activeChatMode === 'remote' && !getActiveRemoteSession()) {
        appendChatBubble('system', t('remote.noSession'), [], { container: remoteChatMessages, forceSystem: true });
        return;
    }
    const chalkboardAttachment = isChalkboardAttachmentEnabled ? buildChalkboardChatAttachment() : null;
    chatInput.value = '';
    chatInput.style.height = '';


    if (activeChatMode === 'remote') {
        appendChatBubble('user', msg, [], {
            container: remoteChatMessages,
            senderLabel: remoteProfile?.userName || 'Me',
            actorScope: 'local',
        });
    } else {
        appendChatBubble('user', chalkboardAttachment ? `${msg}\n\n[已附上 Chalkboard 草圖供 AI 參考]` : msg);
    }
    const currentMode = activeChatMode;
    const currentLocalSession = currentMode === 'local' ? getActiveLocalChatSession() : null;
    const thinkId = appendThinking(currentMode === 'remote' ? remoteChatMessages : chatMessages);

    // 初始化中斷控制
    const requestAbortController = new AbortController();
    setThinkingIdForMode(currentMode, thinkId);
    setActiveAbortController(requestAbortController, currentMode);
    if (currentMode === 'remote') {
        setRemotePendingRoles({ local: false, remote: false });
    }
    updateSendButtonState();

    // 切換按鈕狀態為 Stop
    const iconSend = btnSend.querySelector('.icon-send');
    const iconStop = btnSend.querySelector('.icon-stop');
    btnSend.classList.add('stop');
    btnSend.title = currentLocale === 'en-US' ? 'Stop' : '停止';
    iconSend?.classList.add('hidden');
    iconStop?.classList.remove('hidden');

    try {
        const data = currentMode === 'remote'
            ? await (async () => {
                const targets = resolveRemoteTargets(msg);
                if (targets.includes('local-ai') && targets.includes('remote-ai')) {
                    setRemotePendingRoles({ local: true, remote: true });
                    updatePendingStatusRow();
                    addUILog(currentLocale === 'en-US'
                        ? '🤝 Dual-AI collaboration: Local AI answers first, Remote AI follow-up queued'
                        : '🤝 雙 AI 協作：本地 AI 先回，遠端 AI 補充已排入佇列', 'info');
                    api(`/api/remote/session/${selectedRemoteSessionId}/message`, {
                        method: 'POST',
                        body: {
                            text: msg,
                            mode: 'user',
                            target: 'remote-ai',
                            locale: currentLocale,
                        }
                    }).catch((error) => {
                        addUILog(currentLocale === 'en-US'
                            ? `❌ Remote AI follow-up failed: ${error.message || 'unknown error'}`
                            : `❌ 遠端 AI 補充失敗：${error.message || '未知錯誤'}`, 'error');
                        appendChatBubble('system', `Remote AI follow-up failed: ${error.message}`, [], {
                            container: remoteChatMessages,
                            forceSystem: true,
                        });
                    });
                    appendChatBubble('system', currentLocale === 'en-US' ? 'Local AI is replying first. Remote AI will follow up when ready.' : '先由本地 AI 回覆，遠端 AI 準備好後再補充。', [], {
                        container: remoteChatMessages,
                        forceSystem: true,
                    });
                    return api(`/api/remote/session/${selectedRemoteSessionId}/message`, {
                        method: 'POST',
                        body: {
                            text: msg,
                            mode: 'local-ai',
                            target: 'remote-user',
                            locale: currentLocale,
                            skipUserEcho: true,
                        },
                        signal: requestAbortController.signal
                    });
                }
                if (targets.includes('local-ai')) {
                    setRemotePendingRoles({ local: true, remote: false });
                    updatePendingStatusRow();
                    addUILog(currentLocale === 'en-US'
                        ? '🤖 Routing message to Local AI'
                        : '🤖 訊息交由本地 AI 處理', 'info');
                    const localAiTarget = 'remote-user';
                    return api(`/api/remote/session/${selectedRemoteSessionId}/message`, {
                        method: 'POST',
                        body: {
                            text: msg,
                            mode: 'local-ai',
                            target: localAiTarget,
                            locale: currentLocale,
                        },
                        signal: requestAbortController.signal
                    });
                }
                if (targets.includes('remote-ai') || targets.includes('remote-user')) {
                    setRemotePendingRoles({ local: false, remote: targets.includes('remote-ai') });
                    updatePendingStatusRow();
                    addUILog(currentLocale === 'en-US'
                        ? `🌐 Routing message to ${targets.includes('remote-ai') ? 'Remote AI' : 'Remote User'}`
                        : `🌐 訊息轉送至${targets.includes('remote-ai') ? '遠端 AI' : '遠端使用者'}`, 'info');
                    return api(`/api/remote/session/${selectedRemoteSessionId}/message`, {
                        method: 'POST',
                        body: {
                            text: msg,
                            mode: remoteSendMode?.value || 'user',
                            target: targets.includes('remote-ai') ? 'remote-ai' : 'remote-user',
                            locale: currentLocale,
                        },
                        signal: requestAbortController.signal
                    });
                }
                return { success: true };
            })()
            : await api('/api/chat', {
                method: 'POST',
                body: {
                    message: msg,
                    chalkboard: chalkboardAttachment,
                    locale: currentLocale,
                    remoteSessionId: '',
                    localChatSessionId: currentLocalSession?.id || '',
                    history: currentLocalSession?.history || [],
                },
                signal: requestAbortController.signal
            });

        removeThinking(thinkId);

        if (data.success) {
            setThinkingIdForMode(currentMode, '');
            if (currentMode === 'remote') {

                await loadRemoteProfileAndState();
            } else {
                $$('.suggestions-container').forEach(el => el.remove());
                if (currentLocalSession && Array.isArray(data.history)) {
                    currentLocalSession.history = data.history;
                    touchLocalChatSession(currentLocalSession.id);
                }
                const chalkControl = extractChalkboardControlFromReply(data.reply || '');
                appendChatBubble('ai', chalkControl.displayText || data.reply, data.suggestions);
                const autoDraft = chalkControl.draft;
                if (autoDraft) {
                    applyAgentChalkboardDraft(autoDraft, { actorScope: 'local' });
                }
                if (data.sopChanged) {
                    refreshSidebarDataSoon();
                }
                if (data.task) {
                    await loadTodo();
                    openTab('todolist');
                    if (todoList.length > 0) expandLog();
                }
                if (data.executeTaskId && !data.executeTaskId.includes('CLEAR') && !data.executeTaskId.includes('DELETE')) {
                    executeTask(data.executeTaskId);
                }
            }
        } else {
            setThinkingIdForMode(currentMode, '');
            appendChatBubble(currentMode === 'remote' ? 'system' : 'ai', currentLocale === 'en-US' ? 'Sorry, something went wrong. Please try again.' : '抱歉，出現了一點問題，請再試一次。', [], {
                container: currentMode === 'remote' ? remoteChatMessages : chatMessages,
                forceSystem: currentMode === 'remote',
            });
        }
    } catch (err) {

        removeThinking(thinkId);
        setThinkingIdForMode(currentMode, '');
        if (err.name === 'AbortError') {
            appendChatBubble(currentMode === 'remote' ? 'system' : 'ai', currentLocale === 'en-US' ? 'Cancelled by user' : '使用者中斷', [], {
                container: currentMode === 'remote' ? remoteChatMessages : chatMessages,
                forceSystem: currentMode === 'remote',
            });
        } else {
            console.error('[Chat] Error:', err);
            appendChatBubble(currentMode === 'remote' ? 'system' : 'ai', currentMode === 'remote' ? t('remote.connectFailed', { error: err.message }) : t('chat.connectionError'), [], {
                container: currentMode === 'remote' ? remoteChatMessages : chatMessages,
                forceSystem: currentMode === 'remote',
            });
        }
    } finally {
        // 恢復按鈕狀態
        btnSend.classList.remove('stop');
        if (currentMode === 'remote') {
            setRemotePendingRoles({ local: false, remote: false });
        }
        setActiveAbortController(null, currentMode);
        updateSendButtonState();
    }
}

function appendChatBubble(role, text, suggestions = [], options = {}) {
    const isAI = role === 'ai';
    const isSystem = role === 'system' || options.forceSystem;
    const container = options.container || chatMessages;
    const shouldStick = isContainerPinnedToBottom(container);
    if (!options.fromRender && container === chatMessages) {
        addLocalSessionMessage(role, text, suggestions, options);
    }
    const div = document.createElement('div');
    const actorScope = options.actorScope || (container === remoteChatMessages || options.isRemote ? 'remote' : 'local');
    const chatScopeClass = actorScope === 'remote' ? 'remote-chat-bubble' : 'local-chat-bubble';
    div.className = `message ${chatScopeClass} ${isSystem ? 'system-message' : (isAI ? 'ai-message' : 'user-message')}`;
    
    if (isSystem) {
        div.innerHTML = `
            <div class="msg-bubble-wrapper">
                <div class="msg-bubble markdown-body">${renderMarkdown(linkifyPlainUrls(text))}</div>
            </div>
        `;
        bindExternalLinks(div);
    } else if (isAI) {
        // 設定 marked 選項 (若 library 已載入)
        const htmlContent = highlightMentionsInHtml(renderMarkdown(linkifyPlainUrls(text)), options.highlightNames || getMentionHighlightNames());
        
        let suggestionsHtml = '';
        if (suggestions && suggestions.length > 0) {
            suggestionsHtml = `
                <div class="suggestions-container">
                    ${suggestions.map((s) => {
                        const item = typeof s === 'string' ? { label: s, action: '', sopId: '', taskId: '', mode: '' } : s;
                        return `<button class="btn-suggest" data-action="${escapeHtml(item.action || '')}" data-sop-id="${escapeHtml(item.sopId || '')}" data-task-id="${escapeHtml(item.taskId || '')}" data-mode="${escapeHtml(item.mode || '')}">${escapeHtml(item.label || '')}</button>`;
                    }).join('')}
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
                ${options.senderLabel ? `<div class="remote-chat-author">${escapeHtml(options.senderLabel)}</div>` : ''}
                <div class="msg-bubble markdown-body">${htmlContent}</div>
                ${options.imageDataUrl ? `<img class="remote-image" src="${options.imageDataUrl}" alt="shared screen">` : ''}
                ${options.imageDataUrl ? `<div class="image-action-row"><button class="btn-inline-save" type="button">${t('remote.saveImage')}</button></div>` : ''}
                ${suggestionsHtml}
            </div>
        `;
        bindExternalLinks(div);
        div.querySelector('.btn-speak').addEventListener('click', () => speakText(text, div.querySelector('.btn-speak')));
        
        // 建議按鈕點擊事件
        div.querySelectorAll('.btn-suggest').forEach(btn => {
            btn.addEventListener('click', async () => {
                const action = btn.dataset.action || '';
                if (action) {
                    btn.disabled = true;
                    try {
                        addUILog(currentLocale === 'en-US'
                            ? `🖱 Suggestion clicked: ${action}${btn.dataset.sopId ? ` (${btn.dataset.sopId})` : ''}`
                            : `🖱 已點擊建議按鈕：${action}${btn.dataset.sopId ? `（${btn.dataset.sopId}）` : ''}`, 'info');
                        const result = await handleDirectiveAction({
                            action,
                            sopId: btn.dataset.sopId || '',
                            taskId: btn.dataset.taskId || '',
                            mode: btn.dataset.mode || '',
                            label: btn.textContent || '',
                            contextText: text || '',
                        });
                        if (result?.summary) {
                            appendChatBubble('system', result.summary, [], {
                                container,
                                forceSystem: true,
                            });
                        }
                    } finally {
                        btn.disabled = false;
                    }
                    return;
                }
                chatInput.value = btn.textContent;
                sendChat();
            });
        });
    } else {
        div.innerHTML = `
            <div class="msg-avatar">👤</div>
            <div class="msg-bubble-wrapper">
                ${options.senderLabel ? `<div class="remote-chat-author">${escapeHtml(options.senderLabel)}</div>` : ''}
                <div class="msg-bubble markdown-body">${highlightMentionsInHtml(renderMarkdown(linkifyPlainUrls(text)), options.highlightNames || getMentionHighlightNames())}</div>
                ${options.imageDataUrl ? `<img class="remote-image" src="${options.imageDataUrl}" alt="shared screen">` : ''}
                ${options.imageDataUrl ? `<div class="image-action-row"><button class="btn-inline-save" type="button">${t('remote.saveImage')}</button></div>` : ''}
            </div>
        `;
        bindExternalLinks(div);
    }
    const avatarEl = div.querySelector('.msg-avatar');
    if (avatarEl && !isSystem) {
        avatarEl.innerHTML = isAI ? '&#129302;' : '&#128100;';
    }
    div.querySelector('.btn-inline-save')?.addEventListener('click', () => saveSharedImage(options.imageDataUrl));
    
    container.appendChild(div);
    if (shouldStick) {
        container.scrollTop = container.scrollHeight;
    }
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

function appendThinking(container = chatMessages, forcedId = '') {
    const id = forcedId || ('thinking-' + Date.now());
    const shouldStick = isContainerPinnedToBottom(container);
    const div = document.createElement('div');
    div.className = 'message ai-message';
    div.id = id;
    div.innerHTML = `<div class="msg-avatar">🤖</div><div class="msg-bubble thinking-dots">${currentLocale === "en-US" ? "Thinking..." : "思考中"}</div>`;
    const avatarEl = div.querySelector('.msg-avatar');
    if (avatarEl) avatarEl.innerHTML = '&#129302;';
    container.appendChild(div);
    if (shouldStick) {
        container.scrollTop = container.scrollHeight;
    }
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
    if (activeChatMode === 'remote') {
        disconnectRemoteSession();
        return;
    }
    const confirmMsg = currentLocale === 'en-US' 
        ? 'Clear all chat history?' 
        : '確定要清除所有對話紀錄嗎？';
    if (confirm(confirmMsg)) {
        const session = getActiveLocalChatSession();
        if (session) {
            session.messages = [];
            session.history = [];
            touchLocalChatSession(session.id);
        }
        renderLocalSessionControls();
        renderLocalChatMessages();
        const logMsg = currentLocale === 'en-US'
            ? '💬 Chat history cleared'
            : '💬 對話紀錄已清除';
        addUILog(logMsg, 'info');
    }
}

async function saveRemoteProfile() {
    const data = await api('/api/remote/profile', {
        method: 'POST',
        body: {
            agentName: remoteAgentNameInput?.value.trim(),
            userName: remoteUserNameInput?.value.trim(),
            locale: currentLocale,
        }
    });
    if (data.success) {
        remoteProfile = data.profile;
        syncRemoteProfileDirty(false);
        addUILog(t('remote.profileSaved'), 'success');
        await loadRemoteProfileAndState();
    }
}

async function connectRemotePeer() {
    const currentSession = getActiveRemoteSession();
    if (currentSession && (currentSession.status === 'active' || currentSession.status === 'pending_approval')) {
        await disconnectRemoteSession();
        return;
    }
    const host = remoteHostInput?.value.trim();
    if (!host) return;
    const data = await api('/api/remote/connect', {
        method: 'POST',
        body: { host }
    });
    if (data.success) {
        selectedRemoteSessionId = data.session?.id || selectedRemoteSessionId;
        addUILog(t('remote.connectSuccess'), 'info');
        switchChatMode('remote');
        appendChatBubble('system', `${t('remote.connectingTo', { host })} ${t('remote.waitingResponse')}`, [], { container: remoteChatMessages, forceSystem: true });
        await loadRemoteProfileAndState();
    } else {
        appendChatBubble('system', t('remote.connectFailed', { error: data.error || 'unknown' }), [], { container: remoteChatMessages, forceSystem: true });
    }
}

async function respondRemoteRequest(accept) {
    if (!pendingRemoteRequestId) return;
    const data = await api(`/api/remote/session/${pendingRemoteRequestId}/respond`, {
        method: 'POST',
        body: { accept }
    });
    remoteRequestOverlay?.classList.remove('visible');
    pendingRemoteRequestId = '';
    if (data.success && accept) {
        selectedRemoteSessionId = data.session?.id || selectedRemoteSessionId;
        switchChatMode('remote');
        appendChatBubble('system', t('remote.requestAccepted'), [], { container: remoteChatMessages, forceSystem: true });
    }
    await loadRemoteProfileAndState();
}

async function disconnectRemoteSession() {
    const session = getActiveRemoteSession();
    if (!session) return;
    if (!confirm(t('remote.disconnectConfirm'))) return;
    const reason = session.status === 'pending_approval'
        ? 'Connection cancelled by local user.'
        : 'Disconnected by local user.';
    await api(`/api/remote/session/${session.id}/disconnect`, {
        method: 'POST',
        body: { reason }
    });
    if (session.status === 'pending_approval') {
        appendChatBubble('system', currentLocale === 'en-US' ? 'Connection invitation cancelled.' : '連線邀請已取消。', [], {
            container: remoteChatMessages,
            forceSystem: true,
        });
    }
    await loadRemoteProfileAndState();
}

async function deleteRemoteSessionTab(sessionId = '') {
    const session = (remoteState.sessions || []).find((item) => item.id === sessionId);
    if (!session) return;
    if (session.status === 'active') {
        appendChatBubble('system', t('remote.keepActiveRemoteSession'), [], {
            container: remoteChatMessages,
            forceSystem: true,
        });
        return;
    }
    if (!confirm(t('remote.deleteRemoteSessionConfirm'))) return;
    const data = await api(`/api/remote/session/${sessionId}`, { method: 'DELETE' });
    if (!data.success) {
        appendChatBubble('system', data.error || 'Delete failed', [], {
            container: remoteChatMessages,
            forceSystem: true,
        });
        return;
    }
    if (selectedRemoteSessionId === sessionId) {
        const next = (data.sessions || []).find((item) => item.status === 'active') || (data.sessions || [])[0] || null;
        selectedRemoteSessionId = next?.id || '';
        localStorage.setItem('selected_remote_session_id', selectedRemoteSessionId || '');
    }
    await loadRemoteProfileAndState();
}

async function shareRemoteScreen() {
    const session = getActiveRemoteSession();
    if (!session) {
        appendChatBubble('system', t('remote.noSession'), [], { container: remoteChatMessages, forceSystem: true });
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const video = document.createElement('video');
        video.srcObject = stream;
        await video.play();
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        stream.getTracks().forEach((track) => track.stop());
        const imageDataUrl = canvas.toDataURL('image/png', 0.92);
        const data = await api(`/api/remote/session/${session.id}/share-screen`, {
            method: 'POST',
            body: {
                imageDataUrl,
                caption: currentLocale === 'en-US' ? 'Sent current screen image' : '傳送目前畫面',
            }
        });
        if (data.success) {
            addUILog(t('remote.screenShared'), 'success');
            await loadRemoteProfileAndState();
        } else {
            appendChatBubble('system', t('remote.screenFailed', { error: data.error || 'unknown' }), [], { container: remoteChatMessages, forceSystem: true });
        }
    } catch (error) {
        appendChatBubble('system', t('remote.screenFailed', { error: error.message }), [], { container: remoteChatMessages, forceSystem: true });
    }
}

async function attachRemoteFile(file) {
    const session = getActiveRemoteSession();
    if (!session) {
        appendChatBubble('system', t('remote.noSession'), [], { container: remoteChatMessages, forceSystem: true });
        return;
    }
    if (!file) return;
    if (file.size > 256 * 1024) {
        appendChatBubble('system', t('remote.fileTooLarge'), [], { container: remoteChatMessages, forceSystem: true });
        return;
    }
    const text = await file.text();
    const preview = text.slice(0, 12000);
    const payload = [
        t('remote.fileAttached', { fileName: file.name }),
        '',
        '```text',
        preview,
        '```',
    ].join('\n');
    chatInput.value = payload;
    switchChatMode('remote');
    await sendChat();
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
    const localized = getLocalizedItem(sop);
    const action = localized.recommendedAction || 'install';
    const data = await api('/api/todo', {
        method: 'POST',
        body: {
            title: localized.name || localized.id,
            description: localized.id || '',
            category: localized.category || 'SOP',
            skillId: localized.id,
            action
        },
    });
    if (data.success) {
        todoList = data.todoList;
        renderTodoList();
        addUILog(`＋ ${t('task.addedSOPToList', { action: getActionLabel(action), name: localized.name || localized.id })}`, 'info');
        openTab('todolist');
    }
}

async function addAndExecuteSop(sop) {
    const localized = getLocalizedItem(sop);
    const action = localized.recommendedAction || 'install';
    const data = await api('/api/todo', {
        method: 'POST',
        body: {
            title: localized.name || localized.id,
            description: localized.id || '',
            category: localized.category || 'SOP',
            skillId: localized.id,
            action
        },
    });
    if (data.success) {
        todoList = data.todoList;
        renderTodoList();
        openTab('todolist');
        const newTask = data.task || data.todoList[data.todoList.length - 1];
        if (newTask?.id) {
            addUILog(`▶ ${t('task.startingSOPAction', { action: getActionLabel(action), name: localized.name || localized.id })}`, 'info');
            appendChatBubble('ai', `🚀 ${t('task.startingSOPProcess', { name: localized.name || localized.id, action: getActionLabel(action) })}`);
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
        allOption.textContent = t('exps.filter_all_sops', { default: 'All SOPs' });
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
        const emptyText = expsEntries.length 
            ? t('exps.no_match', { default: 'No matching experiences found.' })
            : t('exps.no_data', { default: 'No installation experiences yet...' });
        empty.textContent = emptyText;
        expEntries.appendChild(empty);
        return;
    }

    // Sort by updatedAt descending (newest first)
    const sorted = [...filtered].sort((a, b) => {
        const timeA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const timeB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return timeB - timeA;
    });

    sorted.forEach((entry) => {
        const card = document.createElement('article');
        card.className = 'exp-card';
        const htmlContent = typeof marked !== 'undefined'
            ? marked.parse(entry.content || '')
            : escapeHtml(entry.content || '').replace(/\n/g, '<br>');
        const updatedAt = entry.updatedAt
            ? new Date(entry.updatedAt).toLocaleString(currentLocale === 'en' ? 'en-US' : 'zh-TW', { hour12: false })
            : '';

        card.innerHTML = `
            <div class="exp-card-header">
              <div class="exp-card-title">${escapeHtml(entry.title || entry.fileName || t('exps.unnamed', { default: 'Unnamed Experience' }))}</div>
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
        addUILog(`ℹ️ ${t('exps.noExpsToExport')}`, 'info');
        return;
    }
    const md = expsEntries.map(e => {
        const ts = e.updatedAt ? new Date(e.updatedAt).toLocaleString('zh-TW', { hour12: false }) : '';
        return `# ${e.title || e.fileName || '未命名'}\n> SOP: ${e.sopId || 'dynamic'} | ${ts}\n\n${e.content || ''}\n\n---`;
    }).join('\n\n');
    api('/api/exps/export-file', {
        method: 'POST',
        body: { markdown: md }
    }).then((data) => {
        if (data.success) {
            addUILog(`✅ ${t('exps.exportSuccess', { fileName: data.fileName || data.filePath })}`, 'success');
            return;
        }

        if (data.cancelled) {
            addUILog(`ℹ️ ${t('exps.exportCancelled')}`, 'info');
            return;
        }

        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aipc-exps-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
        addUILog(`⚠️ ${t('exps.exportFallback', { error: data.error || 'Unknown error' })}`, 'warn');
    });
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
        <div style="margin-top:12px" class="exp-detail-content">${htmlContent}</div>
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
          <span class="task-detail-value task-status" data-status="${task.status}">${localizeStatus(task.status)}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">分類</span>
          <span class="task-detail-value">${task.category || '�'}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">動作</span>
          <span class="task-detail-value">${getActionLabel(task.action || 'install')}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">SOP ID</span>
          <span class="task-detail-value" style="font-family:var(--font-mono);font-size:11px">${task.skillId || '（無）'}</span>
        </div>
        <div class="task-detail-row">
          <span class="task-detail-label">建立時間</span>
          <span class="task-detail-value">${task.createdAt ? new Date(task.createdAt).toLocaleString('zh-TW') : '�'}</span>
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
            btnTheme.title = currentLocale === 'en-US' ? 'Switch to Dark Mode' : '切換至深色模式';
        } else {
            btnTheme.innerHTML = `
                <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
                    <path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4.243 3.05a1 1 0 010 1.414l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM14.243 14.95a1 1 0 01-1.414 0l-.707-.707a1 1 0 111.414-1.414l.707.707a1 1 0 010 1.414zM10 18a1 1 0 01-1-1v-1a1 1 0 112 0v1a1 1 0 01-1 1zm-4.243-3.05a1 1 0 010-1.414l.707-.707a1 1 0 111.414 1.414l-.707.707a1 1 0 01-1.414 0zM3 10a1 1 0 011-1h1a1 1 0 110 2H4a1 1 0 01-1-1zm3.05-4.243a1 1 0 011.414 0l.707.707a1 1 0 01-1.414 1.414l-.707-.707a1 1 0 010-1.414zM10 6a4 4 0 100 8 4 4 0 000-8z" clip-rule="evenodd" />
                </svg>`;
            btnTheme.title = currentLocale === 'en-US' ? 'Switch to Light Mode' : '切換至淺色模式';
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
            addUILog('✅ ' + t('tasks.exportSuccess', { fileName: data.fileName || data.filePath }), 'success');
            appendChatBubble('ai', '✅ ' + t('tasks.exportSuccessChat'));
            return;
        }

        if (data.cancelled) {
            addUILog(`ℹ️ ${t('task.exportCancelled')}`, 'info');
            return;
        }

        // fallback: 若原生另存失敗，仍嘗試瀏覽器下載
        const json = JSON.stringify(todoList, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        a.download = `aipc-tasks-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
            addUILog(`⚠️ ${t('tasks.exportFallback', { error: data.error || 'Unknown error' })}`, 'warn');
    });
}

function importTasks(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const tasks = JSON.parse(e.target.result);
            const data = await api('/api/import', { method: 'POST', body: { tasks } });
            if (data.success) { todoList = data.todoList; renderTodoList(); addUILog('✅ ' + t('tasks.importSuccess'), 'success'); }
        } catch { addUILog('❌ ' + t('tasks.importFailed'), 'error'); }
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
        (w) => { sidebar.style.width = w + 'px'; saveLayout(); if (activeTab === 'chalkboard') resizeChalkboardCanvas(); },
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
        (w) => { chatCol.style.width = w + 'px'; saveLayout(); if (activeTab === 'chalkboard') resizeChalkboardCanvas(); },
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
        (h) => { logPanel.style.minHeight = h + 'px'; logPanel.style.maxHeight = h + 'px'; saveLayout(); if (activeTab === 'chalkboard') resizeChalkboardCanvas(); },
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
    chatModeTabs?.addEventListener('click', (e) => {
        const closeBtn = e.target.closest('[data-local-close-id]');
        if (closeBtn) {
            removeLocalChatSession(closeBtn.dataset.localCloseId || '');
            return;
        }
        const btn = e.target.closest('.chat-mode-tab');
        if (!btn) return;
        if (btn.dataset.chatMode === 'local') {
            const nextSessionId = String(btn.dataset.localSessionId || '').trim();
            if (nextSessionId && selectedLocalChatSessionId !== nextSessionId) {
                selectedLocalChatSessionId = nextSessionId;
                saveLocalChatSessions();
                renderLocalSessionControls();
                renderLocalChatMessages();
            }
            switchChatMode('local');
            return;
        }
        switchChatMode(btn.dataset.chatMode);
    });
    // Send chat
    btnSend?.addEventListener('click', sendChat);
    chatInput?.addEventListener('keydown', (e) => {
        if (mentionMenu?.classList.contains('visible')) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeMentionIndex = Math.min(activeMentionIndex + 1, mentionCandidates.length - 1);
                updateMentionMenu();
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeMentionIndex = Math.max(activeMentionIndex - 1, 0);
                updateMentionMenu();
                return;
            }
            if (e.key === 'Enter' && mentionCandidates[activeMentionIndex]) {
                e.preventDefault();
                insertMention(mentionCandidates[activeMentionIndex].name);
                return;
            }
            if (e.key === 'Escape') {
                hideMentionMenu();
                return;
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    // Auto-resize textarea
    chatInput?.addEventListener('input', () => {
        chatInput.style.height = '';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        activeMentionIndex = 0;
        updateMentionMenu();
    });
    chatInput?.addEventListener('click', updateMentionMenu);
    chatInput?.addEventListener('blur', () => setTimeout(hideMentionMenu, 120));

    // Mic
    btnMic?.addEventListener('click', () => isRecording ? stopRecording() : startRecording());
    btnNewLocalSession?.addEventListener('click', () => {
        if (activeChatMode === 'remote') {
            remoteToolbarCollapsed = false;
            updateRemoteToolbarToggle();
            remoteHostInput?.focus();
            return;
        }
        const next = createLocalChatSession(`${t('chat.localSessionDefault')} ${localChatSessions.length + 1}`);
        localChatSessions.unshift(next);
        selectedLocalChatSessionId = next.id;
        saveLocalChatSessions();
        renderLocalSessionControls();
        renderLocalChatMessages();
        switchChatMode('local');
    });

    // Clear Chat
    btnClearChat?.addEventListener('click', clearChatMessages);
    btnRemoteConnect?.addEventListener('click', connectRemotePeer);
    btnSaveRemoteProfile?.addEventListener('click', saveRemoteProfile);
    btnShareScreen?.addEventListener('click', shareRemoteScreen);
    btnRemoteAttachFile?.addEventListener('click', () => remoteFileInput?.click());
    remoteFileInput?.addEventListener('change', async () => {
        const file = remoteFileInput.files?.[0] || null;
        remoteFileInput.value = '';
        await attachRemoteFile(file);
    });
    btnDisconnectRemote?.addEventListener('click', disconnectRemoteSession);
    btnRemoteToolbarToggle?.addEventListener('click', toggleRemoteToolbar);
    [remoteAgentNameInput, remoteUserNameInput].forEach((input) => {
        input?.addEventListener('input', () => syncRemoteProfileDirty(true));
    });
    remoteSessionSelect?.addEventListener('change', () => {
        selectedRemoteSessionId = remoteSessionSelect.value;
        localStorage.setItem('selected_remote_session_id', selectedRemoteSessionId || '');
        renderRemoteSessionControls();
        switchChatMode('remote');
    });
    remoteSendMode?.addEventListener('change', updateMentionMenu);
    btnAcceptRemoteRequest?.addEventListener('click', () => respondRemoteRequest(true));
    btnRejectRemoteRequest?.addEventListener('click', () => respondRemoteRequest(false));
    btnLang?.addEventListener('click', toggleLocale);

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
    updateRemoteToolbarToggle();
    syncRemoteProfileDirty(false);

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

    browserGoBtn?.addEventListener('click', () => browserNavigate(browserUrlInput?.value || ''));
    browserUrlInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            browserNavigate(browserUrlInput.value || '');
        }
    });
    browserBackBtn?.addEventListener('click', () => browserAction('back'));
    browserForwardBtn?.addEventListener('click', () => browserAction('forward'));
    browserReloadBtn?.addEventListener('click', () => browserAction('reload'));
    browserOpenExternalBtn?.addEventListener('click', () => {
        if (browserTabState.currentUrl) openExternalUrl(browserTabState.currentUrl);
    });

    // Menu Bar
    $('#menuView')?.addEventListener('click', toggleViewMenu);
    switchBottomTab(activeBottomTab);
}

// ── Tab Management ─────────────────────────────────────
function switchTab(tabId) {
    if (tabId === 'browser' && !browserRuntimeReady) return;
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
    if (tabId === 'browser') {
        ensureBrowserSessionStarted().then((ok) => {
            if (!ok) return;
            refreshBrowserSnapshot();
            startBrowserSnapshotPolling();
        });
    } else {
        stopBrowserSnapshotPolling();
    }
}

function openTab(tabId) {
    if (tabId === 'browser' && !browserRuntimeReady) return;
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
    if (tabId === 'browser') {
        stopBrowserSnapshotPolling();
    }
}

// ── View Menu Logic ─────────────────────────────────────
function toggleViewMenu(e) {
    let menu = document.querySelector('.view-dropdown');
    if (menu) { menu.remove(); return; }

    menu = document.createElement('div');
    menu.className = 'view-dropdown menu-dropdown';
    
    const items = [
        { id: 'chalkboard', label: t('tabs.chalkboard'), icon: '🎨' },
        { id: 'hardware', label: t('tabs.hardware'), icon: '🌡️' },
        { id: 'browser', label: browserRuntimeReady ? 'Browser' : (browserInstallQueued ? 'Browser (Added to task)' : 'Browser (install required)'), icon: '🌐' },
        { id: 'todolist', label: t('tabs.todolist'), icon: '📋' }
    ];

    items.forEach(item => {
        const div = document.createElement('div');
        div.className = 'menu-dropdown-item';
        const isOpen = openTabs.includes(item.id);
        div.innerHTML = `
            <span>${item.icon} ${item.label}</span>
            <span style="font-size:10px; opacity:0.6">${isOpen ? t('ui.opened') : ''}</span>
        `;
        div.onclick = () => {
            if (item.id === 'browser' && !browserRuntimeReady) {
                runBrowserInstallWorkflow().finally(() => menu.remove());
                return;
            }
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
        settingModelSelect.innerHTML = `<option value="">${currentLocale === "en-US" ? "Loading models..." : "正在載入模型清單..."}</option>`;
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

    if (!baseUrl) return alert(currentLocale === 'en-US' ? 'Please enter API Base URL' : '請輸入 API Base URL');
    if (authConfig.type === 'oauth_client_credentials' && (!authConfig.tokenUrl || !authConfig.clientId || !authConfig.clientSecret)) {
        return alert(currentLocale === 'en-US' ? 'OAuth mode: Please complete Token URL, Client ID, Client Secret' : 'OAuth 模式請完整填入 Token URL、Client ID、Client Secret');
    }

    const data = await api('/api/llm/config', {
        method: 'POST',
        body: { provider, baseUrl, authConfig, model, visionModel }
    });

    if (data.success) {
        providerSettingsOverlay.classList.remove('visible');
        addUILog('🚀 ' + t('settings.updated', { restarting: true }), 'success');

        // 立即更新 UI 上的模型名稱
        if (chatModelBadge && model) {
            chatModelBadge.textContent = model;
            chatModelBadge.style.display = 'inline-block';
            chatModelBadge.title = currentLocale === 'en-US' ? `Current model: ${model} (Click to switch)` : `當前模型: ${model} (點擊切換)`;
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

    if (!baseUrl) return alert(currentLocale === 'en-US' ? 'Please enter API Base URL' : '請輸入 API Base URL');
    if (!model) return alert(currentLocale === 'en-US' ? 'Please enter or select model name' : '請先輸入或選擇模型名稱');
    if (authConfig.type === 'oauth_client_credentials' && (!authConfig.tokenUrl || !authConfig.clientId || !authConfig.clientSecret)) {
        return alert(currentLocale === 'en-US' ? 'OAuth mode: Please complete Token URL, Client ID, Client Secret' : 'OAuth 模式請完整填入 Token URL、Client ID、Client Secret');
    }

    btnTestProviderSettings.disabled = true;
    btnTestProviderSettings.textContent = currentLocale === 'en-US' ? 'Testing...' : '測試中...';

    const data = await api('/api/llm/test', {
        method: 'POST',
        body: { provider, baseUrl, authConfig, model }
    });

    btnTestProviderSettings.disabled = false;
    btnTestProviderSettings.textContent = currentLocale === 'en-US' ? 'Test Model' : '測試模型';

    if (data.success) {
        addUILog(currentLocale === 'en-US' ? `🧪 Model test successful: ${provider} / ${model}` : `🧪 模型測試成功：${provider} / ${model}`, 'success');
        alert(currentLocale === 'en-US' ? `Test successful\n\nProvider: ${provider}\nModel: ${model}\nReply: ${data.reply || 'OK'}` : `測試成功\n\nProvider: ${provider}\nModel: ${model}\nReply: ${data.reply || 'OK'}`);
    } else {
        addUILog(currentLocale === 'en-US' ? `🧪 Model test failed: ${provider} / ${model} - ${data.error || 'Unknown error'}` : `🧪 模型測試失敗：${provider} / ${model} - ${data.error || 'Unknown error'}`, 'error');
        alert(currentLocale === 'en-US' ? `Test failed\n\n${data.error || 'Unknown error'}` : `測試失敗\n\n${data.error || 'Unknown error'}`);
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


document.addEventListener('click', (e) => {
    const fileMenu = document.getElementById('menuFile');
    const fileDropdown = document.getElementById('fileDropdown');
    const importFileInput = document.getElementById('importFileInput');
    const btnExport = document.getElementById('btnExport');
    if (fileDropdown && fileMenu) {
        if (!fileMenu.contains(e.target) && !fileDropdown.contains(e.target)) {
            fileDropdown.style.display = 'none';
        }
    }
});
