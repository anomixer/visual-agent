1. 基本資訊 (Metadata)
ID: rec_install_ollama

名稱: 安裝 Ollama 本地 LLM 伺服器
分類: AI 引擎
風險等級: 低

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11
權限: 需要 Administrator (觸發 UAC)
網路: 必須 (需要下載安裝檔)

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell):
```powershell
try { 
    $cmd = if (Get-Command ollama -ErrorAction Ignore) { "ollama" } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (Test-Path $cmd) { $v = & $cmd --version 2>&1; if ($LASTEXITCODE -eq 0) { $true } else { $false } } else { $false }
} catch { $false }
```

預期結果: 若 Ollama 已安裝則回傳 True，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
UI 顯示內容: 「正在從 Ollama 官網下載安裝檔 (約 120MB)，請稍候...」
$installerPath = "$env:TEMP\OllamaSetup.exe"
curl.exe -L --progress-bar "https://ollama.com/download/OllamaSetup.exe" -o "$installerPath"

UI 顯示內容: 「正在起始安裝程序... 請在彈出的 UAC 視窗點選「是」以啟用安裝。」
$process = Start-Process -FilePath $installerPath -Args "/SILENT /NORESTART" -PassThru

# Ollama 安装器有時會因為啟動了背景 App 而卡在最後一步不結束
$timeout = 180 # 3 分鐘上限
$ollamaCli = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"

while ($timeout -gt 0 -and !$process.HasExited) {
    Start-Sleep -Seconds 5
    $timeout -= 5
    
    if (Test-Path $ollamaCli) {
        # 嘗試幫使用者關閉自動跳出的 Ollama App 視窗，這通常是導致安裝程序卡住的原因
        Stop-Process -Name "ollama app" -ErrorAction SilentlyContinue
        
        # 給安裝程序一點時間做最後的收尾
        Start-Sleep -Seconds 3
        if ($process.HasExited) { break }
        
        # 如果檔案已在但進程超過 30 秒還沒退，我們就強制結束它，宣告安裝完成
        if ($timeout -lt 150) { 
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            break
        }
    }
}

Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
```

第三階段：驗證 (Verify)
指令 (PowerShell):
```powershell
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -ErrorAction Stop
} catch {
    UI 顯示內容: 「正在啟動本地 AI 引擎 (ollama serve)...」
    $cmd = if (Get-Command ollama -ErrorAction Ignore) { "ollama" } else { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    Start-Process $cmd -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 4
}
try { $r = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/version" -ErrorAction Stop; if ($r.version) { $true } else { $false } } catch { $false }
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80072EE2,網路連線逾時,1. 檢查網路連線 2. 重試下載
Access is denied,沒有管理員權限,1. 請求以系統管理員身分執行
