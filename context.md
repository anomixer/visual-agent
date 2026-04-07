# AI PC Agent Context (2026.04.07)

## 1) 專案現況 (給接手 AI 的快速摘要)
- 平台：Windows + Tauri + Node sidecar。
- 版本：`2026.04.07`（`package.json` / `package-lock.json`）。
- 主要文件已同步：`README.md`、`aipc-spec.md`、`agents.md`。

## 2) 近期已完成重點
- 遠端聊天/多 session：本機與遠端聊天切換、session 管理、pending 狀態分離。
- 模型共享：A 分享給 B，B 接受後可暫時改走 A 模型；中斷後回復本機模型。
- Chalkboard：
  - 支援控制碼模式：僅 `##CHALKBOARD## ... ##ENDCHALKBOARD##` 會落板。
  - resize/座標/8 點框多次修正，避免偏移。
  - 分享畫面可儲存。
- Chat UX：
  - `@mention` 名單與高亮。
  - Markdown 顯示與連結可點擊。
  - 連線/分享模型流程有 waiting + cancel。
- 遊戲攻略流程（後端）：
  - 白名單來源、低品質過濾、影片可播驗證、fallback 策略。
  - 修正主題抽取（避免「劍星 呢?」這類噪音詞污染）。

## 3) 近期關鍵修正 (與使用者痛點直接相關)
- 外部連結開啟：聊天內 URL 改走後端 `/api/open-external-url`，用預設瀏覽器開啟（避免 Tauri 內嵌 WebView 連結無效）。
- DDG 轉址處理：`duckduckgo /l/?uddg=...` 會解成真正目的網址。
- YouTube 假連結過濾：ID 需符合 11 碼規則，排除 `v=example*` 類假網址。
- 遊戲查詢不再輕易回「找不到」：嚴格驗證失敗時會回退到次佳候選清單。

## 4) 已知風險 / 注意事項
- 部分歷史中文內容在某些終端顯示可能亂碼；編輯時務必保持 UTF-8（建議避免 PowerShell 無指定編碼覆寫整檔）。
- 遊戲影片品質仍可能受地區/年齡/平台限制影響，若使用者仍反映垃圾連結，下一步優先做：
  - 頻道白名單
  - 更嚴格標題語意過濾
  - 回傳前逐條 health-check + 自動替代來源

## 5) 接手優先順序 (建議)
1. 先重測：`GTA V 攻略`、`劍星 攻略`（檢查連結可開、影片可播、黑板是否落板）。
2. 若影片仍差：加頻道白名單 + 最低品質規則（長度/標題/關鍵詞）。
3. 若黑板偶發不畫：優先檢查回覆是否含 `##CHALKBOARD##` 控制碼，再檢查前端 parser。

