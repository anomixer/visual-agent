# AI PC Agent SOP File v1

1. Metadata
ID: rec_pull_llm_model

Name: Download the Gemma 4 E2B QAT Model
Category: AI Engine
Risk Level: Low

2. Prerequisites
OS: Windows 10 / 11
Permissions: Standard User
Network: Required (downloads about 1.1 GB)

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
try {
    $ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (Test-Path $ollamaExe) {
        $list = & $ollamaExe list 2>&1
        if ($list -match "gemma4:e2b-it-qat") { $true } else { $false }
    } else {
        $false
    }
} catch {
    $false
}
```

Expected Result: Return True when the model already exists, so the download phase can be skipped.

## Install
Commands (PowerShell):
```powershell
UI Message: "Downloading the Gemma 4 E2B QAT model (about 1.1 GB). The first download may take a while..."
$ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
$ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if (-not (Test-Path $ollamaExe)) {
    throw "Ollama executable was not found: $ollamaExe"
}
& $ollamaExe pull gemma4:e2b-it-qat
if ($LASTEXITCODE -ne 0) {
    throw "Ollama pull failed. Exit code: $LASTEXITCODE"
}
```

## Verify
Commands (PowerShell):
```powershell
try {
    $ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (Test-Path $ollamaExe) {
        $list = & $ollamaExe list 2>&1
        if ($list -match "gemma4:e2b-it-qat") {
            $true
        } else {
            throw "The gemma4:e2b-it-qat model was not found."
        }
    } else {
        throw "Ollama executable was not found: $ollamaExe"
    }
} catch {
    $false
}
```

## Uninstall
Commands (PowerShell):
```powershell
$ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
$ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if (-not (Test-Path $ollamaExe)) {
    throw "Ollama executable was not found: $ollamaExe"
}

UI Message: "Removing the Gemma 4 E2B QAT model..."
& $ollamaExe rm gemma4:e2b-it-qat
if ($LASTEXITCODE -ne 0) {
    throw "Ollama rm failed. Exit code: $LASTEXITCODE"
}
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
ollama: command not found,Ollama is not installed yet,1. Install Ollama before running this task
connection refused,Ollama service is not running,1. Start the Ollama service and retry
