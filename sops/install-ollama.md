1. 基本資訊 (Metadata)
ID: rec_install_ollama

名稱: 安裝 Ollama 本地 LLM 伺服器
分類: AI 引擎
風險等級: 低

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11
權限: 一般使用者
網路: 必須 (需要下載安裝檔)

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell):
```powershell
try { 
    $ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (Test-Path $ollamaExe) { 
        $v = & $ollamaExe --version 2>&1
        if ($LASTEXITCODE -eq 0) { 
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

預期結果: 若 Ollama 已安裝則回傳 True，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
Write-Host "正在透過 winget 安裝 Ollama 本地 AI 引擎，請稍候..."

# 檢查 winget 是否可用
if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget 未安裝或不在 PATH 中，請先安裝 App Installer"
}

# 使用 winget 安裝 Ollama
Write-Host "執行 winget install..."
& winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget 安裝失敗，錯誤代碼: $LASTEXITCODE"
}

Write-Host "安裝程序完成，等待初始化..."
Start-Sleep -Seconds 2
```

第三階段：驗證 (Verify)
指令 (PowerShell):
```powershell
Write-Host "驗證 Ollama 安裝..."
$ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
$ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }

if (-not (Test-Path $ollamaExe)) {
    throw "Ollama 執行檔不存在: $ollamaExe"
}

Write-Host "Ollama 執行檔已找到，啟動服務..."

$maxRetries = 5
$retryCount = 0

while ($retryCount -lt $maxRetries) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -ErrorAction Stop -TimeoutSec 2
        if ($response.version) {
            Write-Host "Ollama 服務已在執行，版本: $($response.version)"
            return $true
        }
    } catch {
        if ($retryCount -eq 0) {
            Write-Host "啟動 Ollama 服務..."
            Start-Process $ollamaExe -ArgumentList "serve" -WindowStyle Hidden
            Start-Sleep -Seconds 2
        }
    }
    
    $retryCount += 1
    if ($retryCount -lt $maxRetries) {
        Write-Host "等待服務啟動... ($retryCount/$maxRetries)"
        Start-Sleep -Seconds 1
    }
}

try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -ErrorAction Stop -TimeoutSec 2
    if ($response.version) { 
        Write-Host "Ollama 服務驗證成功"
        $true 
    } else { 
        throw "Ollama 服務驗證失敗"
    }
} catch { 
    throw "無法連接 Ollama 服務: $_"
}
```

第四階段：解除安裝 (Uninstall)
指令 (PowerShell):

```powershell
Write-Host "正在透過 winget 解除安裝 Ollama，請稍候..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget 未安裝或不在 PATH 中，請先安裝 App Installer"
}

& winget uninstall --id Ollama.Ollama --silent --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget 解除安裝失敗，錯誤代碼: $LASTEXITCODE"
}

Write-Host "Ollama 已送出解除安裝。"
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80072EE2,網路連線逾時,1. 檢查網路連線 2. 重試下載
Access is denied,沒有管理員權限,1. 請求以系統管理員身分執行
