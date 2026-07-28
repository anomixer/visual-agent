# Visual Agent — 實作需求規格書 (2026.07.28 Updated)

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
│ StatusBar  [🟢 AI就緒] │ [N個任務]              [v2026.7.28] │
└─────────────────────────────────────────────────────────────┘
```

- **分頁系統**：中間區域採用 Chrome 風格分頁，Chalkboard 為常駐分頁。
- **完全去 Terminal 化**：嚴禁顯示黑底白字 CMD/PowerShell 視窗
- **所有面板邊界可拖拉**調整大小，佈局持久化到 `localStorage`
- 深色主題為主，支援切換淺色模式
- **國際化支援**：完整中英雙語 UI，AI Engine Settings dialog 與 AI chat 根據語系自動切換

### 2.2 核心功能模組

| 模組 | 狀態 | 說明 |
|------|------|------|
| **SOP 執行引擎** | ✅ | 解析 `.md` SOP 腳本，執行 Check/Install/Verify 三階段 |
| **推薦清單** | ✅ | 動態偵測已有 SOP → 顯示 ⚡ 可自動執行，支援項目搜尋與安裝態沉底排序 |
| **SOP 清單** | ✅ | 左側 sidebar tab，列出全部 SOP，支援搜尋、加入任務、立即執行 |
| **工作清單** | ✅ | 任務 CRUD，進度條，狀態標籤，具備 Tab 分頁與 Badge 提醒 |
| **AI 對話** | ✅ | 本地 LLM，支援 Markdown 渲染、語音朗讀 (TTS) 與清除紀錄 |
| **AI 整合** | ✅ | 支援多種 Provider，自動參數配對，支援 Ollama Native API |
| **多輪對話** | ✅ | 支援記憶 6 則對話，自動注入 SOP 目錄、任務進度與硬體簡報情境 |
| **效能優化** | ✅ | 背景任務並行化與模型狀態快取，聊天回應延遲幾乎降至 0 秒 |
| **硬體健康監控** | ✅ | 圓圈式監控，支援 CPU/GPU/RAM/Disk 偵測與顯卡溫度 |
| **監控插件系統** | ✅ | 支援 `plugins/*.js` 動態擴充監控項目，自動同步至 AppData |
| **AI Provider 設定** | ✅ | 支援 20+ 種雲端與地端 Provider，自動帶入 Base URL，儲存於 AppData |
| **互動安全機制** | ✅ | 「先問後做」攔截、按鈕式建議 (SUGGEST)、對話中斷 (AbortController) |
| **自動初始設定** | ✅ | 新手友善！全新電腦啟動後，全自動於背景安裝 Ollama 與下載地端模型（gemma4:e2b-it-qat） |
| **啟動啟始畫面** | ✅ | 首次執行顯示「環境設定中」，再次執行顯示「伺服器啟動中」，自動淡出 |
| **UTF-8 編碼** | ✅ | PowerShell 輸出正確顯示中文，使用 `chcp 65001` 和 UTF-8 編碼 |
| **執行日誌** | ✅ | Mono 字體，依等級顯示色（info/warn/error/success），支援進度條原地更新 |
| **語音輸入** | ✅ | Web Speech API，中文語音轉文字 |
| **主題切換** | ✅ | Dark / Light，localStorage 記憶 |
| **風險預警提示** | ✅ | 歡迎畫面加入安全風險提示，提醒查證指令 |
| **EXE 一鍵打包** | ✅ | `.bat` 腳本全自動下載 Node/Rust/TauriCLI 依賴，將 Node Server 封裝成 Tauri Sidecar |
| **Exp經驗庫** | ✅ | 自動累積任務經驗，支援搜尋、SOP 篩選、Hover 展開、匯出 Markdown，卡片按時間倒序 |
| **Chalkboard** | ✅ | 互動式 Chalkboard 畫布，支援粉筆、板擦、圖形、圖片、文字框、PNG 匯出、多模態 AI 理解 |
| **雙向 SOP** | ✅ | 安裝類 SOP 支援 install/uninstall 雙向動作，UI 自動切換 |
| **多來源軟體推薦** | ✅ | 支援 winget、Microsoft Store、GitHub Releases 三大來源，AI 可自動產生 SOP |

### 2.3 SOPs 庫

| SOP ID | 功能 | 狀態 |
|----------|------|------|
| `rec_install_ollama` | 安裝 Ollama 本地 AI 引擎 | ✅ |
| `rec_pull_llm_model` | 下載 gemma4:e2b-it-qat 模型 | ✅ |
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
             sops/<slug>/SOP.md        (SOP 腳本庫)
             %APPDATA%\visual-agent\  (tasks.json, sops/<slug>/SOP.md, plugins/)
```
- **監控插件系統**：`src/system.js` 負責動態載入 `plugins/*.js` 中的監控腳本。這些腳本會自動同步到 `%APPDATA%\visual-agent\plugins\` 目慶，並透過 PowerShell 或其他 API 介面獲取系統硬體資訊，實現可擴充的監控功能。

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

## 4. SOP 與 Skills 腳本格式 (AgentSkills.io 相容)

### 4.1 Skills 腳本規範
Skills 的目錄架構與 `SKILL.md` 的語法，**嚴格遵守 [agentskills.io/specification](https://agentskills.io/specification)** 規範。
這確保了我們寫的 Skills 不僅能在 Visual Agent 本身運作，**也能與生態系中其他遵循同一標準的 AI Agent 互相相容與共享**。

- 目錄格式：`skills/<slug>/SKILL.md`
- Markdown 頂端必須具備合規的 YAML Frontmatter：
  ```yaml
  ---
  name: tool-slug-name
  description: 告訴 AI 何時該使用這個技能，以及這個技能的關鍵字
  license: MIT
  compatibility:
    - windows
  metadata:
    tags: ["system", "tool"]
  ---
  ```

#### 4.1.1 Skills 來源（source）欄位
- `source: visual-agent`（預設）：Visual Agent 原生 skill，針對 Windows 本地操作優化。
- `source: hermes-agent`：從 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) 轉換而來，涵蓋更廣泛的 AI/開發/創意領域（共 19 個）。

**重要澄清**：Skills（無論來源）均屬於 **AI 知識增強層**，不含可執行步驟。若需執行系統操作，請使用 **SOP**。

| 類型 | 目的 | 可執行 | 觸發方式 |
|------|------|--------|----------|
| Skill | AI 知識增強 | ❌ | AI 對話時按需注入 |
| SOP | 系統操作腳本 | ✅ | 工作清單執行 |

### 4.2 SOP 腳本規範
SOP 同樣延續目錄化精神 (`sops/<slug>/SOP.md`)，但內部為我們獨有的 Check / Install / Verify 三段式強固結構：

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
*(為排版顯示，上述反引號中加入了空白，實際使用時需移除空白)*

存放與掃描位置：
- 開發時：`skills/<slug>/SKILL.md` / `sops/<slug>/SOP.md`
- 執行時：`%APPDATA%\visual-agent\skills\` / `%APPDATA%\visual-agent\sops\`

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

## 6. 2026.03.24 AI Provider 與 SOP 穩定性修正

### 6.1 Provider 模型
- OpenAI-compatible provider 使用 Bearer 認證與 `/chat/completions`。
- Anthropic Claude 使用原生 headers 與 `/v1/messages`。
- Ollama、vLLM、SGLang、LM Studio 等本地引擎預設維持無認證。
- Customer Provider 支援 API Key 與 OAuth 2.0 Client Credentials。

### 6.2 Runtime 規則
- 任務完成時，必須在 AI 對話區回報 `success`、`failed`、`skipped`。
- Runtime 必須依 `id` 去重 SOP，並優先採用正式檔名，不使用 `Copy` 類副本。
- 內建 SOP、skill、plugin 在內容變更時，需同步至 `%APPDATA%\visual-agent\`。

### 6.3 執行器契約
- `Check` 回傳 `true` 表示可跳過；即使同時有提示文字，執行器仍需辨識布林值。
- `Verify` 在 PowerShell 非零結束碼或 stdout 明確為 `false` 時，必須判定失敗。
- PowerShell 啟動包裝不可使用可能對 `nul` 或裝置處理失敗的 shell 寫法。

### 6.4 SOP 撰寫規則
- 不可在 `Get-Command` 後直接用 `Test-Path "command-name"`，應先解析執行檔實際路徑。
- `Check` 應為無副作用。
- `Verify` 應回傳明確成功或失敗訊號；硬失敗時優先使用 `throw`。
- 依賴本地服務的安裝流程，除了驗證執行檔，也需驗證服務可用性。

### 6.5 工作日誌與版本同步
- 工作日誌僅在畫面已停留底部時才自動捲動。
- 進度型日誌輸出應合併為單列更新。
- 狀態列版本需由 runtime metadata 自 `package.json` 取得，不可寫死在 HTML。

## 6.6 2026.03.24 EXE 啟動與匯出行為

- Tauri 不可因同步啟動 sidecar 而阻塞初始視窗渲染。
- Splash 文案必須在 `app.js` 載入完成前即可顯示。
- 首次執行文案：`首次執行本程式，正設定環境中，請稍候...`
- 後續執行文案：`啟動後端伺服器中，請稍候...`
- 在封裝 EXE 模式下，任務匯出應優先使用原生另存新檔流程，而非瀏覽器下載語意。

## 6.7 2026.03.24 硬體上下文與語系 SOP 拆分

- AI 硬體上下文必須包含 CPU、GPU、RAM、磁碟健康與磁碟剩餘空間。
- 在 NVIDIA 系統上，runtime 應優先使用 `nvidia-smi` 的結構化資訊，而不是只依 GPU 名稱做摘要。
- 語言包 SOP 必須依 locale 拆分：`en-US`、`zh-TW`、`zh-CN`、`ja-JP`。
- 語系 SOP 必須 append 到 `Get-WinUserLanguageList`，不可覆蓋既有使用者語言清單。
- 語言安裝遇到 access denied 時，必須在 install 階段直接 fail，不可只在 verify 階段暴露錯誤。

## 6.8 2026.03.24 共用 UAC 提權規則

- 執行器必須提供共用的 elevated runner，供所有需要管理員權限的 SOP 重用。
- 當 SOP 的權限需求標記為 `Administrator`、`Admin` 或 `UAC` 時，install 階段應自動以 `RunAs` 方式提權。
- 使用者取消 UAC 時，runtime 必須回報失敗，不可進入自動重試。
- 語系 SOP 的安裝偵測不可假設 `Get-InstalledLanguage` 一定存在 `LanguageId` 欄位，需容忍欄位差異。

## 6.9 2026.03.25 知識庫視覺進化、視窗持久化與硬體感知強固

- **經驗庫視覺微調**：
  - 卡片密度更高，摘要預設限制顯示 3 行，滑鼠懸停 (Hover) 時自動展開完整內容。
  - 新增「⬇ 匯出」按鈕，支援將所有累積的經驗一次匯出為單一 Markdown 文件。
  - 卡片左側加入深紫色狀態條，區分不同 SOP 的執行記錄。
- **Ollama 非提權安裝**：修正 Ollama 安裝 SOP，改為預設不觸發 UAC，依賴 winget 本身的 user mode 安裝。
- **模型資訊修正**：將 Qwen3.5 全面更新為 4B 版本，下載容量描述修正為 2.6GB。
- **視窗持久化**：導入 `tauri-plugin-window-state`，自動記憶上次視窗大小與位置。預設首次啟動以最大化 (maximized) 呈現。
- **硬體感知強固**：
  - `hardware-info.js` 優先採用 `nvidia-smi` 數據。
  - 加入 PowerShell 計數器 fallback 機制，避免 `Get-Counter` 在權限不足或 Tauri 環境下崩潰導致顯示失效。

## 6.10 2026.03.25 Tauri EXE 封裝體驗與指令除錯

- **硬體偵測引號跳脫**：修正了 Tauri 打包環境下 PowerShell 指令字串因雙引號干擾 (`"DriveType=3"`) 導致的執行錯誤，確保磁碟狀態與 GPU 負載能正常回傳。
- **原生匯出圖片 API**：新增 `/api/chalkboard/export-file` 端點，以 PowerShell 呼叫 `SaveFileDialog` 來實作「另存新檔」，徹底解決 Tauri EXE 中無法透過 Data URI 與虛擬連結下載圖片的限制。

## 6.11 2026.03.26 國際化完善與經驗庫卡片排序修正

- **AI Engine Settings Dialog 國際化**：修正 dialog 中的硬編碼中文標籤，改為根據 `currentLocale` 動態翻譯，確保英文模式下完全無中文殘留。
- **AI Chat System Prompt 語系感知**：確認後端 `/api/chat` 會接收前端傳遞的 `locale` 參數，並傳遞給 `buildFullSystemPrompt()`，使 AI 在英文模式下回覆英文。
- **經驗庫卡片倒序**：修正 `renderExps()` 函數，現在卡片會按 `updatedAt` 時間戳倒序排列，最新的經驗記錄會顯示在最前面。
- **經驗庫時間格式國際化**：經驗庫卡片中的時間戳現在會根據 `currentLocale` 自動切換為 `en-US` 或 `zh-TW` 格式。
- **經驗庫空狀態文案國際化**：「找不到符合條件的經驗」與「尚未累積安裝經驗」改為根據 locale 翻譯。

### Chalkboard 工具 i18n
- **工具按鈕翻譯**：粉筆顏色（白、紅、黃、綠、藍）、筆刷大小（細、中、粗）、形狀工具（選取、直線、矩形、圓形、文字）、編輯操作（複製、剪下、貼上、清空、Undo）、上傳圖片、存成圖片
- **文字工具 Modal 翻譯**：標題、所有標籤、佔位符、幫助文本、按鈕
- **文字工具選項翻譯**：字型風格（粉筆手寫、板書感、清晰無襯線、經典襯線、等寬打字）、對齊方式（靠左、置中、靠右）
- 所有翻譯根據 `currentLocale` 動態更新，支援中英無縫切換

### 座標系統修復
- **簡化 `getChalkInputRect()`**：直接使用 canvas 的 `getBoundingClientRect()`，移除複雜的邊框計算
- **修復選擇工具偏移**：選擇框座標計算現在正確對應 canvas 內容區域
- **修復文字工具偏移**：文字框和 8 點控制點現在位置準確，落稿不再有偏移

### 中文字寬度補償
- **`measureChalkTextWidth()` 修復**：為中文字添加 5% 的寬度補償，使用正則表達式 `/[\u4e00-\u9fff]/` 檢測
- **`createTextPreviewCanvas()` 修復**：在計算對齊位置時也考慮中文字的補償係數
- **結果**：中文字落稿時不再出現偏移現象，英文字不受影響

## 6.12 2026.03.28 國際化修補

### 深度國際化修補
- **Provider 幫助文案**：修正 `PROVIDER_HELP` 在切換語系時未動態覆蓋的問題，支援英文與中文提示。
- **測試模型邏輯 i18n**：`btnTestProviderSettings` 與系統提示 (`alert`, `addUILog`) 實作語系判定，在英文模式下精確顯示 `Testing...`、`Test successful`。
- **架構潔淨化**：移除冗餘的 `*.i18n.js` 與 `*_test.txt` 測試檔案，統一收斂到原生代碼層級。

### 頂部菜單進化
- **File Menu 實作**：在標題列 `檔案` 展開支援 absolute 排版的下拉選單，包含 `匯入任務清單`、`匯出任務清單`、`Refresh畫面`、`Exit`，完整取代舊有的散落按鈕。

## 6.13 2026.03.29 Chalkboard Resize Chalkboard 縮放修補

- **Resize 觸發時機**：sidebar、chat 與 log panel 三個 resizer 的 setSize callback，確認目前在 chalkboard 分頁時呼叫 `resizeChalkboardCanvas()`，確保畫布大小與視窗同步。
- **pendingTextRect 座標修正**：`resizeChalkboardCanvas()` 在改變新畫布寬高前儲存 `cssWidth / cssHeight`，於 resize 後重新計算縮放比例，更新 `pendingTextRect` 的 `left / top / width / height`，以呼叫 `syncPendingTextBox()`。確保縮放視窗時，尚未確定的文字框與 8 個控制點會跟隨著 canvas 縮放，不會跑位。

## 7. 遠端實體與通訊 (Remote Agent & Communication)
### 7.1 協定與連接埠
- **TCP 19168**：用於遠端 AI 與遠端使用者的點對點連線。
- **通訊協定**：自訂 JSON Line Protocol (hello, chat_message, screen_share, disconnect)。

### 7.2 身份與連線授權
- 連線建立前，需透過 Popup 要求使用者同意或拒絕 (Connection rejected by remote user)。
- 自動獲取本機 Machine Name, Username, Local IP 進行身份廣播與 Prompt 注入。

### 7.3 會話管理與代理 (Session & Model Proxy)
- **多對話 (Multi-session)**：支援本機與遠端對話歷史分頁，以及獨立的 Pending (Thinking) 列。
- **Model Sharing**：A 端同意接受 B 端分享之模型後，A 端 UI 將改用 B 端 API (利用 Session Token 驗證)。
- **@mention 機制**：透過 `@` 啟動對象名單，點名遠端 AI 即可讓遠端模型介入回答。

## 8. 2026.04.10 已修復問題 (Runtime Fixes)

### 8.1 Tauri EXE GPU/HDD 偵測
- `plugins/hardware-info.js` 改為以 PowerShell `EncodedCommand` 執行，避免封裝環境下引號/編碼導致的指令失敗。
- 磁碟偵測新增 fallback：`Get-PhysicalDisk` 失敗時改讀 `Win32_DiskDrive`，確保 HDD/SSD 資訊能回傳。
- `plugins/temperature-monitor.js` 改用 `execFile` 執行 `nvidia-smi.exe`，並加入 NVSMI 絕對路徑 fallback。

### 8.2 nvidia-smi 亂碼訊息
- 錯誤訊息改為以錯誤碼摘要（如 `ENOENT`），不直接吐出本地碼頁原文，避免中文亂碼污染 log。

### 8.3 Chalkboard 8 點框與落稿座標
- `getChalkPoint()` 將座標正規化後 clamp 到 0~1，修正邊界滑動造成的座標漂移。
- `drawPlacedText()` 改為以 8 點框尺寸直接落稿，不再額外擴張到 base size，確保「游標位置 / 8 點框 / 最終落稿」一致。

### 8.4 本機聊天分頁化 (Local Chat Tabs)
- 本機聊天由單一入口改為多對話 tab 管理，保留遠端聊天 tab。
- 新增本機對話 tab 後可個別關閉（`x`），並保留至少一個本機對話以避免空狀態。
- `新增對話` 按鈕移至輸入工具列，位於「清除對話」左側，符合高頻操作路徑。

### 8.5 Chalkboard Resize 重繪與座標重算
- resize 後需同步重算 `pendingTextRect`、`selectionRect` 與互動點位（`dragStart` / `hoverPoint` / `dragPresetEnd`）。
- resize 觸發時重建 pending 文字 preview canvas，避免字體被快照縮放造成糊化。
- 規範：落稿座標應以當前框體與當前畫布尺度為唯一來源，不可混用舊快照像素比例。

### 8.6 Chalkboard 8 點框縮放與游標對齊
- 文字框 8 點控制點在左右縮放時，邊界計算改為使用當前游標絕對位置（而非舊版位移累加），確保控制邊與游標貼齊。
- 若縮放進行中遇到畫布 resize，必須同步更新 `textManipulation` 內的 `originPoint`、`originRect`、`anchorLeft/Top/Right/Bottom`，避免框體偏移。
- 文字預覽在縮放過程中必須依 `pendingTextRect` 內部可用區域動態重算 `fontSize` 與 `lineHeight`，確保框體、預覽與最終落稿一致。

### 8.7 Desktop Agent 工作流（SOP Beyond Install/Uninstall）
- Runtime 必須支援「檢查環境 → 補足依賴 → 擷取資料 → 實際操作 → 回報結果」的多步代理流程。
- 新增財報工作流規格：
  - 觸發條件：使用者要求更新 `*.xlsx` 財報內容（例如 NVIDIA）。
  - 先檢查試算表工具（Excel/LibreOffice/WPS）。
  - 若無工具：引導使用者在「安裝 Office SOP」與「Google Sheets web」間做選擇。
  - 若有 Excel：允許透過 COM 自動寫入工作表。
  - 財報資料來源需附上可追溯網址（目前為 SEC API）。
- 新增遊戲研究工作流規格：
  - 觸發條件：攻略/教學/影片搜尋需求。
  - 輸出格式需為 Markdown，並附 `Chalkboard 摘要草稿` 便於視覺呈現。
- 協議擴充：
  - `[ACTION:OPEN_FILE file_path="..."]`
  - `[ACTION:OPEN_URL url="..."]`

### 8.8 Browser Use / Computer Use 架構分級
- **Level-1 內宇宙（Browser Use）**：
  - API：`POST /api/agent/browser-use`
  - 模式：`open`、`search`、`fetch_title`
  - 用途：Web 搜尋、頁面導覽、內容擷取。
- **Level-2 外宇宙（Computer Use）**：
  - API：`POST /api/agent/computer-use`
  - 模式：`open_file`、`open_url`、`install_sop`
  - 用途：本機 App 操作、檔案開啟、SOP 任務調度。
- **能力門檻**：
  - API：`GET /api/agent/capability`
  - 條件：`vision capable` + `top-tier model` 才可啟用 Browser/Computer Use。

### 8.9 財報 xlsx 自動寫入能力
- 寫入引擎採多策略 fallback：
  1. Excel COM
  2. WPS COM
  3. OpenXML 直接寫入 `xl/worksheets/sheet1.xml`
- 規範：寫入結果需回報方法（method）與來源連結（source URL）。

### 8.10 Chalkboard Agent Draft API
- API：`POST /api/chalkboard/draft`
- 輸入：`title`、`bullets[]`
- 輸出：標準化 draft（含 timestamp）
- 前端行為：收到 `chalkboardDraft` 後可直接渲染到 Chalkboard，不需人工重打。
- 渲染規範：AI 寫入前必須先清板，並以粉筆字重畫；需根據包行後實際行數計算 Y 位移，避免文字重疊。

### 8.11 內宇宙 / 外宇宙行為約束
- 內宇宙（Browser Use）：
  - 目標：資源取得與瀏覽器內編輯。
  - 優先用於搜尋、導覽、讀取、頁面內容處理。
- 外宇宙（Computer Use）：
  - 目標：桌面與 App 層級操作。
  - 預設先準備 VM sandbox（例如 VirtualBox）再執行任務，以降低對主機環境干擾。
  - 只有必要時才允許直接對主機進行操作。

### 8.12 Skills / SOP Context 載入策略
- 預設不得將全部 Skills/SOP 全量放入 system prompt。
- Runtime 需依使用者當前請求進行相關性匹配，僅注入少量關鍵 Skill/SOP 摘要（on-demand context）。
- 若無匹配 Skill/SOP：
  - 優先使用 Browser Use 進行可信來源查詢；
  - 或回傳可執行的手動指引與下一步建議。

### 8.13 Browser Runtime 依賴與動態載入
- Browser tab 與 Browser Use 預設使用 Playwright Chromium session。
- Chromium 不再打包進 MSI / EXE，改由 UI 一鍵引導執行 `install-playwright-chromium` SOP 按需事後補裝。
- 若 Chromium 尚未就緒，UI 將隱藏 Browser 分頁。
- 安裝條件與完成偵測不再僅檢查資料夾，必須精確驗證實際的 `chrome-headless-shell.exe` 或 `chrome.exe` 執行檔是否存在，並由 `/api/meta` 回報 `browserExecutable`。
- 一旦安裝完成，無需重啟程式，Browser 分頁即會自動顯示。

### 8.14 Planner -> Builder -> Learn 工作流
- **Planner (規劃)**: AI 在處理任何複雜需求前，會優先返回規劃（Planner）回應，向使用者總結意圖並提出後續執行的步驟。
- **Builder (執行)**: 在獲得使用者的明確批准（Consent-First）後，系統才會調用對應的 SOP、Browser Use 或 Computer Use 進入執行階段。
- **Learn (學習)**: 任務執行結束後，系統會記錄成功的途徑與遇到的錯誤，並撰寫簡短的 Exp（經驗日誌）保存為知識庫。當模式趨近穩定，則能昇華並封裝成新的 SKILL 或 SOP 永久留存。
- **On-demand Context (按需載入)**: 確保所有 Skills、SOPs 與 Exp 僅在被情境命中時才動態載入至 System Prompt 內，減少資源消耗與干擾。

## 9. 2026.05.05 遠端協作與版本同步

### 9.1 版本
- Runtime 版本號更新為 `2026.05.05`，來源仍以 `package.json` 維持單一真相。

### 9.2 遠端模型共享資訊
- `2026.05.05` 曾要求 `model_share_request` 攜帶 `modelInfo` 並在確認視窗顯示模型資訊。
- 此功能已於 `2026.05.06` 移除；保留舊協定欄位僅作相容，不再提供 UI 入口或模型接管。

### 9.3 Chalkboard 協作同步
- 遠端會話新增 `chalkboard_state` 訊息，用於傳送目前 Chalkboard 快照。
- 任一方使用者或 AI 改寫 Chalkboard 後，另一方必須能看到同步結果。
- 同步需採 idle debounce：Chalkboard有繪製、拖曳、文字框、圖片放置等互動時暫停傳送與套用，互動停止約 1 秒後才同步最新畫面。
- 遠端連線建立後，中間區域應自動切到 Chalkboard tab。

### 9.4 遠端 AI 思考狀態
- 遠端協定新增 `ai_status` 訊息，狀態值為 `thinking` 或 `idle`。
- 本地 AI 推理時 UI 顯示 `本地 AI: 思考中`；遠端 AI 推理時 UI 顯示 `遠端 AI: 思考中`。
- 推理完成、失敗或中斷時狀態必須回到 `待命`。

## 10. 2026.05.06 遠端協作簡化與對話邊界

### 10.1 版本
- Runtime 版本號更新為 `2026.05.06`。

### 10.2 畫面傳送語意
- UI 文案使用「傳送畫面」而非「分享畫面」，明確表示這是單張畫面擷取，不是 live stream。
- 呼叫系統畫面擷取前，應先顯示本 App 自訂提醒：對方將能查看你分享的畫面內容，請勿分享機敏資訊。

### 10.3 移除模型共享入口
- UI 不再提供「分享模型」按鈕與模型分享確認流程。
- 本機一般聊天不再透過 `preferRemoteModel` 自動改走遠端模型代理。
- `/api/remote/session/:sessionId/model-share/*` 與 `/api/remote/model-proxy/chat` 停用並回傳 `410 Gone`。
- 遠端連線後，雙方仍可透過遠端聊天室直接呼叫本地 AI 與遠端 AI 分工。

### 10.4 Double Agent Mode 分工
- 遠端聊天室未指定對象時，流程預設為：本地 AI 先產生輔助筆記，再交由遠端 AI 彙整並回覆人類。
- 若使用者明確指定 `@本地 AI` 或 `@遠端 AI`，則只呼叫指定 AI。
- AI 對 AI 訊息應視為隊友筆記，遠端 AI 負責產出最終回覆，不應互相爭辯或重複搶答。

## 11. 2026.05.13 遠端協作與工具列規格

### 11.1 版本
- Runtime 版本號更新為 `2026.05.13`。

### 11.2 Chalkboard 分工
- AI 應主動將計畫、比較、查詢摘要與多步驟結果寫入 Chalkboard。
- 本地 AI 使用 `position: left`；遠端 AI 使用 `position: right`；遠端協作時預設 `clear:false`。

### 11.3 遠端硬體查詢
- 遠端聊天室中若使用者詢問「自己 / 本機」硬體、磁碟或 free space，需由本地 AI 回答。
- 回覆必須明確標示 PC name，避免把對方電腦資訊誤當本機資訊。

### 11.4 Chat UI
- 本機工具列順序為：新增對話、附上 Chalkboard、清除對話；麥克風位於送出鈕上方。
- 本機對話 tab 為 chip 樣式，右上角可關閉。
- 遠端連線設定為可收合抽屜；遠端工具列提供新增對話、附上檔案、掛電話中斷。

## 12. 2026.05.20 版本與遠端驗收補強

### 12.1 版本
- Runtime 版本號更新為 `2026.05.20`。
- 狀態列與 `/api/meta` 顯示版本仍以 `package.json` 為單一真相來源。

### 12.2 Remote 驗收基準
- 遠端協作調整後，至少需固定驗證三條流程：`SUGGEST`、`INSTALL_SOP`、`Double Agent Mode（本地先回、遠端後補）`。
- 驗收時應確認 UI log 能看見 directive receipt、task reuse / start、以及 remote follow-up 的成功或失敗訊息。

### 12.3 重複指令抑制
- 若遠端 AI 在短時間內重複送出相同 directive，前端應略過重跑並留下 `Skipped duplicate remote directive` 診斷訊息。
- directive receipt log 應包含 `msg:<id>`，方便對照遠端訊息是否重送。
- 遠端身份欄位只在使用者修改後才啟用儲存，不得被 polling 立即還原。

## 13. 2026.05.21 Remote 協作穩定性規格

### 13.1 版本
- Runtime 版本號更新為 `2026.05.21`。
- 狀態列與 `/api/meta` 顯示版本仍以 `package.json` 為單一真相來源。

### 13.2 AI Timeout 與 Queue
- LLM chat request 必須有明確 timeout，目前規格為 3 分鐘。
- Remote AI per-session queue 不得因單一回覆長時間卡住而永久阻塞；逾時後必須釋放 queue 並產生可見錯誤訊息。

### 13.3 Remote Chat 視覺區分
- Remote User、Remote AI、remote system message 的 bubble 底色必須與本機聊天不同。
- Remote chat 仍需保留 sender label，讓使用者能辨識是哪一台電腦 / 哪個 Windows 使用者。

### 13.4 硬體查詢歸屬
- 在 remote 模式下，磁碟容量、RAM、CPU、GPU 等硬體問題，若未明確指定「對方 / 遠端 / remote / peer」，預設由 Local AI 回答。
- 若使用者明確指定對方電腦，才可交給 Remote AI 查詢或回答對方機器資訊。

### 13.5 Chalkboard 同步與歷史
- Remote session 首次進入 active 後，若本機 Chalkboard 已有使用者內容，必須主動送出一次目前 snapshot。
- 接收遠端 Chalkboard snapshot 時不得清空 redo stack，避免 undo 後同步造成使用者無法 redo 檢視歷史內容。

## 14. 2026.05.28 Browser Use 即時查詢規格

### 14.1 版本
- Runtime 版本號更新為 `2026.05.28`。
- 狀態列與 `/api/meta` 顯示版本仍以 `package.json` 為單一真相來源。

### 14.2 工具邊界
- Browser Use 是網路資源取得與瀏覽器內導覽工具。
- Computer Use 是桌面、App、檔案、SOP 等本機操作工具，不得作為一般網路搜尋工具。

### 14.3 即時資訊策略
- 天氣、物價、新聞、股價、匯率、最新版本、店家與行程等即時資訊，AI 必須優先使用 Browser Use。
- AI 不得只回「找不到」或要求使用者手動搜尋；若本地知識不足，應先用 Browser Use 取得可信來源與連結。
- Browser Use `search` 模式若 server-side HTML fetch 失敗或解析不到結果，必須 fallback 到 Playwright Chromium 真瀏覽器搜尋並解析 DOM。

### 11.5 Skills 與 Action
- Sidebar 必須提供 Skills 清單，來源為 `skills/<slug>/SKILL.md`。
- Action parser 必須支援 `[ACTION:...]` 與 `Action=Computer_Use...`。
- Browser Use / Computer Use 執行後必須回傳可見摘要。

### 10.5 斷線提示
- 遠端 session 進入 `disconnected` 時，本地聊天窗需顯示「對方已斷線」。

### 10.6 一般對話
- System prompt 必須允許一般聊天、知識問答、創作與非系統操作話題。
- 只有使用者明確談到電腦問題、軟體、安裝、維護、自動化或本 App 功能時，才引導到 SOP / 安裝 / Agent 工作流。

## 15. 2026.06.03 Observe-after-Act 與建議按鈕規格

### 15.1 版本
- Runtime 版本號更新為 `2026.06.03`。
- 狀態列與 `/api/meta` 顯示版本仍以 `package.json` 為單一真相來源。

### 15.2 日期上下文
- `/api/chat` 每輪必須注入 runtime date context，包含今天、明天與時區。
- AI 回答今天、明天、昨天、最新、天氣、新聞、物價等相對時間問題時，必須使用 runtime date context，不得自行猜測舊日期。

### 15.2.1 Interim Plan
- 對攻略、搜尋、比較、規劃、安裝、設定、除錯、機票/物價/新聞/天氣等可能耗時的請求，前端必須先顯示簡短 interim plan，再等待 `/api/chat` 或工具流程完成。
- Interim plan 只是 UI 進度提示，不得寫入 local chat history，也不得取代正式 AI 回答。

### 15.3 即時資訊與 Browser Use fallback
- 天氣、物價、新聞、匯率、股價與最新資訊若模型未輸出 Browser Use action，後端必須自動補 current-info search。
- Browser Use runtime 或 Playwright Chromium 未安裝時，系統必須提示使用者安裝，並真的加入或沿用 `install_playwright_chromium` 工作清單任務。
- 使用者接著輸入「執行 / 開始 / 安裝 / run / start / execute」時，若有 pending 的 `install_playwright_chromium` 任務，後端必須保底回傳 `executeTaskId` 啟動該任務，不得讓 LLM 空轉等待。
- Browser Use runtime 未就緒時仍應盡量用文字/連結搜尋結果 fallback。
- 工具結果回來後必須進入 Observe-after-Act，直接整理最後答案，不得停在「資料取得後回報」。

### 15.4 Chalkboard 主動摘要
- 計畫、比較、查詢摘要、天氣/物價/新聞或偏長回答，若模型沒有輸出 `##CHALKBOARD##`，前端必須自動產生簡短 Chalkboard draft。
- Remote collaboration 下仍須遵守 local left / remote right 與 lane overwrite protection，避免互相覆蓋。

### 15.5 Suggestion Buttons
- LLM 產生的 suggestion buttons 預設停用。
- 系統不得在一般問答、天氣、新聞、物價等場景顯示與問題無關的安裝或 SOP 建議按鈕。

### 15.6 Provider Model List
- LM Studio 必須和 Ollama、NVIDIA NIM 一樣支援設定視窗「刷新清單」。
- 可提供 OpenAI-compatible `/models` 的 provider 應優先使用下拉清單選模型；抓不到清單時才 fallback 到手動輸入。

## 16. 遠端指令協議與驗收規範

### 16.1 遠端指令協議 (Remote Directive Protocol)

本專案支援遠端 AI 協作，雙方 AI 透過結構化指令（Directive）進行引導與自動化操作：

- **結構化建議按鈕 (Suggestion Buttons)**：
  ```text
  [SUGGEST: button_text="🟢 安裝 VS Code" action="install_sop" sop_id="vscode_install"]
  ```

- **建議動作標籤 (Preferred Action Tags)**：
  ```text
  [ACTION:ADD_TASK sop_id="..."]
  [ACTION:EXECUTE_TASK task_id="..."]
  [ACTION:INSTALL_SOP sop_id="..."]
  [ACTION:COMPUTER_USE mode="prepare_vm_sandbox|open_file|open_url|install_sop" ...]
  [ACTION:BROWSER_USE mode="search|open|navigate|fetch_title|extract_text|snapshot" ...]
  ```

- **Double Agent Mode 分流**：當同時涉及本地 AI 與遠端 AI 時，本地 AI 應優先回覆，遠端 AI 再行跟進（Follow-up），避免阻礙使用者對話。

### 16.2 遠端驗收基準 (Remote Validation Checklist)

在驗證遠端協作變更時，必須執行並通過以下三種典型情境流程：

1. **`SUGGEST` 流程**：
   - **預期結果**：遠端訊息能正確渲染出真實按鈕，按鈕在 polling 時不會閃爍；點擊後能建立或沿用任務，且 UI 執行日誌顯示 `Suggestion clicked`。
2. **`INSTALL_SOP` 流程**：
   - **預期結果**：`[ACTION:INSTALL_SOP sop_id="..."]` 能在本機被執行，UI 執行日誌會先顯示 `Remote AI directive received`，接著顯示 `Started SOP task` 或 `Reused SOP task`（若失敗則顯示明確錯誤）。
3. **Double Agent Mode 流程**：
   - **預期結果**：本地 AI 先行回覆，UI 執行日誌顯示 `Double Agent Mode: Local AI answers first, Remote AI follow-up queued`，隨後遠端 AI 的回覆在背景排程完成後出現，整體流程不阻塞。

### 16.3 其他診斷機制

- **重複指令抑制**：在短時間內收到的重複遠端 directive 將被忽略，並記錄 `Skipped duplicate remote directive`。
- **訊息追蹤識別**：指令接收日誌需包含 `msg:<id>` 標記，方便交叉對照是否為重複發送之遠端訊息。

---

## 17. 2026.06.09 完整國際化 (I18N) 與 UI/網路協定規格

### 17.1 雙語動態切換機制 (Bilingual UI Toggling)
- **零重載翻譯**：介面支援 `zh-TW` 與 `en-US` 雙語動態切換。
- **UI 元素涵蓋範圍**：工作清單、推薦清單、SOP 清單、AI Provider 設定視窗、Chalkboard 工具、經驗知識庫、以及系統對話視窗，皆需根據 `currentLocale` 即時更新。
- **對話分頁動態過濾**：
  - 本機與遠端聊天分頁名稱在切換語系時需動態翻譯（例如：「本機對話 1」 ↔ 「Local Chat 1」）。
  - 對話分頁的過濾與翻譯必須使用非 ASCII 安全的正則表達式 `/^(?:本機對話|Local Chat)(?:\s+\d+)?$/i`，嚴禁使用 `\b`（單字邊界符）以防止在中文等非 ASCII 字元上發生比對失效。

### 17.2 硬體指標與空狀態動態插補 (Hardware Stats & Empty States)
- **硬體統計資訊**：CPU 規格、GPU 機型、RAM/記憶體容量與百分比、硬碟 S.M.A.R.T 健康度（良好/Good）與磁碟空間，其輸出格式與字串需根據目前語系進行插補與翻譯。
- **空狀態保護**：
  - 任務清單當無項目時，需動態顯示 `"No tasks pending"` 或 `"目前沒有待辦任務"`。
  - 渲染工作清單時，必須保留或動態重建 `#todoEmpty` 節點，嚴禁使用直接將容器清空且不復原節點之做法（例如：直接執行容器的 `.innerHTML = ''` 而未重建 `#todoEmpty`）。

### 17.3 點對點連線語系傳遞 (P2P Locale Propagation Protocol)
- **協定欄位擴充**：雙機點對點 TCP Socket 連線下，`chat_message` 訊息之 payload 必須攜帶 `locale` 屬性。
  ```json
  {
    "type": "chat_message",
    "text": "How is the weather today?",
    "locale": "en-US",
    "timestamp": 1780938724186
  }
  ```
- **遠端 AI 語系適配**：遠端端接收到 `chat_message` 時，必須自 payload 中提取 `locale`，並在調用本地 LLM 及建構 System Prompt 時將該 `locale` 傳入，使遠端 AI 能精確使用發問者的介面語系進行回應。

### 17.4 本地預設語言模型規格
- **預設模型名稱**：使用 `gemma4:e2b-it-qat`。
- **體積與加載效能**：模型下載體積需限制於 1.1GB 左右。應用程式於首次執行或啟動檢測時，需自動以該模型進行背景下載與初始化，以實現極速加載與低資源消耗。
- **備份與自動匹配**：
  - `llm.js` 偵測與自動選取邏輯中，除預設的 `gemma4:e2b-it-qat` 外，需優先尋找名稱中包含 `gemma` 的對話型模型作為本地 Ollama 引擎 fallback。
  - 當遠端或本機發起 `rec_pull_llm_model` SOP 時，均需調用該模型的 pull 與 verify 流程。

---

## 18. 2026.06.12 搜尋品質、影片年份權重排序與本地 Chalkboard 版面優化

### 18.1 本地 Chalkboard 版面優化 (Local Chalkboard Layout Fix)
- **滿版呈現**：當不在遠端連線模式（`inRemoteSession` 為 false）時，本地聊天產生的 Chalkboard Draft（例如查詢摘要、比較、天氣新聞等）必須預設以滿版（`position: 'full'`）呈現，避免被非必要地限制在左半邊。

### 18.2 DuckDuckGo 重定向跳轉修正與 Lite 引擎遷移 (DDG Redirect Fix & Lite Migration)
- **跳轉連結解析**：針對 DuckDuckGo 的跳轉連結（如 `//duckduckgo.com/l/?uddg=...` 格式之 URL），在解析前必須先將開頭的相對通訊協定 `//` 正常化為完整的 `https:`，以確保能夠通過正規表達式成功提取 `uddg` 參數中的目標 destination URL，使 AI 回答中的連結可以直接跳轉至來源網站。
- **Lite 引擎保護**：為避免高頻率查詢或中英夾雜的 site 搜尋在 DuckDuckGo HTML 介面觸發 202 阻擋，核心 `searchWebLinks` 正式遷移至不包含 anti-bot 及 JS 驗證碼的 DuckDuckGo Lite 版 (`https://lite.duckduckgo.com/lite/`)，並提供更強健的 `aTagRegex` 標籤提取與單雙引號寬鬆匹配，徹底提升搜尋成功率。

### 18.3 YouTube 影片年份權重排序與防過時機制 (YouTube Date Extraction & Score Weighted Ranking)
- **發布年份提取**：修改影片檢測邏輯，在判斷 YouTube 影片是否可播放 (`isYouTubeWatchPagePlayable`) 時，不再切片前 15,000 字元，而是讀取完整的 Watch page HTML，並以正規表達式從 `itemprop="datePublished"`、`itemprop="uploadDate"` 或 `publishDate` 等 JSON 設定檔欄位中精準提取影片的發布年份。
- **年份權重加權**：在對搜尋到的 YouTube 影片進行評分與排序 (`scoreVideoResult`) 時，引入發布年份權重調整：
  - &gt;= 2025 年的影片：加 10 分。
  - 2024 年的影片：加 6 分。
  - 2023 年的影片：加 3 分。
  - 2022 年的影片：加 1 分。
  - &lt;= 2021 年的影片：扣 6 分。
  藉此確保新影片排在前方，過時的預告片、反應片或無用片段被自動沉底過濾。
- **Playwright Chromium 執行路徑指定**：在背景使用 Playwright 啟動 Chromium 進行搜尋 fallback 時，必須在 launch config 中明確傳入 `executablePath: browserExe`，以確保即使系統 ms-playwright 全域路徑不存在，依然能正確調用本地 AppData 目錄管理的 Chromium 執行檔。

## 19. 2026.06.17 Chalkboard Markdown 表格純文字化

### 19.1 版本
- Runtime 版本號更新為 `2026.06.17`。
- 狀態列與 `/api/meta` 顯示版本仍以 `package.json` 為單一真相來源。

### 19.2 Markdown Table Normalization
- AI 將 Markdown table 寫入 Chalkboard 時，前端不得直接把 `| 欄位 |`、`|---|` 或 GFM 表格骨架畫到 canvas。
- Chalkboard draft 進入畫布前必須將 table rows 轉為短句格式，例如：`欄位A: 值A / 欄位B: 值B`。
- `##CHALKBOARD##` block、auto draft 與實際 canvas render 前都必須套用相同正規化規則，避免後端 draft normalization 或遠端同步後重新帶回 markdown 表格。

## 20. 2026.06.23 Language SOP 安裝/卸載穩定化

### 20.1 版本
- Runtime 版本號更新為 `2026.06.23`。
- 狀態列與 `/api/meta` 顯示版本仍以 `package.json` 為單一真相來源。

### 20.2 成功判準
- 多國語言 SOP 的 Check 階段必須以目前使用者的 `Get-WinUserLanguageList` 為主要判準；語言存在於使用者語言清單時，install action 可視為已完成。
- Install 階段的硬性成功條件是目標語系成功加入目前使用者語言清單；底層 Windows language package 或 optional capability 不得作為唯一成功判準。
- Uninstall 階段的硬性成功條件是目標語系成功自目前使用者語言清單移除；若 Windows 保留底層語言包但使用者語言清單已移除，應視為可接受結果並記錄 warning。

### 20.3 容錯與安全
- `Install-Language` 應優先使用，並在支援時帶入 `CopyToSettings = false`，避免不必要地修改系統/歡迎畫面語系。
- `Install-Language` 失敗時可 fallback 至 `Add-WindowsCapability`；`Language.Basic` 盡量安裝，OCR、Speech、TextToSpeech、Handwriting 等 optional capability 應 best-effort 處理並記錄 warning。
- `Uninstall-Language` 與 `Remove-WindowsCapability` 應 best-effort 處理；Windows 因原始安裝語言、目前 UI 語言、版本限制或功能包鎖定而拒絕移除時，不得在使用者語言清單已移除的情況下誤判整體卸載失敗。
- SOP 必須保留原始 Windows 安裝語言不可移除、以及系統至少保留一個使用者語言的防呆檢查。

## 21. 2026.06.23 Visual Agent 品牌與資料路徑規格

### 21.1 產品命名
- 使用者可見產品名稱統一為 `Visual Agent`。
- repo、npm package、User-Agent 與 AppData 新路徑統一使用 `visual-agent`。
- 遠端雙 AI 協作模式正式命名為 `Double Agent Mode`；`Local AI`、`Remote AI`、`Remote User` 等角色名稱保留，用於對話來源與狀態辨識。

### 21.2 核心定位
- 對外定位句統一為「可視化、可塗鴉、可協作的本地 AI PC Agent」。
- 文件、README、Tauri window title、HTML title、status bar、welcome message、技能來源分組與 SOP/Plugin/Experience 標頭應使用 `Visual Agent`。

### 21.3 資料路徑
- 新安裝與新資料應寫入 `%APPDATA%\visual-agent`。
- 因專案尚未公開發布，不保留舊 `aipc-agent` AppData、localStorage 或 package name 相容層。
- Browser runtime、LLM config、tasks、SOP、skills、plugins 與 experience logs 皆以 `visual-agent` 作為唯一資料根目錄。

## 22. 2026.06.30 Browser Use / Agent Loop 即時查詢規格

### 22.1 版本
- Runtime 版本號更新為 `2026.6.30`。
- 狀態列與 `/api/meta` 顯示版本仍以 `package.json` 為單一真相來源。

### 22.2 Browser Use 內容取得
- `BROWSER_USE mode="extract_text"` 若帶有 `url`，runtime 必須先開啟或抓取該 URL，再抽取頁面文字；不得忽略 URL 而只讀取目前 Browser session。
- 若 Playwright Chromium 尚未安裝，`extract_text url="..."` 應 fallback 到 server-side fetch，將 HTML 轉成可讀純文字。
- `search` 只回網址不足以完成天氣、新聞、價格、股價等 current-info 任務；runtime 必須自動抽取至少前 1-2 個可信搜尋結果內容，再交給 LLM 整理答案。

### 22.3 Agent Loop Observation
- Visual Agent 使用自訂 `[ACTION:...]` 協議時，工具結果回填需使用可攜的「工具觀察結果」訊息，避免 OpenAI-compatible provider 不支援原生 `role: tool` 而拒收或忽略。
- Agent Loop 收到工具觀察結果後，若已有足夠事實必須直接回答使用者；若結果只有連結或空內容，才繼續輸出下一個 ACTION。

### 22.4 Game Research
- 遊戲攻略查詢不得只回傳攻略文章與 YouTube 連結清單。
- Game research workflow 必須抽取至少 1-2 個高品質攻略來源內容，先整理可執行攻略重點，再附來源文章與影片連結。
- 若 LLM 不可用，runtime 仍應從已抽取來源文字產生 fallback 摘要，避免使用者只拿到 link list。

### 22.5 Startup Port Guard
- 後端啟動前必須檢查 HTTP API `3210` 與 Remote Agent TCP `19168` 是否可用。
- 若 port 已被既有 Visual Agent 或其他程序佔用，啟動程序必須明確輸出佔用 port 與 PID，並以非零 exit code 結束。
- 不得在 port 佔用時輸出誤導性的 started 訊息，避免使用者誤以為 `npm start` 已常駐。

## 23. 2026.07.07 Public Readiness 與診斷規格

### 23.1 版本
- Runtime 版本號更新為 `2026.7.7`。
- 狀態列與 `/api/meta` 顯示版本仍以 `package.json` 為單一真相來源。

### 23.2 診斷 API
- 後端必須提供 `GET /api/diagnostics`，回傳 app 版本、PID、Node 版本、平台、AppData 路徑、HTTP/Remote port owner、LLM provider/model 狀態、Browser runtime 狀態、任務/SOP/Skill 數量與 debug log tail。
- 診斷 API 不得依賴 LLM 對話成功；即使 Ollama 或 Browser runtime 缺失，也必須回傳可讀狀態。
- debug log 僅回傳末段，避免一次暴露過多本機紀錄。

### 23.3 UI 診斷
- UI 必須提供「診斷資訊」入口（標題列「說明」選單），讓使用者在回報 issue 前可複製診斷摘要。
- 「說明」選單另提供「關於」，開啟專案 GitHub repository。
- 診斷資訊需明確標示 Browser Use、Ollama/model、port、AppData 與 debug log 末段。

### 23.4 Public Preview 驗收
- README 必須包含 public preview 檢查清單與乾淨機器驗收流程。
- 乾淨機器驗收至少涵蓋 `npm install`、`npm start`、首次 UI 啟動、AI 引擎狀態、Browser runtime 補裝、即時資訊查詢、遊戲攻略摘要與低風險 SOP 任務執行。

### 23.5 遊戲新作與推薦查詢
- 「最近有什麼新遊戲」、「最新 Steam 新作」、「PS5 / Switch / Xbox 新遊戲推薦」屬於即時資訊查詢。
- 若模型未輸出 Browser Use ACTION，runtime 必須自動補 current-info search，抽取來源內容後再交回 Agent Loop，不得只回「馬上幫你查」就停止。

### 23.6 Web Research Agent Loop 保底
- 只要判定為 web research intent，若模型未輸出 ACTION，runtime 必須自動執行 search，抽取前 2 筆來源內容，再交回 Agent Loop summarizing。
- Agent Loop observation 必須集中封裝，避免各 action 路徑自行拼接不一致的 observation message。
- 前端必須顯示 Agent 狀態事件：planning、searching、extracting、summarizing、done；不得只顯示靜態「思考中」。
- 有工具結果時，最終回覆必須是可讀答案；禁止只回「已執行指定動作」或空控制碼。模型仍不可用時，runtime 必須以來源摘要做 fallback。

## 24. 2026.07.15 意圖辨識與 Chalkboard 內容規格

### 24.1 版本
- Runtime 版本號為 `2026.7.15`；`package.json` 是版本單一真相來源。

### 24.2 創作/開發意圖
- 使用者要求設計、撰寫或修改程式、網站、小遊戲時，必須視為創作或開發請求，直接協助實作。
- 不得因訊息含有「遊戲」就新增或建議 Steam；LLM 不可用的 fallback 也只能在明確出現 `Steam` 時建立 Steam 任務。

### 24.3 Chalkboard 頁面與摘要
- Chalkboard 必須支援多頁：新增頁、前後切換、頁碼指示與每頁獨立 Undo / Redo history。
- 垃圾桶必須永久刪除目前頁，並切換至相鄰頁；不得刪除其他頁。最後一頁刪除後保留新的空白第 1 頁。
- AI Chalkboard僅可呈現新的可執行結論：最多 4 條、每條最多 64 字、去除重複與 Markdown/數字前綴。
- Canvas renderer 不得自行為 AI Chalkboard條目加上數字編號；完整說明保留在聊天面板。
- 新聞或即時資訊摘要例外可使用 6 行：最多 5 個短標題與 1 行趨勢總結；不得把第一則新聞內文當成Chalkboard摘要。
- 遊戲發售/Steam 表格必須抽取日期、遊戲名稱與類型，顯示前 5 列與總筆數摘要。
- 若 API 回傳 `chalkboardDraft`，前端必須優先使用該結構化資料；入口頁與前端主程式不得被瀏覽器快取。

### 24.4 一般聊天效能
- 一般對話不得為了建構 prompt 對全部 SOP 執行 runtime check；只有系統任務才更新即時 SOP 狀態。
- WMI、GPU counter 與 NVIDIA 硬體探測僅限硬體查詢，非硬體對話必須跳過。

### 24.5 研究型追問承接
- 當上一則使用者訊息為遊戲新聞/即時研究，後續 100 字內的平台或篩選短句必須繼承前題，產生具體研究 query 並啟用 Browser Use fallback。
- 平台篩選追問不得退化成名詞解釋；例如「最新遊戲新聞」後的「純 PC 平台」必須回答最新 PC 遊戲新聞。

## 25. 2026.07.28 Chalkboard 視覺辨識規格

### 25.1 版本
- Runtime 版本號為 `2026.7.28`；`package.json` 是版本單一真相來源。

### 25.2 圖片附件品質與模型行為
- Chalkboard 附件必須輸出為 PNG，不得以 JPEG 壓縮細小粉筆筆觸或手寫文字。
- 附件應裁切至實際畫面內容並保留適當留白，最長邊不得超過 1600px；空白畫布不得送出附件。
- 有附件時，模型必須優先檢視手寫文字、標籤、圖表、箭頭與置入圖片。細節無法辨識時必須明確告知，不得猜測。
- 優先使用使用者設定的 Vision Model；未設定且目前模型不支援視覺時，應自動從可用模型選擇可辨識視覺的模型。
- Provider 或模型拒絕圖片時，系統必須以文字清楚告知「圖片辨識失敗」，並提示設定 Vision Model 或補充關鍵文字後再提供文字協助。
- 文字模型若靜默接受請求卻忽略圖片，系統必須攔截該路徑，明確回覆「圖片已收到，但模型不支援辨識」；不得讓模型誤稱未收到附件。
- 附圖開關啟用後，已啟用的Chalkboard必須匯出目前可見畫布，不得因 `hasUserContent` 與 Undo／頁面還原狀態不同而漏送。
- Vision Model 偵測必須支援 `qwen2.5vl:7b` 等無連字號的 Qwen VL 命名，並同步套用於設定 UI 與實際送圖路徑。

## 26. 2026.07.16 Agent Loop 與說明選單規格

### 26.1 版本
- Runtime 版本號為 `2026.7.16`；此節為歷史規格，現行版本以第 25 節為準。

### 26.2 說明選單
- 標題列「說明」必須提供下拉：診斷資訊、關於。
- 診斷資訊開啟既有 diagnostics modal 與複製摘要能力。
- 關於必須開啟 GitHub repo `https://github.com/anomixer/visual-agent`。

### 26.3 禁止冗長 interim plan
- 前端不得在送出查詢後先插入「我先給你一個處理計畫…」這類固定計畫泡泡。
- 長任務進度以 thinking bubble + `/api/agent-status/:runId` 顯示。

### 26.4 Agent Loop 最終答案
- 有 web 工具觀察結果時必須進入 summarize loop；最終回覆不得只剩 ACTION 控制碼或「已執行指定動作」。
- 空回覆、純控制碼、空話（馬上幫你查）視為不可用，需重試 summarize 或以抽取來源做 fallback。
- 本機任務類 ACTION（ADD_TASK / EXECUTE_TASK / INSTALL_SOP / CREATE_*_SOP）必須寫入可讀 action summary，且不必強制走 web research loop。
- Browser Use 參數需相容 `mode`/`action` 與有無引號；search 缺 query 時以使用者原句或 research intent 補上。

### 26.5 LLM 傳輸
- chat history 的 role 必須可被 OpenAI-compatible / Ollama 接受；無 tool_call_id 的 tool role 需映射為 user。
- 回應解析需相容 array content 與 reasoning 欄位，避免被誤判為空內容。

### 26.6 Chalkboard 本月新作 / 遊戲清單草稿
- 當回覆為本月新作、新遊戲推薦、上市清單時，auto draft 必須解析遊戲條目，不得只取前 1–2 句 intro。
- 支援格式至少包含：`7/2《遊戲名》（平台）` 換行簡介、以及 `《遊戲名》：一句話`。
- list/news layout 允許最多 8 條、每條最多 96 字；可含 1 行趨勢總結。
- Chalkboard標題優先使用「本月新作速覽」類短標題，完整長文仍保留在聊天面板。
- list/news 渲染應使用較密字級；若條目超出目前頁可用高度，必須自動建立下一頁續寫，不得靜默裁切。




