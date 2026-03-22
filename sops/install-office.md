1. 基本資訊 (Metadata)
ID: rec_office

名稱: 安裝 LibreOffice 辦公套件
分類: 工作必備
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
    $cmd = if (Get-Command soffice -ErrorAction Ignore) { "soffice" } else { "C:\Program Files\LibreOffice\program\soffice.exe" }
    if (Test-Path $cmd) {
        Write-Host "已安裝"
        $true
    } else {
        $false
    }
} catch {
    $false
}
```

預期結果: 若回傳 True 則標記為「已安裝」，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
Write-Host "正在透過 winget 安裝 LibreOffice 辦公套件，請稍候..."

# 檢查 winget 是否可用
if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget 未安裝或不在 PATH 中，請先安裝 App Installer"
}

# 使用 winget 安裝 LibreOffice
Write-Host "執行 winget install..."
& winget install --id TheDocumentFoundation.LibreOffice --silent --accept-package-agreements --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget 安裝失敗，錯誤代碼: $LASTEXITCODE"
}

Write-Host "安裝程序完成，等待初始化..."
Start-Sleep -Seconds 2
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
Write-Host "驗證 LibreOffice 安裝..."
$cmd = if (Get-Command soffice -ErrorAction Ignore) { "soffice" } else { "C:\Program Files\LibreOffice\program\soffice.exe" }

if (-not (Test-Path $cmd)) {
    Write-Host "錯誤: LibreOffice 執行檔不存在"
    $false
    exit
}

Write-Host "LibreOffice 已安裝"
$true
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80072EE2,網路連線逾時或遭防火牆封鎖,1. 測試網路連線 2. 暫時停用防火牆重試
