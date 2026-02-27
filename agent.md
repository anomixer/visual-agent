# AI PC Agent 開發日誌 (2026-02-25)

## 📌 今日進度與重要變更

### 1. 桌面化轉型：從 Web 升級至 Tauri 獨立應用程式
為了讓應用程式不再依賴使用者的本機 `node.js` 與網頁終端，我們導入了 **Tauri** 與 **Rust** 框架，並將這個 AI Agent 成功打包為不需任何相依環境的獨立 `.exe` 綠色安裝版與系統原生安裝版 (MSI & NSIS)。

### 2. Sidecar (側載 API) 架構實作
- 因應打包需求，將負責橋接 PowerShell 腳本、處理本機磁碟讀寫的 Node.js 伺服器抽出，並利用 `pkg` 編譯成 Tauri 能看懂的 `Sidecar Binary`。
- 修改了 Tauri 的 `capabilities/default.json` 權限設定，賦予這支側載伺服器殼層喚醒的最高權限 (`shell:allow-execute`)。
- 現在開啟 `app.exe` 時，本機伺服器會自動悄悄於背景啟動，結束時同步退出。

### 3. 使用者與組態檔案結構重構 (`%APPDATA%`)
- 解決了原生程式位於 `C:\Program Files` 導致資料無法寫入且重裝消失的問題。
- 將使用者的任務清單 (`tasks.json`) 以及擴充的任務腳本中心 (`skills/` 目錄)，重構遷移至全域環境變數 `%APPDATA%\aipc-agent\` 之中。
- 若是初始載入，程式會聰明地將本機內建的基礎 Skills 複製到使用者的 AppData 以確保無縫上手體驗。

### 4. 介面 (UI/UX) 與操作體驗改良
- **新增語音輸入支援**：介面 Chat Bar 加入麥克風按鈕。透過 `Web Speech API`，讓工具能夠聆聽中文辨識轉為請求。在錄音時，按鈕實作了會發散紅色光暈的呼吸燈漸變特效。
- **改進系統回覆設計**：修正對話回應框的排版位移問題，將獨立出可收合展開的「💬 智慧對話 (Chat Window)」面板，讓所有訊息一則一則依序排列。
- **深淺色 (Dark/Light) 主題切換重構**：原先內聯的 CSS 修改方案存在缺陷；重構了整套 `theme-light` CSS 類別標籤的詞彙定義（背景變白、面板透明等），並串接 `window.matchMedia` 來真正的適應 Windows 系統設定自動改變外觀設定。
- **日誌優化**：主題切換與語言選項切換將統一拋轉並以獨有辨識色歸檔至系統「📝 執行日誌 (Log Panel)」，而不再誤導並阻擋正常 AI 對話視窗。
- **標誌與署名**：「匯出/匯入」按鈕修正推進與接收方向，並於上方標題旁邊補上作者屬名 (by anomixer)。

### 5. 伺服器與任務匯出修復
- **修正靜態檔案伺服路由**：解決了 Tauri 打包架構下 Node Server 讀取不到前端編譯檔案的 `Cannot GET /` 錯誤。
- **原生另存新檔支援**：由於 Tauri 封鎖了瀏覽器 `a[download]` 的寫檔行為，為 `/api/todo/export-file` 擴增了藉由呼叫 PowerShell `System.Windows.Forms.SaveFileDialog` 產生原生另存新檔對話框直接寫入檔案的功能。

### 6. 新增更多 Markdown 技能庫 (Skills)
- 🗑️ `remove-copilot.md`：透過修改登錄檔 (HKCU) 關閉與移除系統 Copilot 協助。
- 🌐 `install-chrome.md`：靜默下載並以 Admin 權限自動安裝最新的 Google Chrome。
- 💾 `backup-system.md`：呼叫 PowerShell 的系統還原點 (Restore Point) 功能。

## 🚀 未來展望
- 串接本機或遠端的輕量級 LLM (如 Ollama / Gemini)，將死板的關鍵字觸發改成真實語意理解，完成強大的本地智能管家願景。
- 開發與整理更多的 `.md` Markdown 擴展腳本，例如：驅動更新、一鍵防毒、軟體一鍵移除等。

---
> 📝 這是一支不需要黑綠色文字終端，便能聰明幫你管理系統操作的助手。
