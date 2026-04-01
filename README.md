# AI PC Agent

> 本地優先、無命令列、具備感知能力的 Windows 系統管家  
> by [anomixer](https://github.com/anomixer)

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-0.17%2B-blue)](https://ollama.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4)](https://www.microsoft.com/windows)

---

## 這是什麼？

AI PC Agent 是一個跑在本機上的 Windows 系統自動化工具。你可以直接用中文描述需求，或從推薦清單點選項目，系統會替你建立任務、執行 SOP、驗證結果，並把完整過程顯示在 UI 與工作日誌中。

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

### 3. 啟動開發伺服器

```powershell
npm run start
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
| `check-drivers` | 觸發 Windows Update 與驅動掃描 | 是 |
| `install-language-en-us` | 安裝英文語言包並保留既有語言清單 | 是 |
| `install-language-zh-tw` | 安裝繁體中文語言包並保留既有語言清單 | 是 |
| `install-language-zh-cn` | 安裝簡體中文語言包並保留既有語言清單 | 是 |
| `install-language-ja` | 安裝日文語言包並保留既有語言清單 | 是 |

---

## 檔案格式規格

- `sops/*.md`
  第一行固定為 `# AI PC Agent SOP File v1`
- `exps/exp-yyyymmdd.md`
  第一行固定為 `# AI PC Agent Experience Log - yyyymmdd`
- `skills/*.md`
  第一行固定為 `# AI PC Agent Skill File v1`
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
│   ├── manager.md
│   ├── ollama.md
│   ├── winget-store.md
│   ├── microsoft-store.md
│   └── github-releases.md
├── sops/
│   ├── backup-system.md
│   ├── check-drivers.md
│   ├── install-chrome.md
│   ├── install-language-en-us.md
│   ├── install-language-ja.md
│   ├── install-language-zh-cn.md
│   ├── install-language-zh-tw.md
│   ├── install-office.md
│   ├── install-ollama.md
│   ├── install-steam.md
│   ├── pull-llm-model.md
│   └── remove-copilot.md
├── src-tauri/
├── agents.md
├── aipc-spec.md
├── build.bat
├── package.json
└── verify-remove-copilot.ps1
```

---

## 近期更新

### 2026.04.01
- **Tauri EXE 硬體偵測修復**：`hardware-info` 改為 PowerShell EncodedCommand 執行，並在 `Get-PhysicalDisk` 失敗時 fallback 到 `Win32_DiskDrive`，改善 HDD 資訊缺失。
- **NVIDIA 探測穩健化**：`temperature-monitor` 改為 `execFile` + 多路徑尋找 `nvidia-smi.exe`，封裝環境下更容易取得 GPU 資訊。
- **錯誤訊息去亂碼**：`nvidia-smi` 失敗時改顯示錯誤碼摘要（如 `ENOENT`），避免碼頁亂碼日誌。
- **黑板落稿座標修正**：文字落稿改為完全跟隨 8 點框尺寸，並在指標換算時加入邊界 clamp，修正框與落稿不同步。
- **本機對話 Tab 化**：上方聊天模式改為本機多對話 tab + 遠端 tab；本機新增對話支援 `x` 關閉。
- **新增對話按鈕位置調整**：`+` 移到聊天輸入工具列，位於「清除對話」左側。
- **Chalkboard Resize 重繪強化**：resize 後會重算 `selectionRect / pendingTextRect` 與互動座標，並重建文字預覽，降低縮放糊化與偏移復發。

### 2026.03.30
- **遠端 AI 聊天室**：支援區域網路互連 (19168 TCP)，雙方 AI 與使用者可進行多方通訊。
- **模型共享 (Model Share)**：可將本機模型分享給遠端代理使用，由授權端決定是否接管。
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
- 目前套件版本：`2026.04.01`。
