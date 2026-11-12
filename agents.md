# Visual Agent 開發日誌

> 可視化、可塗鴉、可協作的 AI 管家
> by [anomixer](https://github.com/anomixer)

---

## 📌 2026.11.12 — 第三十五階段：移除型 SOP 不再被標示成「安裝」

> 接續同日第三十四階段；`action` 只有 install / uninstall 兩種值，前端卻把它直接當成顯示動詞。版本維持 `2026.8.7`。

### 症狀：一張寫著「安裝」的卡片，實際會移除軟體
- `rec_remove_copilot` 的 Install 階段執行的是停用 Copilot 登錄檔與移除 AppxPackage，但卡片標題是「安裝 Windows Copilot」、按鈕是「加入安裝清單／立即安裝」、徽章是「⚡ 可安裝」。使用者看到的是新增軟體，按下 ▶ 卻是移除。
- 根因在 `getActionTitle()`：`const normalizedAction = action === 'uninstall' ? 'uninstall' : 'install';` 之後無條件套用 `actions.installTitle`，把 SOP 自己的動詞剝掉再冠上「安裝」。`getActionLabel()` 同樣只有 uninstall / install 兩條路。
- 16 支內建 SOP 中有 6 支沒有 `## Uninstall` 階段，其中 5 支的 Install 階段根本不是安裝：`rec_remove_copilot`（移除）、`rec_backup`（建立還原點）、`sys_backup_user_files`（備份）、`sys_restore_user_files`（還原）、`rec_driver_check`（掃描）。第 6 支 `install_playwright_chromium` 確實是安裝，不受影響。
- 備份 / 還原 / 還原點 / 驅動檢查這 4 支至少還保留了自己的動詞當主體（「安裝 備份文件資料夾」），語意錯但不危險；Copilot 那支是把破壞性動作講成新增動作，屬誤導文案。

### 顯示與執行分離
- 新增 `getDisplayAction(title, action)`：`uninstall` 照舊；否則剝掉開頭非字母數字（表情符號、「」引號）後，只有開頭是 `安裝|下載` 或 `Install|Download` + 空白才回 `install`，其餘一律回中性的 `run`。
- `getActionLabel()` 增加 `run` 分支（zh `執行` / en `Run`），`getActionTitle()` 在 `run` 時原樣回傳標題，不再剝動詞。
- 兩個卡片工廠（`createRecommendCard` / `createSopCard`）、4 個加入／執行的 log 與 chat bubble、任務卡片與詳情視窗的動作 chip，全部改走 `getDisplayAction()`。徽章 `sidebar.actionable` / `actionableShort` 本來就吃 `actionLabel`，因此自動跟著變成「⚡ 可執行」。
- 新增 `task.addRunTask`（加入工作清單 / Add to work list）：`run` 沒有受詞可套進 `加入{action}清單`，硬套會變成「加入執行清單」。
- **送出的 payload 完全不變**：`action` 仍是原始的 `install`，executor 仍跑 Install 階段。這是純顯示層修正。
- 刻意不改的兩處：`evaluateSOPInstalledState()` 的 `recommendedAction`（改成 uninstall 會導向不存在的 `steps.uninstall`），以及 `buildTaskCompletionMessage()`（只與 `actions.uninstall` 比較，install 與 run 落在同一條 `安裝 / 執行完成` 分支，輸出已經正確）。
- 規則是「只改寫開頭是安裝類動詞的標題」，不是「所有 install 都原樣輸出」：後者會把目前正確的 `下載語言模型 → 安裝 語言模型` 一起改壞。`Scan and Install Drivers via Windows Update` 因為 regex 錨在開頭，正確判為 `run`。

### 測試與驗收
- 新增 `test/sop-action-verb.test.js`（13 項）：擷取真實 `getDisplayAction` / `getActionTitle` / `createSopCard` / `createRecommendCard` / `renderTaskCard` / `renderTaskModalBody` / `addRecommendToTodo`，SOP 清單直接讀 repo `sops/*/SOP.md`（唯讀）。鎖住前提（16 支、5 支無 Uninstall）、Copilot 卡片標題／兩個按鈕／徽章都不含安裝字樣、5 支非安裝 SOP 保留自己的動詞、安裝型 SOP 不受影響且仍可翻成解除安裝、下載型維持安裝家族、16×2×2 無重複動詞、點 ＋ 仍 POST `action:'install'` 且不執行、queue log 說執行不說安裝、任務 chip 與詳情、手動與動態標題不被強制冠動詞、en-US 無中文外洩。
- 驅動檢查的名稱是「檢查並安裝驅動程式」，句中的「安裝」是它真正要做的事，因此該項斷言改用錨在開頭的 `LEADING_INSTALL`，不是全文搜尋。
- `test/category-i18n.test.js` 的標題測試改依 `getDisplayAction()` 分支：`run` 必須逐字等於 SOP 名稱。另外 3 支測試檔的 DECLARATIONS 補上 `getDisplayAction`。
- 6 個突變探針全部被抓到（`getDisplayAction` 永遠回 install、`getActionLabel` 移除 run 分支、任務 chip 退回原始 action、SOP 卡片退回原始 action、字典刪掉 `actions.run`、`getActionTitle` 移除 run 短路），分別由 16 / 10 / 2 / 4 / 8 / 8 項測試攔下；探針後 `public/app.js` md5 `c23ed675f487c114eb42cc5509882c93` 與還原後一致。
- `npm test`：25 個 JS 語法、51 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify29`）：zh-TW 16 張 SOP 卡片中 5 支非安裝 SOP 全部顯示「加入工作清單／立即執行」，Copilot 為「移除 Windows Copilot」＋「⚡ 可執行」；推薦清單 8 張同樣正確；安裝型仍「加入安裝清單／立即安裝」，已安裝者仍翻成「加入解除安裝清單／立即解除安裝」。點 Copilot 的 ＋ 攔到的 payload 為 `{"title":"移除 Windows Copilot","skillId":"rec_remove_copilot","action":"install"}`，任務建立為 pending 且未執行；任務卡片 chip 與詳情「動作」皆為「執行」，工作日誌為「＋ 已加入執行：移除 Windows Copilot」。切 en-US 後為 `Remove Windows Copilot` / `Add to work list` / `Run now` / `⚡ Run available`，任務 chip 與詳情為 `Run`，SOP 清單無中文；切回 zh-TW 正常。console 無 error / warn。驗收後已停止實例（PID 9156）、確認 3210 / 19168 不再監聽並刪除暫存設定檔與探針腳本。
- **尚未完成**：未真的執行 Copilot SOP 確認移除結果（會動到登錄檔與 AppxPackage）；本輪只驗證文案與 payload。UAC 提權 process tree、雙機 Chalkboard、Vision、乾淨 Windows EXE 仍須實機驗收。
- 未變更 SOP 檔案、執行語意、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.11.12 — 第三十四階段：任務分類終於會翻譯，讀檔失敗不再靜默

> 接續同日第三十三階段；把「分類本地化」從側邊欄擴到任務卡片與詳情，並補上兩個 `FileReader` 的失敗路徑。版本維持 `2026.8.7`。

### 4 支 SOP 沒有 UI preset，zh-TW 側邊欄直接露出英文
- `getLocalizedItem()` 靠 `sopUi[item.id]` 覆蓋 title／description／category，但 16 支內建 SOP 只有 12 支有 preset。缺的 4 支是 `sys_backup_user_files`、`sys_restore_user_files`、`install_playwright_chromium`、`install_winhance`——正好是 2026.03.27 之後才加入的 SOP，補 SOP 時沒有同步補字典。
- 結果：zh-TW 介面下這 4 張卡片顯示 SOP 檔內的 `Name: Backup User Files` 等英文原文與英文描述，與其餘 12 張中文卡片並排。
- 修正：兩個語系各補 4 組 preset（title／description／category）。zh 標題用「備份文件資料夾」「還原文件資料夾」「安裝 Playwright Chromium」「安裝 WinHance 系統工具」；en 用名詞片語 `Documents Folder Backup` / `Documents Folder Restore`，避免 `getActionTitle()` 套上動詞後變成 `Install Back Up the Documents Folder` 這種雙動詞。
- 命名限制（已寫進 spec §17.1）：`getActionTitle()` 會先剝除 leading 非字母數字字元（`^[^\p{L}\p{N}]+`）再剝除既有動詞，所以 preset 標題不可以用「」這類引號開頭，否則引號會被吃掉、後面的動詞判斷也會跟著錯位。

### `categories` 字典缺 3 個實際 SOP 分類值與全部伺服器 fallback
- 逐一比對 16 支 SOP 的 `Category:` 欄位（11 種）與字典後，缺的是 `backup and restore`（2 支）、`browser runtime`（1 支）、`System Utilities`（1 支）——與上面缺 preset 的正好是同 4 支 SOP，因此這 4 支的分類在側邊欄與任務卡片都是英文原值。
- 另外字典完全沒有伺服器與前端會寫進任務的分類：`RECOMMEND_BASE` 的 `System` / `Cleanup` / `Backup`、SOP fallback `Maintenance`（`src/server.js` 4 處）、手動任務預設 `一般`（`src/server.js:3585`）、遠端 directive 任務 fallback `SOP`（`public/app.js:7527`）。
- 修正：zh-TW 補 10 鍵、en-US 補 16 鍵（8 個英文原值 + 8 個中文鏡像，含 `'一般': 'General'`）。`SOP` 刻意不加鍵——縮寫在兩個語系都讀得通，`localizeCategory()` 原樣回傳即可。

### 任務卡片與詳情直接印儲存值，兩個語系各露一半
- `renderTaskCard()` 與 `renderTaskModalBody()` 都是 `escapeHtml(task.category || …)`，完全沒經 `localizeCategory()`。側邊欄加入的任務存的是**已本地化**分類，`queueSopTaskById()` 與伺服器建立的任務存的是**英文原值**，手動任務存硬編「一般」——同一份清單裡三種來源混雜。
- 實際症狀：zh-TW 介面顯示 `Maintenance`，切到 en-US 反而顯示 `一般`。兩邊都錯，而且錯的方向相反。
- 修正：兩個渲染點改為 `task.category ? localizeCategory(task.category) : …`（卡片空值退回 `t('task.general')`、詳情退回 `—`）。**儲存值一律不動**：`tasks.json`、`/api/todo`、`/api/todo/export` 仍保留建立當下的原值，既有任務檔與匯出內容不受影響，未知分類也原樣顯示而不是被吞掉。
- `queueSopTaskById()` 順手補上 `getLocalizedItem(target)`，讓「依 ID 建立任務」與側邊欄 `queueSopTodo()` 走同一條本地化路徑；`executeNow`、重用既有任務與 SOP 找不到的分支都不變。

### `FileReader.onerror` 從未接上，讀檔失敗完全沒有回饋
- `importTasks()` 與 `handleChalkImageUpload()` 都只設 `reader.onload`。`onerror` 是獨立回呼，不接的話讀檔失敗（權限不足、檔案在選取後被移走、I/O 錯誤）就是**按下按鈕後什麼事都沒發生**——與第三十一／三十二階段修掉的匯入、加入任務靜默失敗同一類，只是這次連伺服器都沒被呼叫。
- Chalkboard 還多一層：`reader.readAsDataURL()` 成功只代表拿到位元組，`img.src = …` 之後若檔案不是可解碼的圖片（例如副檔名改成 `.png` 的文字檔），`img.onload` 永遠不觸發，畫布沒反應也沒有任何訊息。
- 修正：兩個 `reader.onerror` 都把 `reader.error?.message`（無訊息時 `Unknown error`）帶進 error 日誌；`handleChalkImageUpload()` 另補 `img.onerror`。新增 3 個語系鍵：`tasks.importReadFailed`、`chalkboard.imageReadFailed`、`chalkboard.imageLoadFailed`。失敗時不送請求、不動畫布，`event.target.value = ''` 既有的重設仍讓使用者能重試同一個檔案。

### 測試與驗收
- 新增 `test/category-i18n.test.js`（10 項，擷取真實函式與真實 I18N，並唯讀 repo `sops/*/SOP.md`）：16 支 SOP 的分類全部翻得出中文、每支 SOP 在兩個語系都有 preset 且 zh 名稱不等於儲存的英文名、install／uninstall 動作標題可讀（以動作標籤開頭、主詞非空、無雙動詞）、推薦與 fallback 分類覆蓋（`Maintenance`→維護、`一般`→General、`SOP` 原樣）、儲存分類隨語系切換且不被改寫、空值退回 `一般`／`General` 與 `—`、未知分類原樣顯示、`<img src=x onerror=alert(1)>` 跳脫、`queueSopTaskById()` 在 zh／en 各自送出本地化 title 與 category，以及重用／executeNow／SOP 找不到三條分支。
- 新增 `test/file-read-errors.test.js`（8 項，FakeFileReader + FakeImage）：匯入讀檔失敗會寫出含原因的 error 且永不 POST、無 message 時退回 `Unknown error`、成功／拒絕／JSON 格式錯誤三條既有路徑回歸、Chalkboard 讀檔失敗不動畫布且重設 input、`img.onerror` 回報無法解碼、有效上傳進入放置模式（`tool:'image'`、guide 座標）、無檔案時不建立 reader、en-US 標籤無中文殘留。跨 realm 物件比對一律走 `plain()` JSON round-trip。
- `test/app-task-detail-export.test.js` 與 `test/task-card-actions.test.js` 的 DECLARATIONS 補上 `localizeCategory`（渲染層新呼叫所需）。
- 敏感性探測（7 次，皆以 md5 確認還原為探測前位元組 `aa254694b45b667ce001400a6aef616c`）：移除渲染層 `localizeCategory` → 1 項失敗；字典拿掉 `Maintenance` → 1 項失敗；`queueSopTaskById` 改回原始欄位 → 2 項失敗；移除 `importTasks` 的 `reader.onerror` → 1 項失敗；移除 `handleChalkImageUpload` 的 `reader.onerror` → 3 項失敗；移除 `img.onerror` → 2 項失敗；清空 4 組新 preset → 2 項失敗。
- `npm test`：25 個 JS 語法、50 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify28`，只讀取、切換語系與上傳圖片，未執行任何 SOP）：zh-TW SOP 側邊欄 16/16 張卡片都是中文標題、11 個分類標頭全中文（資料保護／備份與還原／系統優化／瀏覽器／系統設定 / 語言／工作效率／AI 引擎／瀏覽器執行環境／娛樂／系統工具／系統清理）；以 API 種入 4 筆探測任務（`Maintenance`／`一般`／`backup and restore`／無分類），卡片在 zh 顯示維護／一般／備份與還原／一般、在 en 顯示 Maintenance／General／Backup and Restore／General；詳情視窗 zh「分類：維護」、en「Category: Maintenance」；`GET /api/todo/export` 證實 4 筆儲存分類仍是原值，未被渲染層改寫。
- 圖片路徑實測：把文字檔偽裝成 `.png` 上傳 → 工作日誌出現 `log-entry error`「❌ 圖片無法載入，請確認檔案是有效的圖片」，切 en-US 再上傳 → 「❌ The image could not be loaded. Make sure the file is a valid image.」；改用 canvas 產生的有效 PNG → `chalkboardState.tool === 'image'`、`pendingImage instanceof HTMLImageElement`、無 error 日誌。console 全程只有 `[log] [Init] hasRun flag: true`。
- 附帶確認一個**不是缺陷**的行為：第三次上傳同一個壞圖沒有新增日誌列，因為 `addLogEntry()` 刻意抑制「與上一列完全相同的非進度訊息」（進度條訊息則原地更新）。這是既有設計，本輪未改。
- 驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成／已知限制**：`rec_remove_copilot` 的 Install 階段實際上是停用／移除 Copilot，但 `evaluateSOPInstalledState()` 只在有 `steps.uninstall` 時才回 `uninstall`，因此 `recommendedAction` 固定為 `install`，卡片顯示「安裝 Windows Copilot」、按鈕 title「立即安裝」、徽章「⚡ 可安裝」——使用者按下去會移除 Copilot。這是語意誤導，列為下一批（不可直接改成 `uninstall`，否則會走不存在的 `steps.uninstall`）。
- 沿用前批未解：14 個 Hermes skill 的小寫 category 標頭在 zh-TW 仍是英文；任務卡片標題仍用儲存的英文 SOP 名（刻意不改 stored title，應在渲染層做）；`tokenizeForMatch()` 沒有 CJK 斷詞，中文查詢幾乎比對不到 skill；`task.logs` 與 `tasks.json` 無上限成長；`POST /api/todo` 仍沒有 try/catch。未以真實 SOP 執行驗證（未安裝、未提權）。
- 未變更 SOP 內容、LLM 設定、版本號；未執行安裝、提權，刪除僅限自己建立的暫存目錄。

---

## 📌 2026.11.12 — 第三十三階段：Skill 的巢狀 tags／category 與來源分組終於生效

> 接續同日第三十二階段；Skills 側邊欄依 `source` 分成 Visual Agent／Hermes 兩群，群內再依 `category` 細分。版本維持 `2026.8.7`。

### frontmatter 只比對行首鍵，巢狀欄位全部漏接
- `loadSkillDocuments()` 以 `fmText.match(/^tags:\s*(.+)$/m)` 這類「行首鍵」regex 取欄位，但 agentskills.io 規格（spec §4.1）把 `tags` 與 `category` 縮排在 `metadata:` 底下。實際 37 支內建 skill 全部照規格寫，於是 **37/37 的 tags 解析為空陣列、19/19 支 Hermes skill 的 category 退回預設 `'Skills'`**。
- 影響三層：`/api/skills` 回傳的 `tags` 一律 `[]`；`createSkillCard()` 的標籤徽章從來沒機會渲染，而搜尋框 placeholder 卻寫著「搜尋 Skill 名稱、描述或標籤」；`buildOnDemandSkillAndSopContext()` 的 token haystack 少了 tags 與 category 兩段，按需注入 skill 的比對面變窄。
- 修正：`src/pure.js` 新增 `parseSkillFrontmatter(frontmatter, fallbackName)`，逐行記錄縮排後組出階層，同鍵取最淺層（頂層優先於巢狀重複鍵）。`tags` 同時接受 spec 寫的 `["system", "tool"]`、逗號分隔與內建實際使用的空白分隔關鍵字；block 清單（`- item`）保留多字詞項目並忽略裸 `-`。字串值統一去頭尾引號，`description` 內的冒號不會被誤切。
- `loadSkillDocuments()` 改為呼叫此函式，不再自行用 regex 重推欄位；`source` 的 `hermes-` 前綴 fallback 仍留在 server（純函式只負責解析）。
- 回歸確認：逐一比對 37 支 skill 修正前後的 `name` / `description` / `source`，全部相同（比對時對舊解析套上同一個 server fallback，否則會誤判 19 支 source 回歸）；另以 13 組查詢（8 中文 + 5 英文）比對按需注入的 top-4 skill 排序，修正前後完全一致。

### `/api/skills` 漏掉 `source`，37 支全歸在同一群
- 前端 `renderSkillList()` 依 `skill.source` 分群（`hermes-agent` 走「From Hermes Agent」並顯示 `⚗️ Hermes` 徽章），但路由的 payload 只挑 `slug` / `name` / `description` / `tags` / `category`，`source` 根本沒送出去。
- 實測側邊欄只有一個群組標頭、計數 **37**，Hermes 群與徽章完全不存在——與 2026.06.08 記錄的「18 原生 / 19 Hermes 兩群」設計不符。
- 修正：payload 補上 `source: skill.source || 'visual-agent'`，並在 spec §3 API 表列為必要欄位。前端未改動。

### 測試與驗收
- 新增 `test/skill-frontmatter.test.js`（12 項）：巢狀解析、spec 陣列與逗號分隔、block 清單多字詞、頂層優先、引號與含冒號描述、空／undefined／null frontmatter 預設值、CRLF 與 tab 縮排、URL 與 `compatibility:` 不被誤判；另讀取 repo `skills/`（唯讀）斷言 37 支都有至少一個單字關鍵字 tag、name 等於 slug、description 非空，19 支 Hermes category 不為 `'Skills'` 且 source 正確、18 支原生為 `'Skills'`、Hermes category 至少 10 種；靜態鎖住 server 的 import 與委派接線；最後以隔離 harness 種入 3 支 skill 走真實 HTTP `GET /api/skills` 驗證 tags／category／source。
- 新增 `test/skill-list-ui.test.js`（8 項，擷取真實 `renderSkillList` / `createSkillCard` 與真實 I18N）：兩個來源標頭與各自計數、缺 source 仍歸 Visual Agent、群內 category 細分、最多 4 個 tags 且徽章只出現在 Hermes、無 tags 不渲染徽章、搜尋命中 name／slug／tags 與空狀態、空清單與重複渲染不累積、`<script>` 等內容跳脫。
- 敏感性探測（4 次，皆以 md5 確認還原為探測前位元組）：server 改回舊行首 regex → 12 項中 2 項失敗；解析器限制只認 `indent === 0` → 8 項失敗；路由移除 `source` → 1 項失敗；前端把 Hermes 過濾改成恆 false → 8 項中 5 項失敗。
- `npm test`：25 個 JS 語法、48 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify27`，只讀取與搜尋，未執行任何 SOP）：`/api/skills` 的 bySource 為 `{ visual-agent: 18, hermes-agent: 19 }`；Skills 分頁顯示「Visual Agent」18（1 個 `Skills` section、18 個標籤徽章、0 個 Hermes 徽章）與「From Hermes Agent」19（14 個 category section、19 個 `⚗️` 徽章、19 個標籤徽章）；搜尋 `macos` → 1 張卡（Hermes 群計數 1）、`robocopy` → 2 張原生卡、清空 → 37 張且兩群恢復；已截圖留存；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成／已知限制**：Skills 群內的 category 標頭（`platform`、`media` 等）在 zh-TW 介面仍是英文原值，需要渲染層本地化；任務卡片與詳情的 `task.category` 也仍直接顯示儲存值（硬編「一般」與 SOP 英文分類混雜），列為下一批。中文查詢幾乎比對不到 skill，因為 `tokenizeForMatch()` 沒有 CJK 斷詞，本輪未動。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權，刪除僅限自己建立的暫存目錄。

---

## 📌 2026.11.12 — 第三十二階段：新增任務不再探測全部 SOP，加入／刪除失敗不再靜默

> 接續同日第三十一階段；側邊欄「＋ 加入」與「▶ 立即執行」都走 `POST /api/todo`。版本維持 `2026.8.7`。

### 建立任務時的無效探測（效能）
- `POST /api/todo` 一進入就 `await annotateSOPRuntimeState(sops)`，但 `sopsWithState` 在整個 handler 內從未被讀取；真正需要的只有 `matchedSOP` 一支，而下一行已經用既有的 `evaluateSOPInstalledState(matchedSOP)`（含 30 秒 TTL 快取）取得狀態。
- 16 支內建 SOP 都有 Check 階段，其中 14 支各開一支 PowerShell（`SOPExecutor` timeout 20 秒），另外 2 支走 Ollama 狀態查詢。等於每次建立任務都平行跑 14 支子程序，結果直接丟棄。
- 以「逐函式 body 統計識別字出現次數」掃過 `src/*.js` 與 `public/app.js`（2,567 個宣告），全庫只有這一個宣告後從未讀取的區域變數。
- 實測（隔離設定檔 `%TEMP%\va-ui-verify26`，只跑 Check 階段，未安裝、未提權）：冷快取 `POST /api/todo { skillId: 'rec_install_chrome' }` 修正前 **1,006 ms**、修正後 **266 ms**；修正後緊接的 `GET /api/sops` 仍花 **977 ms**（16 支全掃），證明探測只是移回真正需要它的端點，沒有少做。兩次解析出的標題與 action 相同（`🗑️ Uninstall Google Chrome` / `uninstall`）。
- 側邊欄四個呼叫端（`queueSopTodo`、`addRecommendToTodo`、`addAndExecuteRecommend`）一律帶 `action`，`evaluateSOPInstalledState` 本來就被短路；但修正前那個無效 await 不受 `action` 影響，冷快取點擊仍得等 14 支探測。修正後以側邊欄真實 payload 實測冷快取只需 **12 ms**，且緊接的 `/api/sops` 仍是 977 ms（未被預熱）。
- 修正：移除該行無效 await。`GET /api/sops`、`/api/recommend` 與 `/api/chat` 的 annotate 呼叫完全不動。

### 加入／刪除任務失敗完全沒有回饋
- `api()` 把網路錯誤與非 JSON 回應（例如 500 HTML）都包成 `{ success:false, error }` 回傳，不拋例外。
- `addSopToTodo`、`addAndExecuteSop`、`addRecommendToTodo`、`addAndExecuteRecommend`、`deleteTask` 都只有 `if (data.success) {…}`，失敗時不寫日誌也不提示，點擊看起來完全沒反應——與第三十一階段修掉的匯入靜默失敗同一類。
- 可重現路徑：`saveTasks()` 落地失敗（磁碟滿、權限）→ async 路由拋錯 → Express 5 回 500 HTML；或任務在卡片渲染後、點擊前剛好變成 running，`DELETE /api/todo/:id` 回 `Cannot delete a running task`，前端靜默吞掉。
- 修正：新增 `logTaskFailure(key, data)` 單一出口（格式與 `importTasks` 一致：標籤＋伺服器原因），五個呼叫端補上 else 分支；新增 `task.addFailed`／`task.deleteFailed` 兩個語系鍵。成功路徑、請求 payload、渲染與執行順序都不變。

### 測試與驗收
- `test/helpers/chat-harness.js` 新增 `sops` 測試接縫：只有測試會傳入自訂 SOP 清單（含 Check 指令）與計數 executor，預設仍是兩支 consent fixture，不執行任何子程序。
- 新增 `test/todo-create-probes.test.js`（6 項，真實 HTTP）：建立 SOP 任務只探測被選到的那支、明確帶 action 時 0 次探測、手動任務 0 次探測、已安裝仍解析為 uninstall 且只探測一次、30 秒快取仍吸收重複建立、`GET /api/sops` 仍探測每一支 SOP。
- 新增 `test/task-queue-errors.test.js`（8 項，擷取真實函式與真實 I18N）：四種加入失敗與刪除拒絕都寫出 error 日誌並含伺服器原因、原清單與渲染不受影響、不會執行從未建立的任務、不會觸發 browser runtime 刷新、`api()` 包裝的傳輸錯誤同樣回報、成功路徑仍 queue／render／execute、en-US 標籤無中文殘留。
- 敏感性探測：還原無效 await → 6 項中 5 項失敗（1 pass / 5 fail，只有「`/api/sops` 仍全探測」該項通過）；把 `logTaskFailure` 改成 no-op → 8 項中 6 項失敗。隨後以 md5 確認 `src/server.js`（`99d697a8…`）與 `public/app.js`（`4e0fc20f…`）還原為探測前內容。
- `npm test`：25 個 JS 語法、46 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify26`，只點擊「＋ 加入」與卡片 ✕，未點擊任何 ▶ 執行安裝）：側邊欄 16 支 SOP 正常；把 `api` 暫時換成只攔截 `POST /api/todo` 的拒絕回應後點「＋」→ 工作日誌出現「❌ 加入任務失敗: Synthetic refusal for verification」（class `log-entry error`），任務數 4 → 4，攔截 1 次，隨後還原 `api`；同樣攔截 DELETE 後點卡片 ✕ → 「❌ 刪除任務失敗: Cannot delete a running task」，卡片仍在；還原後真實點「＋」→ 4 → 5、info 日誌「＋ 已加入安裝 SOP：安裝 Steam」、中央切到任務日誌；真實點 ✕ → 5 → 4 且無 error 日誌；en-US 下兩則拒絕分別為「❌ Failed to add task: …」與「❌ Failed to delete task: …」，切回 zh-TW 後 console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成／已知限制**：任務卡片標題仍用伺服器儲存的英文 SOP 名（`📦 Install Steam`），zh-TW 介面下與側邊欄的「安裝 Steam」不一致；本輪未改，因為改 stored title 會動到既有 `tasks.json` 與匯出內容，應在渲染層做本地化。`POST /api/todo` 仍沒有 try/catch，落地失敗回 500 HTML（前端現在至少會顯示失敗原因）。硬編「一般」分類、匯入整批取代無預覽、`FileReader.onerror` 未接，沿用第三十一階段記錄。未以真實安裝任務驗證（只跑 Check 階段）。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權，刪除僅限自己建立的暫存目錄。

---

## 📌 2026.11.12 — 第三十一階段：不良匯入檔不再永久破壞工作清單

> 接續同日第三十階段；`POST /api/todo/import` 整批取代 `todoList` 並立即落地。版本維持 `2026.8.7`。

### 一個壞元素就能讓工作清單永久停擺（可用性 + 資料）
- 匯入路由只檢查 `Array.isArray(tasks)`，元素本身完全不驗證，而且先 `todoList = tasks` + `saveTasks()` 才組回應。
- 實測（隔離 harness、真實 HTTP）`{ tasks: [null] }`：`publicTodoList()` 的 `({ logs, ...task })` 解構拋 `Cannot destructure property 'logs' of 'object null'`，import 回應變成 `success:false`，但 `[null]` **已經寫進 tasks.json**。此後 `GET /api/todo` 每次輪詢回 500 HTML，`/api/task/:id/status` 也在 `todoList.find((t) => t.id === ...)` 拋錯；前端 `api()` 的 `res.json()` 解析 HTML 失敗後被 catch 吞掉，工作清單從此靜默停擺。
- `reconcileInterruptedTasks()` 用 `task?.status` 且原樣保留 null，所以**重啟也救不回來**，使用者只能手改 `tasks.json`。
- 其他實測結果：`{ tasks: ['oops'] }` 的字串被 rest 解構成 `{"0":"o","1":"o","2":"p","3":"s"}` 落地；缺 id 的任務無法定位詳情；重複 id 讓 `find()` 只回第一筆、刪除卻一次移除兩筆；`logs: 'broken'` 使詳情視窗的 `task.logs?.length` 為真但 `task.logs.map` 拋錯，modal 無法渲染；未知 status（如 `paused`）會原樣顯示未翻譯字串，被歸在 pending 分組卻沒有 ▶。
- 修正：`src/pure.js` 新增 `validateImportedTasks()`，在邊界一次驗證「必須是物件、`id` 為非空字串、`id` 不得重複、`logs` 若存在必須是陣列、`status` 若存在必須是五種已知值」，任一不合格就**整批拒絕**並指出 `tasks[index]` 與原因；既有清單與 `tasks.json` 完全不動。缺 `logs` / `status` 仍視為合法（手寫檔可省略），不強迫補欄位。

### 匯入的 running 任務在 UI 永久卡住
- 第二十七階段只在啟動時 reconcile。匯入檔若帶 `status: 'running'`（例如從被中斷的那台機器匯出），本行程 `runningSOP` 是 null，卡片會永遠顯示 spinner，且 ▶ 與 ✕ 都不渲染（✕ 的條件是 `status !== 'running'`），使用者無法刪除也無法執行。
- 修正：import 路由對驗證後的清單呼叫既有的 `reconcileInterruptedTasks()`，與啟動同一條規則——標為 failed、保留停止時的 progress、補一筆中斷記錄，並隨 `saveTasks()` 落地。

### 動態指令任務沒有執行入口
- 第三十階段修好 executor 輸入結構後，`dynamicCmd` 任務仍無法從 UI 執行：卡片 ▶ 的條件是 `task.skillId && status === 'pending'`，而 dynamicCmd 任務沒有 skillId。
- 改為 `(task.skillId || task.dynamicCmd) && status === 'pending'`；running / success / failed / skipped 仍不顯示 ▶。

### 匯入失敗訊息一律歸咎 JSON
- `tasks.importFailed` 寫死「匯入失敗：JSON 格式錯誤」/「Import failed: JSON format error」，但同一個鍵也用於伺服器拒絕（running、驗證失敗），因此畫面上會出現「匯入失敗：JSON 格式錯誤: Invalid task at tasks[0]…」這種互相矛盾的訊息。
- 改為通用的「匯入失敗」/「Import failed」，伺服器錯誤照舊附在後面；`importTasks()` 的 catch 分支改附上真正的解析錯誤（原本只有裸標籤，使用者無從得知是檔案壞掉還是被伺服器拒絕）。

### 測試與驗收
- `test/pure.test.js` 新增 17 項 `validateImportedTasks`（合法清單與空陣列原樣通過、非陣列與 undefined、null / 字串 / 陣列元素、缺 id / 空白 id / 非字串 id、重複 id、logs 非陣列、未知 status、缺 logs 與 status 仍合法、五種已知 status、不改動傳入清單），全檔 89 項。
- `test/todo-import.test.js` 由 3 項增至 12 項：7 種不良匯入各自驗證「整批拒絕 + `tasks.json` byte-identical + 之後 `GET /api/todo` 與 `/api/task/:id/status` 仍 200」、匯入的 running 被 reconcile 且已落地、合法匯出檔 round-trip 仍保留完整 logs。
- 新增 `test/task-card-actions.test.js`（5 項，擷取真實 `renderTaskCard` 與真實 I18N）：pending SOP 任務有 ▶ / ✕ 且點擊只呼叫 `executeTask` / `deleteTask` 並 stopPropagation（不會同時開詳情）、pending dynamicCmd 無 skillId 仍有 ▶、兩者皆無則無 ▶、四種非 pending 狀態都無 ▶（running 也無 ✕）、zh-TW / en-US 狀態文字。
- `test/task-import-ui.test.js` 由 3 項增至 5 項：驗證拒絕時保留原清單並顯示精確條目、非 JSON 檔案回報解析錯誤且 0 次 API 呼叫。`test/i18n-keys.test.js` 新增 1 項：兩個語系的 `importFailed` 不得寫死 JSON / 格式錯誤。
- 敏感性探測：還原 import 路由與 ▶ 條件後，17 項相關測試中 9 項失敗（8 pass / 9 fail），確認不是空轉；隨後以 md5 確認 `src/pure.js` / `src/server.js` / `public/app.js` 還原為探測前內容。
- `npm test`：25 個 JS 語法、44 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify25`，動態指令只有 `Write-Output`，未安裝、未提權）：以真實 `importTasks()` + `File` 匯入 `{ tasks: [null] }` → 工作日志顯示「❌ 匯入失敗: Invalid task at tasks[0]: expected an object」，原有卡片仍在、`/api/todo` 仍回 200 且 id 不變；匯入含 running 與 dynamicCmd 的清單 → running 立即變成「失敗 / progress 40」且 ✕ 出現，dynamicCmd 卡片出現 ▶；實際點 ▶ → status `success` / progress 100、5 筆 log 含輸出 marker、完成後 ▶ 消失；中斷任務詳情顯示原有 info 加一筆 error 中斷記錄，class 正確；en-US 下卡片為 Failed / Completed，解析錯誤顯示「❌ Import failed: Expected property name or '}' in JSON at position 2…」、驗證錯誤顯示「❌ Import failed: Invalid task at tasks[0]: logs must be an array」；切回 zh-TW 後 console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成**：`POST /api/todo` 未帶 category 時仍存硬編中文「一般」，en-US 卡片會顯示中文分類（本輪未改，因為會動到既有 `tasks.json` 的 stored 值與匯出內容）。匯入仍是整批取代且無預覽 / 確認，匯入空陣列會清空全部任務（屬文件明列的取代語意）。`FileReader.onerror` 未接，檔案讀取失敗仍靜默。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權，刪除僅限自己建立的暫存目錄。

---

## 📌 2026.11.12 — 第三十階段：中斷執行的診斷記錄落地，動態指令任務不再一律失敗

> 接續同日第二十九階段；第二十七階段已能把重啟後殘留的 `running` 任務 reconciled 為 `failed`。版本維持 `2026.8.7`。

### 執行期間的日誌與進度完全沒有落地（診斷資料遺失）
- 先確認呼叫點：`saveTasks()` 只在「執行開始」與 `finally` 各呼叫一次，**不是**每 500 ms checkpoint。因此執行期間 `task.logs` 與 `task.progress` 只存在記憶體，`tasks.json` 停留在 `logs: []` / `progress: 10`。
- 行程被強制結束（當機、工作管理員結束行程、斷電）時 `finally` 不會跑，第二十七階段的中斷復原只能補一句通用訊息：使用者看不出停在哪個階段、跑過哪些指令、下載到哪裡。
- 不採用「每 500 ms 整份 checkpoint」：實測 `saveTasks()` 單次成本為 1 任務 × 3600 logs = 769.2 KB / 2.52 ms、20 任務 × 1000 logs = 4263.2 KB / 10.95 ms、50 任務 × 3600 logs = 38460.8 KB / 101.27 ms。整份重寫會把全部歷史任務的 logs 一起重送，歷史越多越慢。
- 也不截斷 `task.logs`：那會破壞「詳情與匯出保留完整執行歷程」的契約並銷毀使用者資料。
- 新增 `src/task-run-log.js` 與 `%APPDATA%\visual-agent\running-task.jsonl`：append-only JSONL，每筆 `{ taskId, progress, entry }` 只追加新增的那一行。`log` 與 `ui:message` 各追加一筆記錄，`phase:start` 追加 progress-only 記錄（`entry: null`），因此階段進度即使沒有新日誌也會落地。
- 執行開始前 `clearRunLog()`，`finally` 的 `saveTasks()` 之後再 `clearRunLog()`；正常結束不留 sidecar，完整 logs 仍由 `tasks.json` 保存。
- `parseRunLog()` 逐行寬容解析：行程被強制結束時最後一行可能只寫到一半，壞行與不同 `taskId` 的記錄一律跳過，不讓整份記錄報廢。
- `appendRunLogRecord()` / `clearRunLog()` 的失敗只寫 `debug.log`，不中斷執行；checkpoint 失敗時最終的 `saveTasks()` 仍會寫入完整 logs。

### 復原結果沒有寫回，第二次重啟就遺失
- 第二十七階段 reconcile 後只改記憶體。run log 在啟動時已被消費，因此第二次重啟只剩通用中斷訊息（實測 logCount 1 / progress 10，第一次復原的 9 筆全數消失）。
- `loadTasks()` 的 `if (interrupted)` 補上 `saveTasks()`，把復原的 logs / progress 與中斷記錄一起落地。與「健康的任務檔不得在啟動時被重寫」相容：沒有中斷任務時仍不寫檔，`test/task-restart.test.js` 的 byte-identical 斷言維持通過。

### 動態指令任務一律瞬間失敗
- `/api/execute/:taskId` 為 `task.dynamicCmd` 建立的虛擬 SOP 使用 `phases:`，且 commands 是 `{ type: 'ui' }` / `{ type: 'powershell', content }` 物件。executor 讀的是 `sop.steps.check.commands`，因此一律拋 `Cannot read properties of undefined (reading 'check')`；即使補上 steps，`runPhaseCommands()` 的 `cmd.trim()` 也會對物件拋 `trim is not a function`。
- 改為與 `sop-parser` 一致的形狀：`steps.{check,install,uninstall,verify}`、commands 為**字串陣列**、UI 訊息放 `uiMessage`、`errorHandling: []`。空的 check / verify 代表不做前置檢查與事後驗證，executor 會直接以 action 結果判定成功。順帶修正「動體指令」→「動態指令」錯字。
- 影響面：`dynamicCmd` 只能由 `/api/todo/import` 或手改 `tasks.json` 產生，app 內沒有建立入口；但匯入是文件明列的功能，匯入的動態指令任務過去 100% 失敗。

### 測試與驗收
- 新增 `test/task-run-log.test.js`（11 項）：5 項純函式（單行記錄格式、entry 順序與最新 progress、半截最後一行不丟棄先前記錄、不同 taskId 的記錄被忽略、空或垃圾輸入）；6 項真實 HTTP + 隔離 harness（執行中每筆 log 落地而 `tasks.json` byte-identical、啟動復原 logs/progress 且中斷記錄在最末並消費 sidecar、殘留的其他任務 sidecar 被忽略且清除、正常結束保存完整 logs 並移除 sidecar、健康清單不被重寫也不建 sidecar、復原結果已落地所以第二次重啟仍保有日誌）。最後一項以第一個 harness 寫出的 `tasks.json` 種入**第二個** harness 驗證。
- 新增 `test/task-dynamic-cmd.test.js`（3 項）：以**真實** `SOPExecutor` 子類捕捉 `{ sop, options }` 並全程 `dryRun: true`，斷言虛擬 SOP 的四個 phase、`install.commands` 為字串陣列、`uiMessage` 含指令、其餘 phase 為空、`errorHandling` 為陣列；端到端任務達到 `success` / progress 100 且日誌含 `[DRY-RUN]` 與動態指令提示、無 `Cannot read properties` / `trim is not a function`；無 dynamicCmd 也無 skillId 的任務被明確拒絕且維持 pending。
- `test/helpers/chat-harness.js` 只加 4 行接縫：in-memory fs 的 `unlinkSync`、可注入的 `executor`（預設仍是 InertExecutor）、`task-run-log.js` 加入真實模組 allowlist。不執行真實 PowerShell、不讀寫使用者 APPDATA。
- 敏感性探測：還原 3 個 run-log 接線點後 11 項中 4 項失敗（6 pass / 4 fail），確認測試不是空轉；隨後還原為原本內容。
- `npm test`：25 個 JS 語法、43 支測試檔與 server smoke 全綠。
- 實機 crash / restart 驗收（隔離設定檔 `%TEMP%\va-ui-verify24`，指令只有 `Write-Output` 與 `Start-Sleep`，未安裝、未提權、未刪除任何使用者資料）：執行中磁碟 `tasks.json` 為 running / progress 10 / 0 logs，sidecar 已有 7 筆且 progress 40；`taskkill /T /F` 後 sidecar 10 筆存活；第一次重啟復原 9 筆 logs / progress 40 **並寫回磁碟**；第二次重啟仍為 9 筆 / 40、沒有重複的中斷記錄、sidecar 已消費、清單回應不含 logs、匯出含 9 筆 logs 與 `agentVersion 2026.8.7`。
- 瀏覽器驗收（同一隔離實例）：復原任務的 `.task-card` 顯示「失敗」，點開詳情後 9 筆執行記錄的 class 依序為 `ui` / `info` ×7 / `error`，最後一筆為中斷訊息，標籤為「狀態／分類／動作／SOP ID（無）／建立時間／執行記錄」。另以 `/api/todo/import` 種入 dynamicCmd 任務並走真實 `executeTask()`：status `success` / progress 100、6 筆 log（`ui` / `info` ×3 / `success` ×2）含兩個輸出 marker，詳情視窗 class 與「已完成」正確，sidecar 已移除，console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽，並刪除暫存設定檔與 4 支探測腳本。
- **尚未完成**：任務卡片的 ▶ 按鈕只在 `task.skillId && status === 'pending'` 時渲染，因此 dynamicCmd-only 任務在 UI 上沒有可見的執行入口（本輪以 `executeTask()` 驗證伺服器與 executor 路徑，未改 UI）。torn write 只以模擬壞行覆蓋，未實機斷電驗證檔案系統層級行為。每筆任務的 `logs` 仍無上限，`tasks.json` 會隨執行次數持續成長。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權，刪除僅限自己建立的暫存目錄與探測腳本。

---

## 📌 2026.11.12 — 第二十九階段：匯出不再遺失執行記錄，詳情視窗補上語系與日誌顏色

> 接續同日第二十八階段；第二十階段把 `logs` 從清單回應移除後，前端 `todoList` 已不含執行記錄。版本維持 `2026.8.7`。

### 瀏覽器 fallback 匯出會遺失全部執行記錄（資料遺失）
- `exportTasks()` 先呼叫 `/api/todo/export-file`（原生另存新檔）；失敗時 fallback 直接 `JSON.stringify(todoList)`。第二十階段之後 `todoList` 一律沒有 `logs`，因此 fallback 匯出的每一筆任務都少了整段執行歷程，而且格式變成裸陣列、沒有 `exportedAt` / `agentVersion`。
- 失敗分支只 `console.error`，畫面上沒有任何訊息；使用者按下匯出後完全沒有反應，也無從得知是失敗還是被取消。
- 修正：fallback 改抓 `GET /api/todo/export`（伺服器端仍保有完整 logs），以 `Array.isArray(payload?.tasks)` 驗證後才下載整份 wrapper；驗證失敗或請求失敗都以新的 `tasks.exportFailed` 寫進工作日志。原生成功與 `cancelled` 分支直接 return，不會多打一次匯出請求。

### 任務詳情的執行記錄全部顯示為灰色
- `renderTaskModalBody()` 用 `l.type` 組 class，但任務 log 只有 `level`（`info` / `warn` / `error` / `ui` / `success`），`public/style.css` 的 `.log-entry.info/.success/.warn/.error/.ui` 因此永遠不會命中；錯誤與警告跟一般訊息同色。改為 `l.level || 'info'`，與全域日誌面板 `addLogEntry()` 的來源一致。

### 詳情視窗與經驗庫匯出寫死中文
- 任務詳情的「狀態 / 分類 / 動作 / SOP ID / 建立時間 / 執行記錄 / （無）」、經驗詳情的「來源 / 更新時間」都是硬編字串，切到 en-US 仍顯示中文；建立時間固定用 `zh-TW` 格式。
- 補上 `task.detail*`（7 鍵）與 `exps.detailSource` / `exps.detailUpdatedAt`，日期依 `currentLocale` 選 `zh-TW` / `en-US`。zh-TW 的 `hour12` 刻意維持原樣，避免改動既有中文顯示。
- `exportExps()` 的無標題 fallback 與時間戳一併走 `t('exps.unnamed')` 與語系日期。

### 測試與驗收
- 新增 `test/app-task-detail-export.test.js`（8 項，擷取真實函式 + 真實 I18N）：fallback 保留完整 logs 與 wrapper 且不是裸陣列、fallback 失敗時 0 次下載並留下錯誤訊息、原生成功 / 取消不進 fallback、五種 level 各自對應正確 class、zh-TW / en-US 標籤與日期字串、無 SOP 的在地化替代字與無 logs 時不顯示記錄區塊、經驗詳情標籤、經驗匯出的未命名 fallback 與語系時間戳。日期斷言以各語系 `toLocaleString` 比對，不受執行環境時區影響。
- 以還原三項修正的副本實測：8 項中有 4 項失敗，確認測試不是空轉；還原後 8/8 通過。
- `npm test`：24 個 JS 語法、41 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify23`，以 `/api/todo/import` 種入含 5 行 log 的任務）：先確認 `/api/todo` 與前端 `todoList` 皆不含 logs（`hasLogsInList: false`）；讓原生匯出失敗後，實際下載的檔案為物件而非陣列，含 `agentVersion 2026.8.7`、`exportedAt` 與全部 5 行 log，請求順序為 `['/api/todo/export-file','/api/todo/export']`。詳情視窗五種 level 的計算後顏色分別為 error `rgb(244,113,113)`、warn `rgb(220,220,170)`、success `rgb(78,201,176)`、ui `rgb(197,134,192)`、info `rgb(157,157,157)`。zh-TW 顯示「狀態／分類／動作／SOP ID／建立時間／執行記錄／（無）」與 `2026/11/12 上午10:00:00`；en-US 顯示 Status／Category／Action／SOP ID／Created／Execution log／(none) 與 `11/12/2026, 10:00:00 AM`。失敗分支 0 次下載並顯示 `❌ Task list export failed: probe offline`，取消分支 0 次下載並顯示 `ℹ️ Task list export cancelled`；經驗匯出標頭為 `> SOP: probe_sop | 11/12/2026, 10:00:00`；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔與探測腳本。
- **尚未完成**：切換語系時「已經開啟」的詳情視窗仍停在舊語言，需關閉重開才會翻譯（任務與經驗 modal 皆然，屬既有行為，本輪未修，因為需要追蹤目前開啟的是哪一個 modal）。驗收時原生另存對話框與瀏覽器下載皆以 stub 攔截，未實際寫出檔案到使用者磁碟。每筆任務的 `logs` 仍無上限，`tasks.json` 會隨執行次數持續成長。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權，刪除僅限自己建立的暫存目錄。

---

## 📌 2026.11.12 — 第二十八階段：Browser 分頁快照不再重疊、亂序與整份重送

> 接續同日第二十七階段；Browser 分頁每 2 秒抓一次 `fullPage` PNG。版本維持 `2026.8.7`。

### 量測（本機 i9-14900 + RTX 4000 Ada，headless Chromium，本機 fixture 頁）
- `captureBrowserSnapshot()` 單次成本：400 段文字（約 20,000px 高）747–870 ms、PNG 1.84 MB、base64 2.46 MB；2,500 段（約 125,000px 高）4.06–4.46 s、PNG 8.11 MB、base64 10.82 MB。
- 未設守衛的 2 秒輪詢在長頁上實測 **peak 4 份同時截圖**（`setInterval` 不等前一輪回來）。
- 靜止頁面每次輪詢仍整份重送：短頁 2.46 MB / 2 秒，長頁 10.82 MB / 2 秒，前端還要重新 JSON parse、base64 解碼與 PNG 解碼。
- 以原 `ensureBrowserSession()` 的邏輯重現並行呼叫：兩個呼叫各自 `newContext()` + `newPage()`，只有一組被記住，**洩漏 1 個 context**（實測 contexts 1 → 3）。

### 修正
- `ensureBrowserSession()` 改為協調函式：page 仍存活就直接回傳（順帶省去每次呼叫都遞迴掃描 Playwright cache 找執行檔），否則共用進行中的 `openBrowserSession()` promise，結束後（含失敗）清除。實際開啟流程原封不動移入 `openBrowserSession()`。
- `captureBrowserSnapshot()` 額外回 `snapshotHash`（PNG 的 SHA256）。`GET /api/browser/session/snapshot?since=<hash>` 與新截圖雜湊相同時只回 `{ success, title, url, unchanged: true, snapshotHash }`，不含 base64。比對依據是「前端上次收到的影像」而非伺服器全域狀態，因此 AI 的 Browser Use 截圖不會讓 UI 誤判為未變。
- 前端 `refreshBrowserSnapshot()` 加 `snapshotInFlight` 守衛，並在導覽 / 上一頁 / 重新整理進行中（`snapshotActionsInFlight` 計數）暫停輪詢，避免白抓一份舊頁面。
- 保序：只有使用者操作會 `++snapshotSeq`，輪詢只讀取序號；晚到的舊快照若序號已變就丟棄。`applyBrowserSnapshotResponse()` 統一記錄 hash 並套用影像，`unchanged` 時只更新標題與網址、不重寫 `img.src`。

### 驗收時發現並修掉的設計錯誤
- 第一版讓輪詢也 `++snapshotSeq`。實機驗收立刻暴露：長頁導覽需 4.5 s，期間輪詢把序號推進到 14，導覽自己的回應反被判為過期丟棄，畫面停在 `about:blank`，直到下一次輪詢（8.2 s，與導覽同時截圖）才自愈。
- 改為「輪詢讀序號、只有使用者操作推進序號」，並在操作期間暫停輪詢後重測：導覽 381 ms 立即套用，7 秒後標題 / 網址 / 影像不變，序號維持 1。

### 測試與驗收
- 新增 `test/browser-snapshot.test.js`（3 項，真實 HTTP + 假 Playwright）：並行 start 只 launch / newContext / newPage 各一次；`since` 命中回 `unchanged` 且不含 base64、仍會實際截圖、PNG 改變後回新影像與新雜湊、無 `since` 或未知 `since` 回完整影像；導覽與 reload 一律回完整影像，其雜湊可供下一次輪詢沿用。
- `test/helpers/chat-harness.js` 新增 `playwright` 注入（預設仍 deny launch）與種子檔案的父目錄建立，讓目錄掃描找得到假執行檔；不啟動任何真實瀏覽器。
- 新增 `test/app-browser-snapshot.test.js`（7 項，擷取真實函式）：重疊輪詢只發一次且結束後釋放、第一次不帶 since 之後帶上次 hash、`unchanged` 不重寫 src 但更新標題網址、失敗保留 hash 並釋放守衛、操作後 hash 供輪詢沿用、操作期間暫停輪詢、兩次重疊導覽只套用最新且計數歸零。
- 以還原舊行為的副本實測：3 項 server 測試全部失敗（launch 2 次、`unchanged` 為 undefined），確認測試不是空轉。
- `npm test`：24 個 JS 語法、40 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify22`，`PLAYWRIGHT_BROWSERS_PATH` 唯讀指向既有 cache，fixture 頁由本機 3999 提供）：長頁 5 個並行 `refreshBrowserSnapshot()` 只發出 1 個請求（peak 1、4,124 ms），導覽結果立即套用且未被後續輪詢覆蓋；短頁連續 5 次輪詢全為 `unchanged: true`、影像字元總數 0（修正前為 5 × 29,190）、每次約 30 ms；`/api/agent/browser-use` snapshot 仍正常回影像與 64 字元雜湊；console 無 error / warn。驗收後已停止實例與 fixture server、確認 3210 / 19168 / 3999 不再監聽並刪除暫存設定檔與探測腳本。
- **尚未完成**：伺服器仍會每次輪詢實際截圖，長頁約 4 秒的截圖成本未消除（只消除重疊與重送）；極長頁的 fullPage PNG 位元組不穩定（實測同一頁雜湊在 `df95e10a` / `c1334c7d` 之間跳動），dedupe 會 miss，屬已知限制。背景分頁的 Chrome 計時器節流會使輪詢變慢，驗收時改以手動呼叫驅動。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權，刪除僅限自己建立的暫存目錄。

---

## 📌 2026.11.12 — 第二十七階段：重啟後不再殘留永久「執行中」的任務

> 接續 10.29 第二十六階段；`runningSOP` 只存在記憶體，但 `tasks.json` 會保存 `status: 'running'`。版本維持 `2026.8.7`。

### 中斷執行後的永久卡死
- `/api/execute/:taskId` 把任務設為 `running` 後立刻 `saveTasks()`；若行程在執行中被結束（當機、被 kill、關機、直接關掉 app），檔案就留下 `running` 與中途的 progress。
- `loadTasks()` 原樣還原，而 `runningSOP` 重啟後是 `null`，於是這個任務永遠停在「執行中」：
  - `renderTodoList()` 對 `status === 'running'` 不畫刪除鈕，只畫 spinner → UI 無法移除。
  - Agent 的 `REMOVE_TASK` 看到 `status === 'running'` 直接拒絕，`CLEAR_ALL` 也因「有任務執行中」拒絕整批清空。
  - `queueSopTaskById()` 與前端的去重都把 `running` 視為進行中，同一支 SOP 因此無法重新加入（回 `reused: true`）。
  - Ollama / 模型 bootstrap 的 `isRunning` 判斷被擋住，自動安裝不會啟動。
  - `/api/diagnostics` 的 `runningTaskCount` 永遠多算一個幽靈任務。
- 使用者唯一的逃生口是手動編輯 `tasks.json`。

### 啟動時 reconciled
- `src/pure.js` 新增 `reconcileInterruptedTasks(tasks)` → `{ tasks, interrupted }`：只把 `running` 改為 `failed`，保留原有 logs 與停止時的 progress，補一筆 `level: 'error'` 的中斷記錄，**不捏造 `completedAt`**（否則 `getTaskDurationText()` 會算出從建立到重啟的假時長）。不改動傳入的任務物件；非陣列輸入回空清單。
- `loadTasks()` 套用結果，有中斷時才 `console.warn` + `fileLog` 一次。健康的任務檔不會在啟動時被重寫，仍由既有 `saveTasks()` 路徑持久化。

### 冒煙測試不再動到真實 AppData
- `scripts/check.js` 的 smoke 以繼承的環境變數 spawn `src/server.js`，也就是使用者真實的 `%APPDATA%`：每次 `npm test` 都會同步 bundled assets、讀真實 `tasks.json`、寫真實 `debug.log`。本輪讓啟動會改任務狀態後，這個缺口必須先補。
- 改為 `mkdtempSync` 建立暫存 profile，以 `APPDATA` / `LOCALAPPDATA` 覆寫 spawn 環境，結束後刪除。
- 實作時先踩到一個坑：第一版把清理放在子行程的 `exit` 事件，但呼叫端在 `smoke()` resolve 後立刻 `process.exit(0)`，事件根本來不及送達，暫存 profile 因此洩漏。`finish()` 改為等子行程真的結束才 settle，清理留在 `exit` handler。

### 測試與驗收
- `test/pure.test.js` 新增 13 項（共 73）：只改 running、回報中斷數、保留 progress 與原有 log、中斷 log 為 error 且時間戳可解析、不改動傳入物件、未中斷任務原樣保留、空清單、多筆中斷、無 logs 欄位、非陣列輸入。
- 新增 `test/task-restart.test.js`（3 項，真實 HTTP）：`test/helpers/chat-harness.js` 新增 `createChatHarness({ seedFiles })`，在 server 模組載入前把相對 sandboxRoot 的檔案寫進記憶體 fs，才測得到 `loadTasks()` 這種啟動行為。驗證 running → failed 且 progress / 原有 log 保留、`completedAt` 仍為 null、pending / success 不受影響、reconciled 後可刪除且匯出不再是 running、健康任務檔啟動後位元組不變。
- 此 harness 不能斷言 `/api/diagnostics`：它的 port owner 探測使用 `child_process.execSync`，會被 `assertSafe()` 列為 blocked 操作。
- `npm test`：24 個 JS 語法、38 支測試檔與 server smoke 全綠，且無殘留 `va-smoke-*` 暫存目錄。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify21`，啟動前直接把 `tasks.json` 種成 progress 40 的 running 任務與 2 筆 log marker，等同當機留下的狀態）：啟動 log 出現 `[Tasks] 1 task(s) interrupted by the previous shutdown; marked as failed.`；卡片顯示「失敗」、有 ✕ 刪除鈕、無 spinner；詳情視窗依序顯示 2 筆原 marker 與 `Task execution interrupted: the server stopped before it finished.`；點 ✕ 後任務移除並顯示空狀態；`debug.log` 留有 reconciliation 記錄；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成**：未在真實 SOP 執行中真的 kill 行程重現（會執行安裝）；本輪以「種入當機後會留下的持久化狀態」模擬，並只處理啟動時的殘留。server 持續運行但 executor 卡住的情境不在本次範圍。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權，刪除僅限自己建立的暫存目錄。

---

## 📌 2026.10.29 — 第二十六階段：本機對話持久化預算，配額溢出不中斷對話

> 接續同日第二十五階段；每新增一則訊息都會 `touchLocalChatSession()` → `saveLocalChatSessions()`。版本維持 `2026.8.7`。

### 配額溢出與同步序列化
- `saveLocalChatSessions()` 直接 `JSON.stringify(localChatSessions.slice(0, 24))`，內容包含 Chalkboard 附件的完整 PNG base64（單張可達數百 KB 至數 MB），且沒有任何大小上限。
- 兩個後果：`localStorage.setItem` 拋出的 `QuotaExceededError` 會沿 `addLocalSessionMessage()` 往上冒到聊天送出流程；以及每送一則訊息就要同步序列化整份歷史附件，訊息越多越慢。
- 同一個 origin 的配額還可能被其他資料佔用，因此「寫入失敗」是必須容忍的正常情況，不是例外。

### 先文字、再回填附件
- 新增 `LOCAL_CHAT_PERSIST_LIMIT`（2 MiB）與 `buildLocalChatPersistPayload(sessions, limit)`：
  - 先複製一份把所有 `imageDataUrl` 清空的 clone，只序列化文字；文字本身已超過預算就直接回傳，不再做任何附件處理。
  - 剩餘預算依「工作階段 `updatedAt` 新到舊、訊息新到舊」回填附件。data URL 只含 JSON 安全字元，長度可直接估算，不需要為了量大小而重複 stringify。
  - 只改動持久化用的副本，記憶體中的 `localChatSessions` 與附件完全不受影響（每 session 仍上限 120 則）。
- `saveLocalChatSessions()` 的兩個 `setItem` 包進 try/catch，失敗只 `console.warn`，不中斷對話。

### 測試與驗收
- 新增 `test/app-chat-persist.test.js`（5 項，擷取真實 `LOCAL_CHAT_PERSIST_LIMIT` / `buildLocalChatPersistPayload` / `saveLocalChatSessions`）：小歷史原樣保存、超預算時丟最舊附件但保留文字與最新附件、不改動傳入的 sessions、無附件超預算時原樣回傳、寫入失敗不拋錯且只 warn 一次。
- `test/chat-ui-consent.test.js` 的宣告擷取清單補上新的 const 與函式；缺漏時 try/catch 會吞掉 `ReferenceError`，讓 9 項 consent 測試在 `persisted()` 讀到 `undefined` 而失敗。
- `npm test`：24 個 JS 語法、37 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify20`）：
  - 8 張 1,000,022 字元 PNG 附件 → 未拋錯，儲存 2,015,908 字元 ≤ 2,097,152，最新 2 張保留、較舊 6 張只留文字，記憶體中 8 張附件完整。
  - 實際尺寸 6 張 300,022 字元附件 → 全數保留（1,802,075 字元），每則新增耗時 3–21 ms；重新載入後 6 則訊息與附件完整還原。
  - 把 `localStorage.setItem` 換成會拋 `QuotaExceededError` 的替身 → `saveLocalChatSessions()` 不拋錯，只留下 1 筆 warn；console 無 error / warn。
  - 驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成**：記憶體中的附件總量仍無上限（24 sessions × 120 則）。實測把單一 session 塞到 404M 字元附件（heap 1.6 GB）時，每次保存仍因 GC 壓力耗時約 1.3 秒；同樣演算法在正常資料量下只需 14 ms。本輪只限制持久化大小，未改記憶體保留策略。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第二十五階段：debug.log 輪替與診斷尾端讀取

> 接續同日第二十四階段；`fileLog()` 有 50 個呼叫點（搜尋、影片、Skill 載入、遠端錯誤等）。版本維持 `2026.8.7`。

### 無限成長與整檔讀取
- `fileLog()` 直接 `fs.appendFileSync` 到 `%APPDATA%\visual-agent\debug.log`，從不輪替；長時間使用後檔案會持續變大，且每次寫入都與診斷讀取共用同一份檔案。
- `readDebugLogTail()` 為了取最後 80 行，先 `fs.readFileSync` 把整份檔案讀進記憶體再 split；檔案越大，每次開啟「診斷資訊」或打 `/api/diagnostics` 的成本越高。

### 收斂到單一模組
- 新增 `src/debug-log.js`：
  - `appendDebugLog(logPath, message, options)` 寫入一行後檢查大小，超過 `DEFAULT_MAX_BYTES`（1 MiB）就只保留尾端一半（`keepBytes`），之後要再累積半份才會重寫，不會每次 append 都搬整份檔案。
  - 截取尾端以位元組為單位，開頭可能是半行甚至半個 UTF-8 字元；`dropPartialFirstLine()` 丟掉第一個不完整行，避免診斷視窗出現亂碼。
  - `readDebugLogTail(logPath, maxLines, options)` 改用 `openSync` / `fstatSync` / `readSync` 只讀尾端 `DEFAULT_TAIL_BYTES`（256 KiB），再取最後 N 行；回傳形狀 `{ path, lines, exists }` 與錯誤處理維持原樣。
- `server.js` 的 `fileLog()` 與 `readDebugLogTail()` 改為薄封裝，50 個呼叫點與 `/api/diagnostics?tail=` 參數都不需改動。

### 測試與驗收
- 新增 `test/debug-log.test.js`（8 項，只用 `os.tmpdir()` 暫存目錄）：時間戳行格式、超過上限後檔案仍在上限內且保留最新行、丟棄最舊行、從完整行開始、中文輪替後不出現 U+FFFD、尾端讀取只回指定行數、檔案遠大於讀取窗口時仍正確、檔案不存在回 `exists:false`，並靜態鎖住 server 已改走此模組、不再裸 `appendFileSync`。
- `test/helpers/chat-harness.js` 為 `src/debug-log.js` 加入 inert 注入（與 sop-executor / llm / system 一致），避免 consent 測試載入真實檔案系統。
- `npm test`：24 個 JS 語法、36 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify19`）：先種入 4,108,934 bytes 的舊 `debug.log`，並在隔離 skills 目錄放一個 `SKILL.md` 為目錄的壞 skill；啟動後 `GET /api/skills` 觸發真實 `fileLog('Skill load failed … EISDIR')`，檔案輪替為 524,827 bytes、最舊的 `old-line-0` 已丟棄、新錯誤行存在、無 U+FFFD；`/api/diagnostics?tail=2` 只回最後 2 行；前端 `openDiagnosticsModal()` 正常顯示該錯誤行，console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除（壞 skill 只存在於隔離暫存目錄）。

---

## 📌 2026.10.29 — 第二十四階段：日誌游標改用序號，緩衝滿載不再停滯

> 接續同日第二十三階段；全域日誌緩衝上限 500 筆，超過後 `shift()`。版本維持 `2026.8.7`。

### 游標與緩衝錯位
- 全域 `logs` 只在 SOP 執行時寫入，`executor` 事件在超過 500 筆後 `logs.shift()`；前端游標卻仍是「已收到的筆數」（`currentLogIndex = data.total`）。
- 一旦緩衝開始丟棄最舊項目，`since` 與陣列索引就對不上：`since === logs.length` 會永久回空陣列，日誌面板從此停住；游標落後較多時，回傳的 slice 也會是位移後的錯誤段落。
- 這個缺陷只在累積 500 筆執行 log 後出現，短時間驗收看不出來。

### 序號化
- `src/pure.js` 新增 `appendLogWithSeq(buffer, entry, limit)`：寫入時附上單調遞增的 `seq`，超過 `LOG_BUFFER_LIMIT`（500）才丟最舊的；`server.js` 四個寫入點（executor log、`ui:message`、完成、失敗）全部改走此函式，不再有裸 `logs.push`。
- `selectLogsForClient(allLogs, since)` 的 `since` 改為「上一筆序號」：`total` 回最新序號；`since > total`（後端重啟）或 `since < 最舊序號 - 1`（游標落在已丟棄區段）都回全部並標記 `reset: true`，其餘只回 `seq > since` 的項目。前端的「`reset` 清面板、`currentLogIndex = total`」邏輯不需改動。
- 任務本身的 `task.logs` 不受影響：仍保留完整歷程、不加 `seq`，匯出與詳情格式不變。

### 前端節點上限
- 伺服器只留 500 筆，但前端 `#logEntries` 從不刪除節點，長時間執行會持續成長；`addLogEntry()` 新增 `trimLogEntries()`，超過 `LOG_ENTRY_LIMIT`（600）就移除最舊節點，保留進度條原地更新與貼底行為。

### 測試與驗收
- `test/pure.test.js`：新增 6 項 `appendLogWithSeq`（首筆序號、遞增、不改動原物件、上限丟最舊、丟棄後序號連續、上限後接續）與 3 項游標案例（落在丟棄區段重置、緊接最舊項目可增量、空緩衝），日誌預期全部改為 `seq` 形狀（60 項）。
- 新增 `test/app-log-dom-cap.test.js`（3 項）：擷取真實 `LOG_ENTRY_LIMIT` / `trimLogEntries`，驗證未達上限不刪、超過上限先丟最舊，並確認 `addLogEntry()` 真的呼叫裁剪。
- 新增 `test/server-log-buffer.test.js`（2 項）：靜態鎖住 `server.js` 沒有裸 `logs.push`、四個寫入點都走 `appendLogWithSeq`。
- `npm test`：23 個 JS 語法、35 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify18`）：以真實 `addLogEntry()` 連續寫入 605 筆後，`#logEntries` 節點數為 600、第一筆為 `cap-5`、最後一筆為 `cap-604`；把 `currentLogIndex` 設為 999 後呼叫 `pollLogs()`，游標回到 `total: 0` 且下一次仍正常輪詢；`/api/logs` 無參數 / `since=0` 回 `total: 0` 無 `reset`，`since=2` / `since=999` 回 `reset: true`；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成**：未以真實 SOP 執行累積 500 筆以上日誌驗證線上丟棄與 `reset` 時序（會執行安裝）；本輪以純函式、靜態接線與瀏覽器節點上限互補。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第二十三階段：日誌輪詢避免重複與後端重啟後停滯

> 接續同日第二十二階段；日誌面板每 2 秒以 `since` 游標增量抓取。版本維持 `2026.8.7`。

### 重疊請求
- `pollLogs()` 由 `setInterval` 直接呼叫、未等待前一輪；若某次回應較慢，兩個使用相同 `since` 的請求都會回傳同一段日誌，`forEach(addLogEntry)` 就把同一批訊息貼兩次。
- 新增 `logPollInFlight` 守衛：上一輪未回來就跳過本輪，回應（含失敗）後才釋放。游標更新與 `addLogEntry` 邏輯不變。

### 游標失效
- 後端 `logs` 只存在記憶體，重啟後從 0 重新累積；前端 `currentLogIndex` 仍停在舊的較大值時，`selectLogsForClient()` 的 `slice(since)` 永遠是空陣列，新日誌必須等到筆數追上舊游標才會出現。
- `selectLogsForClient()` 在 `since > 目前筆數` 時改回傳全部日誌並標記 `reset: true`；`/api/logs` 原樣帶出此欄位。`since` 等於長度仍屬正常靜默（只回空陣列）。
- 前端收到 `reset` 且確有日誌時，先清空日誌面板再貼上伺服器現有內容，避免新舊兩次 server 的日誌混在一起；空的 reset 不會清空面板。

### 測試與驗收
- 新增 `test/app-log-poll.test.js`（4 項，擷取真實 `pollLogs` 與游標變數）：重疊呼叫只發一次請求、成功後下次以新 total 續抓、失敗或格式錯誤會釋放守衛且游標不前進、`reset` 會先清空面板、空 reset 不清空。
- `test/pure.test.js` 更新日誌選擇器預期（新增 reset 案例，51 項）。
- `npm test`：23 個 JS 語法、33 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify17`）：暫停輪詢後以 `since=999` 直接請求 `/api/logs`，回傳 `reset: true`、`total: 0`；在真實 DOM 放入舊項目並讓 `pollLogs()` 收到一筆 reset 回應後，面板只剩新訊息、游標更新為 1；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成**：尚未以此變更實際重啟後端觀察真實日誌續接（伺服器只在任務執行時寫入日誌，避免為驗收執行真實 SOP）；以 HTTP 契約與客戶端行為測試互補。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第二十二階段：硬體探測重疊時共用同一次執行

> 接續同日第二十一階段；硬體分頁每 5 秒輪詢 `/api/system/health`。版本維持 `2026.8.7`。

### 探測成本
- `getSystemHealth()` 會依序執行外掛：`temperature-monitor`（`nvidia-smi`，8 秒 timeout）再 `hardware-info`（PowerShell，10 秒 timeout）；探測本身可能比 5 秒輪詢間隔久，前端 `setInterval` 不等前一輪完成，慢機器上會同時堆疊多支 PowerShell / nvidia-smi。
- 聊天硬體上下文、遠端硬體回覆與診斷快照也各自呼叫 `getSystemHealth()`，與輪詢同時發生時同樣會多跑一份。

### 共用進行中的探測
- `getSystemHealth()` 改為協調函式：進行中的探測以 plugin 目錄為 key 存放，重疊呼叫共用同一個 promise，結束後（含失敗）清除，下一次呼叫照常重新探測。
- 實際探測流程原封不動移入 `collectSystemHealth()`；外掛順序、錯誤吞掉與 `health` 欄位皆不變。
- 新增 `options.pluginDirs` 測試接縫：只有測試會傳入暫存目錄，正式路徑仍掃描 AppData 與內建 `plugins/`。

### 測試與驗收
- `test/system-plugins.test.js` 由 5 項擴充為 10 項：以暫存目錄放入延遲假外掛，驗證兩個並行呼叫只執行一次外掛、拿到同一份結果、探測結束後再呼叫會重新執行；全程不載入 repo 真實外掛、不執行 PowerShell。
- `npm test`：23 個 JS 語法、32 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify16`）：硬體分頁正常顯示 CPU / GPU / RAM 與溫度；連續 12 次健康探測間隔穩定 5.0 秒、每次約 2.2 秒，本機未發生重疊（重疊保護以單元測試驗證）；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成**：低階機器上探測超過 5 秒的實機情境未實測；本輪只以單元測試鎖定共用行為。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第二十一階段：遠端狀態輪詢沒變更時只回版本號

> 接續同日第二十階段；前端每 2 秒打 `/api/remote/state`，回應包含所有 session 與最多 120 則訊息。版本維持 `2026.8.7`。

### 輪詢負擔
- 每次回應都重新序列化 `profile`、`getLocalIPv4List()` 與每個 session 的訊息；`screen_share` 與 `chalkboard_state` 訊息帶完整 `imageDataUrl`，長連線下每次輪詢可能是數 MB 的 base64，即使內容完全沒變。
- 伺服器端早已有 `remoteStateTick`，但只是 `Date.now()`，前端也從未使用；狀態沒變時仍整份重送、整份套用。

### 版本號短路
- `remoteStateTick` 改為遞增版本（初始 1，`touchRemoteState()` 時 +1），避免同毫秒內兩次變更被視為相同版本。
- `GET /api/remote/state` 接受 `?since=`；與目前版本相同時只回 `{ success, tick, unchanged: true }`，不再序列化 session 與訊息。未帶 `since` 或非整數時照舊回完整內容。
- 所有變更路徑都會 `touchRemoteState()`：route 端的 connect / respond / message / share-screen / chalkboard-sync / disconnect / 刪除 session / profile 儲存，以及 `RemoteAgentService` 內部 `onStateChanged`（對方訊息、AI 狀態、斷線、邀請逾時等）。
- 前端新增 `lastRemoteStateTick`，只在有值時帶 `since`；收到 `unchanged` 就更新版本並跳過 `remoteState` 套用與後續 profile / session / popup 重繪。

### 測試與驗收
- 新增 `test/remote-state-tick.test.js`（4 項，真實 HTTP + 隔離 harness）：首次請求無 `since` 時回完整內容、相同版本只回 `unchanged`、儲存 profile 後版本 +1 且舊 `since` 取得完整內容、非數字 `since` 退回完整內容。
- `npm test`：23 個 JS 語法、32 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify15`）：穩態 5 秒內 2 次輪詢皆為 `unchanged:true`、`lastRemoteStateTick` 維持 1、`renderRemoteSessionControls` 額外呼叫 0 次；以 API 儲存 profile 後版本 1 → 2，下一次輪詢取得完整內容並重繪控制列 1 次、名稱輸入框顯示新值；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- **尚未完成**：雙機實測（真實 peer 訊息、Chalkboard 同步、斷線重連）仍須實機驗收；本輪只驗證 HTTP 契約與本機瀏覽器輪詢行為。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第二十階段：任務清單不再夾帶執行記錄

> 接續同日第十九階段；`/api/todo` 每 2 秒回傳所有任務的完整 `logs`，但前端只在任務詳情視窗使用。版本維持 `2026.8.7`。

### 清單與詳情分離
- 任務的 `logs` 會隨 SOP 執行累積，且沒有上限；`/api/todo` 每 2 秒把全部歷史任務的 log 一起回傳，前端還要用整份 `todoList` 計算繪製簽章。任務越多、跑過的安裝越長，輪詢負擔越大。
- 新增 `publicTodoList()`：清單類回應（`GET /api/todo`、`POST /api/todo`、`DELETE /api/todo/:id`、`POST /api/todo/import`）只回傳任務欄位，省略 `logs`。
- `GET /api/task/:taskId/status` 仍回傳完整任務（含 `logs`）；`/api/todo/export` 與 `/api/todo/export-file` 也維持完整內容，匯出檔不受影響。
- 前端 `showTaskModal(task)` 改為先以清單資料顯示基本欄位，開啟詳情時再抓一次完整任務補上執行記錄；若呼叫端傳入的任務本身已帶 logs，就不重複抓取。原本共用的 modal 內容組裝抽為 `renderTaskModalBody()`。
- 伺服器端 `todoList` 與 `tasks.json` 仍保存完整 logs，重新載入或匯出都不會遺失。

### 測試與驗收
- 新增 `test/todo-payload.test.js`（2 項，真實 HTTP + 隔離 harness）：`GET /api/todo` 不含 `logs` 且其他欄位完整、`/api/task/:id/status` 與 `/api/todo/export` 仍保有完整 log、刪除與匯入回應同樣是無 log 的清單形狀、匯入後伺服器仍保留 logs。
- 既有 `test/todo-import.test.js`、`test/todo-export.test.js` 不需修改且維持通過。
- `npm test`：23 個 JS 語法、31 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify14`，以 `/api/todo/import` 種入 1 筆含 2 行 log 的任務）：清單卡片正常顯示標題與狀態；點開詳情後顯示 2 行執行記錄，內容為剛種入的 marker；`/api/todo` 回應不含 log 文字而 `/api/task/verify-log-task/status` 仍完整；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十九階段：AI 狀態列未變時不重寫 DOM

> 接續同日第十八階段；`/api/llm/status` 每 2 秒輪詢，狀態多數時間完全相同。版本維持 `2026.8.7`。

### 狀態列與徽章
- `checkLLMStatus()` 原本每次回應都呼叫 `updateLLMIndicator()`：重寫狀態燈 `style.cssText`、模型徽章的 style / text / title，並轉呼叫 `updateLLMStatusText()` 再寫標題列與頁尾文字。伺服器端雖有 5 秒快取，回應本身仍穩定不變。
- 新增模組層變數 `lastLLMStatusSignature`，以 `JSON.stringify(data)` 比對；相同時只跳過 `updateLLMIndicator()` 這段 DOM 寫入，函式其餘流程（推薦清單守門、bootstrap 任務清理等）照舊執行，避免改變既有行為。
- 狀態一變化（`available` / `modelReady` / `modelName` / provider 版本等）即重寫；`updateLLMIndicator()` 內既有的 `_installedStatus` 比對與 `renderSidebarTab()` 觸發維持不變。
- 輪詢失敗時（catch 分支）會把 `lastLLMStatusSignature` 清空，狀態燈先改為未就緒；下一次成功回應即使與失敗前完全相同，也會重新套用，不會停在錯誤狀態。
- 切換語系仍直接呼叫 `updateLLMStatusText(window.__lastLLMStatus)`，標題列與頁尾文字照常翻譯。

### 測試與驗收
- 新增 `test/app-llm-status-refresh.test.js`（3 項）：擷取真實 `checkLLMStatus()` 與 `lastLLMStatusSignature`，驗證相同 payload 連續三次只套用一次、狀態改變會套用、失敗後回復即使 payload 相同也會重新套用。
- `npm test`：23 個 JS 語法、30 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify13`）：穩定狀態下 6.5 秒內 `updateLLMIndicator` 額外呼叫 0 次，狀態燈樣式與「AI 就緒」文字保持正確；切換 en-US / zh-TW 時標題列與頁尾分別顯示 `AI Ready` / `AI 就緒`；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十八階段：側邊欄資料未變時不重建

> 接續同日第十七階段；`loadRecommend` / `loadSops` / `loadSkills` 每次成功都整棵重建側邊欄。版本維持 `2026.8.7`。

### 輪詢與重繪
- `startPolling()` 只在 `recommendList` 為空時才呼叫 `loadRecommend()`，因此穩態輪詢本來就不會打 `/api/recommend`；實際的重建來源是啟動載入與 `refreshSidebarDataSoon()`（對話回覆帶 `sopChanged` 時，250ms debounce 後並行呼叫 `loadRecommend` / `loadSops` / `loadSkills`）。
- 這三支載入函式即使回應與前一次完全相同，仍會各自觸發 `renderSidebarTab()`，重建推薦、SOP、Skill 三份清單的全部節點；使用者在重建瞬間操作的卡片（焦點、hover、展開狀態）會被重置。
- 新增模組層變數 `lastRecommendSignature` / `lastSopSignature` / `lastSkillSignature`，以 `JSON.stringify(清單)` 比對；資料未變時只更新本地清單（與 `hideSplash()`），不重建 DOM。`sopChanged` 真的產生新 SOP、或安裝狀態翻轉（`installed` / `recommendedAction` / `supportsUninstall`）時 signature 會改變並立即重繪。
- 切換語系、切換側邊欄分頁、搜尋輸入，以及 `checkLLMStatus()` 偵測到 Ollama / 模型狀態變化時，仍直接呼叫 `renderSidebarTab()`，本地化文字、篩選與安裝徽章不受影響。

### 測試與驗收
- 新增 `test/app-sidebar-refresh.test.js`（4 項）：擷取真實 `loadRecommend` / `loadSops` / `loadSkills` 與三個 signature，驗證相同 payload 不重繪、`hideSplash()` 照常執行、安裝狀態改變與 SOP 清單變動會重繪、失敗或空清單不渲染也不拋錯。
- `npm test`：23 個 JS 語法、29 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify12`）：初次載入三份清單正常（推薦 8、SOP 16、Skill 37）；`refreshSidebarDataSoon()` 後 `renderSidebarTab` 呼叫 0 次且卡片節點未變；在隔離設定檔新增一支 SOP 後 `loadSops()` 讓 SOP 數 16 → 17 並重繪，移除後回到 16；連續兩次 `loadSops()` 皆 0 次重繪；切換語系仍會替換卡片節點並翻譯文字；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十七階段：經驗庫只在看得到時輪詢

> 接續同日第十六階段；`/api/exps` 每 2 秒抓一次，即使經驗庫分頁沒開。版本維持 `2026.8.7`。

### 輪詢範圍
- `startPolling()` 原本固定每 2 秒呼叫 `loadExps()`，但 `expsEntries` 只被經驗庫面板使用（卡片、篩選器、匯出），分頁沒開或面板收起時抓到的資料沒有任何消費者。
- 新增 `isExpsPanelVisible()`（分頁為 `exps` 且日誌面板未收起）；輪詢只在此時抓取。
- `switchBottomTab('exps')` 先以現有資料 `renderExps()`，再 `loadExps()` 取最新；`expandLog()` / `toggleLog()` 展開面板且分頁停在經驗庫時也補抓一次，因此切過去看不到舊資料。
- 初次載入仍由 `init` 的 `loadExps()` 負責，行為不變。

### 測試與驗收
- `npm test`：23 個 JS 語法、28 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify11`，自建 1 筆 exp）：日誌分頁停留 6 秒，`/api/exps` 請求數為 0（修正前每 2 秒 1 次）；切到經驗庫後立即抓到並渲染 1 張卡片；收起面板 5 秒內請求數不變；展開後再次抓取並保留卡片；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十六階段：硬體監控不再重複探測

> 接續同日第十五階段；量測發現每次硬體探測會跑 6 支子程序、耗時 11.4 秒。版本維持 `2026.8.7`。

### 量測結果（本機 i9-14900 + RTX 4000 Ada）
- `getSystemHealth()` 單次 11,386 ms、6 支子程序：`nvidia-smi` → 基準 PowerShell → `Get-Counter` 各跑兩次。
- 原因一：AppData 與程式根目錄各有一份同名外掛，`scanDirs` 兩份都執行，等於每個外掛跑兩次。
- 原因二：`hardware-info.js` 依檔名排在 `temperature-monitor.js` 之前，執行時 `health.gpu.load` 還是初始值，因此即使 `nvidia-smi` 稍後就會提供負載，仍先跑 `Get-Counter`（本機約 3.4 秒）。nvidia-smi 最後覆寫數值，所以這段對顯示結果沒有貢獻。

### 修正
- `src/system.js` 新增 `PLUGIN_ORDER`（`temperature-monitor.js` → `hardware-info.js`）與 `sortPluginFiles()`：已知外掛先跑，其餘維持字母序。意圖是把「取得 GPU 負載」的外掛排在 fallback 之前。
- `getSystemHealth()` 以檔名去重：AppData 版本執行過就跳過同名的內建副本，符合原本註解「AppData 使用者自訂優先」的順序；未在 AppData 提供的外掛仍照常從根目錄載入。
- `plugins/hardware-info.js` 的 `Get-Counter` fallback 增加條件：`health.gpu.details?.vendor` 已存在就不執行。沒有 NVIDIA 的機器（temperature-monitor 不會寫 details）行為不變，仍會用 `Get-Counter` 取得 GPU 負載。
- 輸出欄位與數值來源不變：NVIDIA 機器最終仍以 `nvidia-smi` 的 name / load / temp 為準；WMI 基準探測仍負責 CPU 負載、磁碟健康、磁碟容量與 GPU 名稱備援。

### 測試與驗收
- 新增 `test/system-plugins.test.js`（5 項）：只驗證 `sortPluginFiles()` 的優先順序、未知檔案字母序、空清單與不修改傳入陣列；不執行任何外掛或 PowerShell。
- `npm test`：23 個 JS 語法、28 支測試檔與 server smoke 全綠。
- 以隔離設定檔 `%TEMP%\va-ui-verify9` 量測：修正前 11,386 ms / 6 支子程序，修正後 2,138–2,236 ms / 2 支子程序（`nvidia-smi` + 基準 PowerShell）；`/api/system/health` 連續三次回應 2,180–2,222 ms。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify10`）：開啟硬體分頁後 CPU 型號 / 負載、GPU 名稱 / 負載 / 溫度、RAM 已用與總量、`S.M.A.R.T` 磁碟名稱與 C: 可用空間、上次更新時間皆與修正前一致；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十五階段：遠端工作階段控制列重繪守衛

> 接續同日第十四階段；遠端控制列每 2 秒無條件重建下拉選單與 session chip。版本維持 `2026.8.7`。

### 每 2 秒重建
- `loadRemoteProfileAndState()` 每 2 秒呼叫 `renderRemoteSessionControls()`，即使 session 完全沒變也會重寫 `#remoteSessionSelect` 的 `innerHTML`、重建 `#remoteSessionQuickList` 的 chip，並重新綁定點擊與關閉事件。
- 影響：使用者展開的下拉選單會在輪詢時被關掉；chip 的 hover / focus 每 2 秒被清掉；事件監聽持續重建。
- 新增 `lastRemoteSessionListSignature`：先組出下拉選單與 chip 的 HTML，再以「語系 + 選取中的 session + 兩段 HTML」為簽章；簽章相同就跳過指派與重綁，只更新狀態文字、提示與按鈕。
- 選取變更、session 新增 / 移除、狀態改變、peer 名稱改變、排序改變都會改變 HTML 而觸發重建；`pending_approval` 與停權倒數的狀態文字本來就逐秒變化，仍會照常重建，行為與原本一致。
- `remoteSessionStatus`、`remoteChatHint`、連線 / 切斷按鈕、model badge 與待確認列仍在每次呼叫時更新，不受簽章影響。

### 測試與驗收
- `npm test`：23 個 JS 語法、27 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify8`）：無 session 時觀察 `#remoteSessionSelect` 兩個輪詢週期，MutationObserver 計數為 0（修正前每 2 秒重建一次）；注入兩個假 session 後下拉選單顯示 `PC-A / alice · 已連線`、`PC-B · 未連線`，chip 的 active / 關閉圖示正確；4.5 秒內 chip 仍是同一 DOM 節點，點擊 chip 仍會切換選取並更新下拉選單；改寫 peer 名稱後立即重建為 `PC-A2 · 已連線`；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除，也未建立任何真實遠端連線。

---

## 📌 2026.10.29 — 第十四階段：工作日誌改為增量輪詢

> 接續同日第十三階段；前端每 2 秒抓的是整份 log，改為只抓新增部分。版本維持 `2026.8.7`，回應格式向後相容。

### 增量輪詢
- `pollLogs()` 原本每 2 秒 `GET /api/logs` 取回整個記憶體 log 陣列，再從 `currentLogIndex` 之後逐筆 `addLogEntry()`；log 越長，傳輸與 JSON 解析成本越高，且每次都重算 `data.logs.length`。
- `/api/logs` 新增選用參數 `?since=N`：`N` 為前端已收到的筆數，合法時只回 `logs.slice(N)`；同時固定回傳 `total`（目前總筆數），前端以 `total` 對齊索引。
- 未帶 `since`、非數字、0 或負數一律回完整清單，既有呼叫端不受影響；`since` 超過總筆數時回空陣列，索引自動收斂到 `total`。
- 前端 `pollLogs()` 只送 `?since=${currentLogIndex}`，以 `data.total` 更新索引；若伺服器重啟或 log 被截斷使索引超前，下一次回應會把索引拉回實際總數，不會永久卡住。
- 切片判斷抽為 `selectLogsForClient(allLogs, sinceParam)` 放入 `src/pure.js`，路由只負責呼叫與回傳，方便不啟 server 也能測到各分支。

### 測試與驗收
- `test/pure.test.js` 新增 6 項：無 `since`、`since=0`、非數字、負數皆回完整清單與 `total`；`since` 在範圍內只回增量；`since` 超出長度回空陣列。
- `npm test`：23 個 JS 語法、27 支測試檔與 server smoke 全綠。
- HTTP 驗收（隔離設定檔 `%TEMP%\va-ui-verify7`）：`/api/logs` 在無參數、`since=0`、`since=abc`、`since=-5`、`since=2`、`since=99` 皆回 `{"success":true,"logs":[],"total":0}`；啟動時 log 為空，切片本身由單元測試覆蓋。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十三階段：經驗庫讀取快取與 Provider 文字跳脫

> 接續同日第十二階段；前端不再每 2 秒重繪後，後端也不必每 2 秒重讀所有經驗檔。版本維持 `2026.8.7`。

### 經驗庫讀取快取
- `/api/exps` 每次呼叫都會 `readdirSync` + `statSync` + 讀取每個 `exp-*.md`，再逐段 split、regex 與 `redactSensitiveText()`。前端每 2 秒輪詢一次，等於整天反覆重讀與重算同樣內容。
- 新增 `experienceEntriesCache`：以「檔名 + mtime + 大小」組成簽章，簽章相同直接回傳已排序的完整清單（再依 `limit` 切片）；檔案新增、追加或刪除都會改變簽章並重新解析。
- 目錄不存在時仍回空陣列，不寫入快取；錯誤處理與原本一致（讀檔失敗仍回 500）。

### 前端文字跳脫
- 模型清單載入失敗時，`settingModelSelect` 以字串樣板寫入 `(無法連線至 ${provider})`，`provider` 來自設定（可能被手動改寫的 config）；改為 `escapeHtml(provider)`，與其他動態文字一致。
- 一併檢查 `public/app.js` 全部 51 處 `innerHTML` 指派：其餘動態值都經 `escapeHtml()`、`renderMarkdown()`（DOMPurify 出口）或屬性指派，無其他未跳脫插值。

### 測試與驗收
- `npm test`：23 個 JS 語法、27 支測試檔與 server smoke 全綠。
- HTTP 驗收（隔離設定檔 `%TEMP%\va-ui-verify5`）：初始 1 筆；追加一段後回 2 筆；連續再呼叫仍為同樣 2 筆（命中快取）；刪除檔案後回 0 筆。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十二階段：工作清單重繪守衛

> 接續同日第十一階段，把同一套「資料沒變就不重繪」套到每 2 秒輪詢的工作清單。版本維持 `2026.8.7`。

### 工作清單
- `loadTodo()` 每 2 秒取得清單後都呼叫 `renderTodoList()`，即使任務完全沒變也會重建所有卡片（含重新綁定執行 / 刪除 / 詳情事件），造成 hover 與文字選取被清掉，輪詢剛好落在點擊之間時還可能讓該次點擊落空。
- 新增 `buildTodoRenderSignature()`（語系 + `todoList` 完整 JSON）與 `lastTodoRenderSignature`；`renderTodoList()` 先更新數量文字，再比對簽章，相同就 return 不重建。用完整 JSON 而非挑欄位，確保任務 logs、完成時間等欄位變動時仍會重繪，與原本行為一致。
- 任務新增、刪除、匯入、狀態或進度變更、語系切換都會改變簽章，因此照常重繪。

### 測試與驗收
- `npm test`：23 個 JS 語法、27 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify4`）：建立任務後連續兩個輪詢週期卡片仍是同一 DOM 節點；以 `/api/todo/import` 換成 success 任務後立即重繪為「已完成 / 100%」；切換 en-US 顯示「Completed」、切回 zh-TW 恢復「已完成」；清空後卡片數為 0 且空狀態顯示；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十一階段：經驗庫重繪守衛與英文日期修正

> 接續同日第十階段；經驗庫面板每 2 秒被輪詢重繪，順帶修掉英文介面仍用 zh-TW 日期格式的問題。版本維持 `2026.8.7`。

### 每 2 秒重繪
- `startPolling()` 每 2 秒呼叫 `loadExps()`，即使資料沒變也會清空 `#expEntries` 並重建所有卡片，等於每 2 秒重跑每張卡的 `renderMarkdown()` + DOMPurify，並清掉使用者的文字選取與 hover 狀態。
- 新增 `buildExpsRenderSignature()`（語系、搜尋字串、SOP 篩選、整份 entries）與 `lastExpsRenderSignature`；`renderExps()` 在簽章相同時直接 return，資料或篩選條件變更才會重繪。
- 切到經驗庫分頁時（`switchBottomTab`）主動呼叫 `renderExps()`；`updateLocaleUI()` 也加入同一呼叫，語系切換後篩選器標籤與空狀態立即更新，不必等下一次輪詢。
- 篩選到已不存在的 SOP 時，`expSopFilter` 會被重設，簽章隨之改變，最多多一次重繪後即收斂。

### 英文日期格式
- `renderExps()` 判斷式為 `currentLocale === 'en'`，但 `currentLocale` 只有 `zh-TW` / `en-US` 兩種值，英文介面因此一直套用 zh-TW 日期格式，與詳情視窗（`en-US`）不一致。改為 `'en-US'`。

### 測試與驗收
- `test/app-i18n.test.js` 的 harness 補上 `renderExps` stub，並把 `exps` 加入 `updateLocaleUI` 應呼叫的清單。
- `npm test`：23 個 JS 語法、27 支測試檔與 server smoke 全綠。
- 瀏覽器驗收（隔離設定檔 `%TEMP%\va-ui-verify3`，自建 3 筆 exps）：連續兩個輪詢週期後卡片仍是同一 DOM 節點（修正前會重建）；en-US 卡片日期為 `10/29/2026, 10:35:00`、篩選器為「All SOPs」；搜尋 / 篩選 / 重設分別得到 1 / 1 / 2 張卡；磁碟追加條目後 3 秒內自動出現；console 無 error / warn。驗收後已停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第十階段：動作任務與模型快取條件的單一出口

> 接續同日第九階段；把 Planner / Loop 內完全相同的任務物件與快取判斷收斂成單一函式。版本維持 `2026.8.7`，輸出與行為不變。

### Agent 動作建立任務
- `ADD_TASK` 與 `INSTALL_SOP` 各自複製了同一份 SOP 任務物件（`id` / `title` / `description` / `skillId` / `action` / `category` / `status` / `progress` / `logs` / `createdAt`）。
- 新增 `buildSopTask(sop)`（緊接 `buildTaskTitle`），兩個分支改為 `const task = buildSopTask(mSop);`；欄位順序、字串與預設值（`Maintenance`）維持原樣，`executeTaskId` 與各自的摘要仍留在呼叫端。
- 既有的 `queueSopTaskById()` 未改動：它會去重並額外寫入 `completedAt`、立即 `saveTasks()`，語意與動作清單不同，不合併。

### 模型清單快取條件
- `src/llm.js` 的 OpenAI-compatible 與 Ollama 兩條分支使用同一段「只有沒帶 options（或僅 `forceRefresh`）才更新快取」的判斷。
- 抽出 `shouldUpdateModelCache(options)`，兩處改為單一呼叫；判斷結果與原條件完全相同。

### 測試與驗收
- `npm test`：23 個 JS 語法、27 支測試檔與 server smoke 全綠（`chat-consent.test.js` 的 ADD_TASK / INSTALL_SOP 行為測試涵蓋本次改動路徑）。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第九階段：i18n 缺鍵修正與字典回歸測試

> 接續同日第八階段；修掉介面直接顯示 `undefined` 的翻譯缺鍵，並新增掃描 `t()` 呼叫的字典測試。版本維持 `2026.8.7`。

### 缺鍵症狀與修正
- `t()` 找不到鍵時回傳 `undefined`，呼叫端的 `{ default: '...' }` 參數並未被使用，因此下列位置的畫面文字會變成 `undefined`：
  - 經驗庫篩選器的「全部 SOP」選項（`exps.filter_all_sops`）。
  - 經驗庫無資料與無搜尋結果的空狀態（`exps.no_data`、`exps.no_match`）。
  - 經驗卡沒有標題時的替代名稱（`exps.unnamed`）。
- 兩份語系字典補上上述 4 個鍵（zh-TW：所有 SOP／找不到符合的經驗。／尚未累積安裝經驗...／未命名經驗）。
- `logEmptyMessage` 引用了不存在的 `logs.emptyMessage`，locale 套用後日誌空狀態會變 `undefined`；改共用既有的 `tabs.emptyMessage`，不再新增重複字串。
- `applyLocaleToShell` 以不存在的 `titlebar.llmReady` 寫入 `#llmLabel`，隨即被 `updateLLMStatusText()` 覆蓋；移除這筆多餘寫入，讓狀態文字只由即時 LLM 狀態決定。
- 遠端連線的三個 `remote.*` 鍵是在 I18N 字面量後以 `Object.assign` 補上，屬正常結構，未變動。

### 回歸測試
- 新增 `test/i18n-keys.test.js`（2 項）：以 VM 載入真實 I18N（含後續 `Object.assign`），掃描 `app.js` 所有靜態 `t('...')` 呼叫（294 個），斷言 zh-TW / en-US 都能解析為字串；另單獨鎖住經驗庫 4 個鍵。缺鍵時測試會直接列出 `locale:key`。
- `test/app-i18n.test.js` 同步調整：`llmLabel` 由狀態更新擁有、`logEmptyMessage` 改期待 `tabs.emptyMessage`。

### 瀏覽器驗收（隔離設定檔）
- 以 `%TEMP%\va-ui-verify2` 啟動隔離實例，實測 zh-TW / en-US 切換：經驗庫選項為「所有 SOP／All SOPs」、空狀態為「尚未累積安裝經驗...／No installation experiences yet...」、`#llmLabel` 維持「AI 就緒／AI Ready」，console 無 error / warn，切換後已還原 zh-TW。
- 驗收後停止實例、確認 3210 / 19168 不再監聽並刪除暫存設定檔。

### 測試與驗收
- `npm test`：23 個 JS 語法、27 支測試檔與 server smoke 全綠。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第八階段：重複摘要收斂與未使用匯出清理

> 接續同日第七階段；把實際重複的摘要組字與「SOP 加入任務」payload 收斂成單一出口，並清掉只有模組內部使用的匯出。版本維持 `2026.8.7`，行為不變。

### Agent Loop 來源摘要
- 「已自動抓取來源內容／Extracted source content」在 `/api/chat` 出現三份完全相同的組字（首輪 Browser Use、Loop 工具輪、force-search 分支）。
- 抽出 `formatExtractedSourcesSummary(extracted, locale)` 至 `src/pure.js`，三處改為同一函式；輸出格式、`(untitled)` fallback 與空欄位過濾維持原樣。
- `test/pure.test.js` 新增 2 項：zh-TW / en-US 標頭與多來源以空行串接、缺 title/text 的條目只保留有效行。

### 前端 SOP 加入任務
- `addSopToTodo()` 與 `addAndExecuteSop()` 原本各自複製同一段 `getLocalizedItem` → `POST /api/todo` payload。
- 抽出 `queueSopTodo(sop)` 回傳 `{ localized, action, data }`，兩個入口共用；成功後的記錄、切頁與執行流程各自保留。

### 未使用匯出
- 移除只被模組內部使用、無人 import 的匯出項：`chatApiError`（protocol）、`ensureOllamaRunning`（llm）、`buildExperienceAdvice`（pure）、`normalizeIp`（remote-agent）。
- 函式本體與內部呼叫全部保留；`test/*.test.js` 未引用這些名稱，移除後測試不受影響。

### 測試與驗收
- `npm test`：23 個 JS 語法、26 支測試檔（`pure.test.js` 44 項）與 server smoke 全綠。
- 未變更 SOP、LLM 設定、版本號；未執行安裝、提權或刪除。

---

## 📌 2026.10.29 — 第七階段：任務匯入修復與 Remote 死碼清理

> 接續同日第六階段；修好從未成功的「匯入任務清單」流程，並移除 Remote 已停用功能的無呼叫方法。版本維持 `2026.8.7`。

### 任務匯入（使用者可見缺陷）
- 前端 `importTasks()` 呼叫 `/api/import`，但後端只有 `/api/todo/import`；請求會落到 Express 404 HTML，`api()` 的 `res.json()` 解析失敗後被 catch 吞掉，按下匯入完全沒有反應。
- 匯出檔內容是 `{ exportedAt, agentVersion, tasks }`，前端卻把整個物件當 `tasks` 送出；即使端點正確，後端 `Array.isArray(tasks)` 仍會以 `Invalid format` 拒絕。
- 後端成功時只回 `{ success, count }`，前端卻把 `data.todoList` 寫回 `todoList`，會把清單變成 `undefined`。
- 修正：前端改呼叫 `/api/todo/import`，接受匯出物件與舊版瀏覽器 fallback 的純陣列兩種格式，僅在回傳為陣列時覆蓋清單，失敗時把伺服器錯誤一起寫進工作日志（不再靜默）。後端成功回應補上最新 `todoList`。
- 新增 `test/todo-import.test.js`（3 項，真實 HTTP）：成功匯入並取代清單、非陣列 payload 被拒且原清單不變、running task 時拒絕匯入。
- 新增 `test/task-import-ui.test.js`（3 項）：擷取 `app.js` 真實 `importTasks()`，以 fake `FileReader` / `api` 驗證端點、payload 拆封、成功渲染與失敗提示。

### 瀏覽器驗收（隔離設定檔）
- 以 `%TEMP%\va-ui-verify` 作為 `APPDATA` / `LOCALAPPDATA` 啟動 `node src/server.js`，全程未觸碰使用者真實設定檔；port 3210 / 19168 由該隔離實例持有。
- 隱藏的 `#importFileInput` 無法直接作為 `upload_file` 目標，改以 `DataTransfer` 放入匯出格式 JSON 並派發 `change`，走的仍是 `app.js` 真正的 change listener 與 `importTasks()`。
- 結果：`POST /api/todo/import` 回 200，`todoList` 由 0 變 1、標題與檔案一致，footer 顯示「1 個任務」，工作日志出現「✅ 任務清單已匯入」，console 無 error / warn。
- 驗收後已停止隔離實例、確認 3210 / 19168 不再監聽，並刪除暫存設定檔與診斷腳本。

### Remote 死碼
- 移除 `requestModelShare`、`respondModelShare`、`cancelModelShare`：對應路由自 2026.05.06 起固定回 410，全庫無呼叫點。
- 移除 `appendLocalChatMessage`：從未有人呼叫，本機與遠端訊息都走 `sendChatMessage()`。
- 保留 `handlePayload` 對 `model_share_request` / `model_share_response` / `model_share_cancel` 的處理，避免舊版 peer 送包時狀態無法解讀；`test/remote-agent.test.js` 由 7 項增至 10 項，鎖住這條相容路徑（pending → active → idle 與 system message）。

### 測試與驗收
- `npm test`：23 個 JS 語法、26 支測試檔與 server smoke 全綠。
- 未變更 SOP、LLM 設定與版本號；未執行任何安裝、提權或刪除。

---

## 📌 2026.10.29 — 第六階段：CLI 修正與未使用程式碼清理

> 接續同日第五階段；修正實際會拋錯的 CLI 入口，清掉確認未使用的匯入與變數。版本維持 `2026.8.7`。

### CLI
- `node src/index.js` 無參數時原本呼叫不存在的 `listSkills()`，會落入 catch 顯示「未預期的錯誤: listSkills is not defined」；改為呼叫實際存在的 `listSOPs()`。
- 移除未使用的 `parseSOPFile` 匯入，並把檔案頂部仍寫「skills/」的用法說明改回 SOP。
- 新增 `test/cli.test.js`（2 項）：無參數列出 SOP 清單且不再出現 `listSkills is not defined`；`--help` 正常結束。測試只讀 bundled `sops/`，不執行 PowerShell。

### 未使用程式碼
- `server.js` 移除 7 個未使用的解構匯入（`escapeMarkdown`、`buildExperienceAdvice`、`escapeRegExp`、`formatUsdBillions`、`buildStoreSopMarkdown`、`scoreGitHubAsset`、`isUsefulGitHubAsset`），以及 `defaultPlaywrightBrowserDir`、`isPkg` 兩個未使用常數。
- `public/app.js` 移除未使用的 `pendingModelShareSessionId`、`centerCol`、`chalkboardHeading`、`chalkTools`。
- 上述函式仍保留在 `pure.js` / `sop-templates.js` 並持續由測試覆蓋。

### 不穩定的 process tree 測試
- `test/sop-executor.test.js` 原本以 200ms 逾時驗證「孫行程不會存活」，但 `powershell.exe` 啟動本身就要數百毫秒，孫行程常在逾時後才被建立，導致斷言在「沒測到」與「測到卻失敗」之間跳動。
- 以獨立探針重現：200ms 逾時下 10 次有 2 次孫行程真的啟動，且這 2 次都存活下來；代表 `taskkill /T` 可能落在「子行程正在建立」的競態窗口。
- 測試改為先讓父行程等待孫行程寫出 `started` 檔，之後才進入 30 秒睡眠，逾時時間放寬到 3000ms；逾時後再寫入 trigger 檔，若孫行程仍存活就會輸出 marker，讓斷言直接反映真實結果。連續 4 次執行皆穩定；另以覆寫 `terminateProcessTree` 為 no-op 的探針確認測試會正確失敗。
- 未改動 `terminateProcessTree` 的行為；「子行程剛好成立於 taskkill 快照瞬間而成為孤兒」的窄窗競態仍存在，需以 Windows Job Object 才能完整關閉，暫列為已知限制。

### 測試與驗收
- `npm test`：23 個 JS 語法、24 支測試檔與 server smoke 全綠。
- 未變更 API、SOP、使用者設定與版本號。

---

## 📌 2026.10.29 — 第五階段：SOP 解析可測化、Executor 去重與 Remote socket 收斂

> 接續 10.28 第四階段；只搬純邏輯、補測試與移除死碼，不改執行流程與使用者設定。版本維持 `2026.8.7`。

### SOP 解析
- `src/sop-parser.js` 把檔案讀取與內容解析拆開：`parseSOPFile()` 只負責讀檔並轉呼叫 `parseSOPContent(content, sourceFile)`，解析邏輯現在可直接餵字串測試。
- 新增 `test/sop-parser.test.js`（31 項）：中英文欄位優先序、需求環境、四階段偵測、code block 合併與 UI 訊息過濾、預期結果、錯誤處理條目、未關閉 code block，以及空內容。
- `test/file-operations-sop.test.js` 補上 `sourceFile` 斷言，確認委派後檔名仍正確。

### SOPExecutor
- 移除重複的 `escapePowerShellSingleQuoted()` 方法，改用 `src/pure.js` 的共用實作（含提權路徑三處呼叫）。
- 刪掉永遠不會執行的 `commands.length === 0` 分支（前一檢查已 throw），`actionPhase` 直接等於 `action`。
- 修正兩處錯位的 JSDoc：`matchError` 的說明原本掛在 `runPowerShellElevated` 上，`execute` 的說明原本掛在 `sopRequiresElevation` 上。
- 新增 `test/sop-executor-pure.test.js`（28 項）：`isCheckSatisfied` / `isVerifyFailed` / `matchError` / `sopRequiresElevation` / runner 腳本內容與建構預設值；不啟動子程序。

### Remote Agent 與死碼
- `handleIncomingSocket` / `attachOutgoingSocket` 重複的 socket 事件註冊收斂為 `attachSocketHandlers()`，incoming / outgoing 共用；測試改呼叫同一入口。
- 7 處重複的 peer 名稱組裝收斂為 `peerLabel(session, fallback)`，維持原本 `Remote peer` / `their AI` / `Remote AI` 三種 fallback。
- 移除 `server.js` 中無人呼叫的 `detectGameNewsIntent()`（`isGameDiscoveryRequest()` 仍在使用）。

### 測試與驗收
- `npm test`：23 個 JS 語法、23 支測試檔與 server smoke 全綠。
- 未變更 API、SOP、使用者設定與版本號；UAC、雙機 Chalkboard、Vision、乾淨 Windows EXE 仍須實機驗收。

---

## 📌 2026.10.28 — 第四階段：死碼清理、原生存檔對話框收斂與匯出修正

> 接續同日第三階段；以行為不變為前提，清掉確認無人呼叫的死碼、合併四處重複的 Windows 另存新檔流程，並修正匯出中的舊版本號。版本維持 `2026.8.7`。

### 原生存檔對話框
- 新增 `src/native-dialogs.js`：`buildSaveFileDialogScript()` 產生 WinForms `SaveFileDialog` 腳本，`pickSaveFilePath()` 以可注入 runner 執行，過濾器 / 檔名 / 標題 / 起始目錄皆參數化，單引號統一走 `escapePowerShellSingleQuoted()`。
- `server.js` 的任務匯出、Chalkboard 匯出、經驗庫匯出、遠端畫面另存四處重複區塊改為呼叫同一支 helper；`-Sta`、`windowsHide`、`-Command` 行為與原本一致。
- `test/native-dialogs.test.js`（8 項）只驗證腳本內容與 runner 介面，不執行任何 PowerShell。

### 匯出與死碼
- `GET /api/todo/export` 與 `POST /api/todo/export-file` 的 `agentVersion` 由硬編碼 `1.0.0` 改為 `APP_VERSION`，payload 組裝抽為 `buildTaskExportPayload()` 並以 `test/todo-export.test.js` 走真實 HTTP 驗證。
- 移除確認無引用的死碼：`getRemoteSessionById`、`detectGameResearchIntentV2`、`extractGameTopicV2`、`extractGameTopic`、`handleAgentGameResearchWorkflow`、`handleAgentGameResearchWorkflowV2`；V3 流程與 `detectGameResearchIntentV3` 不受影響。`server.js` 由 5,875 行降至 5,676 行。
- `public/app.js` 移除未使用的 `getChalkSurfaceInset` 與永遠回傳 `false` 的 `shouldShowInterimPlan`；Undo / Redo / 自動 Chalkboard 共用的 9 行待定文字狀態重置收斂為 `resetPendingChalkState()`。

### 測試與驗收
- `npm test`：23 個 JS 語法、21 支測試檔與 server smoke 全綠。
- 未變更使用者設定、SOP、版本號與任何執行期契約。
- 尚未處理：`/api/chat` 路由（約 1,380 行）、`sendChat`、`setupEventListeners`、`RemoteAgentService.handlePayload`、`SOPExecutor.execute` 仍是大型單體；UAC、雙機 Chalkboard、Vision、乾淨 Windows EXE 仍須實機驗收。

---

## 📌 2026.10.28 — 第三階段：巨型檔案拆解與重複邏輯收斂

> 接續同日第二階段，處理維護性熱點；不改行為契約、不改使用者設定。版本維持 `2026.8.7`。

### LLM 協定層
- 新增 `src/llm/protocol.js`：history / content 正規化、Provider URL 解析、401 與 API error、回應欄位抽取（choices / reasoning / Anthropic array / Ollama message-response）、`<think>` / `<reasoning>` 處理。
- `chatWithLLM` 由 280 行降為協調流程；三處重複的 non-OK 錯誤處理與兩套 URL 分支改共用 helper。`src/llm.js` 1151 → 1033 行。
- 順帶修正 legacy completion 回應（只有 `choices[0].text`、沒有 `message`）永遠讀不到的問題。

### SOP 模板
- 新增 `src/agent/sop-templates.js`：winget / Microsoft Store / GitHub Release markdown builder 與 GitHub asset 過濾、評分、挑選。
- 檔案寫入與 SOP ID 建立仍留在 `server.js`；`server.js` 6179 → 5875 行。
- 模板輸出以 `test/sop-templates.test.js` 鎖定：section、來源參數、PowerShell 單引號轉義、regex 跳脫、asset 排序。

### 前端 i18n
- `updateLocaleUI` 由 377 行改為 17 行協調函式，依 shell / workspace / chat / panels / settings / text tool / chalkboard / footer 拆成 `applyLocaleTo*`，元素寫入改用 map 與小 helper。`public/app.js` 8812 → 8726 行。
- 移除重複且互相覆寫的選單字串寫入；`titlebar.refresh`（zh-TW）與 `footer.importTasks/exportTasks`（en-US）字典值對齊原本最終畫面文字，輸出維持不變。
- `test/app-i18n.test.js` 直接擷取真實函式，以最小 DOM 驗證 zh-TW / en-US 兩套接線與渲染呼叫順序。

### 測試與驗收
- 新增 `test/llm-protocol.test.js`（7）、`test/sop-templates.test.js`（7）、`test/app-i18n.test.js`（3）。
- `npm test`：22 個 JS 語法、19 支測試檔、server smoke 全綠。
- 尚未處理：`/api/chat` 路由仍有約 1,380 行，`sendChat` / `setupEventListeners` 與 `RemoteAgentService` 仍是大型單體；UAC、雙機 Chalkboard、Vision、乾淨 Windows EXE 仍須實機驗收。

---

## 📌 2026.10.28 — 第二階段：Consent 執行鏈與本機多對話正確性

> 延續同日第一階段稽核，針對 consent、Agent Loop 與本機多對話補行為測試並修正可重現缺陷。版本維持 `2026.8.7`；不重寫框架、不改使用者設定。

### Consent 執行鏈
- **批准後只執行原 ACTION**：舊版把批准字串當成 LLM 回覆再解析，`ADD_TASK sop_id=install_chrome` 這類無引號動作會被解析成空清單，使用者按了確認卻什麼都沒發生。現在批准請求直接以 `[approvedActionString]` 進入執行動作清單，並不再呼叫 LLM 重寫動作。
- **批准請求不採用戶端訊息**：帶 `approvedActionId` 時，後端忽略 request body 的 `message` 與 Chalkboard 附件，只使用 store 內保存的 ACTION；也因此在有批准時不需要（也不接受）前端另送文字。
- **每輪都攔截系統變更動作**：先前只有首輪 ACTION 會進入 consent，Agent Loop 後續輪次的 `BROWSER_USE navigate`、`ADD_TASK` 會直接執行。現在迴圈內每個通過預算的動作都先檢查 `isSystemChangingAction()`，需確認者一律轉為 `pendingActions` 並停止該輪。
- **精確命令比對**：所有 dispatcher 由 `actionStr.startsWith('X')` 改為 `command === 'X'`，`BROWSER_USE_EXTRA`、`ADD_TASK_EXTRA` 這類前綴偽裝不再能落入真實分支。
- **參數解析單一出口**：`parseActionArg` / `parseBrowserUseMode` 自 `server.js` 移到 `src/agent/actions.js`，consent 分類與執行器共用同一語意；支援 `key = "value"`、單引號與無引號，避免「確認時判為唯讀、執行時卻導覽」的分歧。
- **提案時綁定 SOP 操作**：approval 現在保存提案當下的 `sopAction`（install / uninstall），`pendingActions.description` 直接顯示完整 ACTION 與操作，例如 `ADD_TASK sop_id="chrome" [install]`。即使確認前 runtime 快取翻轉，執行仍沿用已顯示、已批准的操作。
- **執行中任務保護**：`REMOVE_TASK` 對 running task 直接拒絕並說明；有任何 running task 時 `CLEAR_ALL` 拒絕整次清空。兩者都維持 `task:false`，不宣稱已變更清單。另一任務執行中時，仍可移除 pending / success / failed 任務。

### 本機多對話與確認按鈕
- **回覆歸屬發起分頁**：聊天請求進行中切換 local chat tab，晚到的回覆、錯誤訊息、`aiWarning` 與中止訊息都寫回發起 session；目前分頁的 DOM 與訊息不被污染。重繪時只渲染當前 session。
- **確認按鈕可重建**：`pendingActions` 存在訊息的 `messages[]` 中並同步 localStorage；切換分頁再切回、或整段重繪後，按鈕仍會出現且帶原狀態（已確認 / 失敗 / 過期）。
- **busy 狀態涵蓋確認流程**：確認按鈕與一般送出共用 local pending 鎖。請求未 settle 前重複點擊、平行點擊、重繪後的新按鈕都不會再送第二次；Stop 只 abort，鎖保留到 `finally` 才釋放。
- **Stop 與任務啟動的競態**：確認 API 成功後會 `loadTodo()` 再視 `executeTaskId` 決定是否執行。若使用者在 refresh 期間按 Stop，現在會檢查 abort 訊號並改為顯示「已在執行前停止；任務仍保留在工作清單」，不再於回應返回後啟動任務。一般聊天路徑的 `executeTask` 也加上同一檢查。
- **失敗與過期狀態**：approval 失效、請求失敗或中止時，按鈕標為失敗並停用，訊息提示先檢查工作清單再重新提出；過期按鈕在初次渲染與重繪後都停用，且不發出請求。

### Agent Loop 請求級預算
- **預算改為整個請求共用**：`AgentLoopBudget` 現在於 `/api/chat` 入口建立，首輪 ACTION、自動即時資訊搜尋 / 抽取、Agent Loop 工具與每一輪 LLM 請求共用同一組 8 turns / 12 tools / 180 秒上限；LLM 與頁面抓取都使用剩餘 deadline。
- **首輪動作也受去重與上限約束**：首輪 ACTION 先經 `takeActions()`，重複字串、超出工具數或 deadline 已到都不執行；自動抽取在每次抓頁前先 `spendToolCall()`，搜尋前也檢查 `canRunTool()`。
- **待確認動作不佔工具額度**：Agent Loop 先將 `isSystemChangingAction()` 的動作轉為 `pendingActions`，只對真正可執行的動作計入 12 次工具上限；避免一輪大量提案把後續唯讀工具擠掉。
- **中止貫穿工具鏈**：每輪工具、搜尋、抽取與 force-final 前都檢查 abort；`fetchReadablePageText`、Browser Use 搜尋 / 抽取 / `fetch_title`、`searchWebLinks` 與瀏覽器搜尋 fallback 都接受 `signal` 與剩餘 timeout。Playwright 已發出的頁面導覽本身不支援中途取消，仍可能等到自身 timeout 才返回。
- **提前 return 工作流也接 abort**：手動 Browser Use 搜尋、財報活頁簿與遊戲攻略流程會把 `signal` 傳到搜尋、驗證、LLM 與 SEC 抓取，並在寫檔或開檔前檢查；這些流程仍使用各自 timeout，不宣稱已共用 8 turns / 12 tools / 180 秒預算。

### 測試與驗收
- 新增 `test/helpers/chat-harness.js`：以 allowlist 載入真實 `server.js` / routes / consent / parser，搭配 in-memory fs、fake process / OS、scripted LLM、browser spy 與固定時鐘；不讀寫使用者 APPDATA、不連外、不執行 SOP 或子程序。
- 新增 `test/chat-consent.test.js`（31 項，走真實 HTTP 與 `/api/meta` token）：token / Host / Origin、pending-only、單次與跨 session、到期邊界、可竄改 message、Loop consent、唯讀 Browser Use、running 任務保護、前綴偽裝、install/uninstall 綁定與 Browser Use 參數語法；另以 scripted chat hook 驗證首輪 13 個動作只執行 12 次工具、自動抽取與搜尋共用工具額度、deadline 到期後首輪工具為 0 次，以及 Loop 待確認動作不佔工具額度。
- 新增 `test/chat-ui-consent.test.js`（9 項）：直接擷取 `public/app.js` 真實函式並以最小 DOM 執行，涵蓋跨分頁歸屬、按鈕重建、確認 payload、全域 busy、Stop 與 refresh 競態。
- `npm test`（隔離的暫存 APPDATA / LOCALAPPDATA）：20 個 JS 語法、16 支測試檔與 server smoke 全綠。
- 瀏覽器實測（同隔離 harness、in-memory 任務）：確認按鈕顯示 `[install]`、按鈕跨分頁保留、重複點擊只送一次、晚到回覆只寫原分頁、過期按鈕停用；最後驗證確認後於 todo refresh 期間按 Stop，`/execute` 請求為 0、任務維持 pending、busy 已釋放、console 無 error / warn。
- **尚未完成**：財報、遊戲攻略、手動 Browser 與 Browser 安裝 fallback 等提前 return 的工作流已接 abort，但仍使用各自 timeout，尚未納入同一 8 turns / 12 tools / 180 秒預算與 consent 回歸；Playwright 已發出的導覽仍可能等到自身 timeout。UAC、雙機 Chalkboard、Vision 與乾淨 Windows EXE 仍須實機驗收。

---

## 📌 2026.10.28 — 全面稽核第一階段：安全契約、執行正確性與發佈設定

> 本輪依 `agents.md` / `README*.md` / `spec.md` 逐項對照程式，修正「文件宣稱已完成、實作仍缺失」的項目。版本維持 `2026.8.7`；本輪不全面重寫，也不更換框架。

### 本地 API、consent 與外部內容安全
- **本地 API 不再只靠綁 localhost**：保留 `127.0.0.1` 綁定，新增 Host 白名單、Origin / `Sec-Fetch-Site` 檢查與每個 server process 隨機產生的 `X-Visual-Agent-Token`。`/api/meta` 供本機前端取得 token，其餘 `/api/*` 必須帶 token；CORS 由舊日誌所述的 `*` 改為明確白名單。
- **AI 動作改為精確確認**：系統變更類 ACTION 不直接執行，後端回傳 `pendingActions`；前端確認時送出 `approvedActionId`。approval 綁定完整 ACTION 字串與 local chat session，5 分鐘過期、一次性 consume，失效或重放會回 403，避免「按 A 卻執行 B」。
- **Server-side web fetch 防 SSRF**：新增 `src/safe-fetch.js`，只允許公開 HTTP(S) URL，拒絕 credentials、loopback、private、link-local 與其他非公開位址；DNS 解析後固定連線位址，每次 redirect 重新驗證，並有總 timeout、abort、redirect 與 response bytes 上限。
- **前端內容淨化 fail-closed**：新增 `public/ui-security.js` 作為 Markdown / HTML 共同安全出口；DOMPurify 缺件或拋錯時退回 escaped text，不直接插入未淨化 HTML。Exps 與遠端內容也走共同出口；動態任務、SOP、模型與 session 文字補 escaping。
- **圖片輸入嚴格驗證**：畫布、畫面分享等 data URL 只接受有正確 magic bytes 的 PNG / JPEG base64，上限 16 MiB；SVG 或偽裝 MIME 不再進入圖片 sink。
- **OAuth token cache 隔離設定**：cache key 納入 token URL、client ID、client secret、scope、audience，避免測試設定或切換 Provider 時重用另一組憑證的 token。

### LLM、Agent Loop 與工作中斷
- **中止訊號真正傳到 LLM**：chat request abort 會串到 Ollama / OpenAI-compatible / Anthropic 與 streaming reader；stream error frame 會拋錯，尾端無換行的 NDJSON frame 也會 flush，reader 會清理。
- **Agent Loop 有總資源上限**：新增 `AgentLoopBudget`，每輪 chat 最多 8 turns、12 次工具呼叫、總 deadline 180 秒；完整 ACTION 字串去重，首輪 Browser Use 也計入預算。LLM 請求使用剩餘 deadline，時間用盡後走既有 tool-summary fallback，不再額外無限續問。
- **聊天歷史避免 lost update**：同 session 並行請求完成時，會把本輪訊息附加到最新歷史，不再用請求開始時的舊快照覆寫其他已完成回覆。

### SOP、備份與任務資料正確性
- **PowerShell 一般路徑實際改用 `-File`**：舊日誌宣稱已是 `-File`，稽核時一般路徑仍為 `-Command`；本輪改為暫存 runner `.ps1`，一般與 elevated runner 都寫 UTF-8 BOM，保留中文輸出、腳本例外與 native `$LASTEXITCODE`。
- **Timeout 終止 process tree**：Windows 一般執行路徑改用 `taskkill /PID ... /T /F`，不再只 kill 父 PowerShell；暫存目錄於完成或錯誤後清理。Elevated launcher 也使用相同終止函式，但 UAC 後整棵 elevated process tree 尚待專門實測。
- **備份 / 還原可重複且非破壞**：兩支 SOP 的 Check 在確認來源後固定回 `$false`，避免第二次被誤判 skipped；robocopy 由 `/MIR` 改為 `/E`，不刪目的地額外檔案；Verify 逐一比對來源相對路徑、存在性與檔案大小。兩者不再宣稱支援 uninstall，避免誤刪整份備份或提供無意義復原。
- **任務持久化與 ID**：`tasks.json` 改同目錄 temp write + rename；task ID 全面改用 `crypto.randomUUID()`。running task 不可刪除、running 時不可整批 import；刪除 API 回傳最新 `todoList`，修正前端把清單設成 undefined 的問題。

### Remote Chalkboard 與畫面擷取
- Remote queue 在斷線、停止與重連時清理舊工作，避免舊 session 回覆插入新連線。
- Chalkboard state 新增 per-session revision；前端只套用 incoming state，拒絕舊 revision，並以 async image-load token 避免舊圖晚到覆蓋新圖。忙碌佇列攜帶 session ID，切換 session 後不會把舊畫布套到新 session。
- 畫面擷取改在 `finally` 停止所有 media tracks，即使 `video.play()`、canvas 或 API 失敗也不殘留 camera / screen capture。

### 發佈與依賴
- `npm audit fix` 更新 body-parser、proxy-addr、qs 等 transitive dependencies；`npm audit --omit=dev` 為 **0 vulnerabilities**。
- Tauri bundle version 由 `0.1.0` 對齊 `package.json` 的 `2026.8.7`。
- Tauri 加入漸進式 CSP：只允許 self script（現階段保留必要的 `unsafe-inline`）、限制連線到本機 API / Tauri IPC，並禁止 object、frame、外部表單送出與非白名單 base URI；現有 inline script/style 尚未完全移除。
- `pkg.assets` 補上 `skills/**/*` 與 `plugins/**/*`，修正 build 訊息宣稱包含 skills、實際未打包的落差；SOP、public 與 CLI 所需 assets 維持納入。

### 架構處理
- 採 **strangler 式漸進拆分**，不重寫 app：本輪新增 `local-api-security.js`、`safe-fetch.js`、`oauth-token-cache.js`、`agent/consent.js`、`agent/loop-budget.js`、`public/ui-security.js`，把可獨立測試的安全與預算邏輯移出巨型檔案。
- `server.js` / `app.js` 仍是主要複雜度熱點；待 Agent Loop、遠端雙機與 consent 的瀏覽器行為測試補齊後，再拆執行主迴圈，避免為了整齊而改壞行為。

### 驗收與尚未覆蓋範圍
- `npm test`：20 個自研 JS 語法檢查、14 支測試檔（118 組通過記錄）、server smoke（meta / diagnostics、local token、跨來源拒絕）全綠。
- Windows PowerShell 實測：多行變數、繁體中文輸出、native exit code 7 正確；200ms timeout 後父行程與 grandchild 均停止，grandchild 未再寫入 marker。
- 瀏覽器實測：惡意 script / event handler / `javascript:` link 未執行、SVG data URL 被拒、暫時任務可建立並正確刪除；真實 Ollama 長回覆可中止，UI 顯示使用者中斷而非連線錯誤。
- `npm run tauri -- info` 可正確解析版本與 CSP；**尚未重新建置並在乾淨 Windows 驗收新 sidecar / Tauri EXE**。
- 尚未完成：UAC elevated process-tree 實測、雙機 Chalkboard revision / session 與停止重連實測、vision model 實機驗收、Agent Loop 與真正 consent button 的完整瀏覽器整合測試。上述項目不得由單元測試推定通過。

---

## 📌 2026.08.23 — 安全加固、測試基建與 spec/README 對齊

### 安全加固（本次重點）
- **HTTP API 綁 127.0.0.1**：`app.listen(PORT, '127.0.0.1')`。原綁 0.0.0.0 使區域網路內任何主機可遠端觸發 SOP/PowerShell 執行、讀取 API Key（RCE 級風險）。現僅供本機前端（`http://localhost:3210`）與 Tauri dev 使用；遠端雙機協作走獨立 raw TCP（`remote-agent.js`），不受影響。`netstat` 實測 3210 綁 127.0.0.1。
- **前端 XSS 防護**：引入本地 vendored **DOMPurify v3.2.6**（`public/dompurify.min.js`，Tauri 離線可用），在 `renderMarkdown()` 共同出口淨化 AI 與遠端 peer 回傳內容——剝除 event handler、`javascript:` 等危險 URI 與 script，保留 GFM 表格/連結/程式碼。三個訊息渲染呼叫點一次覆蓋。
- **build.bat 下載校驗**：Node MSI 與 rustup-init.exe 下載後比對官方/實測 SHA256（`certutil -hashfile`），不符即拒裝，防 MITM / 被污染二進位。rustup 改用 `static.rust-lang.org` 固定 URL 以配合校驗。
- **測試基建**：新增 `scripts/check.js`（語法門掃全部自研 JS + 起 server 冒煙打 `/api/meta`、`/api/diagnostics`）+ `npm test` + GitHub Actions（`.github/workflows/ci.yml`）。此前專案零測試零 CI。

### spec / README 對齊
- spec §8.8 能力門檻改為「回報不強制」，對齊 04.10 移除 top-tier 門檻的現行行為（避免誤擋 `gemma4:e2b-it-qat` 本地模型）。
- spec §15.2.1 標註 interim plan 已於 07.16 移除。
- spec §3 API 路徑、§2.3 SOP 清單對回實際端點與 16 支 SOP（補 `install-winhance`、`backup-user-files`、`restore-user-files`）。
- spec 頂部加「§1–§4 現行契約 / §6 起歷史 changelog、以程式碼為準」讀法。
- README 內建 SOP 表補 `backup-user-files`、`restore-user-files`；常見問題補 API 本地綁定與內容淨化說明。

### 未改動（刻意，附理由）
- **API Key 不 mask 回傳**：`GET /api/llm/config` 供設定視窗回填、再儲存；mask 會使按「儲存」時把真 key 覆寫成遮罩值。區域網路讀 key 的暴露面已由「綁 127.0.0.1」消滅。
- **CORS 維持 `*`**：綁 localhost 後不再是漏洞（同源本機）；若日後加 token 鑑權再收白名單。（2026.10.28 起已加 token 並改為白名單。）
- **PowerShell 注入面**：SOP 本就以 `-File`（寫檔執行）非 `-Command` 拼字串；外部觸發路徑已由綁 localhost 斷絕，殘留執行僅能由本機 UI 觸發（consent 由 UI 保證）。（後續稽核發現一般路徑仍為 `-Command`，且 consent 需由後端強制；已於 2026.10.28 修正。）

### 驗收
- `npm test` 全綠（11 檔語法 + 冒煙 `/api/meta`、`/api/diagnostics` 皆 `success:true`）。
- `node --check` `src/server.js`、`public/app.js`、`public/dompurify.min.js` 通過。
- 非回環位址連 3210 連不上（確認已鎖本機）。

### 架構重構（後續，同分支 feat-multiuser）
> 原則：逐塊搬、每塊搬完 `npm test` 綠才 commit；只拆**純函式 / 可獨立測試**的塊，行為不變；不碰 `/api/chat` 的執行主迴圈（需 LLM+browser 才觸發，行為測試網建好前不動）。
- **Step 1 — `src/pure.js`**：自 `server.js` 抽出 19 個純函式（tokenize、redact、winget 解析、意圖偵測、財報數字、經驗 markdown…）。`server.js` 6248→5959 行，呼叫點零改動（require + destructure 接回）。
- **Step 2a — `src/agent/actions.js`**：`/api/chat` 的 ACTION/SUGGEST 標籤解析抽出為 `extractActionsFromReply()`（含 `normalizeActionString`），可獨立測試。
- **Step 2b — `src/agent/prompts.js`**：winget / Microsoft Store / GitHub Releases 三段推薦 prompt 注解組裝抽出為 `buildRecommendationPromptNotes()`。抽出過程曾引入 `map` 回調 `(element, index)` 參數順序回歸（id 變 undefined），被新增測試抓出並修正——測試安全網生效。
- **測試網**：`test/pure.test.js`（39）+ `test/agent.test.js`（13）+ `test/prompts.test.js`（14）= **66 斷言**；`scripts/check.js` 單元段改為掃 `test/*.test.js`。
- **現狀**：`server.js` 6248→約 5940 行；`/api/chat` 的「解析 + 推薦組裝」已獨立可測。剩執行主迴圈（ADD_TASK/EXECUTE_TASK/INSTALL_SOP/browser-use/computer-use + 財報/遊戲 workflow + agent loop）待補行為測試後再拆。

### 驗收（含重構）
- `npm test`：語法 12 檔 + 單元 66 斷言（pure/agent/prompts）+ 冒煙，全綠。
- `main` 保持與上游同步（`d640656`）；以上全部落在 `feat-multiuser`。

---

## 📌 2026.08.07 — 品牌識別重設 (VA icon + 墨綠官網)

### 版本同步
- `package.json` / `package-lock.json` 更新為 `2026.8.7`。
- 狀態列版本由 runtime 自 `package.json` 取得,無須手動改 HTML。

### 品牌 Icon 重設為 VA
- 全新識別:墨綠黑板 + 粉筆手寫 `VA` + 右下粉筆 + 左下板擦,無眼睛。
- `src-tauri/icons/` 全尺寸重產(32x32 / 128x128 / 128x128@2x / icon.ico / icon.icns / icon.png 512),Tauri 桌面 app 圖示統一換新。
- `public/index.html` 啟動 splash 的 🤖 換成 VA inline SVG。
- `public/app.js` Skills 列表「Visual Agent」群組標頭 🤖 換成同款 VA inline SVG。
- 功能型 UI 符號(🎨 塗鴉、🌡 溫度、🌐 遠端、📋 清單等)維持不動,僅替換品牌露出處。

### 官方網站 (GitHub Pages)
- 新增 `docs/` 多頁官網,風格參考 OpenClaw 官網(深黑 + 墨綠 emerald 主色)+ mamecloudrom 分頁結構。
- 四頁:首頁 / 功能 / 下載 / 文件,含中英文雙語切換(localStorage 記憶)。
- 首頁產品一瞥區接入中(`hero-zh.png`)/英(`hero-en.png`)首圖。
- `docs/favicon.svg` 使用最終 A1 識別。
- 新增 `docs/LICENSE`(Apache-2.0),根目錄同步放置 `LICENSE`,`package.json` license 欄由 ISC 改為 Apache-2.0。

### 驗收
- `node --check src\server.js`、`node --check src\llm.js`、`node --check public\app.js` 通過。

---

## 📌 2026.07.28 — Chalkboard 視覺辨識修正

### 版本同步
- `package.json` / `package-lock.json` 更新為 `2026.7.28`。
- `public/index.html` 前端資源 cache-bust 更新為 `2026.7.28-chalk-vision`。

### Chalkboard 圖片附件
- 附件由整張 JPEG 改為 **內容裁切後的 PNG**；保留細小粉筆筆觸與手寫文字，避免 JPEG 壓縮失真。
- 依實際筆跡、文字、圖片範圍加留白後輸出，最長邊限制 1600px，讓視覺模型聚焦內容並控制傳輸大小。
- 有附件時明確要求模型檢視文字、標籤、圖表、箭頭與圖片；看不清必須說明，不可臆測。
- 擴充 Vision Model 自動辨識：支援 Qwen VL、Gemma 3、GPT-4o/4.1、Gemini、Claude 3/4 等常見命名。
- 視覺模型或 Provider 不支援圖片時，回覆會清楚提示使用者設定 Vision Model 或補上文字，不再假裝辨識成功。
- 修正文字模型靜默忽略圖片的情況：只要目前模型不支援視覺且找不到可切換模型，後端會直接確認「圖片已收到、模型不支援辨識」，不再回覆「沒有收到圖片」。
- 只要Chalkboard已啟用，附圖開關會匯出目前可見畫布；Undo、頁面還原後不再因 `hasUserContent` 狀態誤判而漏附。
- 修正 `qwen2.5vl:7b` 類無連字號名稱被誤判為非 Vision Model 的 regex；前後端模型清單與後端送圖判斷同步支援。

### 驗收
- `node --check src\server.js`、`node --check src\llm.js`、`node --check public\app.js` 通過。

---

## 📌 2026.07.16 — Agent Loop 可讀答案、說明選單、interim plan 收斂與Chalkboard新作清單

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.7.16`。
- `public/index.html` 前端資源 cache-bust 更新為 `2026.7.16-chalk-games`。

### 說明選單
- 標題列「說明」改為下拉選單：診斷資訊、關於。
- 「診斷資訊」由右上角按鈕移入說明選單，仍開啟既有 `/api/diagnostics` modal。
- 「關於」以 `openExternalUrl` 開啟 GitHub：`https://github.com/anomixer/visual-agent`。

### 對話體感
- 關閉前端 interim plan 泡泡（「我先給你一個處理計畫…」），避免查詢前冗長廢話；進度改由 thinking bubble 的 agent-status 顯示。

### Agent Loop / 即時查詢
- 工具結果存在時必須整理成可讀答案；禁止只回「已執行指定動作」。
- 回覆可用性判斷：空字串、純 ACTION/控制碼、空話（馬上幫你查）視為不可用。
- 最終仍無可用文字時，以來源搜尋/抽取結果做 local fallback 答案。
- `actionSummaries` 改為可跨輪更新；loop 續問改用明確 summarize prompt，不再塞空字串。
- 只有 web 工具觀察結果才進 Agent Loop；ADD_TASK / 安裝 SOP 等本機動作直接回可讀摘要。
- `parseActionArg` 支援無引號參數；`action=` 可當 Browser Use `mode` 別名；search query 空值 fallback 為使用者原句。
- SUGGEST 待確認攔截不再因 ACTION 內 `query="...?"` 的問號誤擋；Browser Use 仍可執行。
- ADD_TASK / EXECUTE_TASK / INSTALL_SOP / CREATE_*_SOP 等執行後寫入 actionSummaries，避免空白回覆。

### Chalkboard 本月新作 / 遊戲清單
- 自動Chalkboard不再把長篇新作回覆裁成 4×64 字的「半截第一款」。
- 新增 `buildGameDiscoveryListDraft`：辨識 `7/2《遊戲名》`、`《遊戲名》：簡介` 等條目，最多 7 款 + 趨勢總結。
- `list` / `news` layout 上限改為 **8 條、96 字**；`/api/chalkboard/draft` 同步放寬。
- 每款優先寫「標題 + 一句短評」，標題列改為「本月新作速覽」。
- list/news 渲染改用較密字級（標題 24 / 內文 18），內容超出畫布時自動換下一頁續寫，避免只看到前幾行。

### LLM 相容
- history role 正規化：無 `tool_call_id` 的 `tool` 改為 `user`，避免 OpenAI-compatible / Ollama 拒收。
- 回應解析支援 array content、`reasoning_content`、`<think>` / `<reasoning>` 標籤。
- system prompt 明確要求：最新遊戲/新作也必須走 Browser Use，禁止只回 done/executed。

### 驗收
- `node --check src\server.js`、`node --check src\llm.js`、`node --check public\app.js` 通過。
- Chalkboard遊戲條目標題 pattern 單元檢查：7 款範例可完整辨識。

---

## 📌 2026.07.15 — 意圖辨識與 Chalkboard 刪除/摘要修正

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.7.15`。

### Agent 意圖辨識
- 強化 system prompt：程式、網站與小遊戲的設計/撰寫需求一律視為創作或開發，不得因出現「遊戲」就導向安裝 Steam。
- LLM 不可用時的 keyword fallback 僅在使用者明確提及 `Steam` 時才建立 Steam 任務，移除泛用「遊戲」誤判。

### Chalkboard 行為
- Chalkboard 支援多頁；工具列可新增頁、前後切換，並顯示目前頁碼。
- 垃圾桶改為永久刪除「目前 Chalkboard 頁」；刪除後自動切到相鄰頁，其他頁保留。最後一頁會重設為空白頁。
- 每頁各自保留 Undo / Redo history，避免跨頁還原或誤刪。
- AI 摘要收斂為最多 4 條、64 字內且去重；畫布不再自動加上 `1.`、`2.` 編號。
- Prompt 明定Chalkboard只寫新的可執行結論，禁止重述聊天、前後言與編號。
- 新聞/即時資訊摘要可使用 5 個短標題加 1 行趨勢總結；前端會優先解析 Markdown 標題與「一句話總結」，不再截取第一段原文。
- Steam/PC 新作 Markdown table 會解析為「日期｜遊戲名稱｜類型」的前 5 款，加上總筆數摘要，不再只取前兩列。
- `/api/chat` 若已回傳 `chalkboardDraft`，前端必須優先直接渲染；`index.html`/`app.js` 禁止快取，確保Chalkboard修正不會被舊 JS 覆蓋。

### 一般對話延遲
- `/api/chat` 僅在安裝、移除、執行任務等系統請求才更新所有 SOP runtime state；一般對話改用既有快取/預設狀態。
- 僅在硬碟、CPU、GPU、RAM 等硬體問題才執行 PowerShell 硬體探測，避免一般聊天被 WMI、GPU counter 與 NVIDIA probe 阻塞。

### 追問語意承接
- 新增新聞/即時研究追問推論：上一則使用者訊息是遊戲新聞時，後續短句含 PC、Steam、平台、純、限定等篩選條件，會自動轉成延續查詢。
- 例：`找一下最新遊戲新聞` → `純 PC game 平台`，會搜尋「最新 PC 遊戲新聞」，不得改為介紹 PC 遊戲平台。

### 驗收
- `node --check src\\server.js`、`node --check src\\llm.js`、`node --check public\\app.js` 通過。

---

## 📌 2026.07.07 — Public Readiness Pass：診斷、文件與乾淨機器驗收

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.7.7`。

### Public preview 準備
- README 新增 public preview 檢查清單與乾淨機器驗收流程，明確列出 `npm install`、`npm start`、Ollama、Browser runtime、即時查詢、遊戲攻略與低風險 SOP 驗收項目。
- README 常見問題新增 `npm start` 立刻回到 prompt 的 port 佔用說明，以及 issue 回報時應提供診斷摘要。
- 後端新增 `/api/diagnostics`，一次回傳版本、PID、Node/Windows runtime、AppData 路徑、HTTP/Remote port owner、Ollama/provider 狀態、Browser runtime 狀態、SOP/Skill/Task 數量與 debug log tail。
- 前端右上角新增「診斷資訊」按鈕，使用既有 modal 顯示診斷結果，並提供複製診斷摘要功能。

### 驗收
- `node --check src\server.js` 通過。
- `/api/diagnostics` 可在不依賴 LLM 對話的情況下回傳本機診斷資訊。

### 纖小修正：遊戲新作查詢
- 「最近有什麼新遊戲」、「Steam 新作推薦」這類遊戲 discovery 查詢納入 current-info fallback。
- 若模型只回「馬上幫你查」但沒有輸出 Browser Use ACTION，後端會自動補搜尋、抽取來源，再進 Agent Loop 整理答案。

### Agent Loop 補強：Web research 保底與狀態
- 新增 `isWebResearchIntent()`，web research 類問題在模型未輸出 ACTION 時，後端會自動 search、extract 前 2 筆來源，再餵回 Agent Loop summarizing。
- 新增 `detectGameNewsIntent()`，專門覆蓋新遊戲、最近上市、Steam/PS5/Switch/Xbox 推薦與新作查詢。
- Tool observation 統一改由 `buildToolObservationMessage()` 封裝，避免各處手寫 observation message。
- 新增 `/api/agent-status/:runId`，前端 chat thinking bubble 會輪詢並顯示 planning/searching/extracting/summarizing/done。

---

## 📌 2026.06.30 — Browser Use 即時查詢修正：工具結果必須變答案

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.6.30`。

### Agent Loop 與 Browser Use 修正
- 修正 `src/server.js` 的 `BROWSER_USE mode="extract_text"`：現在會使用 action 內的 `url` 先導頁或 fetch，再抽取實際頁面文字，不再誤抓目前空白 Browser session。
- Browser runtime / Chromium 尚未安裝時，`extract_text url="..."` 會改用 server-side fetch 讀取 HTML 並轉純文字，避免工具流程直接中斷。
- 天氣、新聞、股價、價格等 current-info 查詢在搜尋後，後端會自動抓取前 2 個搜尋結果的頁面內容，再把來源文字交回 Agent Loop，避免只把 link list 丟給模型。
- Agent Loop 的工具結果回填改為可攜的「工具觀察結果」user message，避免部分 OpenAI-compatible provider 不支援自訂 `[ACTION:...]` 流程中的 `role: tool` 而拒收或忽略。
- 遊戲攻略 workflow 不再只列文章/影片連結；現在會抽取來源攻略頁內容，優先用 LLM 整理「攻略重點」，LLM 不可用時也會以來源文字產生 fallback 重點。
- `skills/game-research/SKILL.md` 同步更新：要求先抽取攻略內容、先回答可執行重點，再附來源連結。
- 啟動流程新增 port guard：啟動前檢查 HTTP `3210` 與 Remote TCP `19168`，若已有舊 Visual Agent 行程佔用，會明確顯示 PID 並停止，不再假裝啟動成功後回到 prompt。

### 驗證
- `node --check src\server.js` 通過。
- `/api/agent/browser-use` 實測 `extract_text https://example.com` 可回傳文字。
- 實測中央氣象署臺北市頁面可抽取內容，天氣查詢不再只能拿到網址列表。
- 實測第一個 `node src/server.js` 可常駐並佔用 `3210/19168`；第二個實例會以 exit code 1 顯示 port 佔用與 PID。

---

## 📌 2026.06.28 — Agent Loop 徹底重構：修正 role: 'tool' 訊息遺失的致命 Bug

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.28`。

### Bug 根因診斷與徹底修復

**致命 Bug 發現**：
1. **天氣查詢只列連結**：AI 執行 `[ACTION:BROWSER_USE action="search"]` 後，後端只回傳搜尋結果連結就停住，沒有自動進入下一步抓取網頁內容並整理答案
2. **Tool 執行結果根本沒傳給 LLM**：在 `llm.js` 的 `chatWithLLM` 函式中，`historyMessages` 的處理邏輯只接受 `role: 'assistant'` 或 `'user'`，**完全忽略了 `role: 'tool'` 的訊息**！
3. **先前的 Agent Loop 實作完全無效**：因為 tool 執行結果根本沒有被傳遞給 LLM，所以無論 loop 幾次都沒用

**修復內容**：

**1. 修正 `src/llm.js` 的 `chatWithLLM` 函式**（line 797-802）：
```javascript
// *** 修正前（錯誤）***
const historyMessages = history.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user', // ← 強制轉換，丟失 'tool' role
    content: typeof m.content === 'string' ? m.content : String(m.content || '')
})).filter((m) => m.content.trim());

