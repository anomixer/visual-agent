/**
 * LLM Integration — AI PC Agent
 *
 * 負責與本地 Ollama 伺服器通訊：
 *   - 檢查 Ollama 是否在線
 *   - 檢查指定模型是否已下載
 *   - 將對話送給模型並取得回應
 */

const OLLAMA_BASE = 'http://localhost:11434';
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
 * @returns {Promise<{ available: boolean, modelReady: boolean, version: string|null }>}
 */
async function checkOllamaStatus() {
    const now = Date.now();
    if (_cachedStatus && (now - _lastCheck) < CACHE_TTL_MS) {
        return _cachedStatus;
    }

    const status = { available: false, modelReady: false, version: null };

    try {
        const res = await fetch(`${OLLAMA_BASE}/api/version`, {
            signal: AbortSignal.timeout(2000),
        });
        if (res.ok) {
            const data = await res.json();
            status.available = true;
            status.version = data.version ?? 'unknown';

            // 檢查模型是否已下載
            try {
                const tagsRes = await fetch(`${OLLAMA_BASE}/api/tags`, {
                    signal: AbortSignal.timeout(3000),
                });
                const tagsData = await tagsRes.json();
                const modelPrefix = DEFAULT_MODEL.split(':')[0]; // 'qwen3.5'
                status.modelReady = tagsData.models?.some(
                    (m) => m.name === DEFAULT_MODEL || m.name.startsWith(modelPrefix + ':')
                ) ?? false;
            } catch {
                status.modelReady = false;
            }
        }
    } catch {
        // Ollama 未啟動或未安裝
    }

    _cachedStatus = status;
    _lastCheck = now;
    return status;
}

/**
 * 清除 LLM 狀態快取（執行任務後呼叫）
 */
function invalidateCache() {
    _cachedStatus = null;
    _lastCheck = 0;
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
        signal: AbortSignal.timeout(30000),
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
    DEFAULT_MODEL,
    OLLAMA_BASE,
};
