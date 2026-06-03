# AI PC Agent

> 本地優先、無命令列、具備感知與自我進化能力的圖形化 Windows 系統管家  
> by [anomixer](https://github.com/anomixer)

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-0.17%2B-blue)](https://ollama.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4)](https://www.microsoft.com/windows)

---

## 這是什麼？

AI PC Agent 是一個跑在本機上的 Windows 系統自動化工具。你可以直接用英文或中文描述需求，或從推薦清單點選項目，系統會替你建立任務、執行嚴謹的 SOP (標準作業程序)、驗證執行結果，並把完整過程顯示在 UI 與工作日誌中，同時建立於經驗庫(Exp)，以便未來執行相同任務時做參考，提升任務執行成功率，達到自我進化能力。

```text
你說：「幫我移除 Copilot」
它就：建立任務 -> 執行 SOP -> 修改系統設定 -> 驗證結果 -> 回報成功或失敗
```

---

## 功能一覽

| 功能 | 說明 |
|------|------|
| 推薦清單 | 常用系統優化與安裝項目，支援搜尋、加入任務、立即執行 |
| SOP 清單 | 左側可切換查看全部 SOP，支援依名稱、ID、分類搜尋與直接執行 |
| 工作清單 | 顯示任務狀態、進度與結果，支援 JSON 匯出匯入 |
| AI 對話 | 支援 Ollama、本機 OpenAI-compatible API 與雲端 Provider |
| Provider 設定 | 可設定 Provider、Base URL、API Key、OAuth 2.0 與模型名稱 |
| 安全互動 | 採用 consent-before-action，先建議再由使用者確認執行 |
| 工作日誌 | 即時顯示 SOP 執行輸出，進度類訊息會原地更新 |
| 經驗庫 | 自動累積任務經驗摘要，支援搜尋、SOP 篩選與老司機備忘錄 |
| Chalkboard | 中央黑板支援粉筆塗寫、局部板擦、圖形、圖片放置、文字框與 PNG 匯出 |
| 硬體監控 | 顯示 CPU、GPU、RAM、Disk 與 NVIDIA GPU 溫度資訊 |
| 插件系統 | 可用 `.js` 擴充系統監控能力 |
| 自動初始化 | 首次執行可自動安裝 Ollama 與預設模型 |
| Tauri 打包 | 可打包成獨立 Windows EXE，Node 後端以 sidecar 方式隨附 |

---

## Remote Directive Protocol

- Structured suggestion buttons:

```text
[SUGGEST: button_text="🟢 Install VS Code" action="install_sop" sop_id="vscode_install"]
```

- Preferred action tags:

```text
[ACTION:ADD_TASK sop_id="..."]
[ACTION:EXECUTE_TASK task_id="..."]
[ACTION:INSTALL_SOP sop_id="..."]
[ACTION:COMPUTER_USE mode="prepare_vm_sandbox|open_file|open_url|install_sop" ...]
[ACTION:BROWSER_USE mode="search|open|navigate|fetch_title|extract_text|snapshot" ...]
```

- When both Local AI and Remote AI are relevant, Local AI should answer first and Remote AI may follow up later. The user should not be blocked waiting for both sides.

---

## Remote Validation Checklist

Use these three flows when validating remote collaboration changes:

1. `SUGGEST` flow
   Expected: the remote message renders a real button, the button does not flicker, clicking it creates or reuses a task, and the UI log shows `Suggestion clicked`.
2. `INSTALL_SOP` flow
   Expected: `[ACTION:INSTALL_SOP sop_id="..."]` is executed locally, the UI log shows `Remote AI directive received`, then either `Started SOP task` / `Reused SOP task` or a clear failure message.
3. Dual-AI flow
   Expected: Local AI replies first, the UI log shows `Dual-AI collaboration: Local AI answers first, Remote AI follow-up queued`, and Remote AI follow-up appears later without blocking the first answer.

Extra diagnostics:

- Duplicate remote directives within a short window are skipped and logged as `Skipped duplicate remote directive`.
- Directive receipt logs now include a `msg:<id>` marker so repeated remote messages can be correlated more easily.

---

## 環境需求

| 項目 | 需求 |
|------|------|
| OS | Windows 10 / 11 |
| Node.js | 18 以上 |
| Ollama | 選用，若要使用本地 LLM 對話 |
| 權限 | 部分 SOP 需要系統管理員權限，會觸發 UAC |

> 若只使用推薦清單與待辦管理，不一定需要先安裝 Ollama。

---

## 快速開始

### 1. 複製專案

```bash
git clone https://github.com/anomixer/aipc-agent.git
cd aipc-agent
```

### 2. 安裝相依套件

```powershell
npm install
```

若 PowerShell 擋下 script execution：

```powershell
powershell -ExecutionPolicy Bypass -Command "npm install"
```

若 `npm audit` 或 `npm install` 出現 `ENOTCACHED` / `only-if-cached`：

```powershell
setx npm_config_offline false
```

### 3. 啟動開發伺服器

```powershell
npm start
```

### 4. 開啟介面

```text
http://localhost:3210
```

---

## AI 對話與 Provider

### 本機 Ollama

系統可自動偵測 Ollama 是否存在，若缺少則可透過內建 SOP 安裝，並下載預設模型 `qwen3.5:4b`。當 UI 顯示 `AI 就緒` 時，就可以直接在右側對話區輸入需求。

### 其他 Provider

- OpenAI、Groq、DeepSeek、Mistral、Together AI、Gemini 走 OpenAI-compatible 流程。
- Gemini 可使用 Google 的 OpenAI-compatible 入口。
- Anthropic Claude 使用原生認證與原生 `/v1/messages`。
- Customer Provider 支援 API Key 與 OAuth 2.0 Client Credentials。

### Browser Runtime

- Browser tab 使用 Playwright Chromium。
- 若第一次啟動顯示 Browser 不可用，請執行 `install-playwright-chromium` SOP 補裝。
- 這樣可避免把 Chromium 綁進 MSI / EXE，安裝包會維持較小。

---

## 打包為 EXE

開發者可直接執行：

```cmd
build.bat
```

此腳本會安裝所需環境並建置 Tauri 桌面版。產物位於：

```text
src-tauri\target\release\bundle\nsis\
```

### 瀏覽器插件安裝

- 當「瀏覽器」標籤顯示「瀏覽器不可用」時，按一下按鈕即可執行 install-playwright-chromium 單操作程式。
- 在安裝 Chromium 之前，「瀏覽器」標籤會隱藏在中間區域，僅在安裝完成後才會顯示。
- 安裝完成後，應用程式會同時接受 %APPDATA%\aipc-agent\playwright-browsers 和 Playwright 的預設路徑 ms-playwright，然後自動顯示「瀏覽器」標籤。


---

## 內建 SOP

| SOP | 說明 | 需要管理員 |
|-----|------|-----------|
| `install-ollama` | 靜默下載安裝 Ollama | 是 |
| `pull-llm-model` | 下載預設 LLM 模型 | 否 |
| `install-chrome` | 靜默安裝最新版 Google Chrome | 是 |
| `remove-copilot` | 停用並移除 Windows Copilot | 是 |
| `backup-system` | 建立 Windows 系統還原點 | 是 |
| `install-office` | 透過 Winget 安裝 LibreOffice | 是 |
| `install-steam` | 靜默安裝 Steam | 是 |
| `install-winhance` | 安裝 WinHance Windows optimization utility | 是 |
| `check-drivers` | 觸發 Windows Update 與驅動掃描 | 是 |
| `install-language-en-us` | 安裝英文語言包並保留既有語言清單 | 是 |
| `install-language-zh-tw` | 安裝繁體中文語言包並保留既有語言清單 | 是 |
| `install-language-zh-cn` | 安裝簡體中文語言包並保留既有語言清單 | 是 |
| `install-language-ja` | 安裝日文語言包並保留既有語言清單 | 是 |

---

## 檔案格式規格

- `skills/<slug>/SKILL.md`
  第一行固定為 `---`，然後 `name: <slug>` ，遵循 [agentskills.io](https://agentskills.io) 格式製作
- `sops/*.md`
  第一行固定為 `# AI PC Agent SOP File v1`
- `exps/exp-yyyymmdd.md`
  第一行固定為 `# AI PC Agent Experience Log - yyyymmdd`
- `plugins/*.js`
  第一行固定為 `// AI PC Agent Plugin File v1`

---

## 自訂 SOP

將 `.md` 檔放進開發目錄 `sops/`，或執行時目錄 `%APPDATA%\aipc-agent\sops\`。格式範例：

````markdown
# AI PC Agent SOP File v1

1. 基本資訊 (Metadata)
ID: my_sop_id
名稱: 我的自訂 SOP
分類: 工具
風險等級: 低

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11
權限: 一般使用者
網路: 否

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell):
```powershell
$false
```

第二階段：安裝 (Install)
指令 (PowerShell):
```powershell
Write-Host "正在執行..."
```

第三階段：驗證 (Verify)
指令 (PowerShell):
```powershell
$true
```
````

重新整理頁面後，系統會重新掃描並載入新的 SOP。

---

## winget 商店推薦

當使用者詢問推薦軟體，而現有 SOP 沒有直接對應項目時，AI 現在會先查詢 winget 商店候選軟體，再列出推薦名稱。

- 若使用者只想看推薦，AI 會直接回推薦清單
- 若使用者指定某一套軟體，AI 可直接產生對應 SOP
- 新產生的 SOP 會寫入 `%APPDATA%\aipc-agent\sops\`
- 產生完成後，左側 `SOP 清單` 會自動刷新

### Microsoft Store / UWP

- 若使用者明確提到 `Microsoft Store`、`UWP`、`商店版`，AI 會優先改用 `msstore` 來源搜尋
- 可依結果建立對應 SOP，安裝與解除安裝會走 `winget --source msstore`

### GitHub Releases

- 若使用者明確要找 `GitHub` 上的 Windows App，AI 會搜尋 repository 與 release assets
- 只會挑有明確 Windows `.exe` / `.msi` / `.zip` release asset 的候選
- 若建立 SOP，預設產生的是「下載型 SOP」：下載到 `Downloads\AI PC Agent Downloads`，並支援驗證與移除下載檔

---

## 專案結構

```text
aipc-agent/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── index.js
│   ├── llm.js
│   ├── server.js
│   ├── sop-executor.js
│   ├── sop-parser.js
│   └── system.js
├── plugins/
│   ├── hardware-info.js
│   └── temperature-monitor.js
├── skills/
│   ├── app-install-and-repair/SKILL.md
│   ├── backup-restore/SKILL.md
│   ├── browser-research-and-edit/SKILL.md
│   ├── desktop-agent/SKILL.md
│   ├── developer-tools-assistant/SKILL.md
│   ├── game-research/SKILL.md
│   ├── github-releases/SKILL.md
│   ├── manager/SKILL.md
│   ├── media-editing-assistant/SKILL.md
│   ├── microsoft-store/SKILL.md
│   ├── office-excel-assistant/SKILL.md
│   ├── ollama/SKILL.md
│   ├── photoshop-workflow/SKILL.md
│   ├── virtualization-sandbox/SKILL.md
│   ├── windows-network-troubleshoot/SKILL.md
│   ├── windows-printer-troubleshoot/SKILL.md
│   ├── windows-storage-recovery/SKILL.md
│   └── winget-store/SKILL.md
├── sops/
│   ├── backup-system/SOP.md
│   ├── backup-user-files/SOP.md
│   ├── check-drivers/SOP.md
│   ├── install-chrome/SOP.md
│   ├── install-language-en-us/SOP.md
│   ├── install-language-ja/SOP.md
│   ├── install-language-zh-cn/SOP.md
│   ├── install-language-zh-tw/SOP.md
│   ├── install-office/SOP.md
│   ├── install-ollama/SOP.md
│   ├── install-playwright-chromium/SOP.md
│   ├── install-steam/SOP.md
│   ├── pull-llm-model/SOP.md
│   ├── remove-copilot/SOP.md
│   └── restore-user-files/SOP.md
├── src-tauri/
├── agents.md
├── aipc-spec.md
├── build.bat
├── package.json
└── verify-remove-copilot.ps1
```

---

## 近期更新

### 2026.06.03
- **版本更新**：套件版本更新為 `2026.06.03`。
- **日期上下文**：`/api/chat` 每輪注入今天、明天與時區，避免「明天天氣」被模型解析成舊日期。
- **即時資訊保底**：天氣、物價、新聞、匯率、股價與最新資訊若模型沒有主動輸出 Browser Use action，後端會自動補 current-info search，再由 Observe-after-Act 整理結果。
- **Browser Use fallback**：若 Playwright Chromium runtime 尚未安裝，會提醒使用者安裝，並盡量以文字/連結搜尋結果 fallback。
- **自動畫黑板**：計畫、比較、查詢摘要、天氣/物價/新聞或偏長回答會自動產生 Chalkboard 摘要，不再完全依賴模型主動輸出 `##CHALKBOARD##`。
- **關閉亂跳建議鈕**：停用 LLM suggestion buttons，避免與問題無關的安裝/任務按鈕干擾對話。

### 2026.05.28
- **版本更新**：套件版本更新為 `2026.05.28`。
- **Browser Use 即時查詢**：天氣、物價、新聞、股價、匯率、最新版本等即時資訊，AI 應優先使用 Browser Use，不再用 CLI 硬爬或只叫使用者手動搜尋。
- **真瀏覽器搜尋 fallback**：`/api/agent/browser-use` 的 `search` 模式在 HTML fetch 失敗或無結果時，會改用 Playwright Chromium 開搜尋頁並解析 DOM 結果。
- **Computer Use 邊界收斂**：Computer Use 定位為桌面、App、檔案、SOP 等本機操作，不作為一般網路搜尋工具。

### 2026.05.21
- **版本更新**：套件版本更新為 `2026.05.21`。
- **AI 卡住保護**：LLM 對話 timeout 統一收斂為 3 分鐘，遠端 AI queue 也會在逾時後釋放，避免其中一端卡住時整條協作鏈乾等。
- **Remote Chat 辨識度**：Remote User、Remote AI 與 remote system bubble 改用不同底色，和本機聊天泡泡更容易區分。
- **硬體查詢歸屬**：在 remote 模式下，磁碟容量、RAM、CPU、GPU 等未明確指定對方電腦的問題預設交給 Local AI，不再誤查對方機器。
- **Chalkboard 同步與歷史**：遠端連線成功後會主動推送本機既有黑板內容；接收遠端同步時保留 redo stack，避免 undo 後同步就不能 redo。

### 2026.05.20
- **版本更新**：套件版本更新為 `2026.05.20`。
- Added a remote validation checklist for `SUGGEST`, `INSTALL_SOP`, and dual-AI collaboration.
- Added duplicate remote directive diagnostics guidance with `Skipped duplicate remote directive` and `msg:<id>` correlation markers.

### 2026.05.14
- **遠端 Directive Protocol 標準化**：遠端 AI 建議按鈕統一採用結構化格式 `[SUGGEST: button_text="..." action="install_sop|add_task|execute_task|computer_use" ...]`，避免 UI 只顯示原始字串或點擊無效。
- **遠端 Action 直通執行**：遠端 AI 若回覆 `[ACTION:INSTALL_SOP ...]`、`[ACTION:ADD_TASK ...]`、`[ACTION:EXECUTE_TASK ...]` 或 `COMPUTER_USE`，前端現在會解析並在本機真正執行，不再只顯示文字。
- **遠端協作不阻塞**：當同時需要本地 AI 與遠端 AI 時，改為本地 AI 先回覆、遠端 AI 背景補充，減少兩邊互等造成的卡死體感。
- **Remote Chat 降閃爍**：遠端聊天室改用 render signature 跳過無變更重繪，降低 suggestion 按鈕與訊息列表每 2 秒閃爍的問題。
- **遠端 AI 排隊回覆**：同一個 remote session 的 remote-AI 任務現在會依序排隊，避免上一題晚回、下一題插隊，導致重複回答或答非所問。

### 2026.05.13
- **版本更新**：套件版本更新為 `2026.05.13`。
- **遠端雙 AI 與 Chalkboard**：強化 AI 主動落板規則；本地 AI 寫左側、遠端 AI 寫右側，並以 `clear:false` 避免互相覆蓋。
- **遠端硬體查詢修正**：遠端聊天室詢問「本機 / 自己電腦」磁碟、RAM、CPU、GPU 時，預設交給本地 AI 回答，避免拿到對方電腦資訊。
- **Chat UI 調整**：本機聊天工具列改為「新增對話、附上 Chalkboard、清除對話」，麥克風移到送出鈕上方。
- **遠端聊天 UI 調整**：遠端連線設定改為可收合抽屜；底部新增「附上檔案」與掛電話中斷按鈕。
- **Skills 清單**：左側新增 Skills tab，列出現有 `skills/<slug>/SKILL.md`。
- **Action 回報修正**：強化 `ACTION` / `Action=Computer_Use...` 解析，Browser Use / Computer Use 執行後會回報成功或失敗摘要。

### 2026.05.06
- **版本更新**：套件版本更新為 `2026.05.06`。
- **畫面傳送語意**：將「分享畫面」改為「傳送畫面」，並在擷取前提醒對方可查看該畫面內容，避免誤傳機敏資訊。
- **移除分享模型入口**：遠端連線後改走雙 AI 分工協作，不再需要額外「分享模型」按鈕或模型接管流程；舊 model-share API 已停用。
- **雙 AI 分工**：遠端聊天室未指定對象時，本地 AI 先提供輔助筆記，遠端 AI 再彙整回覆；使用者仍可用 `@本地 AI` / `@遠端 AI` 指定單一 AI。
- **斷線提示**：對方中斷連線時，聊天窗會顯示「對方已斷線」。
- **一般對話修正**：AI 不再把所有話題硬導向安裝軟體或 SOP；一般聊天、知識、創作與生活話題會直接自然回答。

### 2026.05.05
- **版本更新**：套件版本更新為 `2026.05.05`。
- **遠端模型共享資訊**：當時曾補上分享模型請求的模型資訊顯示；此入口已在 `2026.05.06` 改為移除，改採遠端雙 AI 分工。
- **遠端連線提示**：連線請求視窗補上說明文字，讓使用者清楚知道接受後雙方與 AI 對話可互通。
- **Chalkboard 協作同步**：遠端連線時，雙方使用者或 AI 寫入 Chalkboard 後會同步到對方；黑板正在互動時暫停傳送，idle 約 1 秒後才送出最新畫面。
- **AI 思考狀態**：新增遠端 `ai_status`，清楚顯示 `本地 AI: 思考中` 或 `遠端 AI: 思考中`，結束後回到 `待命`。

### 2026.04.14
- **AgentSkills.io 規格遷移**：全面升級 `skills` 與 `sops` 目錄結構，支援 `<slug>/SKILL.md` 及 `<slug>/SOP.md`。支援 YAML Frontmatter 提供更豐富的中繼資料與精準按需載入 (On-demand Context)。
- **版本更新**：套件版本更新為 `2026.04.14`。
- **UI 互動體驗**：完善任務卡片的按鈕防抖與鎖定機制（Disabled state），給予即時的操作回饋。
- **Agent 工作流**：確立 Planner -> Builder -> Learn 流程。
- **Browser Runtime**：Playwright Chromium 改為啟動後按需安裝，成功載入後自動顯示 Browser 分頁，不需重啟程式。

### 2026.04.10
- **版本更新**：套件版本更新為 `2026.04.10`。
- **AI 空白回覆修復**：當回覆只含 action 控制碼時，後端會回填可讀摘要，不再出現空白訊息。
- **Browser/Computer Use 測試放寬**：移除 `top-tier VLM` 的硬性阻擋訊息，保留 VM-safe 行為約束。
- **遊戲影片連結可用性過濾**：YouTube 連結回傳前先做可播放檢查，降低失效影片比例。
- **無 NVIDIA 顯卡降噪**：`ENOENT` 不再重複刷 `[TemperatureMonitor] nvidia-smi not available`。
- **Chalkboard 控制碼渲染**：僅 `##CHALKBOARD## ... ##ENDCHALKBOARD##` 區塊會落板，避免每句回覆都畫黑板。
- **UI 視覺修補**：粉筆與板擦尺寸調整、dark theme 連結可讀性提升、light theme 背景改乳白。

### 2026.04.01
- **Tauri EXE 硬體偵測修復**：`hardware-info` 改為 PowerShell EncodedCommand 執行，並在 `Get-PhysicalDisk` 失敗時 fallback 到 `Win32_DiskDrive`，改善 HDD 資訊缺失。
- **NVIDIA 探測穩健化**：`temperature-monitor` 改為 `execFile` + 多路徑尋找 `nvidia-smi.exe`，封裝環境下更容易取得 GPU 資訊。
- **錯誤訊息去亂碼**：`nvidia-smi` 失敗時改顯示錯誤碼摘要（如 `ENOENT`），避免碼頁亂碼日誌。
- **黑板落稿座標修正**：文字落稿改為完全跟隨 8 點框尺寸，並在指標換算時加入邊界 clamp，修正框與落稿不同步。
- **黑板 8 點框跟手修正**：文字框左右縮放改為直接採用即時游標位置計算邊界，解決拖曳時框體偏左/偏右。
- **拖曳中 resize 同步修正**：畫布尺寸改變時，會同步縮放 `textManipulation` 的原點與 anchors，避免 8 點框與游標脫鉤。
- **字級隨框縮放**：文字框拉大/拉小時，`fontSize` 與 `lineHeight` 會依框體內可用區域動態重算，預覽與落稿一致。
- **Desktop Agent 工作流 (SOP 強化)**：
  - 新增財報代理流程：可偵測試算表環境、定位 `*.xlsx`、抓取 NVIDIA 最新財報摘要（SEC API），並在 Excel 可用時自動寫入活頁簿。
  - 若缺少試算表工具，會分流詢問「安裝 Office 相容工具」或「改用 Google Sheets web」。
  - 新增遊戲攻略/影片代理流程：自動網頁蒐集後回傳 Markdown 結果，並附 `Chalkboard 摘要草稿`。
  - 新增 Agent action：`OPEN_FILE`、`OPEN_URL`。
- **Browser Use / Computer Use 分級**：
  - Browser Use（內宇宙）：`/api/agent/browser-use`，提供 `search/open/fetch_title`。
  - Computer Use（外宇宙）：`/api/agent/computer-use`，提供 `open_file/open_url/install_sop`。
  - 新增 `/api/agent/capability`：需 `top-tier + vision` 模型才允許進入 Browser/Computer Use。
- **xlsx 寫入強化**：
  - 財報更新改為多策略：`Excel COM` → `WPS COM` → `OpenXML` 直寫，降低環境相依性。
- **Chalkboard API 直寫**：
  - 新增 `/api/chalkboard/draft`，AI 回覆可附 `chalkboardDraft`，前端會自動落板成重點草稿。
  - Agent 落板前會先清除舊內容，再以粉筆字重畫，並依實際包行高度排版，避免字重疊。
- **內宇宙 / 外宇宙**：
  - 內宇宙（Browser Use）：偏向瀏覽器內資源取得與編輯。
  - 外宇宙（Computer Use）：偏向桌面操作，預設先 VM sandbox（如 VirtualBox）再執行，減少對主機干擾。
- **Skills/SOP 懶載入**：
  - 不再於 system prompt 預載所有 Skills。
  - 改為依對話內容動態挑選相關 Skill/SOP 摘要注入（on-demand context），降低 context size。
- **新增技能庫（skills）**：
  - Photoshop、Backup/Restore、App 安裝修復、Office/Excel、Browser research、Network/Printer、Storage recovery、VM sandbox、Developer tools、Media editing。
- **新增 SOP（多步驟）**：
  - `sops/backup-user-files.md`
  - `sops/restore-user-files.md`
- **本機對話 Tab 化**：上方聊天模式改為本機多對話 tab + 遠端 tab；本機新增對話支援 `x` 關閉。
- **新增對話按鈕位置調整**：`+` 移到聊天輸入工具列，位於「清除對話」左側。
- **Chalkboard Resize 重繪強化**：resize 後會重算 `selectionRect / pendingTextRect` 與互動座標，並重建文字預覽，降低縮放糊化與偏移復發。

### 2026.03.30
- **遠端 AI 聊天室**：支援區域網路互連 (19168 TCP)，雙方 AI 與使用者可進行多方通訊。
- **模型共享 (Model Share)**：此版曾支援本機模型分享；已於 `2026.05.06` 移除，改走遠端雙 AI 分工。
- **協作輔助**：包含畫面分享另存、多對話紀錄管理 (Session Chips)，以及 `@mention` 對象標記功能。


### 2026.03.29

- **Chalkboard Resize 落稿框校正**：
  - 拖拉 log 窗、sidebar 或 chat 欄縮放後，文字落稿框與 8 點控制框現在會同步按比例重新映射，不再偏移。
  - 三個 panel resizer 的 setSize callback 均補上 `resizeChalkboardCanvas()` 觸發。
  - `resizeChalkboardCanvas()` 在 resize 後對 `pendingTextRect` 按新舊尺寸比例縮放，確保落稿位置始終與 canvas 內容對齊。

### 2026.03.28

- **深度國際化補完**：
  - 各大雲端與地端 AI Provider 的使用說明、推薦模型範例已完整支援中英切換。
  - 模型測試工具 (Test Model) 按鈕狀態、警示與日誌成功實作雙語化。
  - 對話框上方預設建議按鈕 (如 `Install Chrome`) 能隨語系自動切換。
  - 大幅清理早期的生成式 `*.i18n.js` 檔案，減少結構混亂。
- **選單系統 (File Menu)**：
  - `index.html` 導入下拉式檔案選單。
  - 將 `匯出任務`、`匯入任務` 統一整合，維持版面簡潔，並提供 `Refresh` 與 `Exit` 便捷操作。

### 2026.03.26

- **國際化完善**：
  - AI Engine Settings dialog 中的所有標籤現在根據語系自動翻譯，英文模式下完全無中文殘留。
  - AI chat 在英文模式下會使用英文 system prompt，確保 AI 回覆語言一致。
  - 經驗庫的時間戳與空狀態文案也根據 locale 翻譯。
- **經驗庫卡片排序修正**：
  - 知識庫卡片現在按時間戳倒序排列，最新的經驗記錄顯示在最前面。
  - 之前最新的記錄在最下方的問題已解決。
- **多來源軟體推薦能力擴充**：
  - AI 現在除了 `winget-store` 之外，也支援 `microsoft-store` 與 `github-releases` 兩條推薦路徑。
  - 使用者若明確偏好 `Microsoft Store / UWP`，系統會改走 `msstore` 來源搜尋與建立 SOP。
  - 使用者若要找 GitHub 上的 Windows App，系統會搜尋 repository 與 release assets，並只挑有明確 Windows 安裝檔或壓縮包的候選。
- **內容規格英文化**：
  - `sops/*.md`、`skills/*.md`、`plugins/*.js`、經驗庫/*.md` 的格式規格與內容骨架已改為英文，方便後續國際化與多語系 UI。
  - `sop-parser.js` 保留中英雙語欄位相容，既有舊版中文 SOP 仍可被正確解析。

### 2026.03.25

- **經驗庫視覺進化**：
  - 工作日誌右側經驗庫 tab 重塑為「知識庫」風格，卡片更緊湊。
  - 摘要預設限制顯示 3 行，滑鼠懸停 (Hover) 時自動展開內容。
  - 新增「⬇ 匯出」按鈕，可將累積經驗匯出為 Markdown。
  - 安裝任務結束後，自動將 log 摘要寫入 `%APPDATA%\aipc-agent\經驗庫\exp-yyyymmdd.md`。
- **視窗持久化與最大化**：
  - 程式現在會記住上次視窗大小與位置，下次開啟自動還原。
  - 首次啟動預設以最大化視窗呈現。
- **軟體與硬體感知優化**：
  - Ollama 安裝 SOP 改為非提權 (User mode) 流程。
  - 修正 Qwen3.5 模型名稱 (4B) 與下載大小 (2.6GB) 描述。
  - 強固 GPU 監控邏輯，優先採用 nvidia-smi 並提供計數器 fallback，解決 Tauri packaged 環境下顯示失效問題。
- **封裝環境的指令與體驗修正 (Tauri EXE)**：
  - 修正 Tauri EXE 環境下 `hardware-info.js` 因雙引號干擾導致的指令錯誤，恢復磁碟與 GPU 狀態監控。
  - 新增 `/api/chalkboard/export-file` API 端點與 PowerShell `SaveFileDialog` 實作，修復黑板畫布在封裝模式下無法原生匯出 PNG 的問題。
- **Chalkboard 畫布互動與多模態**：
  - 中央 `Chalkboard` 改為真正可互動的黑板畫布，支援白、紅、黃、綠、藍粉筆與局部板擦。
  - 黑板改為深綠色材質風格，底部加入粉筆托盤、板擦、粗細切換、Undo、清空、上傳圖片與存成圖片。
  - 加入直線、矩形、圓形工具，支援像一般繪圖軟體那樣預覽與落筆。
  - 上傳圖片後可在黑板上拖曳放置範圍與大小。
  - 黑板啟動時會先以粉筆字顯示歡迎詞，首次互動後切換為教學提示；提示字也可被板擦擦除。
  - 歡迎畫面階段會先鎖住黑板工具列，必須先點一下黑板進入可畫模式後才解鎖。
  - `T` 文字工具升級為設定視窗，可輸入文字、選字型、選字型風格、調字級、文字顏色、對齊、粗體與斜體，再到黑板上放置、移動與縮放文字框。
  - 文字字型目前支援 `標楷體`、`微軟正黑體`、`黑體`、`細明體`、`Arial`、`Times New Roman`、`Courier New`。
  - 右側聊天列新增 `Chalkboard` 附圖按鈕，可切換是否把黑板內容一併送給 AI。
  - AI Provider 設定視窗新增 `Vision 多模態模型` 欄位，可指定圖片理解模型；留空時會自動挑選。
  - 當本輪有附圖時，AI 會優先以當前圖片理解使用者意圖，不再被上一張圖的描述污染。
  - 黑板新增選取、複製、剪下、貼上與 clipboard 支援，可把選取區當成圖片重新貼回黑板放置。

### 2026.03.24

- 任務完成後，AI 對話區會回報 `success`、`failed`、`skipped`。
- SOP 載入時會依 `id` 去重，優先使用正式檔名。
- 內建 SOP、skill、plugin 內容更新後會同步到 `%APPDATA%\aipc-agent\`。
- `Verify` 階段若明確輸出 `false`，會視為真正失敗。
- 工作日誌只在使用者停在底部時自動捲動。
- 版本號改由 `/api/meta` 從 `package.json` 讀取。
- EXE 啟動時會先顯示 splash，再於背景啟動 Node sidecar。
- 語系 SOP 已拆分為 `en-US`、`zh-TW`、`zh-CN`、`ja-JP` 四支。
- 需要管理員權限的 SOP 會共用 UAC 提權執行器。
- 右側 AI 對話欄可往左拖拉到工作區一半寬度。
- 左側 sidebar 新增 `SOP 清單` tab，可列出所有 SOP 並支援加入任務與立即執行。

---

## 常見問題

**Q: PowerShell 顯示 `scripts is disabled`？**

```powershell
powershell -ExecutionPolicy Bypass -Command "npm install"
powershell -ExecutionPolicy Bypass -Command "npm run start"
```

**Q: 為什麼有些 SOP 會跳出 UAC 視窗？**  
因為這些 SOP 需要系統管理員權限。現在 install 階段會自動走共用提權流程，若使用者取消 UAC，任務會直接失敗。

**Q: 新增 SOP 後沒有出現？**  
確認檔案放在 `sops/` 或 `%APPDATA%\aipc-agent\sops\`，再重新整理頁面。

**Q: AI 指示燈是紅色或黃色？**  
通常代表 Ollama 尚未安裝、未啟動，或模型尚未下載完成。

---

## 開發說明

- 開發日誌請見 `agents.md`。
- 產品規格請見 `aipc-spec.md`。
- 目前套件版本：`2026.06.03`。
