# Visual Agent SOP File v1

1. Metadata
ID: rec_install_ollama

Name: Install Ollama Local LLM Server
Category: AI Engine
Risk Level: Low

2. Prerequisites
OS: Windows 10 / 11
Permissions: Standard User
Network: Required (download required)

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
try {
    $ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (Test-Path $ollamaExe) {
        $v = & $ollamaExe --version 2>&1
        if ($LASTEXITCODE -eq 0) { $true } else { $false }
    } else {
        $false
    }
} catch {
    $false
}
```

Expected Result: Return True when Ollama is already installed, so the action phase can be skipped.

## Install
Commands (PowerShell):
```powershell
Write-Host "Installing Ollama via winget. Please wait..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}

Write-Host "Running winget install..."
& winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget install failed. Exit code: $LASTEXITCODE"
}

Write-Host "Installation finished. Waiting for initialization..."
Start-Sleep -Seconds 2
```

## Verify
Commands (PowerShell):
```powershell
Write-Host "Verifying Ollama installation..."
$ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
$ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }

if (-not (Test-Path $ollamaExe)) {
    throw "Ollama executable was not found: $ollamaExe"
}

Write-Host "Ollama executable found. Checking service state..."

$maxRetries = 5
$retryCount = 0

while ($retryCount -lt $maxRetries) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -ErrorAction Stop -TimeoutSec 2
        if ($response.version) {
            Write-Host "Ollama service is already running. Version: $($response.version)"
            return $true
        }
    } catch {
        if ($retryCount -eq 0) {
            Write-Host "Starting the Ollama service..."
            Start-Process $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
            Start-Sleep -Seconds 2
        }
    }

    $retryCount += 1
    if ($retryCount -lt $maxRetries) {
        Write-Host "Waiting for the service to start... ($retryCount/$maxRetries)"
        Start-Sleep -Seconds 1
    }
}

try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -ErrorAction Stop -TimeoutSec 2
    if ($response.version) {
        Write-Host "Ollama service verification succeeded."
        $true
    } else {
        throw "Ollama service verification failed."
    }
} catch {
    throw "Unable to reach the Ollama service: $_"
}
```

## Uninstall
Commands (PowerShell):
```powershell
Write-Host "Uninstalling Ollama via winget. Please wait..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}

& winget uninstall --id Ollama.Ollama --silent --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget uninstall failed. Exit code: $LASTEXITCODE"
}

Write-Host "Ollama uninstall has been initiated."
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80072EE2,Network timeout,1. Check network connectivity 2. Retry the download
Access is denied,Administrator permission is missing,1. Request elevation and run as Administrator