// *** 修正後（正確）***
const historyMessages = history
    .map(m => ({
        role: m.role, // ← 保留原始 role，包括 'tool'
        content: typeof m.content === 'string' ? m.content : String(m.content || '')
    }))
    .filter((m) => m.content.trim());
```

**2. 簡化並修正 `src/server.js` 的 Agent Loop**：
- 移除複雜的 `requestHistory` 混用邏輯，改用全新的 `conversationHistory` 陣列
- 每次 loop 開始時建立乾淨的對話歷史：user → assistant → tool → assistant → tool...
- Tool 執行結果正確地以 `role: 'tool'` 加入對話歷史
- LLM 在每一輪都能看到完整的 tool 執行結果
- 移除所有無用的 fallback 和 auto-extract 機制，只保留核心 loop 邏輯

**3. Hermes-style Agent Loop 實作**：
```
Turn Lifecycle:
1. 使用者訊息 → conversationHistory
2. 呼叫 LLM → 取得回覆
3. 解析回覆中的 ACTION 標籤
4. 如果有 ACTION：
   a. 執行 tools
   b. 將結果以 role: 'tool' 加入 conversationHistory
   c. 回到步驟 2（再次呼叫 LLM）
5. 如果沒有 ACTION：回傳最終答案給使用者
```

**預期效果**：
- 問「明天台北天氣」→ AI 自動：
  1. 輸出 `[ACTION:BROWSER_USE mode="search"]`
  2. 系統執行 search，回傳網址列表（作為 tool 訊息）
  3. AI 看到網址，輸出 `[ACTION:BROWSER_USE mode="extract_text"]`
  4. 系統抓取網頁內容（作為 tool 訊息）
  5. AI 看到實際內容，整理並輸出「明天台北 28-32°C，降雨 60%」
  6. ✅ 完成，使用者收到完整答案

- **徹底消除「只列網址」問題**：Tool 執行結果現在會正確傳遞給 LLM
- **真正的 Agent 自主性**：不需要使用者催促「然後咧？」

### 技術細節
- **`role: 'tool'` 支援**：OpenAI-compatible API 標準支援 `role: 'tool'` 用於傳遞工具執行結果
- **對話歷史結構**：`[system, user, assistant, tool, assistant, tool, ...]`
- **最多 8 輪 loop**：`MAX_AGENT_TURNS = 8`，避免無限循環
- **Log 輸出**：每輪會輸出 `[Agent Loop] Turn X/8, tool results: N items`

### 行為對齊
- Visual Agent 現在是**真正的 Agent Loop**，tool 執行結果會正確傳遞給 LLM
- 對齊 Hermes Agent、LangChain、AutoGPT 等業界標準實作
- 不再是「一次性工具呼叫 + 假裝有 loop」的偽實作

---

## 📌 2026.06.23 — Language SOP 安裝/卸載穩定化

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.23`。

