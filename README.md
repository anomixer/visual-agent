# Visual Agent Beta

> 當前版本：**2026.8.7** · 官方網站：https://anomixer.github.io/visual-agent/

> [!NOTE]
> **本程式目前建議視為 public preview 候選版本**。它已能完成主要本地 Agent 工作流，但仍可能因模型、Browser runtime、Windows 權限或網路狀態而失敗。執行系統變更前請先確認任務內容。

> 可視化、可塗鴉、可協作的 AI 管家
> by [anomixer](https://github.com/anomixer)

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-0.17%2B-blue)](https://ollama.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4)](https://www.microsoft.com/windows)

English: [README-en.md](./README-en.md)

---

## 這是什麼？

**Visual Agent** 是一個運行於本地端、兼具安全感知與自我進化能力的 Windows 系統自動化管家。我們拋棄了傳統命令行（CLI）Agent 的高風險操作與簡陋介面，打造出**純圖形介面 (Pure-GUI)** 的視覺化控制中心。

不僅能透過直觀的對話與標準作業程序（SOP）來自動化設定、監控與修復您的 PC，更具備以下突破性優勢：

- **🌐 Double Agent Mode**：支援兩台實體電腦透過專用通訊協議連線，本地 AI 先答、遠端 AI 隨後補充，輕鬆實現多機協同對話與管理。或請遠端朋友與AI一起幫你解決電腦問題。
- **🎨 互動式 Chalkboard 共享**：內建粉筆畫布與多模態視覺理解。遠端連線時可即時共享 Chalkboard快照，隨手塗鴉、放圖、標記即可讓 AI 看懂並提供精準建議。
- **📊 圓圈式 (Circular Gauge) 硬體環形監控**：即時探測 CPU、GPU、RAM、Disk，並能透過專屬插件精準監控 NVIDIA 顯示卡的溫度、VRAM 與即時負載。
- **🔍 Browser Use 聯網即時查詢**：當本地知識不足時，AI 能夠自動呼叫 Browser Use 搜尋、抽取來源頁面文字並整理答案，支援天氣、新聞與最新股價等即時資訊。
- **⚡ 雙向自動化軟體管理**：整合 winget、Microsoft Store、GitHub Releases，為 Chrome、Steam、Office 等常用工具打造防錯的「安裝與移除」雙向 SOP 執行鏈。
- **⚗️ 整合 19 個 Hermes Agent 領域知識庫**：融合來自 NousResearch 專業級 Hermes Agent 的 19 大領域 Skills，在 AI 對話時動態注入，涵蓋 Data Science、DevOps、Red Teaming、自動化代理等深度背景，回答更專業。
- **🛡️ Consent-before-action 安全防護**：AI 執行任何系統變更（如安裝、修改設定）前，均會先將其新增至待辦任務清單，等待使用者手動點擊確認後才執行，防止無人值守的自動修改與潛在風險。
- **🧠 經驗學習與自我進化**：每次任務執行的成敗皆會沉澱至本地經驗庫（Exp），AI 會自動讀取並進行敏感資訊遮罩，並在下一次類似任務中主動避坑，實現軟體層面的持續進化。

```text
你說：「幫我移除 Copilot」
它就：建立任務 -> 提示建議執行按鈕 -> 您點擊確認 -> 提權執行 SOP 內容 -> 修改系統設定 -> 驗證結果 -> 寫入經驗庫
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
| Chalkboard | 中央 Chalkboard支援粉筆塗寫、局部板擦、圖形、圖片放置、文字框與 PNG 匯出 |
| 硬體監控 | 顯示 CPU、GPU、RAM、Disk 與 NVIDIA GPU 溫度資訊 |
| 插件系統 | 可用 `.js` 擴充系統監控能力 |
| 自動初始化 | 首次執行可自動安裝 Ollama 與預設模型 |
| Tauri 打包 | 可打包成獨立 Windows EXE，Node 後端以 sidecar 方式隨附 |

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

如果你只想快速體驗，優先走 Releases 下載安裝版：

1. 到 GitHub Releases 下載最新的 Windows `setup.exe`。
2. 直接執行安裝檔完成 setup。
3. 雙擊 `Visual Agent` 執行檔即可。
4. 首次啟動會自動完成環境檢查與初始化。

如果你要從原始碼跑：

### 1. 複製專案

```bash
git clone https://github.com/anomixer/visual-agent.git
cd visual-agent
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

## 介面說明

第一次進入後，先看這幾個地方：

- 右下角可以切換語言。
- 右上角可以設定 AI 供應商與模型。
- 設定完成後，就可以在右側 AI 交談窗直接和 AI 對話。
- 中間的 Chalkboard 可以塗鴉、貼照片，讓 AI 辨識內容。
- 需要 Browser 查詢時，點 `檢視 -> Browser -> 安裝`。
- 需要安裝或維護電腦時，看左邊的推薦清單與 SOP 清單；按 `+` 可加入任務清單，按 `Play` 可直接執行。
- 需要和朋友互連時，先點右上角遠端 AI，再輸入對方 IP 位置即可連線。
- 連線後可 tag 自己或對方的 AI，請它幫忙或回話。
- 還有很多有趣功能，歡迎自行摸索。

---

## AI 對話與 Provider

### 本機 Ollama

系統可自動偵測 Ollama 是否存在，若缺少則可透過內建 SOP 安裝，並下載預設模型 `gemma4:e2b-it-qat`。當 UI 顯示 `AI 就緒` 時，就可以直接在右側對話區輸入需求。

### 其他 Provider

- OpenAI、Groq、DeepSeek、Mistral、Together AI、Gemini 走 OpenAI-compatible 流程。
- Gemini 可使用 Google 的 OpenAI-compatible 入口。
- Anthropic Claude 使用原生認證與原生 `/v1/messages`。
- Customer Provider 支援 API Key 與 OAuth 2.0 Client Credentials。

### Browser Runtime

- Browser tab 使用 Playwright Chromium。
- Browser runtime ready 狀態由 `/api/meta.browserExecutable` 驗證，接受 Playwright cache 內的 `chrome-headless-shell.exe` 或 `chrome.exe`。
- 若第一次啟動顯示 Browser 不可用，請執行 `install-playwright-chromium` SOP 補裝。
- 這樣可避免把 Chromium 綁進 MSI / EXE，安裝包會維持較小。

---

## 打包為 EXE

開發者可直接執行 [build.bat](./build.bat)：

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
- 安裝完成後，應用程式只會接受 `%APPDATA%\visual-agent\playwright-browsers` 內的 Visual Agent 自管瀏覽器 runtime，然後自動顯示「瀏覽器」標籤。這可避免誤判系統全域 Playwright cache（例如 `%LOCALAPPDATA%\ms-playwright`）裡的瀏覽器。


---

## 內建 SOP

| SOP | 說明 | 需要管理員 |
|-----|------|-----------|
| `install-ollama` | 靜默下載安裝 Ollama | 是 |
| `pull-llm-model` | 下載預設 LLM 模型 | 否 |
| `install-chrome` | 靜默安裝最新版 Google Chrome | 是 |
| `remove-copilot` | 停用並移除 Windows Copilot | 是 |
| `backup-system` | 建立 Windows 系統還原點 | 是 |
| `backup-user-files` | 備份使用者檔案 | 是 |
| `restore-user-files` | 還原使用者檔案 | 是 |
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
  第一行固定為 `# Visual Agent SOP File v1`
- `exps/exp-yyyymmdd.md`
  第一行固定為 `# Visual Agent Experience Log - yyyymmdd`
- `plugins/*.js`
  第一行固定為 `// Visual Agent Plugin File v1`

---

## 自訂 SOP

將 `.md` 檔放進開發目錄 `sops/`，或執行時目錄 `%APPDATA%\visual-agent\sops\`。格式範例：

````markdown
# Visual Agent SOP File v1

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
- 新產生的 SOP 會寫入 `%APPDATA%\visual-agent\sops\`
- 產生完成後，左側 `SOP 清單` 會自動刷新

### Microsoft Store / UWP

- 若使用者明確提到 `Microsoft Store`、`UWP`、`商店版`，AI 會優先改用 `msstore` 來源搜尋
- 可依結果建立對應 SOP，安裝與解除安裝會走 `winget --source msstore`

### GitHub Releases

- 若使用者明確要找 `GitHub` 上的 Windows App，AI 會搜尋 repository 與 release assets
- 只會挑有明確 Windows `.exe` / `.msi` / `.zip` release asset 的候選
- 若建立 SOP，預設產生的是「下載型 SOP」：下載到 `Downloads\Visual Agent Downloads`，並支援驗證與移除下載檔

---

## 專案結構

```text
visual-agent/
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
│   ├── [Visual Agent 原生 × 18]
│   │   ├── app-install-and-repair/SKILL.md
│   │   ├── backup-restore/SKILL.md
│   │   ├── browser-research-and-edit/SKILL.md
│   │   ├── desktop-agent/SKILL.md
│   │   ├── developer-tools-assistant/SKILL.md
│   │   ├── game-research/SKILL.md
│   │   ├── github-releases/SKILL.md
│   │   ├── manager/SKILL.md
│   │   ├── media-editing-assistant/SKILL.md
│   │   ├── microsoft-store/SKILL.md
│   │   ├── office-excel-assistant/SKILL.md
│   │   ├── ollama/SKILL.md
│   │   ├── photoshop-workflow/SKILL.md
│   │   ├── virtualization-sandbox/SKILL.md
│   │   ├── windows-network-troubleshoot/SKILL.md
│   │   ├── windows-printer-troubleshoot/SKILL.md
│   │   ├── windows-storage-recovery/SKILL.md
│   │   └── winget-store/SKILL.md
│   └── [From Hermes Agent × 19]
│       ├── hermes-apple/SKILL.md
│       ├── hermes-autonomous-ai-agents/SKILL.md
│       ├── hermes-creative/SKILL.md
│       ├── hermes-data-science/SKILL.md
│       ├── hermes-devops/SKILL.md
│       ├── hermes-dogfood/SKILL.md
│       ├── hermes-email/SKILL.md
│       ├── hermes-github/SKILL.md
│       ├── hermes-index-cache/SKILL.md
│       ├── hermes-media/SKILL.md
│       ├── hermes-mlops/SKILL.md
│       ├── hermes-note-taking/SKILL.md
│       ├── hermes-productivity/SKILL.md
│       ├── hermes-red-teaming/SKILL.md
│       ├── hermes-research/SKILL.md
│       ├── hermes-smart-home/SKILL.md
│       ├── hermes-social-media/SKILL.md
│       ├── hermes-software-development/SKILL.md
│       └── hermes-yuanbao/SKILL.md
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
├── spec.md
├── build.bat
├── package.json
└── verify-remove-copilot.ps1
```

---

## 開發日誌

完整版本歷程與開發紀錄已集中整理於 [agents.md](agents.md)。README 保留安裝、使用與專案結構說明，避免主文件被 history log 稀釋。

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
確認檔案放在 `sops/` 或 `%APPDATA%\visual-agent\sops\`，再重新整理頁面。

**Q: AI 指示燈是紅色或黃色？**
通常代表 Ollama 尚未安裝、未啟動，或模型尚未下載完成。

**Q: AI 看不懂附上的 Chalkboard 圖？**
Chalkboard 附件會以裁切後 PNG 傳送；目前文字模型不支援辨識時，系統會直接告知「圖片已收到」。請在設定選擇支援圖片的 Vision Model，再重新送出；若仍失敗，請補上關鍵文字或改用較清楚的字跡/截圖。

**Q: `npm start` 立刻回到 prompt？**
通常是 `3210` 或 `19168` 已被另一個 Visual Agent 行程佔用。新版啟動時會顯示佔用 PID。請先關閉舊行程，或直接使用已在跑的 `http://localhost:3210`。

**Q: 要怎麼回報問題？**
點標題列「說明 → 診斷資訊」，複製診斷摘要，連同操作步驟與 debug log 末段一起附上。

**Q: 本 app 的 API 能被同一網路的其他裝置存取嗎？**
不能。本地 HTTP API 只綁定 `127.0.0.1`，僅供本機前端與 Tauri 使用；遠端雙機協作走的是獨立的點對點 TCP 協定（需雙方同意連線），不經由這個 API。

**Q: AI（含遠端 AI）回傳的內容會不會執行網頁指令？**
不會。所有 AI / 遠端 peer 回傳內容在顯示前都會經 `DOMPurify` 淨化，剝除 event handler 與危險 URI，僅保留文字、表格、連結與程式碼。

**Q: 開發時怎麼跑測試？**
`npm test`——語法檢查（全部自研 JS）+ 起 server 冒煙（打 `/api/meta`、`/api/diagnostics`）。不依賴 Ollama / 網路 / 顯示卡。

---

## Contribute

歡迎大家一起 contribute 想法、修正與新功能提案。

這個專案本來就偏實驗性，很多設計都是在做新的協作方式與互動模式，例如：

- 雙人協作 / Double Agent Mode
- Chalkboard 協作
- SOP / Skills 的自動化流程
- 即時查詢、Agent Loop、Browser Use
- 各種你覺得更順手、更好玩的 UI / workflow

如果你有更好的做法，歡迎直接開 issue、提 PR，或先丟想法討論。我們很歡迎把這個專案一起往更有趣、更實用的方向推進。

---

## 開發說明

- 開發日誌請見 [agents.md](./agents.md)。
- 產品規格請見 [spec.md](./spec.md)。
- 目前套件版本：`2026.8.7`。
