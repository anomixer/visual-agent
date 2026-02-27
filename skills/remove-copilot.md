1. 基本資訊 (Metadata)
ID: rec_remove_copilot

名稱: 移除 Windows Copilot
分類: 系統淨化
風險等級: 中

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11

權限: 需要 Administrator (觸發 UAC)
網路: 否

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell): 
```powershell
if (Get-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue | Where-Object { $_.TurnOffWindowsCopilot -eq 1 }) { $true } else { $false }
```

預期結果: 若回傳 True 則標記為「已安裝」，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
if (-not (Test-Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot")) { New-Item -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Force | Out-Null }
Set-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -Value 1 -Force
UI 顯示內容: 「正在停用 Windows Copilot 登錄檔設定...」
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
if (Get-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue | Where-Object { $_.TurnOffWindowsCopilot -eq 1 }) { $true } else { $false }
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80070005,沒有管理員權限,1. 請求以系統管理員身分執行