### 文件整理
- `README.md` 移除大段近期更新 / 開發流水帳，只保留使用、安裝、結構與常見問題；完整開發日誌統一集中於 `agents.md`。
- 原 `readme-tw.md` 的遠端協作摘要已併入 `agents.md`，維持 repo 文件入口簡潔。

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

---

## 📌 2026.06.17 — Chalkboard Markdown 表格純文字化

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.17`。

### Chalkboard 表格渲染修正
- AI 將 Markdown table 寫入 Chalkboard 時，不再直接把 `| 欄位 |` 與 `|---|` 畫到Chalkboard上。
- 前端新增 Chalkboard 專用純文字正規化：偵測 Markdown table header / separator / row，並轉為 `欄位: 值 / 欄位: 值` 的短句格式。
- `##CHALKBOARD##` block、auto draft 與實際 canvas render 前都會套用同一層正規化，避免遠端同步或後端 draft normalization 後又把表格骨架帶回畫布。

---

## 📌 2026.06.12 — 搜尋品質、影片年份權重排序與本地 Chalkboard 版面優化

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.06.12`。

### 本地 Chalkboard 版面優化 (Local Chalkboard Layout Fix)
- **滿版呈現**：修復了本地聊天時，Chalkboard 摘要或 draft 預設只使用左半邊（`position: 'left'`）的 Bug。現在當非處於遠端協作模式時，本地聊天產生的Chalkboard會自動以滿版（`position: 'full'`）呈現，充分利用螢幕寬度。

### DuckDuckGo 跳轉連結與 Lite 引擎遷移 (DDG Redirect & Lite Migration)
- **跳轉連結解析**：修正了原本以 `//duckduckgo.com` 開頭的協議相對跳轉連結無法被正確正常化為 `https:`，導致 parameter 解碼出錯並重新導向中間頁的問題。
- **Lite 引擎遷移**：將核心搜尋機制 `searchWebLinks` 從極易被 anti-bot 或 `202 Accepted` 挑戰阻擋的 `duckduckgo.com/html/` 遷移到極速、無 anti-bot 驗證的 DuckDuckGo Lite 版 (`lite.duckduckgo.com/lite/`)，搭配通用 `aTagRegex` 寬鬆屬性匹配，大幅提升搜尋結果可靠性。
- **搜尋頻率優化**：將遊戲攻略文章搜尋次數從 4 次簡化合併為 1 次，大幅減輕 DuckDuckGo 連續查詢的負載，完全避免高頻限流。

