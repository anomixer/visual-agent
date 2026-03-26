# AI PC Agent SOP File v1

1. 基本資訊 (Metadata)
ID: rec_driver_check

名稱: 檢查並安裝驅動程式 (Windows Update)
分類: 系統優化
風險等級: 中

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11

權限: 需要 Administrator (觸發 UAC)
網路: 必須 (需要連線微軟伺服器下載)

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell): 
```powershell
$false
```

預期結果: 回傳 False，強制每次都需要檢查更新。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
UI 顯示內容: 「正在透過 Windows Update 掃描並安裝最新的系統與驅動程式... (這可能需要幾分鐘)」
# 呼叫系統內建的 Update Session Orchestrator 開始掃描與下載
UsoClient.exe ScanInstallWait
# 因為 USOClient 是背景執行，我們讓使用者知道已經觸發
Start-Sleep -Seconds 3
UI 顯示內容: 「已將更新請求發送至 Windows Update 背景處理程序，您可以至『設定 > Windows Update』確認詳細進度。」
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
$true
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80240438,無法連線至更新伺服器,1. 檢查網路連線是否正常
Access is denied,權限不足,1. 必須以系統管理員身分執行
