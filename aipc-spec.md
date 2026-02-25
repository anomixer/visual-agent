AI PC Agent 實作需求規格書

1. 專案願景 (Vision)
打造一個「本地優先、無命令列、具備感知能力」的系統管家。目標是取代傳統複雜的裝機流程與無能的對話機器人，實現「一嘴（對話）或一鍵」完成所有系統優化、軟體安裝、硬體監控與資料保護。

2. 使用者介面架構 (UI/UX)
完全去 Terminal 化： 嚴禁直接顯示黑底白字的 CMD/PowerShell 視窗。

三段式版面：

To-Do List (工作清單)： 顯示當前執行的任務、進度條與狀態（如：待處理、執行中、排錯中、已完成）。

Recommend List (推薦清單)： 根據硬體偵測結果或預設範本，主動推薦安裝或優化的項目。

Chat Bar (對話中樞)： 位於下方，接收自然語言指令並將其轉化為任務加入清單。

視覺化日誌 (Log)： 以人類可讀的語言紀錄安裝與排錯過程（如：「正在嘗試修復網路連線...」）。

3. 核心功能模組 (Core Modules)
A. 意圖轉譯與任務執行 (Intent & Execution)
自然語言解析： 識別用戶需求（如：「加裝日文語系」、「刪除 Edge」）。

Skill 系統： 支援讀取 skill.md 或 skill.json 格式，定義安裝步驟、驗證邏輯與自動排錯 SOP。

清單管理： 任務清單需支援 匯出與匯入 (JSON 格式)，實現標準化裝機範本分享。

B. 硬體感知與主動防禦 (Hardware Health)
健康監控： 背景監測 HDD/SSD S.M.A.R.T 資訊、溫度、風扇轉速。

主動警報： 偵測到硬體壽命異常（如：硬碟壞軌增加）時，主動在 UI 跳出警報並建議備份。

第三方整合： 自動調用/下載輕量級工具（如 CPU-Z, GPU-Z 核心）獲取詳細資訊。

C. 貼心備份機制 (Smart Backup)
智慧觸發： 根據文件變動量主動詢問是否備份。

零門檻設定： 優先使用 OAuth 驗證網路硬碟，或自動偵測外接磁碟/USB，避免繁瑣的 API 設定。

D. 安全與權限 (Security)
UAC 友善： 涉及系統修改時，必須主動說明原因並觸發標準 Windows UAC 視窗。

自我進化： 程式需具備自我更新機制，並能動態下載/更新 Skill 庫。

4. 具體任務範例 (Implementation Tasks)
系統淨化： 移除 Windows 廣告、停用 Copilot、更換預設瀏覽器。

環境部署： 檢查並安裝特定語系包、驅動程式、或 OpenClaw 生態系軟體。

排錯邏輯： 若 skill.md 執行失敗，AI 需讀取報錯訊息並連網搜尋解決方案，自動嘗試修復。

5. 給 antigravity 的實作建議
技術棧推薦： Tauri (Frontend: HTML/TS, Backend: Rust) 確保輕量化與系統權限。

指令調用： 封裝 PowerShell API 執行後台任務，UI 層需處理非同步進度回傳。

排錯迴圈： 實現 Sense-Think-Act 迴圈：偵測報錯 -> AI 分析 -> 執行修正 -> 驗證。

-------------------------------------------------------------------------------

# AI PC Agent - Project Blueprint

## 1. 核心規格書
**Vision:** 取代 Copilot 成為真正能動手、懂排錯、且隱私友善的系統管家。

### UI 架構
- [ ] **To-Do List:** 頂部顯示當前任務佇列。
- [ ] **Recommend List:** 中間顯示主動預警與建議。
- [ ] **Chat Bar:** 底部自然語言輸入。
- [ ] **Pure UI:** 禁止出現 Terminal 視窗，所有進度以視覺化進度條呈現。

### 核心功能
1. **意圖轉譯:** 解析對話並掛載到 To-Do List。
2. **硬體監控:** 背景輪詢 S.M.A.R.T, 溫度與轉速。
3. **自動排錯:** 讀取錯誤代碼並執行修復 Skill。
4. **清單系統:** 支援 JSON 格式之任務清單匯入/匯出。

---

## 2. 技能書範例 (skills/install-language-ja.md)

### Metadata
- ID: `sys_lang_ja_jp`
- Name: Install Japanese Language Pack

### Execution Steps
1. **Check:** `powershell "(Get-InstalledLanguage).LanguageId -contains 'ja-JP'"`
2. **Install:** ```powershell
   Install-Language -Language ja-JP
   Set-WinUserLanguageList -LanguageList (New-WinUserLanguageList -Language ja-JP) -Force
