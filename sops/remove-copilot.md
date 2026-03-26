# AI PC Agent SOP File v1

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
$hkcu = Get-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue
$hklm = Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue
if (($hkcu -and $hkcu.TurnOffWindowsCopilot -eq 1) -or ($hklm -and $hklm.TurnOffWindowsCopilot -eq 1)) { $true } else { $false }
```

預期結果: 若回傳 True 表示已停用，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
UI 顯示內容: 「正在透過登錄檔停用 Windows Copilot...」
if (-not (Test-Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot")) { New-Item -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Force | Out-Null }
Set-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -Value 1 -Type DWord -Force
if (-not (Test-Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot")) { New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Force | Out-Null }
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -Value 1 -Type DWord -Force
Get-AppxPackage -AllUsers -Name "Microsoft.Windows.Copilot" -ErrorAction SilentlyContinue | Remove-AppxPackage -AllUsers -ErrorAction SilentlyContinue
Get-AppxPackage -Name "Microsoft.Windows.Copilot" -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
```

第三階段：驗證 (Verify)
指令 (PowerShell):
```powershell
$hkcu = Get-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue
$hklm = Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue
if (($hkcu -and $hkcu.TurnOffWindowsCopilot -eq 1) -or ($hklm -and $hklm.TurnOffWindowsCopilot -eq 1)) { $true } else { $false }
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80070005,沒有管理員權限,1. 請求以系統管理員身分執行
Access is denied,沒有 HKLM 寫入權限,1. 請求以系統管理員身分執行