### YouTube 影片發布年份提取與評分加權 (YouTube Date Extraction & Weighted Ranking)
- **年份提取**：更新 `isYouTubeWatchPagePlayable` 核心邏輯，讀取完整 Watch page HTML 以避免 config 截斷；使用高強固性的 JSON/meta regex 精準提取影片發布年份。
- **年份評分加權**：在 `scoreVideoResult` 排序模組中引入年份評分加權：對 &gt;= 2025 年的影片大幅加權 $+10$ 分，2024 年 $+6$ 分，而對於 &lt;= 2021 年的影片加重扣分 $-6$ 分，從而主動排除過時的預告片、反應影片，優先渲染最新的實用攻略。
- **Playwright Chromium 執行路徑指定**：修復了 Chromium 搜尋 fallback 在背景啟動時因為找不到系統全域 Playwright 路徑而拋錯的問題。在 launch config 中明確傳入 `executablePath: browserExe`，保證完美調用 AppData 中管理的內置瀏覽器執行檔。

---

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

---

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

---

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
- 前端新增自動 Chalkboard draft：計畫、比較、查詢摘要、天氣/物價/新聞或偏長回答，即使模型沒有輸出 `##CHALKBOARD##`，也會自動寫入簡短Chalkboard摘要。
- Browser Use / Computer Use / current-info fallback 完成後會自動進入 Observe-after-Act，不再只說「資料取得後回報」就停住。
- LLM 產生的 suggestion buttons 全面停用，避免問天氣卻顯示安裝 Chrome 等文不對題按鈕。

