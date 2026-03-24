1. 基本資訊 (Metadata)
ID: rec_backup

名稱: 建立系統還原點 (備份你的電腦)
分類: 資料保護
風險等級: 低

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11

權限: 需要 Administrator (觸發 UAC)
網路: 否

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell): 
```powershell
$false
```

預期結果: 一律回傳 False，確保每次都會建立新的系統還原點。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
Enable-ComputerRestore -Drive "C:\"
Checkpoint-Computer -Description "AIPC Agent 手動備份" -RestorePointType "MODIFY_SETTINGS"
UI 顯示內容: 「正在建立 Windows 系統還原點，請耐心等待...」
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
$restorePoint = Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Select-Object -First 1
if ($restorePoint) {
    $true
} else {
    throw "找不到任何系統還原點"
}
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80042301,Volume Shadow Copy 服務未執行,1. 啟動 VSS 服務 2. 重試建立還原點
