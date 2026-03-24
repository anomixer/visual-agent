# AI PC Agent 開發日誌

> 本地優先、無命令列、具備感知能力的 Windows 系統管家  
> by [anomixer](https://github.com/anomixer)

---

## 📌 2026.02.25 — 初始版本

### Tauri 桌面化 + Sidecar 架構
- 導入 **Tauri 2.x + Rust** 打包為獨立 `.exe`（MSI/NSIS），不需使用者安裝 Node.js
- Node.js 伺服器以 `pkg` 編譯為 Tauri **Sidecar Binary**，隨主程式啟動/退出
- 修改 `capabilities/default.json` 賦予殼層最高執行權限 (`shell:allow-execute`)

### AppData 架構
- 任務清單 (`tasks.json`) 與 SOP 庫 (`sops/`) 儲存至 `%APPDATA%\aipc-agent\`
- 初次啟動自動把內建 SOPs 複製過去，確保零設定上手

### 初始 SOPs 庫
- 🌐 `install-chrome.md` — 靜默下載安裝最新 Chrome
- 🗑️ `remove-copilot.md` — 登錄檔停用 Copilot
- 💾 `backup-system.md` — PowerShell 系統還原點
- 🇯🇵 `install-language-ja.md` — 安裝日文語系

---

## 📌 2026.03.05 — UI 強化、LLM 整合與打包發佈

### UI 強化 + 推薦執行
- `renderRecommendList` 加入 **＋ 加入** / **▶ 執行** 雙按鈕
- `addAndExecuteRecommend()` 一鍵「加入任務 + 立即執行」
- 後端 `buildRecommendList()` 動態掃描 `sops/` 目錄，有對應 SOP 的項目才顯示 ⚡ 可自動執行 徽章
- **remove-copilot 升級**：同時寫入 HKCU + HKLM 登錄檔，並嘗試移除 Copilot AppxPackage，提供驗證腳本。

### 本地 LLM 整合 (Ollama)
- 新增 `src/llm.js` 負責 Ollama 狀態偵測與對話。
- 啟動時自動 ping `127.0.0.1:11434`，偵測 Ollama 版本與模型是否就緒。
- **全自動 AI 無縫體驗 (Auto-Bootstrap)**：新電初次啟動若無 Ollama，會自動背景觸發下載與靜默安裝，並自動 pull 模型。
- **LLM 狀態指示燈**：Title bar 加入發光小圓點（🔴 未就緒 / 🟡 沒模型 / 🟢 已就緒）。

### VS Code 風格 UI 重構
- **三欄可拖拉介面**：側邊欄寬度、聊天欄寬度、日誌面板高度皆可滑鼠拖拉調整。
- **設計系統**：VS Code 色彩配置、`JetBrains Mono` 日誌字體、Task card 狀態顯色。
- **佈局持久化**：佈局設定自動儲存至 `localStorage`。

### 一鍵打包 EXE (Tauri)
- **`build.bat` 全自動編譯腳本**：實現從無到有的完整 Tauri 開發環境自動安裝與打包（Node -> Rust -> Tauri）。
- **APPDATA 檔案存取修復**：修正 `pkg` 打包後虛擬檔案系統的路徑掛載問題。

---

## 📌 2026.03.06 — 穩定性與 UI 體感優化

### 啟動啟始畫面 (Splash Screen)
- 導入 `splash-overlay`：解決冷啟動時後台 Server 尚未就緒導致的畫面空白
- 智能訊息：首次執行顯示「首次執行本程式，正設定環境中，請稍候...」，再次執行顯示「啟動後端伺服器中，請稍候...」
- 自動偵測：當前端成功抓取到 3210 Port 的資料後，遮罩自動優雅淡出
- 實作位置：`public/app.js` 的 `checkFirstRun()` 與 `hideSplash()` 函數，使用 `localStorage` 標記首次執行

### 日誌渲染革命：原地更新進度條
- 修正大量 `curl` 下載訊息導致的日誌洗版問題
- 實作 `addLogEntry` 智能覆蓋：偵測到 `%` 或 `###` 時，自動更新最後一行日誌而不新增行
- 同步修正 `sop-executor.js`：將代碼區塊改為「整塊執行」，解決 PowerShell 變數無法跨行傳遞的 Bug

### Ollama 安裝守護 (Installation Guard)
- 升級 `install-ollama.md`：自動清理安裝後強制彈出的 Ollama App 視窗
- 加入 UAC 預警提示與超時強制解鎖機制，確保安裝進程不再因為背景 App 視窗而卡死

### 生命週期管理與除錯
- Rust 端監聽 `WindowEvent::Destroyed`，確保 App 關閉時徹底殺死 Node Sidecar 進程
- 後端 Server 加入 `%APPDATA%\debug.log`，方便在無 Console 的打包環境中進行診斷
- 提高 LLM 逾時至 60s，確保冷啟動下的模型偵測不會誤報

---

## 📌 2026.03.07 — SOP 套件擴充與穩健化

### 新增卡片與對應 SOPs
- 📄 `install-office.md` — 透過 `winget` 靜默安裝 LibreOffice
- 🎮 `install-steam.md` — 下載並靜默安裝 Steam 遊戲平台
- 🔍 `check-drivers.md` — 觸發系統 `UsoClient` 進行背景驅動與 Windows Update

### Ollama 網絡與路徑強固 (Robustness)
- **IPv6 防護**：將所有 HTTP fetch (`llm.js` 與 `install-ollama.md`) 請求的 `localhost` 替換為 `127.0.0.1`，徹底解決 Node 18 在乾淨環境下錯誤 binding IPv6 而找不到本地服務的問題
- **PATH 環境變數防呆**：為了解決剛安裝完 Ollama，系統 PATH 尚未刷新的問題，腳本自動 Fallback 至 `$env:LOCALAPPDATA\Programs\Ollama\ollama.exe` 進行絕對路徑啟動

### UI 推薦卡片感知進化
- **已安裝狀態視覺化**：現在只要服務安裝完畢（如 Ollama 或 LLM），左側推薦卡片會自動打上 `✅ 已安裝` 綠色標籤
- **防呆降級**：卡片變半透明並隱藏 `+` 和 `▶` 操作按鈕
- **動態沉底排序**：所有的「已安裝」項目會自動下潛至該分類叢集的最下方，把還沒做的重要任務浮起來

---

## 📌 2026.03.13 — EXE 啟動畫面、Ollama 安裝與 UI 修復

### 啟動畫面修復
- 移除人為延遲，資料載入完成後立即隱藏啟動畫面
- 啟動畫面已在 HTML 中，Tauri 啟動時就會顯示（解決黑畫面問題）

### Ollama 安裝流程優化
- **簡化 PowerShell 指令**：改用 `Write-Host` 取代 `UI 顯示內容` 標籤
- **改進下載邏輯**：檢查下載是否成功，失敗則拋出異常
- **改進驗證邏輯**：使用重試機制（最多 5 次），確保服務啟動成功
- **增強錯誤日誌**：詳細記錄每個步驟的錯誤訊息
- **安裝進度顯示**：每 10 秒輸出一次進度「安裝進度: X/180 秒」

### UTF-8 編碼修復
- 修復 PowerShell 輸出亂碼問題
- 使用 `chcp 65001` 設定 UTF-8 代碼頁（相容 PowerShell 5.1）
- 加入 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`
- 明確設定 stdout/stderr 編碼為 utf8

### 重複訊息修復
- 修復 `checkLLMStatus` 重複觸發 bootstrap 的問題
- 加入「任務執行中」檢查，避免重複加入任務
- 防止對話框重複顯示相同訊息

### AI 對話初始化修復
- 移除 HTML 中的初始訊息，改由 JS 控制
- 模型徽章「qwen3.5:4b」只在模型就緒時才顯示
- 初始訊息只在首次且模型就緒時顯示

### UI 改進
- 進度條高度從 2px 增加到 6px，更明顯
- 進度條背景色改為 `rgba(255, 255, 255, 0.1)`，更清楚
- 進度條圓角從 10px 改為 3px，更現代
- 狀態指示燈文字改為：
  - 🔴 AI 引擎未就緒（無 Ollama）
  - 🟡 模型未就緒（有 Ollama 無模型）
  - 🟢 AI 就緒（都有）

### 錯誤處理改進
- `sop-executor.js` 改進：非零 exit code 時記錄詳細錯誤訊息
- 改進 `runPhaseCommands` 的錯誤日誌級別（warn → error）
- 確保所有異常都被正確捕捉並回傳給前端

---

## 📌 2026.03.16 — SOP 全面重構與 UI 體感進化

### 「SOP」標準化命名
- **全專案重構**：將所有的 `Skills` 相關稱呼更替為 `SOPs` (Standard Operating Procedures / 標準作業程序)。
- **目錄變更**：`skills/` ➔ `sops/`，內建腳本同步移動。
- **程式碼對應**：`skill-parser.js` ➔ `sop-parser.js`，`skill-executor.js` ➔ `sop-executor.js`。
- **後端 API**：`/api/skills` ➔ `/api/sops`。
- **文件正名**：將所有開發文件、README、註解中提到的「技能書」修正為「**標準作業程序書**」。

### 推薦清單智慧搜尋與優化
- **新增搜尋欄 (Search Bar)**：側邊欄頂部加入即時過濾功能，輸入關鍵字即刻篩選 SOP 的標題與描述。
- **沉底排序 (Bottom Sorting)**：已安裝/已執行的項目現在會被強制移動到清單的最底端，並有專屬的「已就緒」分隔線，不再干擾未完成任務。
- **UI 相容性**：修正了灰色樣式（Opacity 0.5）的視覺呈現。

### 對話系統與邏輯強化
- **新增「清除對話」功能**：對話框右側加入清除按鈕，支援二次確認彈窗，提升操作靈活性。
- **任務刪除邏輯改進**：強化了 AI 對「刪除、移除、移掉」等意圖的辨識，避免誤判為新增。
- **崩潰防治 (Safe Guard)**：修復了一個在搜尋不到任務 ID 時會導致後端崩潰的 `TypeError` (Cannot read property 'title' of undefined)。

### 穩定性與配置記憶
- **模型記憶功能**：現在程式會自動記住上次選擇的 LLM 模型（如切換到了較大的模型），下次啟動會優先選取，若不存在才 fallback。

---

## 📌 2026.03.17 — AI 引擎進階自定義與互動優化

### AI Provider 進階設定支援
- **通用 Provider 設定**：新增「AI 引擎設定」視窗，支援自定義 AI Provider、API Base URL 與 API Key。
- **模型名稱 (Model Name) 自定義**：支援手動輸入模型名稱（適用雲端 Provider），針對 Ollama 則會自動抓取本機模型清單供下拉挑選。
- **20+ 預設對照表**：內建 OpenAI, Gemini, Claude, Groq, xAI, vLLM, LM Studio 等 20 種常用引擎的預設 URL。
- **OpenAI 協定相容**：後端 `chatWithLLM` 更新為標準 OpenAI V1 格式，支援所有相容引擎。
- **儲存與刷新**：設定持久化至 `AppData/config.json`，儲存後前端自動重啟連線。

### 對話體驗與安全感官強化
- **先問後做 (Consent-Before-Action)**：AI 不再擅自執行 ACTION，而是透過 `[SUGGEST:...]` 提供按鈕，等待使用者確認。
- **佈局切換按鈕 (Layout Toggles)**：右上角新增三個圖示按鈕，模擬 VS Code 佈局控制。
  - **切換側邊欄 (Ctrl+B)**：顯示/隱藏推薦清單。
  - **切換工作日誌 (Ctrl+J)**：顯示/隱藏下方日誌面板。
  - **切換 AI 對話 (Ctrl+Alt+B)**：顯示/隱藏右側對話欄。
- **全域熱鍵支援**：上述佈局切換皆支援鍵盤快捷鍵。
- **按鈕與點擊路徑優化**：
  - 頂部中心「🟢 AI 就緒」文字現在是設定入口。
  - 對話欄的「AI 模型」徽章則是切換模型入口。

### 架構、穩定性與 Bug 修復
- **AppData 統一存取**：`SOPs` 與 `Skills` 目錄統一移至 `AppData/aipc-agent`。
- **啟動同步機制**：`syncBundledAssets` 同步內建 SOPs 與技能至 AppData。
- **Bug Fixes**：
  - 修復了 `server.js` 中的 `ReferenceError: llm is not defined`。
  - 修復了設定視窗「儲存與刷新」按鈕看不見的 CSS 問題。
  - 修復了 `loadAllSkills` 與 `loadAllSOPs` 函式名稱混淆的錯誤。

### 硬體感知與環型監控中心
- **全新硬體狀態分頁**：改用現代圓圈式 (Circular Gauge) 監控卡片，中間顯數值、圓弧映使用率。
- **全方位硬體探測**：
  - **CPU**: 型號辨識與動態負載。
  - **GPU**: 智慧辨識 (如 RTX 4000) 與繪圖引擎負載。
  - **RAM**: 已使用容量與百分比。
  - **Disk**: 主硬碟名稱與 S.M.A.R.T 健康度辨識 (SSD/NVMe 智慧辨識)。
- **溫度監測**：支援 NVIDIA GPU 即時溫度顯示，顯示於百分比下方。

### 插件化架構 (Plugin System)
- **監控插件化**：`src/system.js` 重構為插件載入器，自動讀取 `plugins/*.js`。
- **獨立監控插件**：
  - `hardware-info.js`: 核心負載與 S.M.A.R.T 偵測。
  - `temperature-monitor.js`: 專責偵測 GPU (nvidia-smi) 溫度。
- **AppData 同步**：啟動時自動同步內建插件至 `%APPDATA%\aipc-agent\plugins\`。

### 對話與 UI 體感進化
- **多輪對話歷史 (Contextual Chat)**：
  - **情境記憶**：AI 現在會記得最近 6 則對話紀錄，支援追問與承接前文。
  - **硬體覺醒 (Hardware-Awareness)**：後端自動將即時硬體狀態注入 Prompt，AI 能根據您的硬體狀況給出建議（例如：發現 CPU 負載高時主動提醒）。
- **RWD 儀表板**：硬體監控卡片支援響應式佈局，自動根據左右面板寬度切換 4 欄或 2x2 排列。
- **啟動資訊強化**：Console 與日誌現在會顯示 `Plugins` 資料夾路徑，方便擴充。

## 📌 2026.03.18 — 效能巔峰優化與推理模型強固

### ⚡ 聊天效能「秒開」優化
- **消除 Pre-request 延遲**：重構 `/api/chat` 核心逻辑，移除所有導致 5-10 秒等待的阻塞操作。
- **任務並行化處理**：將 LLM 狀態檢查、硬體偵測、SOP 掃描等背景任務改為並行執行，或改用快取資料，對話請求現在近乎「即發即收」。
- **快速快取機制**：實作 LLM 狀態 (5s TTL) 與模型清單 (30s TTL) 快取，大幅減少無謂的網路往返時間。

### 🧠 推理模型 (Reasoning Model) 深度相容
- **思考標籤 (Thought Tags) 處理**：優化 `<think>...</think>` 標籤過濾邏輯。若模型（如 DeepSeek R1）回傳純思考內容，系統現在會保留並呈現，不再誤判為空內容。
- **內容抓取強固化**：相容多種 API 欄位格式（如 `response` 欄位），支援 Ollama Native API 與 OpenAI 格式混用。
- **超時上限提升**：將 AI 回應等待上限延長至 **180 秒 (3 分鐘)**，確保長推理、模型加載等耗時操作能完整跑完。
- **自動上下文注入**：每一則對話都會自動帶入當前 **SOP 目錄**、**待辦任務進度**與**硬體簡報**，讓 AI 具備完整的系統覺醒能力。

### 🎨 UI/UX 細節修復與自動化
- **日誌面板自動彈出**：當 AI 觸發「新增任務」或「執行動作」時，系統現在會自動展開日誌面板與工作清單分頁，提升視覺回饋。
- **Bug Fixes**:
  - 修復了前端 `isLogCollapsed` 變數名稱錯誤導致的 `ReferenceError`（曾造成 AI 加入任務時誤報「對話連線發生錯誤」）。
  - 修復了地端 Ollama 在傳送過多參數時可能導致的卡死問題，現在完全尊重模型的自定義預設值。

---

- [ ] SOP 線上商城，動態下載更新
- [ ] 更多 SOPs：防毒掃描、軟體移除

---
> 📝 這是一支不需要黑綠色文字終端，便能聰明幫你管理系統操作的助手。

---

## 2026.03.24 - AI Provider 與 SOP 穩定性修正

### AI Provider
- OpenAI 維持僅支援 API Key。
- Gemini 使用 Google 的 OpenAI-compatible 入口。
- Anthropic Claude 改走原生認證與原生訊息 API。
- Customer Provider 支援 API Key 與 OAuth 2.0 Client Credentials。

### SOP 執行流程
- 任務完成後，AI 對話區會主動回報 `success`、`failed`、`skipped`。
- SOP 載入時會依 `id` 去重，並優先採用正式檔名，不再被 `Copy` 類副本覆蓋。
- 內建 SOP、skill、plugin 在內容變更時，會同步到 `%APPDATA%\aipc-agent\`。

### 執行器修正
- 移除可能觸發 `Out-File` / `nul` 裝置錯誤的 PowerShell 包裝方式。
- `Check` 階段即使同時輸出提示文字，仍可正確辨識布林值。
- `Verify` 階段若明確輸出 `false`，現在會視為真正失敗。

### SOP 修正
- 強化 Steam、Chrome、LibreOffice、Ollama、Qwen 模型下載、系統還原點、日文語言包 SOP。
- 將脆弱的 `Get-Command + Test-Path "command-name"` 改為先解析執行檔路徑再驗證。
- 系統還原點 SOP 的 `Check` 改為無副作用。

## 2026.03.24 - 工作日誌與版本同步

- 工作日誌僅在畫面已停在底部時才自動往下捲。
- Spinner 與下載進度類訊息會原地更新，不再洗出多行。
- 狀態列版本號不再寫死。
- 前端改由 `/api/meta` 讀取版本，來源為 `package.json`。
- 套件版本更新為 `2026.03.24`。