---

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

---

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
- 遠端連線成功後，若本機Chalkboard已經有內容，會主動推送目前畫面給對方。
- 接收遠端 Chalkboard 同步時保留 redo stack，避免 undo 後同步導致 redo 失效。

---

## 📌 2026.05.20 — 遠端協作驗收導向補強

### 版本同步
- `package.json` / `package-lock.json` 版本同步更新為 `2026.05.20`。

### 遠端協作快速備忘（整合自 readme-tw.md）
- 遠端聊天室支援本地 AI、遠端 AI 與使用者三方協作；若訊息同時需要兩邊 AI，預設由本地 AI 先回，遠端 AI 背景補充，避免雙方互等。
- 同一個 remote session 的 remote-AI 任務依序排隊，降低上一題晚回、下一題插隊與重複回答。
- 目標為 `remote-ai` 的 AI 內部協作便條不直接顯示給使用者。
- 建議按鈕固定格式：`[SUGGEST: button_text="🟢 安裝 VS Code" action="install_sop" sop_id="vscode_install"]`，支援 `install_sop`、`add_task`、`execute_task`、`computer_use`。
- 直接動作優先使用 `[ACTION:ADD_TASK sop_id="..."]`、`[ACTION:EXECUTE_TASK task_id="..."]`、`[ACTION:INSTALL_SOP sop_id="..."]`、`[ACTION:COMPUTER_USE mode="prepare_vm_sandbox|open_file|open_url|install_sop" ...]`、`[ACTION:BROWSER_USE mode="search|open|navigate|fetch_title|extract_text|snapshot" ...]`。
- 避免混用舊括號格式或未定義欄位名稱。
- 相關檔案：`src/llm.js`（協議規則）、`src/server.js`（遠端協作後端）、`public/app.js`（遠端前端 UI）。

