const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const DEFAULT_MODEL = 'gemma4:e2b-it-qat';
let currentModel = DEFAULT_MODEL;

// 新增 Provider 設定
let currentProvider = 'Ollama';
let currentBaseUrl = 'http://127.0.0.1:11434/v1';
let currentApiKey = '';
let currentAuthType = 'none';
let currentAuthConfig = { type: 'none' };
let currentVisionModel = '';
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

const CHAT_TIMEOUT_MS = 180000;

/**
 * Provider 端點資料庫 (Database)
 * 依照 Provider 分類其特定的模型清單與 API 格式
 */
const PROVIDER_ENDPOINTS = {
    'Ollama': {
        type: 'ollama',
        list: '/api/tags'
    },
    'Ollama Cloud': {
        type: 'ollama',
        list: '/api/tags',
        check: '/api/tags'
    },
    'Anthropic Claude': {
        type: 'anthropic',
        list: '/models',
        chat: '/messages'
    },
    'OpenAI': {
        type: 'openai',
        list: '/models'
    },
    'Groq': {
        type: 'openai',
        list: '/models'
    },
    'DeepSeek': {
        type: 'openai',
        list: '/models'
    },
    'NVIDIA NIM': {
        type: 'openai',
        list: '/models'
    },
    'Mistral': {
        type: 'openai',
        list: '/models'
    },
    'Together AI': {
        type: 'openai',
        list: '/models'
    }
};

// 設定路徑：與任務清單共用目錄
const APP_DATA_ROOT = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Preferences') : path.join(os.homedir(), '.config'));
const APP_DATA_DIR = path.join(APP_DATA_ROOT, 'visual-agent');
if (!fs.existsSync(APP_DATA_DIR)) {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
}
const CONFIG_PATH = path.join(APP_DATA_DIR, 'config.json');

/**
 * 載入預存設定
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            if (data.currentModel) currentModel = data.currentModel;
            if (data.currentProvider) currentProvider = data.currentProvider;
            if (data.currentBaseUrl) currentBaseUrl = data.currentBaseUrl;
            if (data.currentApiKey) currentApiKey = data.currentApiKey;
            if (data.currentAuthType) currentAuthType = data.currentAuthType;
            if (data.currentAuthConfig) currentAuthConfig = data.currentAuthConfig;
            if (data.currentVisionModel !== undefined) currentVisionModel = data.currentVisionModel || '';
            if (!data.currentAuthType && data.currentApiKey) {
                currentAuthType = 'api_key';
                currentAuthConfig = { type: 'api_key', apiKey: data.currentApiKey };
            }

            console.log(`[LLM] Config loaded: ${currentProvider} @ ${currentBaseUrl}`);
        }
    } catch (e) {
        console.warn('[LLM] Failed to load config:', e.message);
    }
}

/**
 * 儲存設定
 */
