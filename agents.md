# Visual Agent 開發日誌

> 本地優先、無命令列、具備感知能力的 Windows 系統管家  
> by [anomixer](https://github.com/anomixer)

---

## 📌 2026.06.23 — Language SOP 安裝/卸載穩定化

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.23`。

### 品牌重命名
- 產品名稱由 `AI PC Agent` 全面改為 `Visual Agent`。
- repo / package / AppData 新路徑改用 `visual-agent`；因專案尚未公開發布，不保留舊 `aipc-agent` 相容層。
- 遠端雙 AI 協作模式正式命名為 `Double Agent Mode`；本地 AI / 遠端 AI 仍作為角色名稱保留在 UI 與協作規格中。
- 核心定位收斂為「可視化、可塗鴉、可協作的本地 AI PC Agent」。

### 多國語言 SOP 修正
- `install-language-en-us`、`install-language-zh-tw`、`install-language-zh-cn`、`install-language-ja` 的 Check / Install / Uninstall 流程改以目前使用者的 `Get-WinUserLanguageList` 為主要成功判準。
- 安裝時仍會優先嘗試 `Install-Language`，再 fallback 到 Windows Capability；但 OCR、Speech、TextToSpeech、Handwriting 等 optional capability 改為 best-effort warning，不再讓整個 SOP 因為 Windows 版本或功能包缺失而失敗。
- 卸載時先從使用者語言清單移除目標語系，`Uninstall-Language` 與 capability 移除改為 best-effort；若 Windows 保留底層語言包但使用者語言清單已移除，視為可接受結果。
- 保留原始 Windows 安裝語言與最後一個語言不可移除的安全檢查，避免把系統語言設定弄到不可用狀態。

## 📌 2026.06.17 — Chalkboard Markdown 表格純文字化

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.17`。

### Chalkboard 表格渲染修正
- AI 將 Markdown table 寫入 Chalkboard 時，不再直接把 `| 欄位 |` 與 `|---|` 畫到黑板上。
- 前端新增 Chalkboard 專用純文字正規化：偵測 Markdown table header / separator / row，並轉為 `欄位: 值 / 欄位: 值` 的短句格式。
- `##CHALKBOARD##` block、auto draft 與實際 canvas render 前都會套用同一層正規化，避免遠端同步或後端 draft normalization 後又把表格骨架帶回畫布。

## 📌 2026.06.12 — 搜尋品質、影片年份權重排序與本地黑板版面優化

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.12`。

### 本地黑板版面優化 (Local Chalkboard Layout Fix)
- **滿版呈現**：修復了本地聊天時，Chalkboard 摘要或 draft 預設只使用左半邊（`position: 'left'`）的 Bug。現在當非處於遠端協作模式時，本地聊天產生的黑板會自動以滿版（`position: 'full'`）呈現，充分利用螢幕寬度。

### DuckDuckGo 跳轉連結與 Lite 引擎遷移 (DDG Redirect & Lite Migration)
- **跳轉連結解析**：修正了原本以 `//duckduckgo.com` 開頭的協議相對跳轉連結無法被正確正常化為 `https:`，導致 parameter 解碼出錯並重新導向中間頁的問題。
- **Lite 引擎遷移**：將核心搜尋機制 `searchWebLinks` 從極易被 anti-bot 或 `202 Accepted` 挑戰阻擋的 `duckduckgo.com/html/` 遷移到極速、無 anti-bot 驗證的 DuckDuckGo Lite 版 (`lite.duckduckgo.com/lite/`)，搭配通用 `aTagRegex` 寬鬆屬性匹配，大幅提升搜尋結果可靠性。
- **搜尋頻率優化**：將遊戲攻略文章搜尋次數從 4 次簡化合併為 1 次，大幅減輕 DuckDuckGo 連續查詢的負載，完全避免高頻限流。

### YouTube 影片發布年份提取與評分加權 (YouTube Date Extraction & Weighted Ranking)
- **年份提取**：更新 `isYouTubeWatchPagePlayable` 核心邏輯，讀取完整 Watch page HTML 以避免 config 截斷；使用高強固性的 JSON/meta regex 精準提取影片發布年份。
- **年份評分加權**：在 `scoreVideoResult` 排序模組中引入年份評分加權：對 &gt;= 2025 年的影片大幅加權 $+10$ 分，2024 年 $+6$ 分，而對於 &lt;= 2021 年的影片加重扣分 $-6$ 分，從而主動排除過時的預告片、反應影片，優先渲染最新的實用攻略。
- **Playwright Chromium 執行路徑指定**：修復了 Chromium 搜尋 fallback 在背景啟動時因為找不到系統全域 Playwright 路徑而拋錯的問題。在 launch config 中明確傳入 `executablePath: browserExe`，保證完美調用 AppData 中管理的內置瀏覽器執行檔。


## 📌 2026.06.09 — 完整國際化 (I18N) 支援、對話與任務 UI 優化、P2P 語系網路傳播

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.09`。

### 完整動態 UI 國際化 (I18N)
- **多語系切換支援**：實作中英文語系無縫動態切換。包含所有面板（側邊欄、工作日誌、對話列、Chalkboard 等）之標題、按鈕、說明文字、佔位符 (Placeholder) 與提示語。
- **對話分頁動態翻譯**：本機對話分頁（如「本機對話 1」）現在在切換語言時會動態翻譯為對應語言。
- **正則表達式邊界修復**：修正原本以 `\b` 匹配中文造成的正則表達式邊界無效問題（如 `^本機對話\b`），改為更強健的 `/^(?:本機對話|Local Chat)(?:\s+\d+)?$/i`，確保不論有無序號、皆能正確識別並翻譯聊天分頁名稱。
- **硬體統計資訊國際化**：CPU、GPU 型號與負載百分比、RAM 剩餘與使用量、硬碟 S.M.A.R.T 健康度（如 SSD Health: Good 100% / SSD 健康度：良好 100%）與剩餘容量等探測文字在語系切換時皆能同步完成語意翻譯。
- **任務與知識庫空狀態國際化**：任務清單空狀態（"No tasks pending" / "目前沒有待辦任務"）與經驗知識庫空狀態等在語系切換時亦能完整適配。

### 任務清單 (Tasks Tab) DOM 節點損毀修復
- **清除邏輯修正**：修復原先在渲染工作清單時直接執行 `.innerHTML = ''` 導致 `#todoEmpty` (空狀態提示節點) 被意外徹底移除，造成後續新增任務並清空後空狀態無法再次顯示的 Bug。
- **動態重建**：更新 `renderTodos()` 以在清空容器時保留或動態重建 `#todoEmpty` 節點，確保空狀態顯示與隱藏的 toggle 邏輯長效穩定。

### P2P 遠端協作語系網路傳播 (Network Locale Propagation)
- **即時語系傳遞**：除首次連線之 handshake Profile 交換外，在遠端聊天封包 `chat_message` 的 TCP/Socket payload 中新增 `locale` 欄位。
- **遠端 AI 語系對齊**：當本機使用者切換介面語系（如英文）並向遠端 AI 發問時，遠端 AI 能即時在 TCP 封包中讀取 `locale: 'en-US'`，並在建構 System Prompt 時動態將其對齊英文回覆，徹底解決遠端 AI 無法跟隨發問者語系的限制。

### 預設語言模型升級 (Ollama Gemma 4 E2B QAT)
- **模型替換**：預設本地下載與使用的 LLM 模型由 `qwen3.5:4b` 升級/替換為 `gemma4:e2b-it-qat`。
- **好處與效益**：從 Ollama v0.30.6 起支援的 Gemma 4 QAT 具有更小的體積（約 1.1GB vs 原先 Qwen3.5 4B 的 2.6GB），載入與啟動速度極快。
- **變更範圍**：
  - 更新 `sops/pull-llm-model/SOP.md` 內全部下載/檢查/清理/驗證邏輯與大小說明。
  - 更新 `src/llm.js` 預設模型定義 (`DEFAULT_MODEL`) 與自動模型清單過濾器中 `gemma` 的優先比對。
  - 更新 `src/server.js` 與 `public/app.js`（中英文）的推薦清單標題、說明描述及模型大小提示。
  - 更新 `public/index.html` 的設定模型預設 placeholder 字串。
  - 更新 `skills/ollama/SKILL.md` 相關 tags 與模型體積對照表。


## 📌 2026.06.08 — Bug 修復、Markdown 支援、模型選取優化與 Hermes Skills 整合

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.08`。

### AI Chat Markdown 支援
- 前端引入 `marked.min.js`（本地 bundle），`renderMarkdown()` 改為真正解析 GFM（含表格、刪除線、code block）。
- 新增 `.markdown-body` CSS：表格邊框、th 底色、code/pre、h1-h3、blockquote、hr 完整樣式。

### 模型自動選取修正
- `llm.js` 新增 `isLLMCapableModel()` 過濾函式，排除 embedding、reranker、TTS、Whisper、Diffusion、CLIP 等非對話模型。
- `checkOllamaStatus` 的 fallback 選模邏輯全面改為只在 chat-capable 清單中選，避免首次啟動誤選 embedding 模型。

### Browser Tab 顯示修正
- `getPlaywrightBrowserDirCandidates()` 移除 `%LOCALAPPDATA%\ms-playwright` 系統全域路徑。
- 改為只認 AppData 下的 `visual-agent\playwright-browsers`，清除 AppData 後能正確顯示 `install required`，不再因偵測到其他 Playwright 裝置而誤啟 Browser tab。

### Hermes Agent Skills 整合
- 從 [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent/tree/main/skills) 批量轉換 19 個 skills，全部轉為 Visual Agent 的 `SKILL.md` 格式（含 YAML frontmatter + 完整 prompt 說明）。
- 每個 skill 的 frontmatter 加入 `source: hermes-agent` 欄位；後端 `loadSkillDocuments()` 同步讀取並回傳 `source` 欄位（兼容舊 skills 自動 fallback 為 `visual-agent`）。
- Skills Tab UI 改為兩大來源群組：`🤖 Visual Agent`（18 個原生 skills）和 `⚗️ From Hermes Agent`（19 個轉換 skills），各有對應顏色的 section header 與 count badge。
- Hermes skills 卡片右上角顯示 `⚗️ Hermes` 黃色徽章，視覺區分來源。
- 轉換的 19 個 skills 涵蓋：apple、autonomous-ai-agents、creative、data-science、devops、dogfood、email、github、index-cache、media、mlops、note-taking、productivity、red-teaming、research、smart-home、social-media、software-development、yuanbao。
- **說明**：Hermes Skills 屬於 AI 知識增強層（context/prompt），不像 SOP 有可執行的 PowerShell 步驟；它們在 AI 對話時自動注入對應領域知識，讓 AI 回答更專業。


## 📌 2026.06.03 — 日期上下文、Observe-after-Act 與建議按鈕收斂

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.03`。

### Agent 回覆體感
- 對攻略、搜尋、比較、規劃、安裝、除錯、機票/物價/新聞/天氣等可能耗時的請求，前端會先顯示一則不寫入對話歷史的 interim plan，讓使用者先知道 AI 準備怎麼做，再繼續等待背景工具與最終答案。
- Interim plan 只作為 UI 進度提示，不會污染 local chat history，也不取代後續正式答案。

### Provider 設定
- LM Studio 加入模型清單刷新白名單，和 Ollama、NVIDIA NIM 一樣可用「刷新清單」直接抓取 `/models`。

### 日期與即時資訊
- 每輪 `/api/chat` 會注入 runtime date context，明確標示今天、明天與時區，避免 AI 把「明天」解析成舊日期。
- 天氣、物價、新聞、匯率、股價與最新資訊若模型忘記主動呼叫 Browser Use，後端會自動補一輪 current-info search，再交給 Observe-after-Act 整理成可讀回答。
- Browser Use 不完整或 Chromium runtime 未安裝時，後端會明確提示使用者安裝，並真的加入/沿用 `install_playwright_chromium` 工作清單任務；使用者接著說「執行 / 開始 / 安裝」時會保底啟動該 pending task。
- Browser Use 仍會盡量使用文字/連結 fallback 回答，避免只停在錯誤訊息。

### Chalkboard 與回覆收斂
- 前端新增自動 Chalkboard draft：計畫、比較、查詢摘要、天氣/物價/新聞或偏長回答，即使模型沒有輸出 `##CHALKBOARD##`，也會自動寫入簡短黑板摘要。
- Browser Use / Computer Use / current-info fallback 完成後會自動進入 Observe-after-Act，不再只說「資料取得後回報」就停住。
- LLM 產生的 suggestion buttons 全面停用，避免問天氣卻顯示安裝 Chrome 等文不對題按鈕。

## 📌 2026.05.28 — Browser Use 即時查詢與版本同步

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.05.28`。

### Browser Use 重新定位
- 天氣、物價、新聞、股價、匯率、最新版本、店家與行程等即時資訊，應優先走 Browser Use。
- `Computer Use` 不再被視為網路查詢工具；它只負責桌面、App、檔案、SOP 等本機操作。
- `/api/agent/browser-use` 的 `search` 模式新增真瀏覽器 fallback：server-side fetch 搜尋失敗或解析不到結果時，會改用 Playwright Chromium 開搜尋頁並從 DOM 抽取結果。

### Prompt 收斂
- System prompt 明確要求：本地知識不足或需要最新資訊時，要主動使用 Browser Use，不要叫使用者手動搜尋，也不要用 CLI 硬爬。
- Browser Use action 範圍明確列入 `search/open/navigate/extract_text/snapshot/fetch_title`。

## 📌 2026.05.21 — Remote 協作卡住保護與 Chalkboard 同步修正

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.05.21`。

### AI 回覆卡住保護
- LLM 對話 timeout 統一收斂為 3 分鐘，避免 UI 長時間維持思考中卻沒有可見結果。
- Remote AI queue 加入 timeout 防護；若單一回覆卡住，會釋放後續排程並回報可見錯誤訊息。

### Remote Chat 辨識度
- Remote User、Remote AI 與 remote system bubble 使用不同底色，降低與本機對話混淆的機率。

### 硬體查詢歸屬
- Remote 模式下，磁碟容量、RAM、CPU、GPU 等未明確指定「對方 / 遠端」的問題預設交給 Local AI 回答。
- 這可避免 A 問「硬碟剩多少」時誤查到 B 電腦。

### Chalkboard 同步與歷史
- 遠端連線成功後，若本機黑板已經有內容，會主動推送目前畫面給對方。
- 接收遠端 Chalkboard 同步時保留 redo stack，避免 undo 後同步導致 redo 失效。

## 📌 2026.05.20 — 遠端協作驗收導向補強

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.05.20`。

### Directive 可觀測性
- 遠端 AI directive 的工作日誌現在會帶 `msg:<id>` 標記，方便對照是不是同一則遠端訊息重送。
- `SUGGEST`、`INSTALL_SOP`、`COMPUTER_USE` 等遠端 directive 在執行前後都會留下較明確的 UI log 與 system bubble。

### 重複指令抑制
- 新增短時間 duplicate directive suppression，若遠端 AI 在短窗口內重複送出相同 directive，前端會略過重跑並留下 `Skipped duplicate remote directive` 診斷訊息。
- 這層保護用來降低 polling 重繪、遠端重送或 orchestration 競態造成的重複動作。

### 驗收腳本文件化
- 在 `README.md` 與 `readme-tw.md` 補上固定的 remote validation checklist。
- 驗收聚焦三條典型路徑：`SUGGEST`、`INSTALL_SOP`、`Double Agent Mode（本地先回、遠端後補）`。

## 📌 2026.02.25 — 初始版本

### Tauri 桌面化 + Sidecar 架構
- 導入 **Tauri 2.x + Rust** 打包為獨立 `.exe`（MSI/NSIS），不需使用者安裝 Node.js
- Node.js 伺服器以 `pkg` 編譯為 Tauri **Sidecar Binary**，隨主程式啟動/退出
- 修改 `capabilities/default.json` 賦予殼層最高執行權限 (`shell:allow-execute`)

### AppData 架構
- 任務清單 (`tasks.json`) 與 SOP 庫 (`sops/`) 儲存至 `%APPDATA%\visual-agent\`
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
- 導入 `splash-overlay`：解決 cold 啟動時後台 Server 尚未就緒導致的畫面空白
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
- **新增「清除對話」功能**：對話框對右側加入清除按鈕，支援二次確認彈窗，提升操作靈活性。
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
- **AppData 統一存取**：`SOPs` 與 `Skills` 目錄統一移至 `AppData/visual-agent`。
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
- **AppData 同步**：啟動時自動同步內建插件至 `%APPDATA%\visual-agent\plugins\`。

### 對話與 UI 體感進化
- **多輪對話歷史 (Contextual Chat)**：
  - **情境記憶**：AI 現在會記得最近 6 則對話紀錄，支援追問與承接前文。
  - **硬體覺醒 (Hardware-Awareness)**：後端自動將即時硬體狀態注入 Prompt，AI 能根據您的硬體狀況給出建議（例如：發現 CPU 負載高時主動提醒）。
- **RWD 儀表板**：硬體監控卡片支援響應式佈局，自動根據左右面板寬度切換 4 欄或 2x2 排列。
- **啟動資訊強化**：Console 與日誌現在會顯示 `Plugins` 資料夾路徑，方便擴充。

---

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

## 📌 2026.03.24 - AI Provider 與 SOP 穩定性修正

### AI Provider
- OpenAI 維持僅支援 API Key。
- Gemini 使用 Google 的 OpenAI-compatible 入口。
- Anthropic Claude 改走原生認證與原生訊息 API。
- Customer Provider 支援 API Key 與 OAuth 2.0 Client Credentials。

### SOP 執行流程
- 任務完成後，AI 對話區會主動回報 `success`、`failed`、`skipped`。
- SOP 載入時會依 `id` 去重，並優先採用正式檔名，不再被 `Copy` 類副本覆蓋。
- 內建 SOP、skill、plugin 在內容變更時，會同步到 `%APPDATA%\visual-agent\`。

### 執行器修正
- 移除可能觸發 `Out-File` / `nul` 裝置錯誤的 PowerShell 包裝方式。
- `Check` 階段即使同時輸出提示文字，仍可正確辨識布林值。
- `Verify` 階段若明確輸出 `false`，現在會視為真正失敗。

### SOP 修正
- 強化 Steam、Chrome、LibreOffice、Ollama、Qwen 模型下載、系統還原點、日文語言包 SOP。
- 將脆弱的 `Get-Command + Test-Path "command-name"` 改為先解析執行檔路徑再驗證。
- 系統還原點 SOP 的 `Check` 改為無副作用。

## 工作日誌與版本同步

- 工作日誌僅在畫面已停在底部時才自動往下捲。
- Spinner 與下載進度類訊息會原地更新，不再洗出多行。
- 狀態列版本號不再寫死。
- 前端改由 `/api/meta` 讀取版本，來源為 `package.json`。
- 套件版本更新為 `2026.03.24`。

## EXE 啟動與匯出修正

### EXE 啟動
- Tauri 改為背景啟動 Node sidecar，讓本地 HTML splash 可以先顯示，不再黑畫面等待。
- 首次執行顯示：`首次執行本程式，正設定環境中，請稍候...`
- 後續執行顯示：`啟動後端伺服器中，請稍候...`

### 任務匯出
- EXE 模式下的任務匯出改為優先使用 `/api/todo/export-file` 的原生 Windows 另存新檔流程.
- 瀏覽器型 blob 下載僅作為 fallback。

## 硬體上下文與語系 SOP 拆分

### 硬體上下文
- AI 對話 prompt 現在會注入 CPU、GPU、RAM、磁碟健康與磁碟剩餘空間摘要。
- NVIDIA 環境會額外帶入 `nvidia-smi` 的結構化資訊，包含 driver、VRAM 使用量與功耗。

### 語系 SOP
- 語言包安裝已拆成 `en-US`、`zh-TW`、`zh-CN`、`ja-JP` 四支獨立 SOP。
- 每支語系 SOP 都只會把自己的語言 append 到既有 Windows 使用者語言清單，不會覆蓋整份清單。
- 暫時性的英文與繁中復原 SOP 已在拆分後移除。
- 日文語言安裝遇到 access denied 時，會在 install 階段直接失敗，不再拖到 verify 才暴露問題。

## 共用 UAC 提權執行器

### 提權執行
- SOP Executor 現在內建共用的 `runPowerShellElevated()`。
- 只要 SOP 的權限標記包含 `Administrator`、`Admin` 或 `UAC`，install 階段就會自動走提權流程。
- 提權流程會透過 `Start-Process -Verb RunAs` 觸發 Windows UAC 視窗。

### 失敗處理
- 若使用者取消 UAC，任務會直接失敗，不再假裝修復成功後重試。
- 語系 SOP 的 `Check` 與 `Verify` 不再只依賴單一 `LanguageId` 欄位，會同時接受 `LanguageTag`、`LocaleName`、`Language` 等欄位。

## Sidebar 與 Chat 佈局補強

### 右側 AI 對話欄
- 放寬 chat window 拖拉上限，現在可往左拉到工作區約一半寬度。
- 佈局還原時會自動依目前視窗大小重新夾住 chat 欄寬度，避免縮窗後超界。

### 左側 Sidebar
- 原本只有「推薦清單」單一面板，現在改為 tab 式 sidebar。
- 新增「SOP 清單」tab，直接列出 `/api/sops` 載入的所有 SOP。
- SOP 清單支援依名稱、ID、分類搜尋，並可直接「加入任務」或「立即執行」。
- 搜尋框 placeholder 會隨 sidebar tab 切換成對應文案。

---

## 📌 2026.03.25 - Chalkboard 與文字工具、知識庫視覺進化、視窗持久化與硬體感知強固

### 黑板畫布
- 中央 `Chalkboard` 改為真正可畫的 canvas，不再只是靜態歡迎區塊。
- 黑板改用深綠色材質風格，底部加入粉筆托盤、板擦、粗細切換、Undo、清空、上傳圖片與存成圖片。
- 支援白、紅、黃、綠、藍粉筆與局部板擦，提示字與歡迎字皆直接畫在黑板上，可被板擦擦除。
- 初始進入黑板時先顯示粉筆風格歡迎詞，首次互動後再切換為操作提示。
- 歡迎畫面階段會先禁用整排工具列，第一次點黑板進入可畫模式後才解鎖。

### 圖形與圖片
- 加入直線、矩形、圓形工具，支援預覽後落筆。
- 圖片上傳後可在黑板上拖曳指定放置範圍與大小，再落到畫布上。
- 黑板內容可直接匯出為 PNG。
- 新增選取、複製、剪下、貼上與 clipboard 支援，可把選取區作為圖片重新貼回黑板。

### 文字工具
- `T` 工具改為先開文字設定視窗，再建立文字框。
- 文字設定視窗支援輸入內容、選字型、選字型風格、調字級、文字顏色、對齊、粗體與斜體。
- 真正字型目前支援 `標楷體`、`微軟正黑體`、`黑體`、`細明體`、`Arial`、`Times New Roman`、`Courier New`。
- 建立後可在黑板上先放置文字框，再拖曳框本體移動、拖 8 個控制點縮放，點框外定稿。

### AI 多模態理解
- 右側聊天列新增 `Chalkboard` 附圖按鈕，可切換是否把黑板內容一併送給 AI。
- 後端支援把黑板快照作為多模態輸入送給 vision 模型，並在主模型不支援看圖時自動 fallback 到可用的 vision 模型。
- AI Provider 設定視窗新增 `Vision 多模態模型` 欄位，可由使用者明確指定圖片理解模型。
- 當本輪有附圖時，會忽略先前附圖回合的歷史描述，避免第二張圖被上一張圖的內容污染。

### exps 知識庫視覺進化
- **視覺微調**：將 exps 面板重塑為「知識庫」風格。卡片密度更高，摘要預設限制顯示 3 行，滑鼠懸停 (Hover) 時自動展開完整內容。
- **匯出功能**：新增「⬇ 匯出」按鈕，支援將所有累積的經驗一次匯出為單一 Markdown 文件，方便備份與知識共享。
- **資訊層級**：卡片左側加入深紫色狀態條，區分不同 SOP 的執行記錄，並優化了時間與標題的對齊方式。

### 軟體安裝與 SOP 穩健化
- **Ollama 非提權安裝**：修正 Ollama 安裝 SOP，改為預設不觸發 UAC。`winget install` 在 User 模式下即可完成，減少不必要的權限彈窗困擾。
- **模型資訊修正**：修正 `pull-llm-model` SOP 與推薦清單中的 hardcoded 字串，將 Qwen3.5 全面更新為 `4B` 版本，並修正下載容量描述為更精確的 `2.6GB`。

### Tauri 桌面體驗優化
- **視窗持久化**：導入 `tauri-plugin-window-state`。現在程式會記住您上次關閉時的視窗大小與位置，下次開啟時自動還原，省去重新拉動的麻煩。
- **啟動最大化**：預設在首次啟動時以最大化視窗呈現，提供更寬廣的畫布與操作維度。

### 硬體感知強固
- **GPU 數據精準化**：優化 `hardware-info.js` 插件。優先採用 `nvidia-smi` 獲取的結構化負載資訊。
- **PowerShell 相容性補強**：針對 Tauri 打包環境下 `Get-Counter` 可能權限不足的問題，加入 `catch` 降級機制 (fallback)，確保 GPU 儀表板不再因為系統計數器問題而顯示錯誤或卡死。

### 封裝環境的指令與體驗修正 (Tauri EXE)
- **硬體偵測的引號跳脫**：修正 `hardware-info.js` 中傳遞給 PowerShell 執行指令時的雙引號干擾問題（改以單引號封裝 `DriveType=3`），解決打包後因指令解析錯誤導致磁碟與 GPU 狀態監控全盤失效的問題。
- **原生匯出圖片 API**：為了解決 Tauri EXE 容器內無法透過 `data:image` 超連結觸發原生瀏覽器下載的問題，於後端新增 `/api/chalkboard/export-file` 端點。此端點利用 PowerShell 的 `SaveFileDialog` 呼叫原生 Windows「另存新檔」視窗，確保黑板截圖能穩定儲存為 PNG。

---

## 📌 2026.03.26 — 國際化、黑板優化與 AI 語系感知

### 🌍 全方位國際化 (Internationalization / I18N)
- **UI 全面中英切換**：新增 `I18N` 資源表，涵蓋 AI 對話區、AI 引擎設定 Modal、狀態列與黑板提示詞。
- **設定視窗 (Settings Modal) 深度翻譯**：包括所有 Provider 說明、認證方式選項、以及 Vision 模型佔位符，確保英文模式下無殘留中文。
- **黑板粉筆互動字體**：黑板啟動時的歡迎詞與互動提示字，現在會根據介面語系自動切換（Welcome to Visual Agent / 互動提示）。

### 🧠 LLM 語系意識 (Locale-Aware AI)
- **雙語 System Prompt**：後端 `llm.js` 內建中英雙語系統提示詞。
- **語系同步發送**：前端 `/api/chat` 會主動傳遞 `locale` 給後端，確保 AI 在英文模式下會以英文思考、回覆並提供 Suggestion。
- **動態 Prompt 注入**：系統提示詞會根據語系精確規範 AI 的回應風格與語言一致性。

### 🎨 黑板與 UI 視覺優化
- **工具托盤分隔線 (Dividers)**：黑板下方工具列加入垂直分隔線，將「顏色/粗細」、「圖形工具」、「編輯操作」進行分組，提升視覺層次。
- **對話區與設定視窗微調**：修飾了英文模式下的標籤溢出與寬度適應問題，確保 UI 佈局在不同語系下皆呈現 premium 感。

### 🚀 多來源軟體推薦與動態 SOP 生成
- **Store & Release 搜查能力**：AI 除了 `winget` 之外，現在具備 `microsoft-store` 與 `github-releases` 的感知能力。
- **自動化 SOP 建置**：支援 `CREATE_WINGET_SOP`、`CREATE_MSSTORE_SOP` 與 `CREATE_GITHUB_RELEASE_SOP` 動作，AI 能根據外部店面資訊現場「手寫」出功能完備的 SOP。
- **智慧檢查 (Smart Check/Verify)**：強化安裝前後的狀態確認，優先讀取系統計數器與路徑版本，提升 SOP 執行的穩健性。

---

## 📌 2026.03.27 - winget 商店推薦、格式規格與雙向 SOP 補強

### winget 商店推薦與 SOP 生成
- 新增 `skills/winget-store.md`，讓 AI 在現有 SOP 不足時可先查詢 winget 商店候選軟體，再回推薦名稱。
- `/api/chat` 現在支援從 winget 商店直接回推薦結果，並可依使用者指定套件自動產生對應 SOP。
- `CREATE_WINGET_SOP` 完成後，前端會自動刷新左側 `SOP 清單`，不需要手動重整頁面才看得到新檔案。

### winget 產生 SOP 品質補強
- `winget-store` 生成的 SOP 模板不再只憑 `winget install/uninstall` exit code 判斷成功與否。
- 新模板會在安裝與解除安裝後輪詢 `winget list` 的實際狀態，再決定是否成功，降低互動式安裝器或非零回傳碼造成的誤判。
- 模板改採 ASCII 標題，避免終端編碼污染新產生的 SOP 結構。

### 安裝 / 解除安裝 SOP 補強
- `install-office.md` 的解除安裝流程比照 Steam 補上真實狀態輪詢，不再因 `winget uninstall` 回傳 `1` 就直接誤判失敗。
- 卸載型任務標題、工作清單與 AI 回覆改口一致，不再出現「解除安裝任務卻顯示安裝標題」的混亂狀況。
- 卸載後的驗證共用 executor 規則，現在會把 `check = false` 視為目標已成功移除。

### exps 經驗庫
- `exps` 寫入、顯示與注入 AI prompt 前都會先做敏感資訊遮罩，避免把 API Key、密碼、CD Key、Token 與本機路徑直接存入經驗庫。
- `exps` 詳細視窗改為顯示完整內容，不再被三行摘要樣式截斷。
- `exps` 匯出改走原生 Windows 另存新檔流程，提升 Tauri / EXE 環境穩定性。

### 檔案格式規格
- `sops/*.md` 第一行固定為 `# Visual Agent SOP File v1`
- `exps/exp-yyyymmdd.md` 第一行固定為 `# Visual Agent Experience Log - yyyymmdd`
- `skills/*.md` 第一行固定為 `# Visual Agent Skill File v1`
- `plugins/*.js` 第一行固定為 `// Visual Agent Plugin File v1`

### Microsoft Store / UWP 技能
- 新增 `skills/microsoft-store.md`，讓 AI 能在使用者明確偏好商店版 App 時，改走 `msstore` 來源搜尋候選軟體。
- `/api/chat` 現在可直接列出 Microsoft Store 候選軟體，並在需要時自動產生對應 SOP。
- 這類 SOP 會用 `winget --source msstore` 進行安裝、驗證與解除安裝。

### GitHub Releases 技能
- 新增 `skills/github-releases.md`，讓 AI 可搜尋 GitHub repository 與 release assets。
- 新流程只挑選有明確 Windows `.exe`、`.msi`、`.zip` asset 的 repo，排除 source code、checksum、signature 類附件。
- 若使用者要求建立 SOP，現在會產生保守的「下載型 SOP」：下載 release asset、驗證檔案存在，必要時移除下載檔案與解壓資料夾。

### Parser 與 Prompt 相容
- `sop-parser.js` 新增英文欄位相容，現在 `Category`、`Risk Level`、`Permissions`、`Network`、`Expected Result` 也能正確解析。
- LLM prompt 現在除了 `winget` 候選之外，也會在需要時注入 Microsoft Store 與 GitHub Releases 候選資訊，並支援新的 `CREATE_MSSTORE_SOP` 與 `CREATE_GITHUB_RELEASE_SOP` action。

### 軟體發現技能
- 新增 `skills/microsoft-store.md`，讓 AI 能在使用者明確偏好商店版 App 時，改走 `msstore` 來源搜尋候選軟體，並透過 `winget --source msstore` 產生對應 SOP。
- 新增 `skills/github-releases.md`，讓 AI 可搜尋 GitHub repository 與 Windows release assets，並在適當時產生保守的「下載型 SOP」。
- `/api/chat` 現在支援 `CREATE_MSSTORE_SOP` 與 `CREATE_GITHUB_RELEASE_SOP`，搭配既有的 `CREATE_WINGET_SOP` 流程。

### 英文內容標準化
- 將內建 `sops/*.md` 內容改為英文，同時保留必要的標題 `# Visual Agent SOP File v1`。
- 將 `skills/*.md` 與 `plugins/*.js` 的標題與核心描述改為英文，為未來國際化做準備。
- 標準化經驗庫 markdown 生成為英文導向內容，保留標題格式 `# Visual Agent Experience Log - yyyymmdd`。
- 重寫 `sop-parser.js` 註解為英文，同時保留對舊版中文 SOP 欄位的雙語相容性。

### 雙向 SOP 與動作感知卡片
- 安裝類 SOP 現在正式支援 `install / uninstall` 雙向動作。
- 推薦清單與 SOP 清單會先檢查目前系統狀態；若目標已安裝且 SOP 支援移除，卡片會自動改成「解除安裝」。
- 中央工作清單、任務詳情、AI 對話提示與完成訊息，現在都會依 `action` 顯示正確文案，不再把卸載流程誤寫成安裝。

### 卸載驗證框架修正
- 修正 `sop-executor.js` 在卸載後沿用 `check` 驗證時，誤把 `false` 當成 verify 失敗的邏輯錯誤。
- 現在對卸載 SOP 而言，`check = false` 會被正確解讀為「目標已不存在」，可共用於所有解除安裝流程。
- 這次修正讓 Steam 卸載不再在實際成功後被錯誤標記成 `failed`。

### SOP 偵測與移除穩健化
- Chrome SOP 的 `Check / Verify` 改為讀取執行檔版本資訊，不再執行 `chrome.exe --version`，避免 Tauri 啟動或狀態掃描時誤彈出 Chrome 視窗。
- Steam SOP 的安裝與移除判定改為檢查實際安裝路徑與精準的 `DisplayName = Steam` 卸載項，並等待互動式 uninstall wizard 完成後再判定結果。
- 語系 SOP 新增移除保護：若目標語言是 Windows 原始安裝語言，或移除後會讓系統只剩唯一語言，則直接阻擋解除安裝。

### Tauri / PowerShell 細節修正
- 提權 PowerShell 在 UAC 同意後，改用較低干擾的 minimized 視窗執行。
- 深色模式下的下拉選單與 `全部 SOP` 篩選器，補上明確的深底淺字樣式，避免選單文字難以辨識。

### 黑板工具完整國際化
- 為所有黑板工具按鈕添加 i18n 支援：粉筆顏色、筆刷大小、形狀工具、編輯操作
- 文字工具 modal 完整翻譯：標題、標籤、佔位符、幫助文本、按鈕
- 文字工具選項翻譯：字型、字型風格（粉筆手寫、板書感等）、對齊方式（靠左、置中、靠右）
- 上傳圖片、存成圖片按鈕翻譯

### 座標系統修復
- 簡化 `getChalkInputRect()` 直接使用 canvas 的 `getBoundingClientRect()`
- 移除複雜的邊框計算，因為 canvas 已經是 `inset: 0` 填滿 surface 的內容區域
- 修復選擇工具和文字工具的座標偏移問題

### 中文字寬度補償
- 修復 `measureChalkTextWidth()` 為中文字添加 5% 的寬度補償
- 修復 `createTextPreviewCanvas()` 在計算對齊位置時也考慮中文字的補償
- 中文字檢測使用正則表達式 `/[\u4e00-\u9fff]/` 來識別中文字符
- 解決中文字落稿時的偏移現象

---

## 📌 2026.03.28 - I18N 全面修正

### 全面國際化 (I18N) 補齊
- **UI 與狀態文字多語系化**：將「思考中」、「正在載入模型清單」、以及各 AI Provider 的說明與模型指引，全面加入 `en-US` / `zh-TW` 動態判定。
- **對話與測試提示翻譯**：針對「Test Model」按鈕的狀態變更（測試中...、測試模型）、對話欄輔助選項（如「幫我安裝 Chrome」）實作語系即時切換 (`currentLocale`)。
- **清除歷史包袱**：徹底淘汰原先依賴 `app.i18n.js`、`server.i18n.js` 等後備檔案的粗糙作法，將邏輯直接融入正文，確保專案結構簡潔乾淨。

### 檔案選單 (File Menu) 重構
- **下拉式選單 (Dropdown) 實作**：將原先純文字的「檔案」進化為具備豐富互動的全功能選單。
- **核心功能收編**：整合「匯入任務清單」、「匯出任務清單」、「Refresh 畫面」與「Exit」，兼顧美觀與雙語顯示。

---

## 📌 2026.03.29 - Chalkboard Resize 黑板縮放與定位修補
### 🐛 Bug 修復：還原未定案文字框與 8 控制點位置偏移
**修復 (`public/app.js`)**
- 三個 resizer (sidebar、chat、logPanel) 的 setSize callback 加入：`if (activeTab === 'chalkboard') resizeChalkboardCanvas()`。
- `resizeChalkboardCanvas()` 在更新 cssWidth/cssHeight 前會記錄原始大小，resize 後若有 `pendingTextRect`，會重新計算並更新其座標（scaleX = 新寬/舊寬，scaleY = 新高/舊高）。

## 📌 2026.03.30 - 遠端 AI 對話與模型共享功能
### 遠端實體連線與聊天機制
- **本機身份感知**：AI 獲取自身 Windows 機器名稱、使用者名稱及 IP，並注入系統 Prompt。
- **19168 Port 通訊**：新增自訂 JSON Line TCP 協定 (hello/chat_message/screen_share/disconnect 等)。
- **遠端 AI 聊天室**：UI 將聊天區域分為「本機 AI」與「遠端 AI」雙頁籤。
- **連線審批 UI**：收到連線請求時會彈出 Popup，顯示來源身份並供使用者接受或拒絕。
- **支援 Markdown 與 `@mention`**：輸入 `@` 可呼叫參與者清單，點名另一台機器的 AI 時對方 AI 會自動接管回覆；對話支援 Markdown。
- **畫面分享與另存**：雙方可傳送截圖給對方，並支援透過原生檔案視窗「另存圖片」。

### 多 Session 與非同步任務解耦
- **Session 管理**：本機與遠端均實作歷史紀錄切換 Chips (依活躍度排序)。
- **Pending 狀態分離**：切換分頁時，本機或遠端 AI 的思考狀態不會被中斷。

### Double Agent Mode
- **移除模型接管**：舊 Model Share 已於 `2026.05.06` 移除，不再讓本機全域 AI API 改呼叫對方模型。
- **分工協作**：遠端連線後，雙方可直接呼叫本地 AI 與遠端 AI；未指定對象時，本地 AI 先提供輔助筆記，遠端 AI 再彙整回覆。
- **狀態標示**：主聊天模型徽章只顯示本機目前模型；AI 思考狀態以 `本地 AI: 思考中` / `遠端 AI: 思考中` 顯示。

---

## 📌 2026.04.01 - Tauri EXE 硬體探測與黑板座標修復

### 硬體探測穩健化 (GPU / HDD)
- `hardware-info.js` 改為使用 `powershell.exe -EncodedCommand` + `execFile`，降低 Tauri EXE 封裝環境下的引號與碼頁干擾。
- 磁碟探測新增雙路徑：優先 `Get-PhysicalDisk`，失敗時自動 fallback 到 `Win32_DiskDrive`，避免 EXE 環境出現 HDD 資訊空白。
- `temperature-monitor.js` 改為 `execFile` 執行 `nvidia-smi.exe`，並加入 NVSMI 常見安裝路徑 fallback，提升 NVIDIA 探測成功率。

### nvidia-smi 錯誤訊息去亂碼
- 將錯誤輸出簡化為穩定錯誤碼格式（如 `ENOENT`），不再直接輸出本地碼頁訊息，避免 `程式不存在，已略過` 這類亂碼污染日誌。

### 黑板座標與落稿一致性
- `getChalkPoint()` 新增座標 clamp（0~1），避免游標移動到畫布邊界外時造成定位偏差。
- `drawPlacedText()` 改為完全以 8 點框尺寸落稿，不再強制使用 `baseWidth/baseHeight` 擴張，修正「8 點框位置與最終文字落稿不一致」問題。

### UI 編碼細節
- 修復硬體面板溫度顯示字元，`°C` 改為 `°C`。

### 本機聊天與黑板體驗補強
- 右側聊天上方改為「本機多對話 tab + 遠端 tab」；本機對話新增後可在 tab 直接 `x` 關閉（保留至少一個）。
- `新增對話` 按鈕移到輸入工具列，位置在「清除對話」左側，降低建立新會話的操作成本。
- Chalkboard 在 resize 後，除了縮放快照，也會同步重算 `selectionRect/pendingTextRect/drag points`，並重建 pending 文字 preview，降低字體糊化與偏移復發。

### 黑板 8 點框拖曳精準化（補丁）
- 修正 8 點框 resize 時「框體與游標左右偏移」問題，改為以即時游標位置作為邊界計算，不再使用舊版 `dx` 累加造成漂移。
- 修正畫布 resize 當下若仍在拖曳文字框，會同步縮放 `textManipulation.originPoint / originRect / anchor`，避免拖曳中途視窗改變導致框與游標脫鉤。
- 修正文字框縮放時字級不變問題：pending 文字預覽改為依框內可用區域動態計算 `fontSize / lineHeight`，落稿視覺與框體一致。

### SOP 強化：Desktop Agent 工作流（第一版）
- `/api/chat` 新增 Agent Workflow Router：命中特定任務時，優先走「技能流程」而非純 LLM 對話。
- 新增 `財報.xlsx + NVIDIA` 自動流程：
  - 檢查 Excel/LibreOffice/WPS 是否存在
  - 尋找指定活頁簿路徑（Desktop/Documents/Downloads）
  - 從 SEC Company Facts 抓 NVIDIA 最新財報關鍵數據
  - 若有 Excel，透過 COM 自動寫入工作表並開啟檔案
  - 若無試算表工具，回到「安裝 Office SOP 或改 Google Sheets」分流
- 新增 `遊戲攻略/影片` 流程：自動做 Web 搜尋，回傳 Markdown 分組結果與 Chalkboard 摘要草稿。
- 擴充動作協議：新增 `[ACTION:OPEN_FILE ...]`、`[ACTION:OPEN_URL ...]`。
- 新增 Skills：`skills/desktop-agent.md`、`skills/game-research.md`。

### Browser Use / Computer Use 雙層代理（內宇宙 / 外宇宙）
- **內宇宙（Browser Use）**：新增 `/api/agent/browser-use`，支援 `search/open/fetch_title` 模式，供 AI 進行瀏覽器層級操作。
- **外宇宙（Computer Use）**：新增 `/api/agent/computer-use`，支援 `open_file/open_url/install_sop` 模式，供 AI 操控本機應用與任務。
- **VLM 門檻控管**：新增能力檢查 `/api/agent/capability`；Browser/Computer Use 僅在 `top-tier + vision capable` 模型下啟用。
- **Action 協議升級**：LLM 新增可輸出 `[ACTION:BROWSER_USE ...]` / `[ACTION:COMPUTER_USE ...]`。

### 財報工作流強化（多寫入引擎）
- `.xlsx` 更新改為多策略：`Excel COM` → `WPS COM` → `OpenXML 直寫`，提升非 Office 環境成功率。
- 仍保留環境檢查與分流：若無可用試算表工具，優先回到「安裝 Office SOP 或 Google Sheets」。

### Chalkboard API 直寫
- 新增 `/api/chalkboard/draft`，AI 回覆可帶 `chalkboardDraft`，前端會自動把摘要渲染到黑板（標題 + 重點條列）。
- AI 下筆前會先清板、清除 pending/selection，再以粉筆字逐行重畫；包行後改用實際行數累進 Y 座標，避免重疊。

### 外宇宙（Computer）沙箱化補強
- Computer Use 新增 `prepare_vm_sandbox` 模式，優先檢查/準備 VirtualBox 作為沙箱執行層。
- 預設策略改為 VM 優先；未明確覆蓋前，阻擋直接在主機開檔/開網址，避免干擾本機環境。

### 內宇宙（Browser）用途明確化
- Browser Use 定位為「資源取得 + 瀏覽器內編輯」層，供 AI 在 web 內完成搜尋、讀取、導覽與內容處理。

### Skills/SOP 懶載入與技能庫擴充
- `llm.js` 改為不在 system prompt 預先載入全部 Skills，降低 context 浪費。
- `/api/chat` 新增按需匹配：根據使用者訊息動態挑選相關 Skill 與 SOP 摘要注入 Prompt。
- 新增多個高頻 Skills：Photoshop、備份還原、安裝修復、Office/Excel、Browser research、網路/印表機、儲存與復原、虛擬化沙箱、開發工具、媒體編輯。
- 新增多步驟 SOP：
  - `sops/backup-user-files.md`
  - `sops/restore-user-files.md`

## 📌 2026.04.10 — 回覆穩定性、黑板控制碼與版本同步

### 版本
- `package.json` / `package-lock.json` 版本同步更新為 `2026.04.10`。

### 對話與代理穩定性
- 修正 AI 只輸出 action 控制碼時對話變空白的問題：後端現在會回填可讀摘要。
- `Browser Use` / `Computer Use` 測試期放寬，移除 top-tier VLM 硬性阻擋訊息（保留 VM-safe 行為限制）。

### 遊戲影片品質
- 遊戲影片結果改為先正規化 YouTube watch URL，再做可播放檢查，減少失效影片。

### Chalkboard 控制
- 黑板渲染改為只處理 `##CHALKBOARD## ... ##ENDCHALKBOARD##` 區塊，避免一般回覆句句落板。
- 黑板提示改為 popup hint；3 秒自動消失或滑鼠點擊即關閉。

### 無 NVIDIA 機器降噪
- `temperature-monitor` 在 `ENOENT`（無 `nvidia-smi`）時不再重複刷 log。

### Browser Skill 強化
- 新增/補強 `skills/browser-research-and-edit.md`，把 Browser Use 明確定義為「本地知識不足時的按需外查流程」。
- Skill 內規定先清理使用者雜訊字串，再組查詢詞，避免把「改由瀏覽器手動搜尋」這類提示語當成真正關鍵字。
- 搜尋結果回覆需整理成可執行答案，並在需要時附 Chalkboard 摘要模板。

### Playwright Chromium 自動安裝
- Chromium 已改為事後補裝，不再塞進 MSI / EXE bundle。
- Browser tab 若缺 Chromium，會引導執行 `install-playwright-chromium` SOP 來補裝。
- 目的：讓安裝包維持小體積，並把 browser runtime 安裝留給工作流處理。

- ## 📌 2026.04.10 - Browser 缺件一鍵補裝
- Browser tab 偵測到 Chromium 缺失時，會直接提供安裝按鈕，並執行 `install-playwright-chromium` SOP。
- Browser runtime 改為安裝後補裝，不再把 Chromium 綁進 EXE / MSI 安裝包。

- Browser availability now requires a real Chromium executable check. The tab stays hidden until the executable exists, then appears automatically without a restart.

## 2026.04.13 Planner / Builder / Learn
- Default behavior is now Planner first, Builder after user approval, Learn after completion.
- Exp is the learning memory: store what worked, what failed, and the reusable pattern.
- Repeated successful patterns can be promoted to Skills; stable multi-step flows can be promoted to SOPs.

---

## 📌 2026.04.14 — AgentSkills.io 規格遷移

### Skills 目錄結構重構
- 依照 [agentskills.io/specification](https://agentskills.io/specification) 規格，將 skills/*.md 改為 skills/<slug>/SKILL.md 目錄格式。
- 每個 SKILL.md 頂部加入 YAML frontmatter：
ame、description、license、compatibility、metadata（含 	ags）。
- 
ame 欄位必須符合父目錄名（小寫英數字 + 連字符），最長 64 字元。
- description 針對 AI 發現 (discovery) 優化，明確描述「何時使用」並含關鍵字。
- 舊的扁平 skills/*.md 保留作向後相容，server.js 會自動兼容兩種格式。

### server.js 更新
- syncBundledAssets()：改為同步目錄格式，自動同步 skills/<slug>/SKILL.md 及 scripts/、
eferences/、assets/ 子目錄。
- loadSkillDocuments()：優先讀取目錄格式 SKILL.md，解析 frontmatter 中的 
ame、description、	ags 擴充 token matching 精確度；保留扁平格式 fallback。

### 亂碼修復
- agents.md：修復 nvidia-smi ENOENT 行的 Big5 亂碼、°C 溫度符號、以及重複貼入的 Big5 亂碼 Browser 區段。
- aipc-spec.md：修復「Browser (未安裝)」的 Big5 亂碼。

### Planner / Builder / Learn 代理流程
- **Planner**：AI 優先返回規劃回應，總結意圖並提出下一步建議。
- **Builder**：在獲得使用者明確批准後才開始執行任務（Consent-First）。
- **Learn**：任務完成後，撰寫簡短的 Exp 以便代理能從結果中學習並自我優化（重複成功的模式升級為 Skills，穩定的多步驟升級為 SOPs）。

### Browser Runtime 動態載入
- Browser tab 現在按需使用 Playwright Chromium，不再將 Chromium 打包入 EXE / MSI，保持安裝檔輕巧。
- Browser 狀態取決於 Playwright cache 中的 `chrome-headless-shell.exe` 或 `chrome.exe` 是否存在，並由 `/api/meta` 回報實際 `browserExecutable`。
- 缺失時，UI提供一鍵執行 \install-playwright-chromium\ SOP，安裝完畢無需重啟即可出現 Browser tab。

---

## 📌 2026.05.05 — 遠端模型共享與 Chalkboard 協作同步

### 版本
- `package.json` / `package-lock.json` 版本同步更新為 `2026.05.05`。

### 遠端模型共享
- 此版曾補上模型分享請求視窗的 `AI 模型` 顯示。
- `2026.05.06` 已移除「分享模型」操作入口與模型接管流程，改採 Double Agent Mode 分工。
- 遠端連線成功後，中央區域會自動切到 Chalkboard tab，方便立即協作。

### 遠端連線提示
- 遠端連線請求視窗補上說明文字：接受後雙方與 AI 對話可互通。

### Chalkboard 雙向同步
- 遠端連線啟用時，Chalkboard 會以 `chalkboard_state` 事件同步雙方畫面。
- 本機使用者、遠端使用者或 AI 寫入 Chalkboard 後，對方都能看到最新黑板。
- 同步改為 idle 約 1 秒後送出；若任一方正在畫、拖圖、放文字或操作文字框，會暫停傳送與套用遠端畫面，避免互相覆蓋。

### 遠端 AI 思考狀態
- 新增 `ai_status` 遠端事件。
- 自家 AI 推理時顯示 `本地 AI: 思考中`；對方 AI 推理時顯示 `遠端 AI: 思考中`。
- 推理結束或錯誤時會回到 `待命`，狀態列樣式加粗並固定顯示。

---

## 📌 2026.05.06 — 遠端協作流程簡化與一般對話修正

### 版本
- `package.json` / `package-lock.json` 版本同步更新為 `2026.05.06`。

### 遠端畫面傳送
- UI 文案由「分享畫面」改為「傳送畫面」，避免誤解為 live share。
- 傳送前新增確認提醒：對方將能查看你分享的畫面內容，請勿分享機敏資訊。

### 遠端 AI 分工
- 移除「分享模型」操作入口；遠端連線後改以雙方 AI 分工協作，不再要求額外模型共享授權。
- 停用 model-share 與 remote model proxy API，舊呼叫會回傳 `410 Gone`。
- 遠端聊天室未明確指定對象時，本地 AI 會先產生輔助筆記，再交由遠端 AI 給出最終回覆，避免 Double Agent Mode 下雙方搶答。
- 使用者仍可透過 `@本地 AI` 或 `@遠端 AI` 明確指定單一 AI。

### 斷線提示
- 遠端連線中斷時，聊天窗會顯示「對方已斷線」。

### 一般對話修正
- System prompt 放寬：使用者可聊一般知識、創作、生活與非電腦維護話題。
- 只有明確涉及系統操作、軟體、SOP、自動化或本 App 功能時，AI 才主動導向 SOP / 安裝 / Agent 工作流。

---

## 📌 2026.05.14 — 遠端 Directive Protocol 與協作節奏重構

### 遠端 Directive Protocol 標準化
- **SUGGEST 結構化**：遠端 AI 建議按鈕改為固定輸出格式 `[SUGGEST: button_text="..." action="install_sop|add_task|execute_task|computer_use" sop_id="..." task_id="..." mode="..."]`。
- **ACTION 命名收斂**：建議 AI 優先使用 `ADD_TASK`、`EXECUTE_TASK`、`INSTALL_SOP`、`COMPUTER_USE`、`BROWSER_USE`，避免混用舊括號格式或未定義欄位。
- **遠端前端執行器**：`public/app.js` 新增 directive 解析與執行流程；遠端 AI 回覆中的 `INSTALL_SOP` / `ADD_TASK` / `EXECUTE_TASK` / `COMPUTER_USE` 現在會在本機真正觸發。

### 遠端聊天 UI 與 Suggestion
- **按鈕不再是原始字串**：修正 `[SUGGEST: button_text="..." ...]` 先前只顯示整串屬性字串的問題，現在會渲染成真正可點按鈕。
- **Remote Chat 降閃爍**：遠端聊天室加入 render signature，若 session 狀態與最後訊息未改變，就跳過整塊重繪，降低按鈕與訊息列表每 2 秒閃爍。
- **AI-to-AI 內部便條隱藏**：目標為 `remote-ai` 的 AI 內部協作訊息不再直接顯示給使用者，避免誤認為 AI 重複回答。

### 遠端 Orchestration 重構
- **快者先回**：當訊息同時需要本地 AI 與遠端 AI 時，改為本地 AI 先回使用者，遠端 AI 轉為背景補充，不再要求使用者等待雙方都完成。
- **Per-session Queue**：遠端 AI 自動回覆改為每個 session 依序排隊，避免上一題晚回、下一題插隊，造成「查得怎麼樣」時才回答前一題。
- **本地歷史保留、遠端單發**：`local-ai` 協作模式下，使用者原話只保留在本機 session 歷史，不再同時送去遠端 AI 與本地 AI 整理稿，降低雙重觸發與重複回答機率。

## 📌 2026.05.13 — 遠端協作、Chat UI、Skills 清單與 Action 回報修正

### Double Agent Mode / Chalkboard
- AI 需主動使用 Chalkboard 呈現計畫、比較、查詢摘要與多步驟結果。
- 遠端協作時，本地 AI 使用 `position: left`，遠端 AI 使用 `position: right`，雙方皆使用 `clear: false` 避免覆蓋。
- 遠端對話需以實際 Windows user name 稱呼對方，AI 自稱以自己的 PC name 表示。

### 遠端硬體查詢
- 使用者詢問「本機 / 自己電腦」free space、磁碟、RAM、CPU、GPU 時，預設交由本地 AI 回答。
- AI 回覆硬體資訊時必須標明該資訊屬於哪一台 PC。

### Chat UI
- 本機聊天底部工具列順序改為：新增對話、附上 Chalkboard、清除對話。
- 麥克風改放在送出鈕上方。
- 本機對話 tab 採橢圓 chip，右上角提供小型 `x` 關閉。
- 遠端連線設定改為可收合抽屜；遠端工具列加入附上檔案與掛電話中斷按鈕。
- 遠端身份欄位編輯時不再被輪詢立即還原，只有改動後才啟用「儲存名稱」。

### Skills / Action
- 左側新增 Skills 清單，來源為 `skills/<slug>/SKILL.md`。
- Action parser 支援 `[ACTION:...]` 與裸 `Action=Computer_Use...` 格式。
- Browser Use / Computer Use 執行後必須回傳成功或失敗摘要，避免 UI 沒動靜。