### Directive 可觀測性
- 遠端 AI directive 的工作日誌現在會帶 `msg:<id>` 標記，方便對照是不是同一則遠端訊息重送。
- `SUGGEST`、`INSTALL_SOP`、`COMPUTER_USE` 等遠端 directive 在執行前後都會留下較明確的 UI log 與 system bubble。

### 重複指令抑制
- 新增短時間 duplicate directive suppression，若遠端 AI 在短窗口內重複送出相同 directive，前端會略過重跑並留下 `Skipped duplicate remote directive` 診斷訊息。
- 這層保護用來降低 polling 重繪、遠端重送或 orchestration 競態造成的重複動作。

### 驗收腳本文件化
- 在 `README.md` 與 `agents.md` 補上固定的 remote validation checklist；原 `readme-tw.md` 摘要已併入本開發日誌並移除。
- 驗收聚焦三條典型路徑：`SUGGEST`、`INSTALL_SOP`、`Double Agent Mode（本地先回、遠端後補）`。

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

---

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
- 本機使用者、遠端使用者或 AI 寫入 Chalkboard 後，對方都能看到最新Chalkboard。
- 同步改為 idle 約 1 秒後送出；若任一方正在畫、拖圖、放文字或操作文字框，會暫停傳送與套用遠端畫面，避免互相覆蓋。