function saveConfig() {
    try {
        if (!fs.existsSync(APP_DATA_DIR)) fs.mkdirSync(APP_DATA_DIR, { recursive: true });
        const config = {
            currentModel,
            currentProvider,
            currentBaseUrl,
            currentApiKey,
            currentAuthType,
            currentAuthConfig,
            currentVisionModel
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error('[LLM] Failed to save config:', e.message);
    }
}

/**
 * 更新 Provider 設定
 */
function normalizeAuthConfig(authConfig = {}, legacyApiKey = '') {
    const type = authConfig.type || (legacyApiKey ? 'api_key' : 'none');

    if (type === 'api_key') {
        return {
            type,
            apiKey: authConfig.apiKey !== undefined ? authConfig.apiKey : legacyApiKey
        };
    }

    if (type === 'oauth_client_credentials') {
        return {
            type,
            tokenUrl: authConfig.tokenUrl || '',
            clientId: authConfig.clientId || '',
            clientSecret: authConfig.clientSecret || '',
            scope: authConfig.scope || '',
            audience: authConfig.audience || ''
        };
    }

    return { type: 'none' };
}

function updateProviderSettings(provider, baseUrl, apiKey, model, authConfig = null, visionModel = '') {
    currentProvider = provider;
    currentBaseUrl = baseUrl;
    currentAuthConfig = normalizeAuthConfig(authConfig || {}, apiKey);
    currentAuthType = currentAuthConfig.type;
    currentApiKey = currentAuthType === 'api_key' ? (currentAuthConfig.apiKey || '') : '';
    if (model) currentModel = model;
    currentVisionModel = visionModel || '';
    saveConfig();
    invalidateCache();
}

// 初始化載入
loadConfig();

// 基礎系統 Prompt
const BASE_SYSTEM_PROMPT_ZH = `你是一名住在 Windows 電腦裡的「AI 智慧管家」與「資深軟體工程師」。
你的存在是為了精確、自動化地執行電腦維護與軟體建置任務，以及各種 AI Agent 任務。
你也可以像一般助理一樣陪使用者聊天、討論知識、創作、生活、學習、娛樂或任何非電腦維護話題；不要把所有話題都硬轉成安裝軟體、SOP 或 AI Agent 任務。

你的核心任務（優先權高至低）：
  0. **一般對話與知識協助**：當使用者只是聊天、問知識、討論想法、創作或詢問非系統操作話題時，直接自然回答，不要主動引導到 SOP、安裝或系統維護。使用者要求設計、撰寫或修改程式、網站或小遊戲時，這是創作/開發請求，不是安裝軟體請求；應直接協助設計或產生程式，絕不可因「遊戲」一詞推薦或新增 Steam 任務。
  - **追問必須承接上下文**：使用者以短句補充平台、時間、地區、類別或篩選條件時，必須把它視為上一個問題的限制。例如先問「最新遊戲新聞」再說「純 PC 平台」，意思是「最新 PC 遊戲新聞」，必須延續查詢，不可改為解釋 PC 遊戲平台。
1. **系統維護與優化**：如移除廣告、停用 Copilot、建立備份點、檢查更新。
2. **軟體安裝與佈署**：協助使用者安裝 Chrome、Steam、Office 等工具。
3. **故障診斷與排錯**：當使用者反應電腦問題，主動推薦相關 SOP 進行檢修。
4. **輔助工具操作**：如切換主題、查看日誌、管理工作清單。 **嚴禁主動建議使用者切換或下載其他 AI 模型，除非使用者明確詢問電腦或 AI 本身的技術細節。**

你的守則：
1. **簡潔精準**：說話直擊重點，避免囉嗦。先給結論，再簡要說明原因。
2. **專家直覺**：深度理解使用者意圖。只有當使用者明確在談電腦問題、軟體、安裝、維護、自動化或本 App 功能時，才根據「可用 SOP 列表」推薦解決方案。
3. **安全第一**：涉及任何系統變動、執行任務，必須先簡述風險並「徵得使用者同意」。
4. **語言一致**：預設一律使用「繁體中文（zh-TW）」回覆。即使使用者上傳圖片、草圖、截圖或混用英文關鍵字，只要使用者沒有明確要求其他語言，都要用繁體中文輸出。只有當使用者明確指定英文、日文或其他語言時，才切換回覆語言。

- 若需操作系統，請在回覆末端附加協議標籤 [ACTION:...]。
- 若問題包含計畫、比較、查資料摘要、硬體狀態、遠端協作或超過 3 個步驟，請主動寫黑板（Chalkboard），不要等使用者提醒。
- 若要把重點放到黑板，必須使用控制碼區塊，格式如下（僅該區塊會畫到黑板）：
  ##CHALKBOARD##
  position: <full | left | right> (選填，與遠端 AI 協作時請協調，例如本機寫 left 遠端寫 right)
  clear: <true | false> (選填，預設為 true。若要保留隊友內容請設為 false)
  Title: <一行標題，簡短>
  - <重點 1>
  - <重點 2>
  ##ENDCHALKBOARD##
- 黑板只放「新的可執行結論」，不可重述聊天內容：一般最多 4 行重點、每行盡量不超過 42 個中文字、不得使用 1./2. 等編號。若是新聞/即時資訊摘要，可寫最多 5 個短標題，再加 1 行「趨勢總結」；不可貼原文段落，也不得加入前言或重複資訊。遠端協作時，本機 AI 固定寫 left，遠端 AI 固定寫 right，且 clear:false，避免互相覆蓋。
- 代理分級：
  1. Browser Use（內宇宙）：在瀏覽器內執行搜尋、讀取、導覽與編輯，可輸出 \`[ACTION:BROWSER_USE mode="search|open|navigate|extract_text|snapshot|fetch_title" ...]\`。天氣、物價、新聞、股價、匯率、最新版本、店家/行程等即時資訊必須優先用 Browser Use，不要用 CLI 硬爬。
  2. Computer Use（外宇宙）：操控桌面與 App；預設先走 VM sandbox，必要時才觸及主機，可輸出 \`[ACTION:COMPUTER_USE mode="prepare_vm_sandbox|open_file|open_url|install_sop" ...]\`。
  3. Computer Use 不是網路搜尋工具；只用於桌面、App、檔案與 SOP 等本機操作。
- 搜尋強制守則：若本地知識不足，或使用者詢問即時/最新資訊，必須主動使用 Browser Use（可參考 browser-research-and-edit.md 的流程）整理可用答案與連結；不要只回「找不到」或只叫使用者手動搜尋。
- **即時資訊查詢強制規則**：當使用者詢問天氣、物價、新聞、股價、匯率、最新版本、**最新遊戲/新作推薦**等即時資訊時，**第一句話就必須輸出** [ACTION:BROWSER_USE mode="search" query="..."]，不要先說「好的我來查」然後停住，也**禁止**只回「已執行指定動作」。正確範例：使用者詢問「明天台北天氣」或「最新的新遊戲」時，你必須直接輸出 [ACTION:BROWSER_USE mode="search" query="..."]，系統會自動執行並回傳結果，你再整理成可讀答案。
- **混合模式守則**：
  1. **直接執行 (ACTION)**：當你決定立即動作（如：安裝、移除、執行）時，**必須**輸出對應的 \`[ACTION:...]\`。此時**禁發**建議按鈕。若任務已在清單中且為 pending，當使用者說「開始、執行、做吧、OK」時，你**必須**輸出 \`[ACTION:EXECUTE_TASK task_id="任務ID"]\`。
  2. **提供選項 (SUGGEST)**：當你決定「提供建議/詢問」時（例如：要我幫您安裝...嗎？），你**必須**提供結構化建議按鈕 \`[SUGGEST: button_text="顯示文字" action="add_task|execute_task|computer_use" sop_id="..." task_id="..." mode="..."]\`。安裝/語系/系統變更一律先用 \`action="add_task"\` 加入工作清單，不要用 \`computer_use\` 直接執行；使用者之後可在工作清單按執行，或再請 AI 代為執行。在此回覆中**絕對禁止**出現 \`[ACTION:...]\` 標籤。
  3. **遠端協作守則**：若同時需要本地 AI 與遠端 AI，請讓本地 AI 先給使用者可讀答案，再讓遠端 AI 補充；不要要求使用者等待雙方都完成才回覆。
  4. **動作名稱標準化**：優先使用 \`ADD_TASK\`、\`EXECUTE_TASK\`、\`INSTALL_SOP\`、\`COMPUTER_USE\`、\`BROWSER_USE\`。不要混用舊的括號格式與未定義欄位名稱。
  5. **避免重複指令**：不要在相鄰兩則回覆中重複輸出相同的 \`[ACTION:...]\` 或 \`[SUGGEST:...]\`。若同一動作已提出或正在進行，請改用自然語言回報進度或補充資訊。
- **對話歷史**：請結合背景任務狀態與對話歷史來精確判斷使用者的意圖。確保動作標籤確切對應到任務 ID。`;

const BASE_SYSTEM_PROMPT_EN = `You are "Visual Agent", a Senior Software Engineer residing in a Windows computer.
Your existence is dedicated to performing computer maintenance and software build tasks accurately and automatically, as well as various AI Agent tasks.
You can also behave like a general assistant: chat, explain knowledge, brainstorm, write, discuss life, learning, entertainment, or any non-PC-maintenance topic. Do not force every topic into software installation, SOPs, or AI Agent tasks.

Your core tasks (priority high to low):
  0. **General conversation and knowledge help**: When the user is chatting, asking general knowledge, brainstorming, writing, or discussing non-system-operation topics, answer naturally and do not steer into SOPs, installation, or system maintenance. Requests to design, write, or modify code, websites, or small games are creative/development requests, not software-installation requests: help build them directly and never recommend or queue Steam merely because the word "game" appears.
  - **Follow-ups must preserve context**: Treat short platform, time, region, category, or filter phrases as constraints on the previous request. For example, after "latest game news", "PC only" means "latest PC game news"; continue the research instead of explaining PC gaming platforms.
1. **System Maintenance and Optimization**: Such as removing ads, disabling Copilot, creating restore points, checking for updates.
2. **Software Installation and Deployment**: Assist users in installing Chrome, Steam, Office, and other tools.
3. **Troubleshooting and Diagnosis**: When a user reports a computer problem, proactively recommend relevant SOPs for inspection and repair.
4. **Auxiliary Tool Operations**: Such as switching themes, viewing logs, managing task lists. **Strictly forbid proactively suggesting users switch or download other AI models, unless the user explicitly asks for technical details about the computer or the AI itself.**

Your rules:
1. **Concise and precise**: Speak directly to the point and avoid being wordy. Give conclusions first, then explain the reasons briefly.
2. **Expert intuition**: Deeply understand the user's intent. Recommend solutions from the "Available SOP List" only when the user is clearly discussing PC issues, software, installation, maintenance, automation, or this app's features.
3. **Safety first**: Involve any system changes or task execution, you must first briefly describe the risks and "obtain the user's consent".
4. **Language consistency**: Default to reply in English (en-US). Even if the user uploads pictures, sketches, screenshots or mixes Chinese keywords, as long as the user does not explicitly request other languages, use English output. Switch the reply language only when the user clearly specifies Chinese, Japanese or other languages.

- If you need to operate the system, please attach the protocol tag [ACTION:...] at the end of the reply.
- For plans, comparisons, research summaries, hardware status, remote collaboration, or answers with more than 3 steps, proactively write to the Chalkboard instead of waiting for the user to ask.
- If content should be rendered to Chalkboard, you MUST wrap that part with control tags (only this block will be drawn):
  ##CHALKBOARD##
  position: <full | left | right> (optional, coordinate with peer AI: e.g., Local AI uses left, Remote uses right)
  clear: <true | false> (optional, default is true. Set to false to keep teammate's content)
  Title: <short single-line title>
  - <point 1>
  - <point 2>
  ##ENDCHALKBOARD##
- Put only new actionable conclusions on the Chalkboard: normally use at most 4 short bullets (about 42 CJK characters each), without 1./2. numbering. For news/current-information summaries, use up to 5 short headlines plus one trend-summary line. Never paste article paragraphs, introductions, or repeated chat content. In remote collaboration, Local AI uses left, Remote AI uses right, and clear:false to avoid overwriting teammate content.
- Agent levels:
  1. Browser Use (inner universe): web resource acquisition and browser-side editing via \`[ACTION:BROWSER_USE mode="search|open|navigate|snapshot|extract_text|fetch_title" ...]\`. Use \`navigate\` to drive the built-in Browser tab (Playwright Chromium session). Weather, prices, news, stocks, exchange rates, latest software versions, restaurants, and travel/current-info questions MUST prefer Browser Use; do not rely on CLI scraping.
  2. Computer Use (outer universe): desktop/app operations with VM sandbox first via \`[ACTION:COMPUTER_USE mode="prepare_vm_sandbox|open_file|open_url|install_sop" ...]\`.
  3. Computer Use is not the web-search tool; reserve it for desktop/app/file/SOP operations.
- Search rule: if local knowledge is insufficient, or if the user asks for current/latest information, proactively use Browser Use (follow browser-research-and-edit.md style) and return actionable answers with links; do not only say "not found" or ask user to search manually.
- **Realtime Info Query Mandatory Rule**: When user asks about weather, prices, news, stocks, exchange rates, latest versions, or **latest/new game releases**, **output the ACTION tag in your FIRST response**, do NOT say "OK let me check" and stop, and NEVER reply with only "Done / executed". Correct example:
  User: "tomorrow's Taipei weather" or "latest new games"
  AI: [ACTION:BROWSER_USE mode="search" query="..."]
  (System will execute and return results, then you synthesize a readable answer)
- Hybrid mode rules:
  1. **Direct execution (ACTION)**: When you decide to act immediately (e.g., install, remove, execute), you MUST output the corresponding \`[ACTION:...]\`. Suggestion buttons are FORBIDDEN at this time. If the task is already in the list and is pending, when the user says "start, execute, do it, OK", you MUST output \`[ACTION:EXECUTE_TASK task_id="TASK_ID"]\`.
  2. **Provide options (SUGGEST)**: When you decide to "provide suggestion/ask" (e.g., want me to help you install...?), you MUST provide a structured suggestion button in the form \`[SUGGEST: button_text="Label" action="add_task|execute_task|computer_use" sop_id="..." task_id="..." mode="..."]\`. Installs, language packs, and system changes must first use \`action="add_task"\` to add a task to the task list; do not use \`computer_use\` to execute them directly. The user can run the task later, or ask AI to execute it after it is queued. In that same reply \`[ACTION:...]\` tags are ABSOLUTELY FORBIDDEN.
  3. **Remote collaboration rule**: If both Local AI and Remote AI should help, Local AI should answer the user first and Remote AI may follow up later. Do not block the user waiting for both sides to finish.
  4. **Action naming rule**: Prefer \`ADD_TASK\`, \`EXECUTE_TASK\`, \`INSTALL_SOP\`, \`COMPUTER_USE\`, and \`BROWSER_USE\`. Do not mix older parenthesized styles or undefined field names.
  5. **No duplicate directives**: Do not emit the same \`[ACTION:...]\` or \`[SUGGEST:...]\` again in an adjacent reply. If the same work is already proposed or underway, provide a plain-language progress update instead.
- Conversation history: Please combine background task status and conversation history to accurately judge the user's intent. Ensure action tags correspond exactly to task IDs.`;

const AGENT_WORKFLOW_PROMPT_ZH = `- 只有複雜、會改動系統、需要工具或需要 SOP 的任務才走 Planner：整理使用者意圖、風險、下一步，不要直接執行。
- 一般聊天、知識問答、創作、非系統操作話題不需要 Planner，直接回答。
- 遵循 ReAct：先在內部判斷 Reason（意圖、風險、需要哪個工具），再用可見文字或結構化標籤 Act（SUGGEST / ACTION / Chalkboard），工具或任務結果回來後再 Observe 並回報。不要輸出完整隱藏推理鏈。
- 只有在使用者明確允許後，才進入 Builder。
- Builder 階段才可呼叫 Skills / SOPs / Browser Use / Computer Use。
- 任務完成後要寫入一筆短 Exp，記錄成功、失敗與可重用做法。
- Skills、SOPs、Exp 都要按需載入，不要一開始就全部塞進 system prompt。`;

const AGENT_WORKFLOW_PROMPT_EN = `- Use Planner only for complex tasks, system-changing tasks, tool-using tasks, or SOP tasks: summarize intent, risks, and next step; do not execute immediately.
- General chat, knowledge Q&A, writing, brainstorming, and non-system-operation topics do not need Planner; answer directly.
- Follow ReAct: internally Reason about intent, risk, and needed tools; visibly Act with plain text or structured tags (SUGGEST / ACTION / Chalkboard); after tool or task results, Observe and report the outcome. Do not reveal hidden chain-of-thought.
- Only enter Builder after the user explicitly approves.
- Builder may call Skills / SOPs / Browser Use / Computer Use.
- After completion, write a short Exp entry with what worked, what failed, and what can be reused.
- Load Skills, SOPs, and Exp on demand only; do not preload everything into the system prompt.`;

/**
 * 組合 System Prompt
 * 注意：Skills / SOPs 採「按需注入」，避免每輪都塞滿 context。
 */
function buildFullSystemPrompt(locale = 'zh-TW', extraContext = '') {
    const base = (locale === 'en-US') ? BASE_SYSTEM_PROMPT_EN : BASE_SYSTEM_PROMPT_ZH;
    const workflow = (locale === 'en-US') ? AGENT_WORKFLOW_PROMPT_EN : AGENT_WORKFLOW_PROMPT_ZH;
    let fullPrompt = base + '\n\n### Workflow\n' + workflow + '\n\n';

    if (extraContext) {
        fullPrompt += `${locale === 'en-US' ? '### Runtime Context' : '### 執行階段情境'}\n${String(extraContext).trim()}\n\n`;
    }

    return fullPrompt;
}

function stripDataUrlPrefix(dataUrl = '') {
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
        mimeType: match[1],
        base64: match[2]
    };
}

