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
            currentApiKey
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error('[LLM] 儲存設定失敗:', e.message);
    }
}

/**
 * 更新 Provider 設定
 */
function updateProviderSettings(provider, baseUrl, apiKey, model) {
    currentProvider = provider;
    currentBaseUrl = baseUrl;
    currentApiKey = apiKey;
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
    const apiRoot = currentBaseUrl.replace(/\/v1\/?$/, ''); // 拿掉末尾的 /v1 得到根路徑

    if (currentProvider !== 'Ollama') {
        // 非 Ollama 模式：嘗試通用的 OpenAI 格式檢查
        try {
            const res = await fetch(`${currentBaseUrl}/models`, {
                headers: currentApiKey ? { 'Authorization': `Bearer ${currentApiKey}` } : {},
                signal: AbortSignal.timeout(5000)
            }).catch(() => null);

            if (res && res.ok) {
                status.available = true;
                status.modelReady = true; // 雲端模組通常視為已就緒
                status.modelName = currentModel || 'Cloud Model';
            }
        } catch (e) {
            console.warn(`[LLM] Check ${currentProvider} status failed:`, e.message);
        }
        _cachedStatus = status;
        _lastCheck = now;
        return status;
    }

    try {
        // 1. 檢查服務是否在線 (試探根路徑版本)
        const res = await fetch(`${apiRoot}/api/version`, {
            signal: AbortSignal.timeout(3000),
        }).catch(() => null);

        if (res && res.ok) {
            const data = await res.json();
            status.available = true;
            status.version = data.version ?? 'unknown';

            // 2. 檢查模型清單 (Ollama 專屬路徑)
            try {
                const tagsRes = await fetch(`${apiRoot}/api/tags`, {
                    signal: AbortSignal.timeout(5000),
                });
                const tagsData = await tagsRes.json();

                if (tagsData.models && Array.isArray(tagsData.models)) {
                    // 優先尋找目前設定的模型
                    let foundModel = tagsData.models.find(m => m.name === currentModel);

                    // 如果目前記憶的模型不在 Ollama 中，嘗試 fallback
                    if (!foundModel && currentModel !== DEFAULT_MODEL) {
                        foundModel = tagsData.models.find(m => m.name === DEFAULT_MODEL);
                        if (foundModel) {
                            currentModel = DEFAULT_MODEL;
                            saveConfig();
                        }
                    }

                    // 次要尋找任何帶有 qwen3.5 的模型 (fallback)
                    if (!foundModel) {
                        const modelPrefix = DEFAULT_MODEL.split(':')[0]; // e.g. 'qwen3.5'
                        foundModel = tagsData.models.find(m => m.name.startsWith(modelPrefix + ':') || m.name === modelPrefix);
                    }

                    // 最後保底：只要包含 qwen 即可
                    if (!foundModel) {
                        foundModel = tagsData.models.find(m => m.name.toLowerCase().includes('qwen'));
                    }

                    if (foundModel) {
                        status.modelReady = true;
                        status.modelName = foundModel.name;
                    }
                }
            } catch (tagsErr) {
                console.warn('[LLM] 讀取模型清單失敗:', tagsErr.message);
                status.modelReady = false;
            }
        }
    } catch (err) {
        if (currentProvider === 'Ollama') {
            // Ollama 未啟動，嘗試啟動它
            console.warn('[LLM] Ollama 服務未響應，嘗試啟動服務...');
            await ensureOllamaRunning();

            // 啟動後再次快速檢查一次
            try {
                const retry = await fetch(`${apiRoot}/api/version`, { signal: AbortSignal.timeout(2000) });
                if (retry.ok) {
                    status.available = true;
                    const data = await retry.json();
                    status.version = data.version;
                }
            } catch { /* 依舊失敗則放棄 */ }
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
}

/**
 * 取得當前 Ollama 已安裝的所有模型
 */
async function listModels() {
    if (currentProvider !== 'Ollama') {
        try {
            const res = await fetch(`${currentBaseUrl}/models`, {
                headers: currentApiKey ? { 'Authorization': `Bearer ${currentApiKey}` } : {},
                signal: AbortSignal.timeout(5000)
            });
            if (res.ok) {
                const data = await res.json();
                // OpenAI 返回格式是 { data: [{ id: '...', ... }] }
                if (data.data && Array.isArray(data.data)) {
                    return data.data.map(m => ({ name: m.id, size: 0 }));
                }
            }
        } catch (e) {
            console.error(`[LLM] List models from ${currentProvider} failed:`, e.message);
        }
        return [];
    }

    const apiRoot = currentBaseUrl.replace(/\/v1\/?$/, '');
    try {
        const res = await fetch(`${apiRoot}/api/tags`, {
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
            const data = await res.json();
            return data.models || [];
        }
    } catch (e) {
        console.error('[LLM] List models failed:', e.message);
    }
    return [];
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
    const messages = [
        { role: 'system', content: buildFullSystemPrompt() },
        ...history,
        { role: 'user', content: userMessage },
    ];

    const headers = { 'Content-Type': 'application/json' };
    if (currentApiKey) headers['Authorization'] = `Bearer ${currentApiKey}`;

    // 判斷使用的 Endpoint (有些 Provider 可能沒帶 /v1)
    const chatUrl = currentBaseUrl.endsWith('/') ? `${currentBaseUrl}chat/completions` : `${currentBaseUrl}/chat/completions`;

    const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: currentModel,
            messages: messages,
            stream: false,
            // 某些 Provider 需要這些 OpenAI 標準以外的參數，需視情況調整
            think: false,
            temperature: 0.7,
            top_p: 0.9,
            max_tokens: 1000,
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    // 兼顧 OpenAI (choices[0].message.content) 與 Ollama (message.content) 格式
    let content = '';
    if (data.choices && data.choices[0]?.message?.content) {
        content = data.choices[0].message.content;
    } else if (data.message?.content) {
        content = data.message.content;
    }
    content = content.trim();

    // 安全過濾：移除殘留的 <think>...</think> 標籤（以防 think:false 沒完全生效）
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    return content || '（抱歉，我剛才走神了，你再說一次？）';
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
};
