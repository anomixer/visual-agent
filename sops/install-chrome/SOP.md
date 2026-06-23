# Visual Agent SOP File v1

1. Metadata
ID: rec_install_chrome

Name: Install Google Chrome
Category: Browser
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
    $chromeCmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
    $chromeExe = if ($chromeCmd) { $chromeCmd.Source } else { "C:\Program Files\Google\Chrome\Application\chrome.exe" }
    if (Test-Path $chromeExe) {
        $version = (Get-Item $chromeExe).VersionInfo.ProductVersion
        if ([string]::IsNullOrWhiteSpace($version)) { $false } else { $true }
    } else {
        $false
    }
} catch {
    $false
}
```

Expected Result: Return True when Google Chrome is already installed, so the action phase can be skipped.

## Install
Commands (PowerShell):
```powershell
Write-Host "Installing Google Chrome via winget. Please wait..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}

Write-Host "Running winget install..."
& winget install --id Google.Chrome --silent --accept-package-agreements --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget install failed. Exit code: $LASTEXITCODE"
}

Write-Host "Installation finished. Waiting for initialization..."
Start-Sleep -Seconds 2
```

## Verify
Commands (PowerShell):
```powershell
Write-Host "Verifying Google Chrome installation..."
$chromeCmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
$chromeExe = if ($chromeCmd) { $chromeCmd.Source } else { "C:\Program Files\Google\Chrome\Application\chrome.exe" }

if (-not (Test-Path $chromeExe)) {
    throw "Chrome executable was not found: $chromeExe"
}

try {
    $version = (Get-Item $chromeExe).VersionInfo.ProductVersion
    if ([string]::IsNullOrWhiteSpace($version)) {
        throw "Chrome version information is empty."
    }
    Write-Host "Google Chrome is installed. Version: $version"
    $true
} catch {
    throw "Unable to verify Chrome installation: $_"
}
```

## Uninstall
Commands (PowerShell):
```powershell
Write-Host "Uninstalling Google Chrome via winget. Please wait..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}

& winget uninstall --id Google.Chrome --silent --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget uninstall failed. Exit code: $LASTEXITCODE"
}

Write-Host "Google Chrome uninstall has been initiated."
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80072EE2,Network timeout or blocked by firewall,1. Test network connectivity 2. Temporarily disable the firewall and retry
