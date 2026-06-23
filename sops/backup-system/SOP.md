# Visual Agent SOP File v1

1. Metadata
ID: rec_backup

Name: Create a Windows Restore Point
Category: Data Protection
Risk Level: Low

2. Prerequisites
OS: Windows 10 / 11
Permissions: Administrator (triggers UAC)
Network: No

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
$false
```

Expected Result: Always return False so a new restore point is created each time.

## Install
Commands (PowerShell):
```powershell
Enable-ComputerRestore -Drive "C:\"
Checkpoint-Computer -Description "Visual Agent Manual Backup" -RestorePointType "MODIFY_SETTINGS"
UI Message: "Creating a Windows restore point. Please wait..."
```

## Verify
Commands (PowerShell):
```powershell
$restorePoint = Get-ComputerRestorePoint -ErrorAction SilentlyContinue | Select-Object -First 1
if ($restorePoint) {
    $true
} else {
    throw "No system restore point was found."
}
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80042301,The Volume Shadow Copy service is not running,1. Start the VSS service 2. Retry restore point creation
