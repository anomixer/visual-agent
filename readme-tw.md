# AI PC Agent 繁中摘要

> 本文件為繁體中文快速摘要，重點補充遠端 AI 協作、Directive Protocol 與最近修正。完整說明仍以 [README.md](/C:/dev/aipc-agent/README.md) 為準。

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
- 遠端 AI 自動回覆改為 per-session queue，減少答錯題、回兩次與 thinking 卡住。

## 相關檔案

- 協議規則：[src/llm.js](/C:/dev/aipc-agent/src/llm.js)
- 遠端協作後端：[src/server.js](/C:/dev/aipc-agent/src/server.js)
- 遠端前端 UI：[public/app.js](/C:/dev/aipc-agent/public/app.js)
- 開發日誌：[agents.md](/C:/dev/aipc-agent/agents.md)
