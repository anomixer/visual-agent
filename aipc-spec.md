# AI PC Agent — 實作需求規格書 (2026.03.17)

> 本地優先、無命令列、具備感知能力的 Windows 系統管家

---

## 1. 專案願景

打造一個「**本地優先、無命令列、具備感知能力**」的系統管家。目標是取代傳統複雜的裝機流程，實現「一句話（對話）或一鍵」完成所有系統優化、軟體安裝、硬體監控與資料保護。

---

## 2. 目前實作狀態 ✅

### 2.1 UI 架構（Multi-tab + VS Code）

```
┌─────────────────────────────────────────────────────────────┐
│ TitleBar  [檔案][檢視][說明]  ──  [●AI就緒]  ── [☀️↓↑] │
├────────────┬──────────────────────────┬─────────────────────┤
│ [搜尋...]   │ [🎨 Chalkboard] [📋 工作] │                     │
│  💡 推薦清單 │ ─────────────────────── │   💬 AI 對話        │
│  (sidebar) │     (Tab Content)        │   [🗑️ 清除]          │
│  ←→ drag  ─┤──────────────────────────│  ←→ drag            │
│            │  📖 工作日誌   ↕ drag     │  [使用者輸入框]      │
├────────────┴──────────────────────────┴─────────────────────┤
│ StatusBar  [🟢 AI就緒] │ [N個任務]              [v2026.03.17] │
└─────────────────────────────────────────────────────────────┘
```

- **分頁系統**：中間區域採用 Chrome 風格分頁，Chalkboard 為常駐分頁。
- **完全去 Terminal 化**：嚴禁顯示黑底白字 CMD/PowerShell 視窗
- **所有面板邊界可拖拉**調整大小，佈局持久化到 `localStorage`
- 深色主題為主，支援切換淺色模式

### 2.2 核心功能模組

| 模組 | 狀態 | 說明 |
|------|------|------|
| **SOP 執行引擎** | ✅ | 解析 `.md` SOP 腳本，執行 Check/Install/Verify 三階段 |
| **推薦清單** | ✅ | 動態偵測已有 SOP → 顯示 ⚡ 可自動執行，支援項目搜尋與安裝態沉底排序 |
| **工作清單** | ✅ | 任務 CRUD，進度條，狀態標籤，具備 Tab 分頁與 Badge 提醒 |
| **AI 對話** | ✅ | 本地 LLM，支援 Markdown 渲染、語音朗讀 (TTS) 與清除紀錄 |
| **AI 整合** | ✅ | qwen3.5:4b，`/api/chat` 格式，支援 OpenAI V1 與 API Key |
| **多輪對話** | ✅ | 支援最近 6 則對話 Context 記憶，支援追問 |
| **硬體健康監控** | ✅ | 圓圈式監控，支援 CPU/GPU/RAM/Disk 偵測與顯卡溫度 |
| **監控插件系統** | ✅ | 支援 `plugins/*.js` 動態擴充監控項目，自動同步至 AppData |
| **AI Provider 設定** | ✅ | 支援 20+ 種雲端與地端 Provider，自動帶入 Base URL，儲存於 AppData |
| **互動安全機制** | ✅ | 「先問後做」攔截、按鈕式建議 (SUGGEST)、對話中斷 (AbortController) |
| **自動初始設定** | ✅ | 新手友善！全新電腦啟動後，全自動於背景安裝 Ollama 與下載地端模型（qwen3.5:4b） |
| **啟動啟始畫面** | ✅ | 首次執行顯示「環境設定中」，再次執行顯示「伺服器啟動中」，自動淡出 |
| **UTF-8 編碼修復** | ✅ | PowerShell 輸出正確顯示中文，使用 `chcp 65001` 和 UTF-8 編碼 |
| **執行日誌** | ✅ | Mono 字體，依等級顯示色（info/warn/error/success），支援進度條原地更新 |
| **語音輸入** | ✅ | Web Speech API，中文語音轉文字 |
| **主題切換** | ✅ | Dark / Light，localStorage 記憶 |
| **風險預警提示** | ✅ | 歡迎畫面加入安全風險提示，提醒查證指令 |
| **EXE 一鍵打包** | ✅ | `.bat` 腳本全自動下載 Node/Rust/TauriCLI 依賴，將 Node Server 封裝成 Tauri Sidecar |

