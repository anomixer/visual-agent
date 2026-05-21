# AI PC Agent SOP File v1

1. Metadata
ID: install_winhance

Name: Install WinHance
Category: System Utilities
Risk Level: Medium (Windows optimization utility)

2. Prerequisites
OS: Windows 10 / 11
Permissions: Administrator (triggers UAC)
Network: Required (download required)

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
try {
    $entry = Get-ItemProperty `
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
        -ErrorAction SilentlyContinue | Where-Object {
            $_.DisplayName -match 'WinHance'
        } | Select-Object -First 1

    $pathCandidates = @(
        "$env:ProgramFiles\WinHance\WinHance.exe",
        "$env:ProgramFiles(x86)\WinHance\WinHance.exe",
        "$env:LOCALAPPDATA\Programs\WinHance\WinHance.exe"
    ) | Where-Object { $_ } | Select-Object -Unique
    $exe = $pathCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($entry -or $exe) { $true } else { $false }
} catch {
    $false
}
```

Expected Result: Return True when WinHance is already installed.

## Install
Commands (PowerShell):
```powershell
$ErrorActionPreference = 'Stop'
$url = 'https://github.com/memstechtips/Winhance/releases/latest/download/Winhance.Installer.exe'
$installer = Join-Path $env:TEMP 'Winhance.Installer.exe'

Write-Host "Downloading WinHance installer..."
Invoke-WebRequest -Uri $url -OutFile $installer -UseBasicParsing -ErrorAction Stop

if (-not (Test-Path $installer) -or ((Get-Item $installer).Length -le 0)) {
    throw "WinHance installer download failed or produced an empty file."
}

Write-Host "Running WinHance installer..."
$silentArgs = @('/VERYSILENT', '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
$proc = Start-Process -FilePath $installer -ArgumentList $silentArgs -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    throw "WinHance installer failed. Exit code: $($proc.ExitCode)"
}

Start-Sleep -Seconds 2
UI Message: "Downloading and installing WinHance from the official GitHub release."
```

## Verify
Commands (PowerShell):
```powershell
$entry = Get-ItemProperty `
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
    -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -match 'WinHance'
    } | Select-Object -First 1

$pathCandidates = @(
    "$env:ProgramFiles\WinHance\WinHance.exe",
    "$env:ProgramFiles(x86)\WinHance\WinHance.exe",
    "$env:LOCALAPPDATA\Programs\WinHance\WinHance.exe"
) | Where-Object { $_ } | Select-Object -Unique
$exe = $pathCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($entry -or $exe) {
    if ($entry) { Write-Host "WinHance uninstall entry found: $($entry.DisplayName)" }
    if ($exe) { Write-Host "WinHance executable found: $exe" }
    $true
} else {
    throw "WinHance was not found after installation."
}
```

## Uninstall
Commands (PowerShell):
```powershell
$ErrorActionPreference = 'Stop'
$entry = Get-ItemProperty `
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
    -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -match 'WinHance'
    } | Select-Object -First 1

if (-not $entry) {
    throw "WinHance uninstall entry was not found."
}

$uninstall = $entry.QuietUninstallString
if (-not $uninstall) {
    $uninstall = $entry.UninstallString
}
if (-not $uninstall) {
    throw "WinHance uninstall command was not found."
}

Write-Host "Running WinHance uninstaller..."
if ($uninstall -match '^\s*\"([^\"]+)\"\s*(.*)$') {
    $exe = $matches[1]
    $args = $matches[2]
} else {
    $parts = $uninstall -split '\s+', 2
    $exe = $parts[0]
    $args = if ($parts.Count -gt 1) { $parts[1] } else { '' }
}

if ($args -notmatch '/SILENT|/VERYSILENT|/quiet|/qn') {
    $args = "$args /VERYSILENT /SILENT /SUPPRESSMSGBOXES /NORESTART"
}

$proc = Start-Process -FilePath $exe -ArgumentList $args -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    throw "WinHance uninstall failed. Exit code: $($proc.ExitCode)"
}
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
WinHance installer download failed,Network blocked or GitHub unavailable,1. Check network connectivity 2. Retry later
WinHance installer failed,Installer rejected silent mode or needs user interaction,1. Ask user to run installer interactively 2. Retry with administrator approval
Access is denied,Administrator permission missing or UAC was denied,1. Run again as Administrator 2. Confirm the UAC prompt was approved
