# AI PC Agent SOP File v1

1. Metadata
ID: rec_steam

Name: Install Steam
Category: Entertainment
Risk Level: Low

2. Prerequisites
OS: Windows 10 / 11
Permissions: Administrator (triggers UAC)
Network: Required (download required)

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
try {
    $steamCandidates = @(
        "$env:ProgramFiles(x86)\Steam\steam.exe",
        "$env:ProgramFiles\Steam\steam.exe",
        "$env:LOCALAPPDATA\Programs\Steam\steam.exe"
    ) | Where-Object { $_ } | Select-Object -Unique

    $steamExe = $steamCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    $uninstallEntry = Get-ItemProperty `
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
        -ErrorAction SilentlyContinue | Where-Object {
            $_.DisplayName -eq 'Steam'
        } | Select-Object -First 1

    if ($steamExe -or $uninstallEntry) { $true } else { $false }
} catch {
    $false
}
```

Expected Result: Return True when Steam is already installed, so the action phase can be skipped.

## Install
Commands (PowerShell):
```powershell
Write-Host "Installing Steam via winget. Please wait..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}

Write-Host "Running winget install..."
& winget install --id Valve.Steam --silent --accept-package-agreements --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget install failed. Exit code: $LASTEXITCODE"
}

Write-Host "Installation finished. Waiting for initialization..."
Start-Sleep -Seconds 2
```

## Verify
Commands (PowerShell):
```powershell
Write-Host "Verifying Steam installation..."
$steamCandidates = @(
    "$env:ProgramFiles(x86)\Steam\steam.exe",
    "$env:ProgramFiles\Steam\steam.exe",
    "$env:LOCALAPPDATA\Programs\Steam\steam.exe"
) | Where-Object { $_ } | Select-Object -Unique

$steamExe = $steamCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$uninstallEntry = Get-ItemProperty `
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
    -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -eq 'Steam'
    } | Select-Object -First 1

if (-not $steamExe -and -not $uninstallEntry) {
    throw "Steam executable and uninstall registry entry were not found."
}

if ($steamExe) {
    Write-Host "Steam executable found: $steamExe"
}

if ($uninstallEntry) {
    Write-Host "Steam is registered in the uninstall list: $($uninstallEntry.DisplayName)"
}

$true
```

## Uninstall
Commands (PowerShell):
```powershell
Write-Host "Uninstalling Steam via winget. Please wait..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}

& winget uninstall --id Valve.Steam --silent --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget uninstall failed. Exit code: $LASTEXITCODE"
}

Write-Host "Steam uninstall has been triggered. Waiting for Windows to finish removal..."

$removed = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2

    $steamCandidates = @(
        "$env:ProgramFiles(x86)\Steam\steam.exe",
        "$env:ProgramFiles\Steam\steam.exe",
        "$env:LOCALAPPDATA\Programs\Steam\steam.exe"
    ) | Where-Object { $_ } | Select-Object -Unique

    $steamExe = $steamCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    $uninstallEntry = Get-ItemProperty `
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
        -ErrorAction SilentlyContinue | Where-Object {
            $_.DisplayName -eq 'Steam'
        } | Select-Object -First 1

    if (-not $steamExe -and -not $uninstallEntry) {
        $removed = $true
        break
    }
}

if (-not $removed) {
    throw "Steam uninstall wizard appears to have finished, but Windows still detects Steam."
}

Write-Host "Steam has been fully removed."
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80072EE2,Network timeout or blocked by firewall,1. Test network connectivity 2. Temporarily disable the firewall and retry