### 2.3 SOPs 庫

| SOP ID | 功能 | 狀態 |
|----------|------|------|
| `rec_install_ollama` | 安裝 Ollama 本地 AI 引擎 | ✅ |
| `rec_pull_llm_model` | 下載 qwen3.5:4b 模型 | ✅ |
| `rec_install_chrome` | 靜默安裝 Google Chrome | ✅ |
| `rec_remove_copilot` | 移除 Windows Copilot | ✅ |
| `rec_backup` | 建立系統還原點 | ✅ |
| `sys_lang_ja_jp` | 安裝日文語系 | ✅ |
| `rec_office` | 安裝 LibreOffice 辦公套件 | ✅ |
| `rec_steam` | 安裝 Steam 遊戲平台 | ✅ |
| `rec_driver_check` | 檢查與下載 Windows Update 與驅動 | ✅ |

### 2.4 技術架構

```
browser ──── public/index.html
             public/style.css   (VS Code 設計系統)
             public/app.js      (前端邏輯 + resize)
                 │
                 │ HTTP (localhost:3210)
                 ▼
             src/server.js      (Express API)
             src/llm.js         (Ollama 整合)
             src/sop-parser.js
             src/sop-executor.js
             src/system.js    (插件載入器)
                 │
                 │ Dynamic Load
                 ▼
             plugins/*.js     (硬體監控插件)
                 │
                 │ PowerShell / API
                 ▼
             sops/*.md        (SOP 腳本庫)
             %APPDATA%\aipc-agent\  (tasks.json, sops/, plugins/)
```
- **監控插件系統**：`src/system.js` 負責動態載入 `plugins/*.js` 中的監控腳本。這些腳本會自動同步到 `%APPDATA%\aipc-agent\plugins\` 目錄，並透過 PowerShell 或其他 API 介面獲取系統硬體資訊，實現可擴充的監控功能。

---

## 3. API 端點

| Method | Path | 功能 |
|--------|------|------|
| GET | `/api/todo` | 取得工作清單 |
| POST | `/api/todo` | 新增任務 |
| DELETE | `/api/todo/:id` | 刪除任務 |
| POST | `/api/execute/:id` | 執行任務 |
| GET | `/api/recommend` | 取得推薦清單（含 sopId）|
| GET | `/api/llm/status` | Ollama 狀態 + 模型就緒狀態 |
| GET | `/api/llm/config` | 取得 LLM Provider 設定 |
| POST | `/api/llm/config` | 更新 LLM Provider 設定 |
| POST | `/api/chat` | AI 對話（LLM 優先）|
| GET | `/api/logs` | 全域執行日誌 |
| POST | `/api/import` | 匯入任務清單 |

---

## 4. SOP 腳本格式

```markdown
1. 基本資訊 (Metadata)
ID: sop_id
名稱: 顯示名稱
分類: 分類名稱
風險等級: 低|中|高

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11
權限: 一般使用者 | 需要 Administrator
網路: 否 | 必須

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell):
```powershell
# 回傳 $true 表示已完成，跳過安裝
$false
```

第二階段：安裝 (Install)
指令 (PowerShell):
```powershell
UI 顯示內容: 「人類可讀的進度說明」
# 實際 PowerShell 指令
```

第三階段：驗證 (Verify)
指令 (PowerShell):
```powershell
# 回傳 $true 表示成功
$true
```

4. 自動排錯邏輯 (Error Handling)
錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80070005,沒有管理員權限,1. 請求以系統管理員身分執行
```

SOPs 存放位置：
- 開發時：`sops/*.md`
- 執行時：`%APPDATA%\aipc-agent\sops\*.md` (SOP 腳本庫)

---

## 5. 未來規劃

### 短期
- [ ] SOP 線上商城，動態下載更新
- [ ] 更多 SOPs：防毒掃描、軟體移除

### 中期
- [ ] SOP 線上商城，動態下載更新
- [ ] 任務排程（定時執行）
- [x] Tauri 打包為獨立桌面應用程式 (`build.bat`)

### 長期
- [ ] 多輪語意理解（RAG over sop library）
- [ ] 硬碟壽命預警、主動通知

---

> 📝 這是一支不需要黑綠色文字終端，便能聰明幫你管理系統操作的助手。
