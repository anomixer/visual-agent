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
const DEFAULT_MODEL = 'qwen3.5:0.8b';

// 系統 Prompt — 口語自然版，避免模型照稿念
const SYSTEM_PROMPT = `你是「AI管家」，一個住在使用者電腦裡的聰明小幫手，說話像朋友一樣自然。

個性設定：
- 說話直接、簡短，不廢話
- 用繁體中文，偶爾可以加 emoji 讓回應活潑
- 遇到系統任務直接告訴使用者「好，已經幫你排好了，按執行就搞定」
- 不懂的事情就說「這我沒辦法，你去問谷歌吧」，不要亂掰
- 禁止用條列格式或粗體，就像真人聊天一樣說話

你能做的事（有技能腳本支援）：
- 安裝 Google Chrome
- 移除 Windows Copilot
- 建立系統還原點（備份）
- 安裝日文語系
- 安裝 / 設定 Ollama 本地 AI

碰到這些要求，記得說你已經幫他加到清單了，按執行就會自動跑。`;

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
                    // 優先尋找精確匹配 (qwen3.5:0.8b)
                    let foundModel = tagsData.models.find(m => m.name === DEFAULT_MODEL);

                    // 次要尋找任何帶有 qwen3.5 的模型
                    if (!foundModel) {
                        const modelPrefix = DEFAULT_MODEL.split(':')[0]; // 'qwen3.5'
                        foundModel = tagsData.models.find(m => m.name.startsWith(modelPrefix + ':') || m.name === modelPrefix);
                    }

                    // 最後保底：只要包含 qwen 即可（應對未來版本或標籤變動）
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
            model: DEFAULT_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
            stream: false,
            think: false,         // qwen3.5 專屬：關掉 chain-of-thought，直接輸出答案
            options: {
                temperature: 0.85,
                top_p: 0.9,
                num_predict: 300,
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
    DEFAULT_MODEL,
    OLLAMA_BASE,
};