function buildOpenAIMessageContent(text, attachment) {
    if (!attachment?.dataUrl) {
        return text;
    }

    return [
        { type: 'text', text },
        {
            type: 'image_url',
            image_url: {
                url: attachment.dataUrl,
                detail: 'high'
            }
        }
    ];
}

function buildAnthropicMessageContent(text, attachment) {
    if (!attachment?.dataUrl) {
        return text;
    }

    const parsed = stripDataUrlPrefix(attachment.dataUrl);
    if (!parsed) {
        return text;
    }

    return [
        { type: 'text', text },
        {
            type: 'image',
            source: {
                type: 'base64',
                media_type: attachment.mimeType || parsed.mimeType || 'image/jpeg',
                data: parsed.base64
            }
        }
    ];
}

function buildOllamaMessage(role, text, attachment) {
    const message = { role, content: text };
    if (role === 'user' && attachment?.dataUrl) {
        const parsed = stripDataUrlPrefix(attachment.dataUrl);
        if (parsed?.base64) {
            message.images = [parsed.base64];
        }
    }
    return message;
}

function modelSupportsVision(modelName = '') {
    const normalized = String(modelName || '').toLowerCase();
    if (!normalized) return false;
    // Qwen uses names such as qwen2.5vl:7b (no separator before "vl").
    return /(vision|vlm|multimodal|nano-vl|paligemma|kosmos|fuyu|neva|vila|deplot|-vl\b|\bqwen[\w.-]*vl\b|gemma[-_ ]?3\b|gpt-4o|gpt-4\.1|gemini|claude[-_ ]?3|claude[-_ ]?4)/i.test(normalized);
}

