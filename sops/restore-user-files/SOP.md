# AI PC Agent SOP File v1

1. Metadata
ID: sys_restore_user_files

Name: Restore User Files from Backup Folder
Category: backup and restore
Risk Level: High

2. Prerequisites
OS: Windows 10 / 11
Permissions: User
Network: Optional

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
$backup = "$env:USERPROFILE\Backups\Documents"
$dest = "$env:USERPROFILE\Documents"
if ((Test-Path -LiteralPath $backup) -and (Test-Path -LiteralPath $dest)) { $true } else { $false }
```

Expected Result: Return True when backup source and restore destination are available.

## Install
Commands (PowerShell):
```powershell
$backup = "$env:USERPROFILE\Backups\Documents"
$dest = "$env:USERPROFILE\Documents"
if (-not (Test-Path -LiteralPath $backup)) { throw "Backup folder not found: $backup" }
if (-not (Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
robocopy $backup $dest /E /R:2 /W:2 /NFL /NDL /NP /XJ
if ($LASTEXITCODE -gt 7) { throw "robocopy restore failed with exit code $LASTEXITCODE" }
Write-Host "Restore completed."
```

## Verify
Commands (PowerShell):
```powershell
$dest = "$env:USERPROFILE\Documents"
$count = (Get-ChildItem -LiteralPath $dest -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
if ($count -gt 0) { $true } else { throw "Restore destination has no files." }
```

## Uninstall
Commands (PowerShell):
```powershell
Write-Host "No uninstall action for restore operation."
$false
```

4. Error Handling
Error code / Message,Possible Cause,Auto-recovery Action
Backup folder not found,Backup path changed or removed,1. Ask user for correct backup path 2. Re-run check
robocopy restore failed,File lock or permission issue,1. Retry after closing apps 2. Restore partial folders first
