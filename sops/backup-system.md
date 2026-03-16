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
Enable-ComputerRestore -Drive "C:\"
$true
```

預期結果: 總是回傳 True，因為系統還原點可以多次建立。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
Checkpoint-Computer -Description "AIPC Agent 手動備份" -RestorePointType "MODIFY_SETTINGS"
UI 顯示內容: 「正在建立 Windows 系統還原點，請耐心等候...」
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
if (Get-ComputerRestorePoint) { $true } else { $false }
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80042301,Volume Shadow Copy 服務未執行,1. 啟動 VSS 服務 2. 重試建立還原點