### 遠端 AI 思考狀態
- 新增 `ai_status` 遠端事件。
- 自家 AI 推理時顯示 `本地 AI: 思考中`；對方 AI 推理時顯示 `遠端 AI: 思考中`。
- 推理結束或錯誤時會回到 `待命`，狀態列樣式加粗並固定顯示。

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
- spec.md：修復「Browser (未安裝)」的 Big5 亂碼。

### Planner / Builder / Learn 代理流程
- **Planner**：AI 優先返回規劃回應，總結意圖並提出下一步建議。
- **Builder**：在獲得使用者明確批准後才開始執行任務（Consent-First）。
- **Learn**：任務完成後，撰寫簡短的 Exp 以便代理能從結果中學習並自我優化（重複成功的模式升級為 Skills，穩定的多步驟升級為 SOPs）。

### Browser Runtime 動態載入
- Browser tab 現在按需使用 Playwright Chromium，不再將 Chromium 打包入 EXE / MSI，保持安裝檔輕巧。
- Browser 狀態取決於 Playwright cache 中的 `chrome-headless-shell.exe` 或 `chrome.exe` 是否存在，並由 `/api/meta` 回報實際 `browserExecutable`。
- 缺失時，UI提供一鍵執行 \install-playwright-chromium\ SOP，安裝完畢無需重啟即可出現 Browser tab。

