# AI PC Agent SOP File v1

1. Metadata
ID: rec_remove_copilot

Name: Disable Windows Copilot
Category: System Cleanup
Risk Level: Medium

2. Prerequisites
OS: Windows 10 / 11
Permissions: Administrator (triggers UAC)
Network: No

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
$hkcu = Get-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue
$hklm = Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue
if (($hkcu -and $hkcu.TurnOffWindowsCopilot -eq 1) -or ($hklm -and $hklm.TurnOffWindowsCopilot -eq 1)) { $true } else { $false }
```

Expected Result: Return True when Windows Copilot is already disabled, so the action phase can be skipped.

## Install
Commands (PowerShell):
```powershell
UI Message: "Disabling Windows Copilot through policy registry keys..."
if (-not (Test-Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot")) { New-Item -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Force | Out-Null }
Set-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -Value 1 -Type DWord -Force
if (-not (Test-Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot")) { New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Force | Out-Null }
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -Value 1 -Type DWord -Force
Get-AppxPackage -AllUsers -Name "Microsoft.Windows.Copilot" -ErrorAction SilentlyContinue | Remove-AppxPackage -AllUsers -ErrorAction SilentlyContinue
Get-AppxPackage -Name "Microsoft.Windows.Copilot" -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
```

## Verify
Commands (PowerShell):
```powershell
$hkcu = Get-ItemProperty -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue
$hklm = Get-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue
if (($hkcu -and $hkcu.TurnOffWindowsCopilot -eq 1) -or ($hklm -and $hklm.TurnOffWindowsCopilot -eq 1)) { $true } else { $false }
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80070005,Administrator permission is missing,1. Request elevation and run as Administrator
Access is denied,HKLM write permission is missing,1. Request elevation and run as Administrator
