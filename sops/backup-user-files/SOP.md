# Visual Agent SOP File v1

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
if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Source folder not found: $source" }
$false
```

Expected Result: Return False after validating the source so backups remain repeatable.

## Install
Commands (PowerShell):
```powershell
$source = "$env:USERPROFILE\Documents"
$target = "$env:USERPROFILE\Backups\Documents"
if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Source folder not found: $source" }
New-Item -ItemType Directory -Path $target -Force | Out-Null
robocopy $source $target /E /R:2 /W:2 /NFL /NDL /NP /XJ
if ($LASTEXITCODE -gt 7) { throw "robocopy failed with exit code $LASTEXITCODE" }
Write-Host "Backup completed without deleting extra files from the target."
```

## Verify
Commands (PowerShell):
```powershell
$source = "$env:USERPROFILE\Documents"
$target = "$env:USERPROFILE\Backups\Documents"
if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Source folder not found: $source" }
if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw "Backup target not found: $target" }
$sourceRoot = [System.IO.Path]::GetFullPath($source).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
$sourceFiles = @(Get-ChildItem -LiteralPath $source -Recurse -File -Force -ErrorAction Stop)
foreach ($file in $sourceFiles) {
  $relativePath = $file.FullName.Substring($sourceRoot.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar)
  $targetFile = Join-Path -Path $target -ChildPath $relativePath
  if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) { throw "Backup file missing: $relativePath" }
  $copiedFile = Get-Item -LiteralPath $targetFile -Force -ErrorAction Stop
  if ($copiedFile.Length -ne $file.Length) { throw "Backup file size mismatch: $relativePath" }
}
$true
```

4. Error Handling
Error code / Message,Possible Cause,Auto-recovery Action
Source folder not found,Invalid source path,1. Ask user to choose another source folder 2. Re-run backup
robocopy failed,File lock or permission issue,1. Retry with reduced scope 2. Close busy applications and retry
