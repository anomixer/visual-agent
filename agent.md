# AI PC Agent 開發日誌

> 本地優先、無命令列、具備感知能力的 Windows 系統管家  
> by [anomixer](https://github.com/anomixer)

---

## 📌 v0.1 — 初始版本 (2026-02-25)

### Tauri 桌面化 + Sidecar 架構
- 導入 **Tauri 2.x + Rust** 打包為獨立 `.exe`（MSI/NSIS），不需使用者安裝 Node.js
- Node.js 伺服器以 `pkg` 編譯為 Tauri **Sidecar Binary**，隨主程式啟動/退出
- 修改 `capabilities/default.json` 賦予殼層最高執行權限 (`shell:allow-execute`)

### AppData 架構
- 任務清單 (`tasks.json`) 與技能庫 (`skills/`) 儲存至 `%APPDATA%\aipc-agent\`
- 初次啟動自動把內建 Skills 複製過去，確保零設定上手

### 初始 Skills 庫
- 🌐 `install-chrome.md` — 靜默下載安裝最新 Chrome
- 🗑️ `remove-copilot.md` — 登錄檔停用 Copilot
- 💾 `backup-system.md` — PowerShell 系統還原點
- 🇯🇵 `install-language-ja.md` — 安裝日文語系

---

## 📌 v0.2 — UI 強化 + 推薦執行 (2026-03-05)

### 推薦清單一鍵執行
- `renderRecommendList` 加入 **＋ 加入** / **▶ 執行** 雙按鈕
- `addAndExecuteRecommend()` 一鍵「加入任務 + 立即執行」
- 後端 `buildRecommendList()` 動態掃描 `skills/` 目錄，有對應 Skill 的項目才顯示 ⚡ 可自動執行 徽章

### remove-copilot 升級
- 同時寫入 HKCU + HKLM 登錄檔
- 嘗試移除 Copilot AppxPackage（all users）
- 提供獨立驗證腳本 `verify-remove-copilot.ps1`

---

## 📌 v0.3 — 本地 LLM 整合 (2026-03-05)

### Ollama + qwen3.5:0.8b 整合
- 新增 `src/llm.js` 負責 Ollama 狀態偵測與對話
- 啟動時自動 ping `localhost:11434`，偵測 Ollama 版本與模型是否就緒
- `/api/chat` 升級：**LLM 優先**，Ollama 不可用時 fallback 到關鍵字比對
- `/api/llm/status` 新 API 端點
- System Prompt 口語化，`think: false` 關閉 qwen3.5 CoT 思考模式
- 使用 `/api/chat` 格式（roles messages）效果比 `/api/generate` 自然

### 新增 Skills
- 🧠 `install-ollama.md` — 靜默下載安裝 Ollama
- 📥 `pull-llm-model.md` — `ollama pull qwen3.5:0.8b`

### 全自動 AI 無縫體驗 (Auto-Bootstrap)
- 新電腦初次開啟程式時，若未偵測到 Ollama，UI 提示並**自動背景觸發**下載與靜默安裝。
- Ollama 就緒後，若無模型，再次**自動加入並執行**模型下載任務。
- 使用者只需打開程式放置，即可全自動點亮「🟢 AI 就緒」進入智能管家狀態。

### LLM 狀態指示燈
- Title bar 加入發光小圓點（🔴 未安裝 / 🟡 模型未就緒 / 🟢 AI 就緒）
- Status bar 同步顯示狀態

---

## 📌 v0.4 — VS Code 風格 UI 重構 (2026-03-05)

### 三欄可拖拉介面
```
┌─────────────────────────────────────────────────────────┐
│ TitleBar  [File][View][Help] ─── [●AI就緒] ─── [🌙↓↑] │
├──────────┬────────────────────────────┬─────────────────┤
│ 推薦清單  │  📋 工作清單               │  💬 AI 對話     │
│ (sidebar) │  (task cards)              │  (chat history) │
│←→ resize ─│──────────────────────────  ←→ resize        │
│           │  📝 工作日誌 ↕ resize      │  [使用者輸入框] │
├──────────┴────────────────────────────┴─────────────────┤
│ StatusBar  [🟢 AI就緒] │ [N個任務]         [v1.0][繁]   │
└─────────────────────────────────────────────────────────┘
```

- 所有面板邊界皆可滑鼠拖拉調整：側邊欄寬度、聊天欄寬度、日誌面板高度
- 佈局設定自動儲存至 `localStorage`

### 設計系統
- VS Code 色彩配置（`#1e1e1e` 背景、`#569cd6` accent）
- `JetBrains Mono` 日誌字體
- Task card 左邊框顏色代表狀態（藍=待執行、黃=執行中、綠=完成、紅=失敗）
- Message bubble 對話氣泡（AI 左/使用者右）

---

## 📌 v0.5 — 一鍵打包 EXE (2026-03-05)

### `build.bat` 全自動編譯腳本
- 實現從無到有的完整 Tauri 開發環境自動安裝與打包
- 過程包含：偵測/安裝 Node.js → 安裝 `pkg` → 偵測/安裝 Rust C++ Toolchain → 安裝 `tauri-cli` → 編譯 `app.exe` (NSIS/MSI)
- 自動將 Node 後端與 Skills 壓縮成 Sidecar Binary (`pkg` 虛擬檔案系統修復)

### APPDATA 檔案存取修復
- 修正 `pkg` 打包後 `fs.copyFileSync` 無法掛載虛擬檔案的錯誤
- 確保所有預設 `.md` 技能腳本能在系統第一次啟動時，正確釋放到 `%APPDATA%\aipc-agent\skills` 中

---

## 📌 v0.6 — 穩定性與 UI 體感優化 (2026-03-06)

### 啟動啟始畫面 (Splash Screen)
- 導入 `splash-overlay`：解決冷啟動時後台 Server 尚未就緒導致的畫面空白。
- 智能訊息：首次執行顯示「環境設定中」，再次執行顯示「伺服器啟動中」。
- 自動偵測：當前端成功抓取到 3210 Port 的資料後，遮罩自動優雅淡出。

### 日誌渲染革命：原地更新進度條
- 修正大量 `curl` 下載訊息導致的日誌洗版問題。
- 實作 `addLogEntry` 智能覆蓋：偵測到 `%` 或 `###` 時，自動更新最後一行日誌而不新增行。
- 同步修正 `skill-executor.js`：將代碼區塊改為「整塊執行」，解決 PowerShell 變數無法跨行傳遞的 Bug。

### Ollama 安裝守護 (Installation Guard)
- 升級 `install-ollama.md`：自動清理安裝後強制彈出的 Ollama App 視窗。
- 加入 UAC 預警提示與超時強制解鎖機制，確保安裝進程不再因為背景 App 視窗而卡死。

### 生命週期管理與除錯
- Rust 端監聽 `WindowEvent::Destroyed`，確保 App 關閉時徹底殺死 Node Sidecar 進程。
- 後端 Server 加入 `%APPDATA%\debug.log`，方便在無 Console 的打包環境中進行診斷。
- 提高 LLM 逾時至 60s，確保冷啟動下的模型偵測不會誤報。

---

## 🚀 未來展望

- [ ] 硬體健康監控（S.M.A.R.T、CPU 溫度、風扇轉速）
- [ ] 多輪對話歷史（contextual chat）
- [ ] Skill 線上商城，動態下載更新
- [ ] 更多 Skills：驅動更新、防毒掃描、軟體移除

---
> 📝 這是一支不需要黑綠色文字終端，便能聰明幫你管理系統操作的助手。
