# AI PC Agent SOP File v1

1. 基本資訊 (Metadata)
ID: rec_pull_llm_model

名稱: 下載 Qwen3.5 語言模型 (4B)
分類: AI 引擎
風險等級: 低

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11
權限: 一般使用者
網路: 必須 (需要下載模型約 2.6GB)

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell):
```powershell
try {
    $ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (Test-Path $ollamaExe) { $list = & $ollamaExe list 2>&1; if ($list -match "qwen3.5:4b") { $true } else { $false } } else { $false }
} catch { $false }
```

預期結果: 若模型已存在則回傳 True，跳過下載。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
UI 顯示內容: 「正在下載 Qwen3.5 語言模型 (約 2.6GB)，首次下載請耐心等候...」
$ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
$ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if (-not (Test-Path $ollamaExe)) {
    throw "找不到 Ollama 執行檔: $ollamaExe"
}
& $ollamaExe pull qwen3.5:4b
if ($LASTEXITCODE -ne 0) {
    throw "Ollama pull 失敗，錯誤代碼: $LASTEXITCODE"
}
```

第三階段：驗證 (Verify)
指令 (PowerShell):
```powershell
try {
    $ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
    $ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (Test-Path $ollamaExe) {
        $list = & $ollamaExe list 2>&1
        if ($list -match "qwen3.5:4b") {
            $true
        } else {
            throw "找不到 qwen3.5:4b 模型"
        }
    } else {
        throw "找不到 Ollama 執行檔: $ollamaExe"
    }
} catch { $false }
```

第四階段：解除安裝 (Uninstall)
指令 (PowerShell):

```powershell
$ollamaCmd = Get-Command ollama.exe -ErrorAction SilentlyContinue
$ollamaExe = if ($ollamaCmd) { $ollamaCmd.Source } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if (-not (Test-Path $ollamaExe)) {
    throw "找不到 Ollama 執行檔: $ollamaExe"
}

UI 顯示內容: 「正在移除 Qwen3.5 4B 語言模型...」
& $ollamaExe rm qwen3.5:4b
if ($LASTEXITCODE -ne 0) {
    throw "Ollama rm 失敗，錯誤代碼: $LASTEXITCODE"
}
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
ollama: command not found,Ollama 尚未安裝,1. 請先安裝 Ollama 再執行此任務
connection refused,Ollama 服務未啟動,1. 啟動 Ollama 服務後重試