/**
 * 判斷模型是否為可對話的 LLM/VLM
 * 排除 embedding, rerank, audio-only, speech, clip 等非對話模型
 */
function isLLMCapableModel(modelName = '') {
    const n = String(modelName || '').toLowerCase();
    if (!n) return false;
    // 明確排除清單
    const EXCLUDED = [
        /\bembed(ding)?s?\b/,      // nomic-embed-text, text-embedding-*, *-embed
        /\brerank(er)?\b/,          // bge-reranker, rerank-*
        /\bclip\b/,                 // openai/clip-*
        /\bwhisper\b/,              // whisper-*, openai/whisper
        /\btts\b/,                  // tts-1, kokoro-tts
        /\basr\b/,                  // asr-only models
        /\bspeech\b/,               // speech-to-text models
        /\bvoice\b/,                // voice-only models
        /\bstable[- ]?diffusion\b/, // sd, sdxl
        /\bsd[xl]?\b/,              // sdxl, sd3
        /\bdiffusion\b/,            // flux, *-diffusion
        /\bflux\b/,                 // FLUX image models
        /\bclassif(y|ier|ication)\b/, // classifier-only
        /\bcross[- ]?encoder\b/,   // cross-encoder rerankers
    ];
    return !EXCLUDED.some(re => re.test(n));
}