---

## 2026.04.13 Planner / Builder / Learn
- Default behavior is now Planner first, Builder after user approval, Learn after completion.
- Exp is the learning memory: store what worked, what failed, and the reusable pattern.
- Repeated successful patterns can be promoted to Skills; stable multi-step flows can be promoted to SOPs.

---

## 📌 2026.04.10 — 回覆穩定性、Chalkboard控制碼與版本同步

### 版本
- `package.json` / `package-lock.json` 版本同步更新為 `2026.04.10`。

### 對話與代理穩定性
- 修正 AI 只輸出 action 控制碼時對話變空白的問題：後端現在會回填可讀摘要。
- `Browser Use` / `Computer Use` 測試期放寬，移除 top-tier VLM 硬性阻擋訊息（保留 VM-safe 行為限制）。

### 遊戲影片品質
- 遊戲影片結果改為先正規化 YouTube watch URL，再做可播放檢查，減少失效影片。

### Chalkboard 控制
- Chalkboard渲染改為只處理 `##CHALKBOARD## ... ##ENDCHALKBOARD##` 區塊，避免一般回覆句句落板。
- Chalkboard提示改為 popup hint；3 秒自動消失或滑鼠點擊即關閉。

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

---

## 📌 2026.04.01 - Tauri EXE 硬體探測與Chalkboard座標修復

### 硬體探測穩健化 (GPU / HDD)
- `hardware-info.js` 改為使用 `powershell.exe -EncodedCommand` + `execFile`，降低 Tauri EXE 封裝環境下的引號與碼頁干擾。
- 磁碟探測新增雙路徑：優先 `Get-PhysicalDisk`，失敗時自動 fallback 到 `Win32_DiskDrive`，避免 EXE 環境出現 HDD 資訊空白。
- `temperature-monitor.js` 改為 `execFile` 執行 `nvidia-smi.exe`，並加入 NVSMI 常見安裝路徑 fallback，提升 NVIDIA 探測成功率。

### nvidia-smi 錯誤訊息去亂碼
- 將錯誤輸出簡化為穩定錯誤碼格式（如 `ENOENT`），不再直接輸出本地碼頁訊息，避免 `程式不存在，已略過` 這類亂碼污染日誌。

### Chalkboard座標與落稿一致性
- `getChalkPoint()` 新增座標 clamp（0~1），避免游標移動到畫布邊界外時造成定位偏差。
- `drawPlacedText()` 改為完全以 8 點框尺寸落稿，不再強制使用 `baseWidth/baseHeight` 擴張，修正「8 點框位置與最終文字落稿不一致」問題。

### UI 編碼細節
- 修復硬體面板溫度顯示字元，`°C` 改為 `°C`。

### 本機聊天與Chalkboard體驗補強
- 右側聊天上方改為「本機多對話 tab + 遠端 tab」；本機對話新增後可在 tab 直接 `x` 關閉（保留至少一個）。
- `新增對話` 按鈕移到輸入工具列，位置在「清除對話」左側，降低建立新會話的操作成本。
- Chalkboard 在 resize 後，除了縮放快照，也會同步重算 `selectionRect/pendingTextRect/drag points`，並重建 pending 文字 preview，降低字體糊化與偏移復發。

### Chalkboard 8 點框拖曳精準化（補丁）
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
- 新增 `/api/chalkboard/draft`，AI 回覆可帶 `chalkboardDraft`，前端會自動把摘要渲染到Chalkboard（標題 + 重點條列）。
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

---

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

## 📌 2026.03.29 - Chalkboard Resize Chalkboard 縮放與定位修補
### 🐛 Bug 修復：還原未定案文字框與 8 控制點位置偏移
**修復 (`public/app.js`)**
- 三個 resizer (sidebar、chat、logPanel) 的 setSize callback 加入：`if (activeTab === 'chalkboard') resizeChalkboardCanvas()`。
- `resizeChalkboardCanvas()` 在更新 cssWidth/cssHeight 前會記錄原始大小，resize 後若有 `pendingTextRect`，會重新計算並更新其座標（scaleX = 新寬/舊寬，scaleY = 新高/舊高）。

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

### Chalkboard 工具完整國際化
- 為所有 Chalkboard 工具按鈕添加 i18n 支援：粉筆顏色、筆刷大小、形狀工具、編輯操作
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

## 📌 2026.03.26 — 國際化、Chalkboard優化與 AI 語系感知

### 🌍 全方位國際化 (Internationalization / I18N)
- **UI 全面中英切換**：新增 `I18N` 資源表，涵蓋 AI 對話區、AI 引擎設定 Modal、狀態列與Chalkboard提示詞。
- **設定視窗 (Settings Modal) 深度翻譯**：包括所有 Provider 說明、認證方式選項、以及 Vision 模型佔位符，確保英文模式下無殘留中文。
- **Chalkboard粉筆互動字體**：Chalkboard啟動時的歡迎詞與互動提示字，現在會根據介面語系自動切換（Welcome to Visual Agent / 互動提示）。

### 🧠 LLM 語系意識 (Locale-Aware AI)
- **雙語 System Prompt**：後端 `llm.js` 內建中英雙語系統提示詞。
- **語系同步發送**：前端 `/api/chat` 會主動傳遞 `locale` 給後端，確保 AI 在英文模式下會以英文思考、回覆並提供 Suggestion。
- **動態 Prompt 注入**：系統提示詞會根據語系精確規範 AI 的回應風格與語言一致性。

### 🎨 Chalkboard與 UI 視覺優化
- **工具托盤分隔線 (Dividers)**：Chalkboard下方工具列加入垂直分隔線，將「顏色/粗細」、「圖形工具」、「編輯操作」進行分組，提升視覺層次。
- **對話區與設定視窗微調**：修飾了英文模式下的標籤溢出與寬度適應問題，確保 UI 佈局在不同語系下皆呈現 premium 感。

### 🚀 多來源軟體推薦與動態 SOP 生成
- **Store & Release 搜查能力**：AI 除了 `winget` 之外，現在具備 `microsoft-store` 與 `github-releases` 的感知能力。
- **自動化 SOP 建置**：支援 `CREATE_WINGET_SOP`、`CREATE_MSSTORE_SOP` 與 `CREATE_GITHUB_RELEASE_SOP` 動作，AI 能根據外部店面資訊現場「手寫」出功能完備的 SOP。
- **智慧檢查 (Smart Check/Verify)**：強化安裝前後的狀態確認，優先讀取系統計數器與路徑版本，提升 SOP 執行的穩健性。

---

## 📌 2026.03.25 - Chalkboard 與文字工具、知識庫視覺進化、視窗持久化與硬體感知強固

### Chalkboard 畫布
- 中央 `Chalkboard` 改為真正可畫的 canvas，不再只是靜態歡迎區塊。
- Chalkboard改用深綠色材質風格，底部加入粉筆托盤、板擦、粗細切換、Undo、清空、上傳圖片與存成圖片。
- 支援白、紅、黃、綠、藍粉筆與局部板擦，提示字與歡迎字皆直接畫在Chalkboard上，可被板擦擦除。
- 初始進入Chalkboard時先顯示粉筆風格歡迎詞，首次互動後再切換為操作提示。
- 歡迎畫面階段會先禁用整排工具列，第一次點Chalkboard進入可畫模式後才解鎖。

### 圖形與圖片
- 加入直線、矩形、圓形工具，支援預覽後落筆。
- 圖片上傳後可在Chalkboard上拖曳指定放置範圍與大小，再落到畫布上。
- Chalkboard 內容可直接匯出為 PNG。
- 新增選取、複製、剪下、貼上與 clipboard 支援，可把選取區作為圖片重新貼回Chalkboard。

### 文字工具
- `T` 工具改為先開文字設定視窗，再建立文字框。
- 文字設定視窗支援輸入內容、選字型、選字型風格、調字級、文字顏色、對齊、粗體與斜體。
- 真正字型目前支援 `標楷體`、`微軟正黑體`、`黑體`、`細明體`、`Arial`、`Times New Roman`、`Courier New`。
- 建立後可在Chalkboard上先放置文字框，再拖曳框本體移動、拖 8 個控制點縮放，點框外定稿。

### AI 多模態理解
- 右側聊天列新增 `Chalkboard` 附圖按鈕，可切換是否把 Chalkboard 內容一併送給 AI。
- 後端支援把Chalkboard快照作為多模態輸入送給 vision 模型，並在主模型不支援看圖時自動 fallback 到可用的 vision 模型。
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
- **原生匯出圖片 API**：為了解決 Tauri EXE 容器內無法透過 `data:image` 超連結觸發原生瀏覽器下載的問題，於後端新增 `/api/chalkboard/export-file` 端點。此端點利用 PowerShell 的 `SaveFileDialog` 呼叫原生 Windows「另存新檔」視窗，確保Chalkboard截圖能穩定儲存為 PNG。

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




<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
