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

## 🚀 未來展望

- [ ] 硬體健康監控（S.M.A.R.T、CPU 溫度、風扇轉速）
- [ ] 多輪對話歷史（contextual chat）
- [ ] Skill 線上商城，動態下載更新
- [ ] 更多 Skills：驅動更新、防毒掃描、軟體移除

---
> 📝 這是一支不需要黑綠色文字終端，便能聰明幫你管理系統操作的助手。
