# AI PC Agent SOP File v1

1. Metadata
ID: rec_office

Name: Install LibreOffice
Category: Productivity
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
    $officeCandidates = @(
        "$env:ProgramFiles\LibreOffice\program\soffice.exe",
        "$env:ProgramFiles(x86)\LibreOffice\program\soffice.exe",
        "$env:LOCALAPPDATA\Programs\LibreOffice\program\soffice.exe"
    ) | Where-Object { $_ } | Select-Object -Unique

    $officeExe = $officeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    $uninstallEntry = Get-ItemProperty `
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
        -ErrorAction SilentlyContinue | Where-Object {
            $_.DisplayName -like 'LibreOffice*'
        } | Select-Object -First 1

    if ($officeExe -or $uninstallEntry) { $true } else { $false }
} catch {
    $false
}
```

Expected Result: Return True when LibreOffice is already installed, so the action phase can be skipped.

## Install
Commands (PowerShell):
```powershell
Write-Host "Installing LibreOffice via winget. Please wait..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}

Write-Host "Running winget install..."
& winget install --id TheDocumentFoundation.LibreOffice --silent --accept-package-agreements --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget install failed. Exit code: $LASTEXITCODE"
}

Write-Host "Installation finished. Waiting for initialization..."
Start-Sleep -Seconds 2
```

## Verify
Commands (PowerShell):
```powershell
Write-Host "Verifying LibreOffice installation..."
$officeCandidates = @(
    "$env:ProgramFiles\LibreOffice\program\soffice.exe",
    "$env:ProgramFiles(x86)\LibreOffice\program\soffice.exe",
    "$env:LOCALAPPDATA\Programs\LibreOffice\program\soffice.exe"
) | Where-Object { $_ } | Select-Object -Unique

$officeExe = $officeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
$uninstallEntry = Get-ItemProperty `
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
    "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
    -ErrorAction SilentlyContinue | Where-Object {
        $_.DisplayName -like 'LibreOffice*'
    } | Select-Object -First 1

if (-not $officeExe -and -not $uninstallEntry) {
    throw "LibreOffice executable and uninstall registry entry were not found."
}

if ($officeExe) {
    Write-Host "LibreOffice executable found: $officeExe"
}

if ($uninstallEntry) {
    Write-Host "LibreOffice is registered in the uninstall list: $($uninstallEntry.DisplayName)"
}

$true
```

## Uninstall
Commands (PowerShell):
```powershell
Write-Host "Uninstalling LibreOffice via winget. Please wait..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}

& winget uninstall --id TheDocumentFoundation.LibreOffice --silent --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    Write-Host "winget uninstall returned a non-zero exit code: $LASTEXITCODE. Confirming actual system state before failing..."
}

Write-Host "LibreOffice uninstall has been triggered. Waiting for Windows to finish removal..."

$removed = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2

    $officeCandidates = @(
        "$env:ProgramFiles\LibreOffice\program\soffice.exe",
        "$env:ProgramFiles(x86)\LibreOffice\program\soffice.exe",
        "$env:LOCALAPPDATA\Programs\LibreOffice\program\soffice.exe"
    ) | Where-Object { $_ } | Select-Object -Unique

    $officeExe = $officeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    $uninstallEntry = Get-ItemProperty `
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*" ,
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" `
        -ErrorAction SilentlyContinue | Where-Object {
            $_.DisplayName -like 'LibreOffice*'
        } | Select-Object -First 1

    if (-not $officeExe -and -not $uninstallEntry) {
        $removed = $true
        break
    }
}

if (-not $removed) {
    throw "LibreOffice uninstall appears to have finished, but Windows still detects LibreOffice."
}

Write-Host "LibreOffice has been fully removed."
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80072EE2,Network timeout or blocked by firewall,1. Test network connectivity 2. Temporarily disable the firewall and retry