async function getVisionCapableModel(options = {}) {
    const models = await listModels({ ...options, forceRefresh: options.forceRefresh ?? false });
    const names = Array.isArray(models) ? models.map(model => model?.name).filter(Boolean) : [];
    if (!names.length) return null;

    const preferredModels = [
        'meta/llama-3.2-90b-vision-instruct',
        'meta/llama-3.2-11b-vision-instruct',
        'microsoft/phi-4-multimodal-instruct',
        'microsoft/phi-3.5-vision-instruct',
        'microsoft/phi-3-vision-128k-instruct',
        'google/paligemma',
        'adept/fuyu-8b',
        'nvidia/nemotron-nano-12b-v2-vl',
        'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
        'nvidia/neva-22b',
        'nvidia/vila',
        'microsoft/kosmos-2'
    ];

    const exactMatch = preferredModels.find(model => names.includes(model));
    if (exactMatch) return exactMatch;

    return names.find(modelSupportsVision) || null;
}

let _cachedStatus = null;
let _lastCheck = 0;
const CACHE_TTL_MS = 5000; // 5 秒 cache，避免頻繁 ping

/**
 * 檢查 Ollama 服務狀態與模型是否就緒
 * @param {boolean} [force=false] - 是否強制重新檢查（忽略快取）
 * @returns {Promise<{ available: boolean, modelReady: boolean, version: string|null }>}
 */
async function checkOllamaStatus(force = false) {
    const now = Date.now();
    if (!force && _cachedStatus && (now - _lastCheck) < CACHE_TTL_MS) {
        return _cachedStatus;
    }

    const status = { available: false, modelReady: false, version: null, modelName: null };
    const meta = PROVIDER_ENDPOINTS[currentProvider] || { type: 'openai', list: '/models' };
    const apiRoot = currentBaseUrl.replace(/\/v1\/?$/, ''); // 拿掉末尾的 /v1 得到根路徑

    // ==========================================
    // 1. 處理 OpenAI 類型 Provider
    // ==========================================
    if (meta.type === 'openai' || meta.type === 'anthropic') {
        const listPath = meta.list || '/models';
        const checkUrl = currentBaseUrl.endsWith('/') ? `${currentBaseUrl}${listPath.substring(1)}` : `${currentBaseUrl}${listPath}`;
        try {
            const authHeaders = await getRequestHeaders(currentProvider);
            const res = await fetch(checkUrl, {
                headers: authHeaders,
                signal: AbortSignal.timeout(5000)
            }).catch(() => null);

            if (res && res.ok) {
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    status.available = true;
                    status.modelReady = true; 
                    status.modelName = currentModel || 'Cloud Model';

                    // 額外嘗試獲取版本 (針對本地 Ollama)
                    if (currentProvider === 'Ollama') {
                        try {
                            const verRes = await fetch(`${apiRoot}/api/version`, { signal: AbortSignal.timeout(2000) });
                            if (verRes.ok) {
                                const verData = await verRes.json();
                                status.version = verData.version;
                            }
                        } catch { /* 忽略錯誤 */ }
                    }
                } else {
                    let hint = '';
                    if (currentBaseUrl.includes('ollama.com')) {
                        hint = ' (提示：https://ollama.com is the website; API path differs from local)';
                    }
                    console.warn(`[LLM] Check ${currentProvider} status failed. URL: ${checkUrl}, Expected JSON but got ${contentType}${hint}`);
                }
            } else if (res) {
                console.warn(`[LLM] Check ${currentProvider} status returned error ${res.status} for ${checkUrl}`);
            } else if (currentProvider === 'Ollama') {
                // Fetch failed and it's local Ollama
                console.warn('[LLM] Local Ollama not responding, trying to start...');
                await ensureOllamaRunning();
            }
        } catch (e) {
            console.warn(`[LLM] Check ${currentProvider} status failed for ${checkUrl}:`, e.message);
            if (currentProvider === 'Ollama') {
                await ensureOllamaRunning();
            }
        }
        _cachedStatus = status;
        _lastCheck = now;
        return status;
    }

    // ==========================================
    // 2. 處理 Ollama 類型 Provider
    // ==========================================
    try {
        const checkPath = meta.check || '/api/version';
        const checkUrl = `${apiRoot}${checkPath}`;
        
        const res = await fetch(checkUrl, {
            signal: AbortSignal.timeout(3000),
        }).catch(() => null);

        if (res && res.ok) {
            const contentType = res.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
                const data = await res.json();
                status.available = true;
                status.version = data.version ?? 'unknown';

                // 檢查模型清單
                const listPath = meta.list || '/api/tags';
                try {
                    const tagsRes = await fetch(`${apiRoot}${listPath}`, {
                        signal: AbortSignal.timeout(5000),
                    });
                    const tagsData = await tagsRes.json();

                    if (tagsData.models && Array.isArray(tagsData.models)) {
                        // 只考慮 chat-capable 的模型（排除 embed/rerank/audio/tts 等）
                        const chatModels = tagsData.models.filter(m => isLLMCapableModel(m.name));

                        let foundModel = chatModels.find(m => m.name === currentModel);
                        if (!foundModel && currentModel !== DEFAULT_MODEL) {
                            foundModel = chatModels.find(m => m.name === DEFAULT_MODEL);
                            if (foundModel) {
                                currentModel = DEFAULT_MODEL;
                                saveConfig();
                            }
                        }
                        if (!foundModel) {
                            const modelPrefix = DEFAULT_MODEL.split(':')[0];
                            foundModel = chatModels.find(m => m.name.startsWith(modelPrefix + ':') || m.name === modelPrefix);
                        }
                        if (!foundModel) {
                            foundModel = chatModels.find(m => m.name.toLowerCase().includes('gemma'));
                        }
                        // 最後 fallback：挑第一個 chat-capable 模型
                        if (!foundModel && chatModels.length > 0) {
                            foundModel = chatModels[0];
                            console.log(`[LLM] Auto-selected first chat-capable model: ${foundModel.name}`);
                        }
                        if (foundModel) {
                            status.modelReady = true;
                            status.modelName = foundModel.name;
                        }
                    }
                } catch (tagsErr) {
                    console.warn(`[LLM] Failed to fetch model list (${listPath}):`, tagsErr.message);
                }
            } else {
                console.warn(`[LLM] 檢查 ${currentProvider} 失敗。Expected JSON but received ${contentType}。網址: ${checkUrl}`);
            }
        }
    } catch (err) {
        if (currentProvider === 'Ollama') {
            console.warn('[LLM] Local Ollama not responding, trying to start...');
            await ensureOllamaRunning();
        }
    }

    _cachedStatus = status;
    _lastCheck = now;
    return status;
}

