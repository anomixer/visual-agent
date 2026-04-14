# AI PC Agent SOP File v1

1. Metadata
ID: sys_backup_user_files

Name: Backup User Files to Target Folder
Category: backup and restore
Risk Level: Medium

2. Prerequisites
OS: Windows 10 / 11
Permissions: User
Network: Optional (required for NAS path)

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
$source = "$env:USERPROFILE\Documents"
$target = "$env:USERPROFILE\Backups\Documents"
if ((Test-Path -LiteralPath $source) -and (Test-Path -LiteralPath $target)) { $true } else { $false }
```

Expected Result: Return True when source and target paths both exist.

## Install
Commands (PowerShell):
```powershell
$source = "$env:USERPROFILE\Documents"
$target = "$env:USERPROFILE\Backups\Documents"
if (-not (Test-Path -LiteralPath $source)) { throw "Source folder not found: $source" }
New-Item -ItemType Directory -Path $target -Force | Out-Null
robocopy $source $target /MIR /R:2 /W:2 /NFL /NDL /NP /XJ
if ($LASTEXITCODE -gt 7) { throw "robocopy failed with exit code $LASTEXITCODE" }
Write-Host "Backup completed."
```

## Verify
Commands (PowerShell):
```powershell
$target = "$env:USERPROFILE\Backups\Documents"
if (-not (Test-Path -LiteralPath $target)) { throw "Backup target not found." }
$count = (Get-ChildItem -LiteralPath $target -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
if ($count -gt 0) { $true } else { throw "Backup target has no files." }
```

## Uninstall
Commands (PowerShell):
```powershell
$target = "$env:USERPROFILE\Backups\Documents"
if (Test-Path -LiteralPath $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}
$false
```

4. Error Handling
Error code / Message,Possible Cause,Auto-recovery Action
Source folder not found,Invalid source path,1. Ask user to choose another source folder 2. Re-run backup
robocopy failed,File lock or permission issue,1. Retry with reduced scope 2. Close busy applications and retry
