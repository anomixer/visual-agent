# 🤖 AI PC Agent

> 本地優先、無命令列、具備感知能力的 Windows 系統管家  
> by [anomixer](https://github.com/anomixer)

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/) [![Ollama](https://img.shields.io/badge/Ollama-0.17%2B-blue)](https://ollama.com/) [![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4)](https://www.microsoft.com/windows)

---

## 📌 這是什麼？

AI PC Agent 是一個跑在你電腦本地端、**不需要打開終端機**的 Windows 系統自動化工具。

用中文說需求，或直接點推薦清單，它就能自動幫你安裝軟體、調整系統設定、移除廣告元件，並把整個過程視覺化呈現在畫面上。

```
你說：「幫我把 Copilot 移除掉」
它就：自動執行 PowerShell 腳本 → 修改登錄檔 → 驗證結果 → 告訴你完成了
```

---

## ✨ 功能一覽

| 功能 | 說明 |
|------|------|
| � **推薦清單** | 系統常用優化項目，一鍵加入或立即執行 |
| � **工作清單** | 任務進度條、狀態顯示、JSON 匯出匯入 |
| 🧠 **AI 對話** | 本地 Ollama LLM（qwen3.5:0.8b），真正理解你說的話 |
| 🪄 **自動初始設定**| 全新電腦初次執行時，自動於背景下載安裝 Ollama 與 AI 模型 |
| 📦 **一鍵 EXE 打包**| 內建 `build.bat`，開發者能藉由 Tauri 全自動發佈安裝檔 |
| 📝 **執行日誌** | 即時顯示每個步驟，Mono 字體，依嚴重度顯色 |
| 🎤 **語音輸入** | 中文語音辨識，說話就能下指令 |
| 🔲 **可拖拉面板** | VS Code 風格三欄介面，每個邊界都可滑鼠拖拉調整 |
| 🌓 **深淺色主題** | 一鍵切換，設定自動記憶 |

---

## 🖥️ 介面預覽

```
┌─────────────────────────────────────────────────────────────┐
│ AI PC Agent  [檔案][檢視][說明]  ──  [●AI就緒]  ── [🌙↓↑] │
├────────────┬──────────────────────────┬─────────────────────┤
│            │                          │                     │
│  � 推薦清單 │     📋 工作清單           │   💬 AI 對話        │
│            │                          │                     │
│  ←→ 拖拉  ─┤──────────────────────────│  ←→ 拖拉            │
│            │  � 工作日誌  ↕ 拖拉      │  [使用者輸入框]      │
├────────────┴──────────────────────────┴─────────────────────┤
│ [🟢 AI就緒] │ [0 個任務]                     [v1.0] [繁中]  │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚙️ 環境需求

| 項目 | 需求 |
|------|------|
| **OS** | Windows 10 / 11 |
| **Node.js** | 18 以上 → [下載](https://nodejs.org/) |
| **Ollama**（可選） | AI 對話功能 → [下載](https://ollama.com/) |
| **執行權限** | 部分 Skill 需要「系統管理員身分執行」 |

> 若只是要一鍵安裝軟體、不用 AI 對話，不裝 Ollama 也可以跑。

---

## 🚀 快速開始

### 1. 複製專案

```bash
git clone https://github.com/anomixer/aipc-agent.git
cd aipc-agent
```

### 2. 安裝相依套件

```powershell
npm install
```

> 若出現 `scripts is disabled` 錯誤：
> ```powershell
> powershell -ExecutionPolicy Bypass -Command "npm install"
> ```

### 3. 啟動伺服器

```powershell
node src/server.js
```

### 4. 開啟瀏覽器

```
http://localhost:3210
```

---

## 🧠 啟用 AI 對話（Ollama）

**AI PC Agent 內建 Auto-Bootstrap！**  
若你的電腦是一張白紙，只要在執行專案後放著不動，它會主動偵測缺少的依賴項目。
1. 若系統未安裝 Ollama，它會自動將安裝腳本加入佇列並執行。
2. Ollama 啟動後，它會背景自動發送指令下載 `qwen3.5:0.8b` 模型。

待介面上方的指示燈變成 **🟢 AI 就緒**，對話框就能真正無縫理解你說的話了！（你也可以手動從推薦清單中觸發它）

---

## 📦 打包為獨立 EXE

如果你是開發者，想要產生能發給別人直接執行的 `.exe` 安裝檔，不需要手動設定：

```cmd
C:\aipc-agent> build.bat
```

腳本會自動幫你下載與安裝 Node.js、Rust C++ 開發環境、Tauri CLI 等依賴。
最終產出位於 `src-tauri\target\release\bundle\nsis\`（包含你的 Node 後端與 Skills 腳本）。

---

## 🎮 三種使用方式

### 方式一：推薦清單（最快）

1. 左側「💡 推薦清單」找到要執行的項目
2. 滑鼠移上去 → 出現 **＋ 加入** 和 **▶ 執行** 按鈕
3. 點 **▶ 執行** → 自動加入清單並立即執行
4. 中間工作清單顯示進度，下方日誌即時更新

> 有 ⚡ **可自動執行** 標籤的項目，背後有完整的 Skill 腳本支援

### 方式二：AI 對話輸入

在右下輸入框打字（或按 🎤 語音）：

```
幫我移除 Windows Copilot
我電腦很久沒備份了
安裝 Google Chrome
```

AI 理解你的意圖後，自動建立任務 → 加入清單 → 等你按執行。

### 方式三：自訂任務

直接從右下輸入框描述需求，若有對應 Skill 則自動掛載執行腳本；若沒有則作為待辦事項加入清單。

---

## � 內建 Skills

| Skill | 說明 | 需要管理員 |
|-------|------|-----------|
| 🧠 `install-ollama` | 靜默下載安裝 Ollama | ✅ |
| 📥 `pull-llm-model` | 下載 qwen3.5:0.8b 語言模型 | ❌ |
| 🌐 `install-chrome` | 靜默安裝最新版 Google Chrome | ✅ |
| 🗑️ `remove-copilot` | 移除 Windows Copilot（HKCU+HKLM+AppxPackage）| ✅ |
| 💾 `backup-system` | 建立 Windows 系統還原點 | ✅ |
| 🇯🇵 `install-language-ja` | 安裝日文語系包 | ✅ |

---

## ✍️ 新增自訂 Skill

把 `.md` 檔案放進 `skills/`（開發）或 `%APPDATA%\aipc-agent\skills\`（執行），格式如下：

```markdown
1. 基本資訊 (Metadata)
ID: my_skill_id
名稱: 我的自訂技能
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
$false   # 回傳 $true 則跳過安裝
```

第二階段：安裝 (Install)
指令 (PowerShell):
```powershell
UI 顯示內容: 「正在執行...」
Write-Host "Hello from my skill!"
```

第三階段：驗證 (Verify)
指令 (PowerShell):
```powershell
$true
```
```

存檔後重新整理頁面即自動載入。

---

## � 專案結構

```
aipc-agent/
├── public/
│   ├── index.html          # VS Code 三欄介面
│   ├── style.css           # 設計系統（深色 + JetBrains Mono）
│   └── app.js              # 前端邏輯 + 可拖拉 resize
│
├── src/
│   ├── server.js           # Express API 伺服器 (port 3210)
│   ├── llm.js              # Ollama 整合（狀態偵測 + 對話）
│   ├── skill-parser.js     # 解析 .md 技能腳本
│   ├── skill-executor.js   # 執行 PowerShell + 三階段流程
│   └── index.js            # Tauri sidecar 入口
│
├── skills/                 # 技能腳本庫
│   ├── install-ollama.md
│   ├── pull-llm-model.md
│   ├── install-chrome.md
│   ├── remove-copilot.md
│   ├── backup-system.md
│   └── install-language-ja.md
│
├── agent.md                # 開發日誌
├── aipc-spec.md            # 實作規格書
├── verify-remove-copilot.ps1  # Copilot 移除驗證腳本（VM 測試用）
└── package.json
```

---

## ❓ 常見問題

**Q: npm 出現「scripts is disabled」？**
```powershell
powershell -ExecutionPolicy Bypass -Command "npm install"
powershell -ExecutionPolicy Bypass -Command "node src/server.js"
```

**Q: Skill 執行需要管理員權限怎麼辦？**  
以「系統管理員身分」開啟 PowerShell 或 Terminal，再執行 `node src/server.js`。

**Q: Header 上的 AI 指示燈是紅色？**  
Ollama 未安裝或未啟動。從推薦清單點「🧠 安裝 Ollama → ▶ 執行」，或手動至 [ollama.com](https://ollama.com) 下載安裝。

**Q: AI 回應感覺很死板？**  
確認 `qwen3.5:0.8b` 已下載且 Ollama 正在執行中（指示燈顯示 🟢 AI 就緒）。關鍵字模式的回應確實較制式。

**Q: 新增的 Skill 沒有出現？**  
確認 `.md` 放在 `%APPDATA%\aipc-agent\skills\` 或開發用的 `skills/`，並重新整理頁面。

---

## 🚀 未來計畫

- [ ] 多輪對話歷史（讓 AI 記住上下文）
- [ ] 硬體健康監控（S.M.A.R.T、CPU 溫度）
- [ ] Skill 線上商城，動態下載更新
- [ ] 更多 Skills：驅動更新、防毒掃描、軟體移除
- [x] Tauri 打包成獨立 `.exe`（不再依賴本機 Node.js）

---

> 📝 這是一支不需要黑綠色文字終端，便能聰明幫你管理系統操作的助手。
