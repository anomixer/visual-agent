/**
 * LLM Integration — AI PC Agent
 *
 * 負責與本地 Ollama 伺服器通訊：
 *   - 檢查 Ollama 是否在線
 *   - 檢查指定模型是否已下載
 *   - 將對話送給模型並取得回應
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3.5:4b';
let currentModel = DEFAULT_MODEL;

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
            if (data.currentModel) {
                currentModel = data.currentModel;
                console.log(`[LLM] 載入預存模型: ${currentModel}`);
            }
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
        const config = { currentModel };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error('[LLM] 儲存設定失敗:', e.message);
    }
}

// 初始化載入
loadConfig();

// 基礎系統 Prompt
const BASE_SYSTEM_PROMPT = `你是一名住在 Windows 電腦裡的「AI 智慧管家」與「資深軟體工程師」。
你的存在是為了讓複雜的操作變得直覺。

你的守則：
1. **簡潔精準**：說話直擊重點，避免囉嗦。先給結論，再簡要說明原因。
2. **專家直覺**：深度理解使用者意圖。若使用者提到電腦問題，主動連結相關 SOP。
3. **安全第一**：涉及任何系統變動、執行任務或下載模型，必須先簡述風險並「徵得使用者同意」。

回覆規範：
- 使用「繁體中文」。展現專業且親切的工程師態度。
- 善用即時資訊：[[當前系統狀態]]、[[目前已安裝模型]]。
- 若需操作系統，請在回覆末端附加協議標籤 [ACTION:...]。`;

/**
 * 載入所有 Skill 定義並組合為 System Prompt
 */
function buildFullSystemPrompt() {
    let fullPrompt = BASE_SYSTEM_PROMPT + '\n\n';
    
    // 掃描 skills 目錄
    const skillsDir = path.join(__dirname, '..', 'skills');
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

    try {
        // 1. 檢查 Ollama Server 是否在線
        const res = await fetch(`${OLLAMA_BASE}/api/version`, {
            signal: AbortSignal.timeout(3000), // 放寬至 3 秒
        });
        if (res.ok) {
            const data = await res.json();
            status.available = true;
            status.version = data.version ?? 'unknown';

            // 2. 檢查模型清單
            try {
                const tagsRes = await fetch(`${OLLAMA_BASE}/api/tags`, {
                    signal: AbortSignal.timeout(5000), // 模型清單可能較慢，給 5 秒
                });
                const tagsData = await tagsRes.json();

                if (tagsData.models && Array.isArray(tagsData.models)) {
                    // 優先尋找目前設定的模型
                    let foundModel = tagsData.models.find(m => m.name === currentModel);

                    // [改動] 如果目前記憶的模型不在 Ollama 中，嘗試 fallback
                    if (!foundModel && currentModel !== DEFAULT_MODEL) {
                        console.warn(`[LLM] 預設記憶模型 ${currentModel} 不存在，嘗試回退至 ${DEFAULT_MODEL}`);
                        foundModel = tagsData.models.find(m => m.name === DEFAULT_MODEL);
                        if (foundModel) {
                            currentModel = DEFAULT_MODEL; // 正式回退
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
        // Ollama 未啟動，嘗試啟動它
        console.warn('[LLM] Ollama 服務未響應，嘗試啟動服務...');
        await ensureOllamaRunning();

        // 啟動後再次快速檢查一次
        try {
            const retry = await fetch(`${OLLAMA_BASE}/api/version`, { signal: AbortSignal.timeout(2000) });
            if (retry.ok) {
                status.available = true;
                const data = await retry.json();
                status.version = data.version;
            }
        } catch { /* 依舊失敗則放棄 */ }
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
    try {
        const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
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
 * @returns {Promise<string>} LLM 回應文字
 */
async function chatWithLLM(userMessage) {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: currentModel,
            messages: [
                { role: 'system', content: buildFullSystemPrompt() },
                { role: 'user', content: userMessage },
            ],
            stream: false,
            think: false,         // qwen3.5 專屬：關掉 chain-of-thought，直接輸出答案
            options: {
                temperature: 0.7,   // 稍微降低隨機性，讓回答更穩定
                top_p: 0.9,
                num_predict: 800,   // 設定一個合理的上限，避免過長
                // 不指定 num_ctx，讓 Ollama 抓取 Model 檔案中定義的預設值 (例如 2048, 4096, 32k 等)
                repeat_penalty: 1.1,
            },
        }),
        signal: AbortSignal.timeout(60000), // 初次載入可能較久，放寬至 60 秒
    });

    if (!res.ok) {
        throw new Error(`Ollama API error: ${res.status}`);
    }

    const data = await res.json();
    let content = (data.message?.content ?? '').trim();

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
    OLLAMA_BASE,
};