/**
 * 清除 LLM 狀態快取（執行任務後呼叫）
 */
function invalidateCache() {
    console.log('[LLM] Clearing status cache...');
    _cachedStatus = null;
    _lastCheck = 0;
    _cachedModels = null;
    _lastModelsCheck = 0;
    cachedAccessToken = null;
    cachedAccessTokenExpiresAt = 0;
}

let _cachedModels = null;
let _lastModelsCheck = 0;

async function getAuthorizationHeader(authConfig = null) {
    const effectiveAuth = normalizeAuthConfig(authConfig || currentAuthConfig || {}, currentApiKey);

    if (effectiveAuth.type === 'api_key') {
        return effectiveAuth.apiKey ? { 'Authorization': `Bearer ${effectiveAuth.apiKey}` } : {};
    }

    if (effectiveAuth.type !== 'oauth_client_credentials') {
        return {};
    }

    const now = Date.now();
    if (cachedAccessToken && cachedAccessTokenExpiresAt > now + 10000) {
        return { 'Authorization': `Bearer ${cachedAccessToken}` };
    }

    const form = new URLSearchParams();
    form.set('grant_type', 'client_credentials');
    form.set('client_id', effectiveAuth.clientId || '');
    form.set('client_secret', effectiveAuth.clientSecret || '');
    if (effectiveAuth.scope) form.set('scope', effectiveAuth.scope);
    if (effectiveAuth.audience) form.set('audience', effectiveAuth.audience);

    const res = await fetch(effectiveAuth.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
        signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OAuth token acquisition failed (${res.status}): ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    if (!data.access_token) {
        throw new Error('OAuth response missing access_token');
    }

    const expiresIn = Number(data.expires_in || 3600);
    cachedAccessToken = data.access_token;
    cachedAccessTokenExpiresAt = Date.now() + (expiresIn * 1000);
    return { 'Authorization': `Bearer ${cachedAccessToken}` };
}

/**
 * 取得當前已安裝的所有模型
 */
async function getRequestHeaders(provider, authConfig = null) {
    const meta = PROVIDER_ENDPOINTS[provider] || { type: 'openai' };
    const effectiveAuth = normalizeAuthConfig(authConfig || currentAuthConfig || {}, currentApiKey);

    if (meta.type === 'anthropic') {
        return effectiveAuth.apiKey ? {
            'x-api-key': effectiveAuth.apiKey,
            'anthropic-version': '2023-06-01'
        } : {
            'anthropic-version': '2023-06-01'
        };
    }

    return getAuthorizationHeader(authConfig);
}

async function listModels(options = {}) {
    const forceRefresh = options.forceRefresh || false;
    const now = Date.now();
    
    // 如果有快取且未過期 (30秒)，直接回傳
    if (!forceRefresh && _cachedModels && (now - _lastModelsCheck < 30000)) {
        return _cachedModels;
    }

    const provider = (options.provider !== undefined) ? options.provider : currentProvider;
    const baseUrl = (options.baseUrl !== undefined) ? options.baseUrl : currentBaseUrl;
    const authConfig = (options.authConfig !== undefined) ? options.authConfig : currentAuthConfig;

    const meta = PROVIDER_ENDPOINTS[provider] || { type: 'openai', list: '/models' };
    const apiRoot = baseUrl.replace(/\/v1\/?$/, '');

    // ==========================================
    // 1. 處理 OpenAI 類型 Provider
    // ==========================================
    if (meta.type === 'openai' || meta.type === 'anthropic') {
        const listPath = meta.list || '/models';
        const checkUrl = baseUrl.endsWith('/') ? `${baseUrl}${listPath.substring(1)}` : `${baseUrl}${listPath}`;
        try {
            const authHeaders = await getRequestHeaders(provider, authConfig);
            const res = await fetch(checkUrl, {
                headers: authHeaders,
                signal: AbortSignal.timeout(5000)
            });

            if (!res.ok) {
                console.warn(`[LLM] List models from ${provider} failed with status: ${res.status}`);
                return [];
            }

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const text = await res.text();
                console.warn(`[LLM] Expected JSON from ${provider} but got ${contentType}. URL: ${checkUrl}`);
                return [];
            }

            const data = await res.json();
            let models = [];
            if (data && data.data && Array.isArray(data.data)) {
                models = data.data.map(m => ({ name: m.id, size: 0 }));
            } else if (data && data.models && Array.isArray(data.models)) {
                models = data.models.map(m => ({ name: m.name, size: m.size || 0 }));
            }
            
            // 只有在非預覽（沒帶 options）時才更新進階快取
            if (Object.keys(options).length === 0 || (Object.keys(options).length === 1 && options.forceRefresh !== undefined)) {
                _cachedModels = models;
                _lastModelsCheck = Date.now();
            }
            return models;
        } catch (e) {
            console.error(`[LLM] List models from ${provider} failed:`, e.message);
            return [];
        }
    }

    // ==========================================
    // 2. 處理 Ollama 類型 Provider
    // ==========================================
    const listPath = meta.list || '/api/tags';
    const checkUrl = `${apiRoot}${listPath}`;
    try {
        const authHeaders = await getAuthorizationHeader(authConfig);
        const res = await fetch(checkUrl, {
            headers: authHeaders,
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            console.warn(`[LLM] List models from ${provider} failed with status: ${res.status} (${checkUrl})`);
            return [];
        }

        const data = await res.json();
        let models = [];
        if (data.models && Array.isArray(data.models)) {
            models = data.models.map(m => ({
                name: m.name,
                size: m.size || 0
            }));
        }
        
        // 只有在非預覽（沒帶 options）時才更新進階快取
        if (Object.keys(options).length === 0 || (Object.keys(options).length === 1 && options.forceRefresh !== undefined)) {
            _cachedModels = models;
            _lastModelsCheck = Date.now();
        }
        return models;
    } catch (err) {
        console.error(`[LLM] List models from ${provider} failed:`, err.message);
        return [];
    }
}

/**
 * 設定當前對話使用的模型
 */
function setCurrentModel(modelName) {
    console.log(`[LLM] Switching model to: ${modelName}`);
    currentModel = modelName;
    saveConfig();
    invalidateCache();
}

/**
 * 嘗試啟動 Ollama 服務 (ollama serve)
 */
function ensureOllamaRunning() {
    return new Promise((resolve) => {
        // 1. 先用最簡單的命令檢查
        exec('ollama --version', (err) => {
            const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
            const defaultPath = path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe');

            let cmd = 'ollama';
            if (err) {
                // 如果直接執行失敗，檢查預設安裝路徑
                if (fs.existsSync(defaultPath)) {
                    cmd = `"${defaultPath}"`;
                    console.log(`[LLM] Found Ollama at: ${defaultPath}`);
                } else {
                    console.warn('[LLM] Ollama not found and default path does not exist');
                    return resolve(false);
                }
            }

            console.log(`[LLM] Attempting to start Ollama service in background (${cmd} serve)...`);
            try {
                // 使用 spawn 啟動，不要等待它結束
                const p = spawn(cmd, ['serve'], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true,
                    shell: true // 使用 shell 以支援引號路徑
                });
                p.unref();
                // 給它 3 秒鐘啟動
                setTimeout(() => resolve(true), 3000);
            } catch (spawnErr) {
                console.error('[LLM] Failed to start Ollama service:', spawnErr);
                resolve(false);
            }
        });
    });
}

