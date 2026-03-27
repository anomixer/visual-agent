/**
 * AI PC Agent � Frontend Application (VS Code Layout)
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
let currentLocale = localStorage.getItem('ui_locale') || 'zh-TW';

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
const btnLang = $('#btnLang');
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
            toggleLog: '切換工作日誌 (Ctrl+J)',
            toggleChat: '切換 AI 對話 (Ctrl+Alt+B)',
        },
        footer: {
            tasks: '{count} 個任務',
            switchTo: '切換成 English',
        },
        tabs: {
            recommend: '💡 推薦清單',
            sops: '📚 SOP 清單',
            hardware: '硬體狀態',
            todolist: '工作清單',
            logs: '📝 工作日誌',
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
                undo: 'Undo',
                upload: '上傳圖片',
                save: '存成圖片',
            },
        },
        status: {
            llmReady: '🟢 AI 就緒',
            modelNotReady: '🟡 模型未就緒',
            engineNotReady: '🔴 AI 未就緒',
        },
        buttons: {
            collapse: '收起 ▼',
            execute: '執行',
            delete: '刪除',
        },
        task: {
            general: '一般',
            unnamedItem: '未命名項目',
            addActionTask: '加入{action}清單',
            runActionNow: '立即{action}',
        },
        sidebar: {
            recommendLoading: '推薦清單載入中...',
            recommendEmpty: '找不到相符的項目',
            sopLoading: 'SOP 清單載入中...',
            sopEmpty: '找不到相符的 SOP',
            installedHeader: '── 已就緒 / 已安裝 ──',
            recommendPlaceholder: '搜尋推薦項目...',
            sopPlaceholder: '搜尋 SOP 名稱、ID 或分類...',
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
            toggleLog: 'Toggle Work Log (Ctrl+J)',
            toggleChat: 'Toggle AI Chat (Ctrl+Alt+B)',
        },
        footer: {
            tasks: '{count} tasks',
            switchTo: 'Switch to 繁體中文',
        },
        tabs: {
            recommend: '💡 Recommended',
            sops: '📚 SOPs',
            hardware: 'Hardware',
            todolist: 'Tasks',
            logs: '📝 Work Log',
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
                undo: 'Undo',
                upload: 'Upload Image',
                save: 'Save Image',
            },
        },
        status: {
            llmReady: '🟢 AI Ready',
            modelNotReady: '🟡 Model Not Ready',
            engineNotReady: '🔴 AI Not Ready',
        },
        buttons: {
            collapse: 'Collapse ▼',
            execute: 'Run',
            delete: 'Delete',
        },
        task: {
            general: 'General',
            unnamedItem: 'Untitled Item',
            addActionTask: 'Add {action} task',
            runActionNow: '{action} now',
        },
        sidebar: {
            recommendLoading: 'Loading recommendations...',
            recommendEmpty: 'No matching items found',
            sopLoading: 'Loading SOP list...',
            sopEmpty: 'No matching SOP found',
            installedHeader: '-- Ready / Installed --',
            recommendPlaceholder: 'Search recommendations...',
            sopPlaceholder: 'Search SOP name, ID, or category...',
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
    // 直接使用 canvas 的 bounding rect，因為 canvas 已經是 inset: 0 填滿 surface 的內容區域
    return chalkboardCanvas.getBoundingClientRect();
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
    markChalkboardUserContent(false);
    drawChalkText(t('chalkboardWelcome.hintTitle'), 34, 62, {
        font: '700 30px "Comic Sans MS", "Bradley Hand", "Segoe Print", cursive',
        color: '#f4efe2',
        alpha: 0.94
    });
    drawWrappedChalkText(
        t('chalkboardWelcome.hintBody'),
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
    updateLocaleUI();
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

let sidebarRefreshTimer = null;
function refreshSidebarDataSoon() {
    if (sidebarRefreshTimer) clearTimeout(sidebarRefreshTimer);
    sidebarRefreshTimer = setTimeout(() => {
        sidebarRefreshTimer = null;
        loadRecommend();
        loadSops();
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
        return `✅「${task.title}」已${actionLabel === '解除安裝' ? '解除安裝' : '安裝 / 執行'}完成。`;
    }
    if (task.status === 'skipped') {
        return actionLabel === '解除安裝'
            ? `ℹ️「${task.title}」對應的項目目前已不在系統中，所以我幫你跳過了。`
            : `ℹ️「${task.title}」已經存在，所以我幫你跳過了。`;
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
            appendChatBubble('ai', '🟡 Ollama 已就緒，正在自動為您下載 qwen3.5 語言模型，請稍候...');
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
        .replace(/^(安裝|下載|建立|解除安裝|移除|清理|優化|檢測|設定|Install|Download|Create|Uninstall|Remove|Setup|Set up|Set|Get|Pull|Check|Add|Add-AppxPackage)\s*/iu, '')
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
        card.querySelector('.btn-add-todo')?.addEventListener('click', (e) => {
            e.stopPropagation();
            addRecommendToTodo({ ...localized, recommendedAction: action });
        });
        card.querySelector('.btn-run-now')?.addEventListener('click', (e) => {
            e.stopPropagation();
            addAndExecuteRecommend({ ...localized, recommendedAction: action });
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
            ? t('sidebar.recommendPlaceholder')
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
        card.querySelector('.btn-add-todo')?.addEventListener('click', (e) => {
            e.stopPropagation();
            addSopToTodo({ ...sop, recommendedAction: action });
        });
        card.querySelector('.btn-run-now')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await addAndExecuteSop({ ...sop, recommendedAction: action });
        });
    }
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
    if (sidebarTabRecommend) sidebarTabRecommend.textContent = t('tabs.recommend');
    if (sidebarTabSops) sidebarTabSops.textContent = t('tabs.sops');
    const tabHardware = document.querySelector('#tab-hardware .tab-title');
    const tabTodo = document.querySelector('#tab-todolist .tab-title');
    if (tabHardware) tabHardware.textContent = t('tabs.hardware');
    if (tabTodo) tabTodo.textContent = t('tabs.todolist');
    const logTab = document.querySelector('[data-bottom-tab="logs"]');
    const expsTab = document.querySelector('[data-bottom-tab="exps"]');
    if (logTab) logTab.textContent = t('tabs.logs');
    if (expsTab) expsTab.textContent = t('tabs.exps');
    const panelTitle = document.querySelector('.chat-history .panel-title');
    if (panelTitle) panelTitle.textContent = t('tabs.aiChat');
    if (chatModelBadge) {
        if (!chatModelBadge.textContent || chatModelBadge.textContent === 'AI 模型' || chatModelBadge.textContent === 'AI Model') {
            chatModelBadge.textContent = t('chat.modelBadge');
        }
        chatModelBadge.title = t('chat.switchModel');
    }
    if (btnMic) btnMic.title = t('chat.mic');
    if (btnChalkAttach) btnChalkAttach.title = t('chat.attachChalkboard');
    if (btnClearChat) btnClearChat.title = t('chat.clear');

    // Chat Input Area
    if (chatInput) chatInput.placeholder = t('chat.placeholder');
    if (btnSend) btnSend.title = t('chat.send');
    const inputHint = document.querySelector('.input-hint');
    if (inputHint) inputHint.textContent = t('chat.hint');

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
        addUILog(`＋ 已加入${getActionLabel(action)}：${getActionTitle(localized.title, action)}`, 'info'); 
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
            addUILog(`▶ 開始${getActionLabel(action)}：${getActionTitle(localized.title, action)}`, 'info');
            appendChatBubble('ai', `🚀 正在啟動「${getActionTitle(localized.title, action)}」流程...`);
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
            body: { message: msg, chalkboard: chalkboardAttachment, locale: currentLocale },
            signal: chatAbortController.signal
        });

        removeThinking(thinkId);

        if (data.success) {
            // 移除舊的建議按鈕
            $$('.suggestions-container').forEach(el => el.remove());
            
            appendChatBubble('ai', data.reply, data.suggestions);
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
        } else {
            appendChatBubble('ai', '抱歉，出現了一點問題，請再試一次。');
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
    div.innerHTML = `<div class="msg-avatar">🤖</div><div class="msg-bubble thinking-dots">${currentLocale === "en-US" ? "Thinking..." : "思考中"}</div>`;
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
    const confirmMsg = currentLocale === 'en-US' 
        ? 'Clear all chat history?' 
        : '確定要清除所有對話紀錄嗎？';
    if (confirm(confirmMsg)) {
        chatMessages.innerHTML = '';
        const logMsg = currentLocale === 'en-US'
            ? '💬 Chat history cleared'
            : '💬 對話紀錄已清除';
        addUILog(logMsg, 'info');
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
        addUILog(`＋ 已加入${getActionLabel(action)} SOP：${localized.name || localized.id}`, 'info');
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
            addUILog(`▶ 開始${getActionLabel(action)} SOP：${localized.name || localized.id}`, 'info');
            appendChatBubble('ai', `🚀 正在啟動「${localized.name || localized.id}」的${getActionLabel(action)}流程...`);
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
        addUILog('ℹ️ 目前沒有可匯出的 exps', 'info');
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
            addUILog(`✅ exps 已匯出：${data.fileName || data.filePath}`, 'success');
            return;
        }

        if (data.cancelled) {
            addUILog('ℹ️ 已取消匯出 exps', 'info');
            return;
        }

        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `aipc-exps-${new Date().toISOString().slice(0, 10)}.md`;
        a.click();
        URL.revokeObjectURL(url);
        addUILog(`⚠️ 原生匯出 exps 失敗，已改用瀏覽器下載：${data.error || 'Unknown error'}`, 'warn');
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
            addUILog(`✅ 任務清單已匯出：${data.fileName || data.filePath}`, 'success');
            appendChatBubble('ai', '✅ 任務清單已匯出成功。');
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
        { id: 'chalkboard', label: t('tabs.chalkboard'), icon: '🎨' },
        { id: 'hardware', label: t('tabs.hardware'), icon: '🌡️' },
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

    if (!baseUrl) return alert('請輸入 API Base URL');
    if (!model) return alert('請先輸入或選擇模型名稱');
    if (authConfig.type === 'oauth_client_credentials' && (!authConfig.tokenUrl || !authConfig.clientId || !authConfig.clientSecret)) {
        return alert('OAuth 模式請完整填入 Token URL、Client ID、Client Secret');
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
            if ($('#hw-cpu-temp')) $('#hw-cpu-temp').textContent = h.cpu.temp ? `${h.cpu.temp}�C` : '';

            // GPU
            setGauge('gpu', h.gpu.load);
            if ($('#hw-gpu-name')) $('#hw-gpu-name').textContent = h.gpu.name || 'N/A';
            if ($('#hw-gpu-temp')) $('#hw-gpu-temp').textContent = h.gpu.temp ? `${h.gpu.temp}�C` : '';

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
