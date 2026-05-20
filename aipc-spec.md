# AI PC Agent — 實作需求規格書 (2026.05.06 Updated)

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
│ StatusBar  [🟢 AI就緒] │ [N個任務]              [v2026.05.06 Updated] │
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
| **自動初始設定** | ✅ | 新手友善！全新電腦啟動後，全自動於背景安裝 Ollama 與下載地端模型（qwen3.5:4b） |
| **啟動啟始畫面** | ✅ | 首次執行顯示「環境設定中」，再次執行顯示「伺服器啟動中」，自動淡出 |
| **UTF-8 編碼** | ✅ | PowerShell 輸出正確顯示中文，使用 `chcp 65001` 和 UTF-8 編碼 |
| **執行日誌** | ✅ | Mono 字體，依等級顯示色（info/warn/error/success），支援進度條原地更新 |
| **語音輸入** | ✅ | Web Speech API，中文語音轉文字 |
| **主題切換** | ✅ | Dark / Light，localStorage 記憶 |
| **風險預警提示** | ✅ | 歡迎畫面加入安全風險提示，提醒查證指令 |
| **EXE 一鍵打包** | ✅ | `.bat` 腳本全自動下載 Node/Rust/TauriCLI 依賴，將 Node Server 封裝成 Tauri Sidecar |
| **Exp經驗庫** | ✅ | 自動累積任務經驗，支援搜尋、SOP 篩選、Hover 展開、匯出 Markdown，卡片按時間倒序 |
| **Chalkboard 黑板** | ✅ | 互動式黑板畫布，支援粉筆、板擦、圖形、圖片、文字框、PNG 匯出、多模態 AI 理解 |
| **雙向 SOP** | ✅ | 安裝類 SOP 支援 install/uninstall 雙向動作，UI 自動切換 |
| **多來源軟體推薦** | ✅ | 支援 winget、Microsoft Store、GitHub Releases 三大來源，AI 可自動產生 SOP |

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
             sops/<slug>/SOP.md        (SOP 腳本庫)
             %APPDATA%\aipc-agent\  (tasks.json, sops/<slug>/SOP.md, plugins/)
```
- **監控插件系統**：`src/system.js` 負責動態載入 `plugins/*.js` 中的監控腳本。這些腳本會自動同步到 `%APPDATA%\aipc-agent\plugins\` 目慶，並透過 PowerShell 或其他 API 介面獲取系統硬體資訊，實現可擴充的監控功能。

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
這確保了我們寫的 Skills 不僅能在 AI PC Agent 本身運作，**也能與生態系中其他遵循同一標準的 AI Agent 互相相容與共享**。

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
- 執行時：`%APPDATA%\aipc-agent\skills\` / `%APPDATA%\aipc-agent\sops\`

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
- 內建 SOP、skill、plugin 在內容變更時，需同步至 `%APPDATA%\aipc-agent\`。

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

### 黑板工具 i18n
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

## 6.13 2026.03.29 Chalkboard Resize 黑板縮放修補

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

### 8.3 黑板 8 點框與落稿座標
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
- 安裝條件與完成偵測不再僅檢查資料夾，必須精確驗證實際的 `chrome-headless-shell.exe` 執行檔是否存在。
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
- 同步需採 idle debounce：黑板有繪製、拖曳、文字框、圖片放置等互動時暫停傳送與套用，互動停止約 1 秒後才同步最新畫面。
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

### 10.4 雙 AI 分工
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
- 遠端協作調整後，至少需固定驗證三條流程：`SUGGEST`、`INSTALL_SOP`、`雙 AI 協作（本地先回、遠端後補）`。
- 驗收時應確認 UI log 能看見 directive receipt、task reuse / start、以及 remote follow-up 的成功或失敗訊息。

### 12.3 重複指令抑制
- 若遠端 AI 在短時間內重複送出相同 directive，前端應略過重跑並留下 `Skipped duplicate remote directive` 診斷訊息。
- directive receipt log 應包含 `msg:<id>`，方便對照遠端訊息是否重送。
- 遠端身份欄位只在使用者修改後才啟用儲存，不得被 polling 立即還原。

### 11.5 Skills 與 Action
- Sidebar 必須提供 Skills 清單，來源為 `skills/<slug>/SKILL.md`。
- Action parser 必須支援 `[ACTION:...]` 與 `Action=Computer_Use...`。
- Browser Use / Computer Use 執行後必須回傳可見摘要。

### 10.5 斷線提示
- 遠端 session 進入 `disconnected` 時，本地聊天窗需顯示「對方已斷線」。

### 10.6 一般對話
- System prompt 必須允許一般聊天、知識問答、創作與非系統操作話題。
- 只有使用者明確談到電腦問題、軟體、安裝、維護、自動化或本 App 功能時，才引導到 SOP / 安裝 / Agent 工作流。
