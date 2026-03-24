const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const DEFAULT_MODEL = 'qwen3.5:4b';
let currentModel = DEFAULT_MODEL;

// 新增 Provider 設定
let currentProvider = 'Ollama';
let currentBaseUrl = 'http://127.0.0.1:11434/v1';
let currentApiKey = '';
let currentAuthType = 'none';
let currentAuthConfig = { type: 'none' };
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

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
const APP_DATA_DIR = path.join(process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Preferences') : path.join(os.homedir(), '.config')), 'aipc-agent');
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
            if (!data.currentAuthType && data.currentApiKey) {
                currentAuthType = 'api_key';
                currentAuthConfig = { type: 'api_key', apiKey: data.currentApiKey };
            }

            console.log(`[LLM] 載入設定: ${currentProvider} @ ${currentBaseUrl}`);
        }
    } catch (e) {
        console.warn('[LLM] 載入設定失敗:', e.message);
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
            currentAuthConfig
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error('[LLM] 儲存設定失敗:', e.message);
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

function updateProviderSettings(provider, baseUrl, apiKey, model, authConfig = null) {
    currentProvider = provider;
    currentBaseUrl = baseUrl;
    currentAuthConfig = normalizeAuthConfig(authConfig || {}, apiKey);
    currentAuthType = currentAuthConfig.type;
    currentApiKey = currentAuthType === 'api_key' ? (currentAuthConfig.apiKey || '') : '';
    if (model) currentModel = model;
    saveConfig();
    invalidateCache();
}

// 初始化載入
loadConfig();

// 基礎系統 Prompt
const BASE_SYSTEM_PROMPT = `你是一名住在 Windows 電腦裡的「AI 智慧管家」與「資深軟體工程師」。
你的存在是為了精確、自動化地執行電腦維護與軟體建置任務，以及各種AI Agent任務。

你的核心任務（優先權高至低）：
1. **系統維護與優化**：如移除廣告、停用 Copilot、建立備份點、檢查更新。
2. **軟體安裝與佈署**：協助使用者安裝 Chrome、Steam、Office 等工具。
3. **故障診斷與排錯**：當使用者反應電腦問題，主動推薦相關 SOP 進行檢修。
4. **輔助工具操作**：如切換主題、查看日誌、管理工作清單。 **嚴禁主動建議使用者切換或下載其他 AI 模型，除非使用者明確詢問電腦或 AI 本身的技術細節。**

你的守則：
1. **簡潔精準**：說話直擊重點，避免囉嗦。先給結論，再簡要說明原因。
2. **專家直覺**：深度理解使用者意圖。若使用者發現問題，應根據「可用 SOP 列表」主動推薦解決方案。
3. **安全第一**：涉及任何系統變動、執行任務，必須先簡述風險並「徵得使用者同意」。

- 若需操作系統，請在回覆末端附加協議標籤 [ACTION:...]。
- **混合模式守則**：
  1. **直接執行 (ACTION)**：當你決定立即動作（如：安裝、移除、執行）時，**必須**輸出對應的 \`[ACTION:...]\`。此時**禁發**建議按鈕。若任務已在清單中且為 pending，當使用者說「開始、執行、做吧、OK」時，你**必須**輸出 \`[ACTION:EXECUTE_TASK(task_id="任務ID")]\`。
  2. **提供選項 (SUGGEST)**：當你決定「提供建議/詢問」時（例如：要我幫您安裝...嗎？），你**必須**提供建議按鈕 \`[SUGGEST:...]\`，但在此回覆中**絕對禁止**出現 \`[ACTION:...]\` 標籤。
- **對話歷史**：請結合背景任務狀態與對話歷史來精確判斷使用者的意圖。確保動作標籤確切對應到任務 ID。`;

/**
 * 載入所有 Skill 定義並組合為 System Prompt
 */
function buildFullSystemPrompt() {
    let fullPrompt = BASE_SYSTEM_PROMPT + '\n\n';

    // 掃描 AppData 中的 skills 目錄
    const skillsDir = path.join(APP_DATA_DIR, 'skills');
    if (fs.existsSync(skillsDir)) {
        const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'));
        files.forEach(file => {
            const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8');
            fullPrompt += `### 技能定義 (${file}):\n${content}\n\n`;
        });
    }

    return fullPrompt;
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
                        hint = ' (提示：https://ollama.com 是官網，API 路徑通常與本地不同)';
                    }
                    console.warn(`[LLM] Check ${currentProvider} status failed. URL: ${checkUrl}, Expected JSON but got ${contentType}${hint}`);
                }
            } else if (res) {
                console.warn(`[LLM] Check ${currentProvider} status returned error ${res.status} for ${checkUrl}`);
            } else if (currentProvider === 'Ollama') {
                // Fetch failed and it's local Ollama
                console.warn('[LLM] 本地 Ollama 未響應，嘗試啟動服務...');
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
                        let foundModel = tagsData.models.find(m => m.name === currentModel);
                        if (!foundModel && currentModel !== DEFAULT_MODEL) {
                            foundModel = tagsData.models.find(m => m.name === DEFAULT_MODEL);
                            if (foundModel) {
                                currentModel = DEFAULT_MODEL;
                                saveConfig();
                            }
                        }
                        if (!foundModel) {
                            const modelPrefix = DEFAULT_MODEL.split(':')[0];
                            foundModel = tagsData.models.find(m => m.name.startsWith(modelPrefix + ':') || m.name === modelPrefix);
                        }
                        if (!foundModel) {
                            foundModel = tagsData.models.find(m => m.name.toLowerCase().includes('qwen'));
                        }
                        if (foundModel) {
                            status.modelReady = true;
                            status.modelName = foundModel.name;
                        }
                    }
                } catch (tagsErr) {
                    console.warn(`[LLM] 讀取模型清單失敗 (${listPath}):`, tagsErr.message);
                }
            } else {
                console.warn(`[LLM] 檢查 ${currentProvider} 失敗。預期 JSON 但收到 ${contentType}。網址: ${checkUrl}`);
            }
        }
    } catch (err) {
        if (currentProvider === 'Ollama') {
            console.warn('[LLM] 本地 Ollama 未響應，嘗試啟動服務...');
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
    console.log('[LLM] 正在清除狀態快取...');
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
        throw new Error(`OAuth token 取得失敗 (${res.status}): ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    if (!data.access_token) {
        throw new Error('OAuth token 回應缺少 access_token');
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
    console.log(`[LLM] 切換模型至: ${modelName}`);
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
                    console.log(`[LLM] 找到 Ollama 絕對路徑: ${defaultPath}`);
                } else {
                    console.warn('[LLM] 系統中未偵測到 Ollama，且預設路徑不存在');
                    return resolve(false);
                }
            }

            console.log(`[LLM] 正在背景嘗試啟動 Ollama 服務 (${cmd} serve)...`);
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
                console.error('[LLM] 啟動 Ollama 服務失敗:', spawnErr);
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
async function chatWithLLM(userMessage, history = []) {
    const meta = PROVIDER_ENDPOINTS[currentProvider] || { type: 'openai' };
    if (meta.type === 'anthropic') {
        const headers = {
            'Content-Type': 'application/json',
            ...(await getRequestHeaders(currentProvider))
        };
        const apiRoot = currentBaseUrl.replace(/\/v1\/?$/, '');
        const chatUrl = `${apiRoot}${meta.chat || '/messages'}`;
        const body = {
            model: currentModel,
            max_tokens: 1024,
            system: buildFullSystemPrompt(),
            messages: [...history, { role: 'user', content: userMessage }].map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: m.content
            }))
        };
        const res = await fetch(chatUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(180000),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`API error (${res.status}): ${errText.substring(0, 200)}`);
        }
        const data = await res.json();
        const content = Array.isArray(data?.content)
            ? data.content.filter(item => item?.type === 'text').map(item => item.text).join('\n').trim()
            : '';
        if (!content) {
            throw new Error('AI 引擎回傳了空內容，請確認 Anthropic model 名稱與權限設定。');
        }
        return content;
    }
    const messages = [
        { role: 'system', content: buildFullSystemPrompt() },
        ...history,
        { role: 'user', content: userMessage },
    ];

    const headers = {
        'Content-Type': 'application/json',
        ...(await getRequestHeaders(currentProvider))
    };

    const apiRoot = currentBaseUrl.replace(/\/v1\/?$/, '');
    let chatUrl = '';

    if (meta.type === 'ollama') {
        // 使用 Ollama 原生 API 路徑
        chatUrl = `${apiRoot}/api/chat`;
    } else {
        // 使用 OpenAI 相容路徑
        chatUrl = currentBaseUrl.endsWith('/') ? `${currentBaseUrl}chat/completions` : `${currentBaseUrl}/chat/completions`;
    }
    
    console.log(`[LLM] 傳送對話請求：Provider=${currentProvider}, URL=${chatUrl}, Model=${currentModel}`);

    const body = {
        model: currentModel,
        messages: messages,
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
            signal: AbortSignal.timeout(180000), // 延長至 3 分鐘，配合「思考型」或地端加載較慢的模型
        });
    } catch (fetchErr) {
        if (fetchErr.name === 'TimeoutError' || fetchErr.message.includes('timeout')) {
            throw new Error(`AI 引擎回應超時（已等待 3 分鐘）。這通常發生在模型正在加載或正在進行深度思考。請確保您的硬體資源充足，或稍後再試。`);
        }
        throw fetchErr;
    }

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error (${res.status}): ${errText.substring(0, 200)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        const html = await res.text();
        throw new Error(`API error: Expected JSON but got ${contentType}. Content start: ${html.substring(0, 100)}`);
    }

    const data = await res.json();
    
    // 兼顧 OpenAI 與 Ollama 的各種欄位格式
    let content = '';
    if (data && data.choices && data.choices[0]?.message) {
        content = data.choices[0].message.content;
    } else if (data && data.message) {
        content = data.message.content;
    } else if (data && data.content) {
        content = data.content;
    } else if (data && data.response) {
        content = data.response; // 支援 Ollama /api/generate 格式混用
    }

    content = (content || '').trim();

    // 處理思考標籤 (Thought Tags)
    // 如果模型只回傳了 <think>...</think>，我們保留它（或者至少不轉為空字串導致報錯）
    const thoughtMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
    const thought = thoughtMatch ? thoughtMatch[1].trim() : null;
    const cleanContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

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
        throw new Error('模型有回應，但內容為空。請檢查 model 名稱與 provider 相容格式。');
    }

    return String(reply).trim();
}

module.exports = {
    checkOllamaStatus,
    chatWithLLM,
    invalidateCache,
    ensureOllamaRunning,
    listModels,
    setCurrentModel,
    getCurrentModel: () => currentModel,
    updateProviderSettings,
    getCurrentProvider: () => currentProvider,
    getCurrentBaseUrl: () => currentBaseUrl,
    getCurrentApiKey: () => currentApiKey,
    getCurrentAuthType: () => currentAuthType,
    getCurrentAuthConfig: () => currentAuthConfig,
    testProviderConnection,
};
