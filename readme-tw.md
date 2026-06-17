# AI PC Agent 繁中摘要

> 本文件為繁體中文快速摘要，重點補充遠端 AI 協作、Directive Protocol 與最近修正。完整說明仍以 [README.md](/C:/dev/aipc-agent/README.md) 為準。

## 2026.06.03 修正摘要

- 版本更新為 `2026.06.03`。
- 攻略、搜尋、比較、規劃、安裝、除錯、機票/物價/新聞/天氣等耗時請求，聊天窗會先顯示不寫入歷史的 interim plan，再背景執行並回傳正式答案。
- LM Studio 可像 Ollama / NVIDIA NIM 一樣在設定視窗按「刷新清單」抓模型。
- `/api/chat` 每輪注入今天、明天與時區，避免 AI 把「明天」解析成舊日期。
- 天氣、物價、新聞、匯率、股價與最新資訊若模型忘了叫 Browser Use，後端會自動補 current-info search，並進入 Observe-after-Act 續答。
- Browser Use runtime 未安裝時會提示安裝，並真的加入/沿用 `install_playwright_chromium` 工作清單任務；使用者接著說「執行 / 開始 / 安裝」時會保底啟動該 pending task。
- Browser runtime ready 狀態由 `/api/meta.browserExecutable` 驗證，接受 `chrome-headless-shell.exe` 或 `chrome.exe`。
- Browser Use runtime 未就緒時仍會盡量使用文字/連結搜尋 fallback。
- 計畫、比較、查詢摘要或偏長回答會自動寫入 Chalkboard 摘要。
- LLM suggestion buttons 已停用，避免顯示文不對題的安裝或 SOP 按鈕。

## 遠端 AI 協作重點

- 遠端聊天室支援本地 AI、遠端 AI 與使用者三方協作。
- 若訊息同時需要本地 AI 與遠端 AI，現在改為本地 AI 先回覆，遠端 AI 再背景補充，避免雙方互等。
- 同一個 remote session 的 remote-AI 任務會依序排隊，降低上一題晚回、下一題插隊與重複回答。
- 目標為 `remote-ai` 的 AI 內部協作便條不再直接顯示給使用者。

## Directive Protocol

### Suggestion

- 建議按鈕請使用固定格式：

```text
[SUGGEST: button_text="🟢 安裝 VS Code" action="install_sop" sop_id="vscode_install"]
```

- 支援的 `action`：
  - `install_sop`
  - `add_task`
  - `execute_task`
  - `computer_use`

### Action

- 直接動作請優先使用：

```text
[ACTION:ADD_TASK sop_id="..."]
[ACTION:EXECUTE_TASK task_id="..."]
[ACTION:INSTALL_SOP sop_id="..."]
[ACTION:COMPUTER_USE mode="prepare_vm_sandbox|open_file|open_url|install_sop" ...]
[ACTION:BROWSER_USE mode="search|open|navigate|fetch_title|extract_text|snapshot" ...]
```

- 避免混用舊的括號格式或未定義欄位名稱。

## 2026.05.14 修正摘要

- 修正遠端 `[SUGGEST: button_text="..." ...]` 先前只顯示屬性字串、按了沒作用的問題。
- 修正遠端 `[ACTION:INSTALL_SOP ...]` 先前只顯示文字、不會真正執行的問題。
- 遠端聊天室加入 render signature，降低 polling 導致的 suggestion 按鈕閃爍。
- 遠端 AI 自動回覆改成 per-session queue，減少答錯題、回兩次與 thinking 卡住。

## 2026.05.20 驗收重點

建議每次改完遠端協作後，固定驗這三條：

1. `SUGGEST` 流程
   預期：遠端訊息會出現真正可點的按鈕、按鈕不閃、點下去後會建立或沿用任務，UI log 會看到 `Suggestion clicked`。
2. `INSTALL_SOP` 流程
   預期：`[ACTION:INSTALL_SOP sop_id="..."]` 會在本機被執行，UI log 先看到 `Remote AI directive received`，接著看到 `Started SOP task` / `Reused SOP task` 或明確錯誤。
3. 雙 AI 協作流程
   預期：本地 AI 先回，UI log 會看到 `Dual-AI collaboration: Local AI answers first, Remote AI follow-up queued`，遠端 AI 之後再補充，不會整段卡住。

另外：

- 短時間內重複的遠端 directive 現在會被略過，並在 log 顯示 `Skipped duplicate remote directive`。
- directive 收到時的 log 會帶 `msg:<id>`，之後比較容易對照是不是同一批遠端訊息重送。

## 相關檔案

- 協議規則：[src/llm.js](/C:/dev/aipc-agent/src/llm.js)
- 遠端協作後端：[src/server.js](/C:/dev/aipc-agent/src/server.js)
- 遠端前端 UI：[public/app.js](/C:/dev/aipc-agent/public/app.js)
- 開發日誌：[agents.md](/C:/dev/aipc-agent/agents.md)