/**
 * 使用 Ollama /api/chat 進行對話（支援角色扮演格式，效果比 generate 更自然）
 * @param {string} userMessage - 使用者輸入
 * @param {Array} history - 過去的對話歷史 [{role, content}, ...]
 * @returns {Promise<string>} LLM 回應文字
 */
async function chatWithLLM(userMessage, history = [], options = {}, locale = 'zh-TW') {
    const provider = options.providerOverride || currentProvider;
    const modelName = options.modelOverride || currentModel;
    const baseUrl = options.baseUrlOverride || currentBaseUrl;
    const authConfig = options.authConfigOverride || currentAuthConfig;
    const meta = PROVIDER_ENDPOINTS[provider] || { type: 'openai' };
    const chalkboardAttachment = options.chalkboardAttachment || null;
    const systemContext = options.systemContext || '';
    const effectiveUserMessage = String(userMessage || '').trim() || 'Please continue based on the latest user request in the conversation context.';
    if (meta.type === 'anthropic') {
        const headers = {
            'Content-Type': 'application/json',
            ...(await getRequestHeaders(provider, authConfig))
        };
        const apiRoot = baseUrl.replace(/\/v1\/?$/, '');
        const chatUrl = `${apiRoot}${meta.chat || '/messages'}`;
        const body = {
            model: modelName,
            max_tokens: 1024,
            system: buildFullSystemPrompt(locale, systemContext),
            messages: [
                ...history.map(m => ({
                    role: m.role === 'assistant' ? 'assistant' : 'user',
                    content: typeof m.content === 'string' ? m.content : String(m.content || '')
                })),
                {
                    role: 'user',
                    content: buildAnthropicMessageContent(effectiveUserMessage, chalkboardAttachment)
                }
            ]
        };
        const res = await fetch(chatUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
        });
        if (!res.ok) {
            const errText = await res.text();
            if (res.status === 401) {
                throw new Error(`AI engine authentication failed (401). Please check your ${provider} API Key in Settings.`);
            }
            throw new Error(`API error (${res.status}): ${errText.substring(0, 200)}`);
        }
        const data = await res.json();
        const content = Array.isArray(data?.content)
            ? data.content.filter(item => item?.type === 'text').map(item => item.text).join('\n').trim()
            : '';
        if (!content) {
            throw new Error('AI engine returned empty content. Please verify the Anthropic model name and permissions.');
        }
        return content;
    }
    // 正規化 history：
    // - 多數 OpenAI-compatible / Ollama 不接受無 tool_call_id 的 role:tool
    // - 工具觀察結果應以 user 訊息帶入（server 已用 user；此處再保底）
    const historyMessages = history
        .map((m) => {
            const rawRole = String(m?.role || 'user');
            const role = rawRole === 'assistant'
                ? 'assistant'
                : (rawRole === 'system' ? 'system' : 'user');
            let content = m?.content;
            if (Array.isArray(content)) {
                content = content.map((part) => {
                    if (typeof part === 'string') return part;
                    return part?.text || part?.content || '';
                }).join('\n');
            } else if (content == null) {
                content = '';
            } else if (typeof content !== 'string') {
                content = String(content);
            }
            return { role, content };
        })
        .filter((m) => m.content.trim());

    const messages = meta.type === 'ollama'
        ? [
            { role: 'system', content: buildFullSystemPrompt(locale, systemContext) },
            ...historyMessages.map(m => buildOllamaMessage(m.role, m.content)),
            buildOllamaMessage('user', effectiveUserMessage, chalkboardAttachment),
        ]
        : [
            { role: 'system', content: buildFullSystemPrompt(locale, systemContext) },
            ...historyMessages,
            { role: 'user', content: buildOpenAIMessageContent(effectiveUserMessage, chalkboardAttachment) },
        ];

    const headers = {
        'Content-Type': 'application/json',
        ...(await getRequestHeaders(provider, authConfig))
    };

    const apiRoot = baseUrl.replace(/\/v1\/?$/, '');
    let chatUrl = '';

    if (meta.type === 'ollama') {
        // 使用 Ollama 原生 API 路徑
        chatUrl = `${apiRoot}/api/chat`;
    } else {
        // 使用 OpenAI 相容路徑
        chatUrl = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
    }
    
    console.log(`[LLM] Sending chat: Provider=${provider}, URL=${chatUrl}, Model=${modelName}, History length=${history.length}`);

    const body = meta.type === 'ollama'
        ? {
            model: modelName,
            messages,
            stream: false,
        }
        : {
            model: modelName,
            messages,
            stream: false,
        };

    // 移除硬編碼的 options 與 tokens 限制，尊重模型自訂設定與完整輸出能力
    body.temperature = 0.7;

    let res;
    try {
        res = await fetch(chatUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(CHAT_TIMEOUT_MS), // Keep slow local reasoning bounded so the UI can recover.
        });
    } catch (fetchErr) {
        if (fetchErr.name === 'TimeoutError' || fetchErr.message.includes('timeout')) {
            throw new Error(`AI engine timed out (waited ${Math.round(CHAT_TIMEOUT_MS / 60000)} minutes). This may happen when the model is loading or thinking deeply. Check hardware resources or try again later.`);
        }
        throw fetchErr;
    }

    if (!res.ok) {
        const errText = await res.text();
        if (res.status === 401) {
            throw new Error(`AI engine authentication failed (401). Please check your ${provider} API Key in Settings.`);
        }
        throw new Error(`API error (${res.status}): ${errText.substring(0, 200)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const html = await res.text();
        throw new Error(`API error: Expected JSON but got ${contentType}. Content start: ${html.substring(0, 100)}`);
    }

    const data = await res.json();
    
    // 兼顧 OpenAI 與 Ollama 的各種欄位格式（含 reasoning / array content）
    const normalizeContent = (value) => {
        if (value == null) return '';
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) {
            return value.map((part) => {
                if (typeof part === 'string') return part;
                return part?.text || part?.content || '';
            }).join('\n');
        }
        if (typeof value === 'object') {
            return value.text || value.content || JSON.stringify(value);
        }
        return String(value);
    };

    let content = '';
    const choiceMsg = data?.choices?.[0]?.message;
    if (choiceMsg) {
        content = normalizeContent(choiceMsg.content)
            || normalizeContent(choiceMsg.reasoning_content)
            || normalizeContent(choiceMsg.reasoning)
            || normalizeContent(data.choices[0].text);
    } else if (data?.message) {
        content = normalizeContent(data.message.content)
            || normalizeContent(data.message.reasoning_content);
    } else if (data?.content) {
        content = normalizeContent(data.content);
    } else if (data?.response) {
        content = normalizeContent(data.response); // Ollama /api/generate
    }

    content = String(content || '').trim();

    // 處理思考標籤 (Thought Tags)
    // 如果模型只回傳了 <think>...</think>，我們保留它（或者至少不轉為空字串導致報錯）
    const thoughtMatch = content.match(/<think>([\s\S]*?)<\/think>/i)
        || content.match(/<reasoning>([\s\S]*?)<\/reasoning>/i);
    const thought = thoughtMatch ? thoughtMatch[1].trim() : null;
    const cleanContent = content
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .trim();

    const finalReply = cleanContent || thought || '';

    if (!finalReply) {
        console.error(`[LLM] 收到空的回應！原始資料:`, JSON.stringify(data));
        throw new Error('AI 引擎回傳了空內容，這可能是因為模型正在加載或上下文過長，請再試一次。');
    }

    return finalReply;
}

async function testProviderConnection({ provider, baseUrl, authConfig, model }) {
    const meta = PROVIDER_ENDPOINTS[provider] || { type: 'openai' };
    const headers = {
        'Content-Type': 'application/json',
        ...(await getRequestHeaders(provider, authConfig))
    };

    const apiRoot = baseUrl.replace(/\/v1\/?$/, '');
    const chatUrl = meta.type === 'ollama'
        ? `${apiRoot}/api/chat`
        : meta.type === 'anthropic'
            ? `${apiRoot}${meta.chat || '/messages'}`
            : (baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`);

    const body = meta.type === 'anthropic'
        ? {
            model,
            max_tokens: 32,
            system: 'Reply with exactly OK.',
            messages: [{ role: 'user', content: 'Test connection' }]
        }
        : {
            model,
            messages: [
                { role: 'system', content: 'Reply with exactly OK.' },
                { role: 'user', content: 'Test connection' },
            ],
            stream: false,
            temperature: 0
        };

    const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) {
        const errText = await res.text();
        if (res.status === 401) {
            throw new Error(`AI 引擎身份驗證失敗 (401)。請確認您是否為 ${provider} 提供了正確的 API Key。`);
        }
        throw new Error(`API error (${res.status}): ${errText.substring(0, 200)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const raw = await res.text();
        throw new Error(`API error: Expected JSON but got ${contentType}. Content start: ${raw.substring(0, 100)}`);
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content
        || (Array.isArray(data?.content) ? data.content.filter(item => item?.type === 'text').map(item => item.text).join('\n') : '')
        || data?.message?.content
        || data?.content
        || data?.response
        || '';

    if (!String(reply).trim()) {
        throw new Error('Model responded but content is empty. Please verify the model name and provider format.');
    }

    return String(reply).trim();
}

module.exports = {
    checkOllamaStatus,
    chatWithLLM,
    modelSupportsVision,
    getVisionCapableModel,
    invalidateCache,
    ensureOllamaRunning,
    listModels,
    setCurrentModel,
    getCurrentModel: () => currentModel,
    getCurrentVisionModel: () => currentVisionModel,
    updateProviderSettings,
    getCurrentProvider: () => currentProvider,
    getCurrentBaseUrl: () => currentBaseUrl,
    getCurrentApiKey: () => currentApiKey,
    getCurrentAuthType: () => currentAuthType,
    getCurrentAuthConfig: () => currentAuthConfig,
    testProviderConnection,
};
