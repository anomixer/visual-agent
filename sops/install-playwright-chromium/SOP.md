# AI PC Agent SOP File v1
1. Metadata
ID: install_playwright_chromium

Name: Install Playwright Chromium
Category: browser runtime
Risk Level: Low
2. Prerequisites
OS: Windows 10 / 11
Permissions: Standard User
Network: Required
3. Execution Steps
## Check
Expected Result: Return True when Playwright Chromium browser binaries already exist in AppData.
```powershell
try {
    $browserDir = Join-Path $env:APPDATA 'aipc-agent\playwright-browsers'
    if (Test-Path $browserDir) {
        $exe = Get-ChildItem -Path $browserDir -Recurse -Filter 'chrome-headless-shell.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($exe) {
            $true
        } else {
            $false
        }
    } else {
        $false
    }
} catch {
    $false
}
```
## Install
```powershell
Write-Host "Installing Playwright Chromium. Please wait..."
$browserDir = Join-Path $env:APPDATA 'aipc-agent\playwright-browsers'
if (-not (Test-Path $browserDir)) {
    New-Item -ItemType Directory -Path $browserDir -Force | Out-Null
}
$env:PLAYWRIGHT_BROWSERS_PATH = $browserDir

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npm) {
    & npm.cmd exec -- playwright install chromium
} else {
    throw "npm.cmd not found. Please install Node.js first."
}

if ($LASTEXITCODE -ne 0) {
    throw "Playwright Chromium install failed with exit code $LASTEXITCODE"
}
```
## Verify
```powershell
try {
    $browserDir = Join-Path $env:APPDATA 'aipc-agent\playwright-browsers'
    if (Test-Path $browserDir) {
        $exe = Get-ChildItem -Path $browserDir -Recurse -Filter 'chrome-headless-shell.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($exe) {
            $true
        } else {
            $false
        }
    } else {
        $false
    }
} catch {
    $false
}
```

## Note
4. Error Handling
Error Code / Message,Possible Cause,AI Auto Fix
npm.cmd not found,Node.js missing,1. Ask user to install Node.js 2. Retry SOP
Playwright Chromium install failed,Network blocked or registry unavailable,1. Retry later 2. Check proxy/network
5. Notes
- This SOP is intended to be invoked when Browser tab reports missing Chromium.
- It keeps the install step out of MSI/EXE packaging so the app stays small.
