1. 基本資訊 (Metadata)
ID: rec_steam

名稱: 安裝 Steam 遊戲平台
分類: 娛樂
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

預期結果: 若回傳 True 則標記為「已安裝」，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
Write-Host "正在透過 winget 安裝 Steam 遊戲平台，請稍候..."

# 檢查 winget 是否可用
if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget 未安裝或不在 PATH 中，請先安裝 App Installer"
}

# 使用 winget 安裝 Steam
Write-Host "執行 winget install..."
& winget install --id Valve.Steam --silent --accept-package-agreements --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget 安裝失敗，錯誤代碼: $LASTEXITCODE"
}

Write-Host "安裝程序完成，等待初始化..."
Start-Sleep -Seconds 2
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
Write-Host "驗證 Steam 安裝..."
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
    throw "找不到 Steam 的執行檔或安裝登錄資訊"
}

if ($steamExe) {
    Write-Host "Steam 已安裝: $steamExe"
}

if ($uninstallEntry) {
    Write-Host "Steam 已登錄於系統移除清單: $($uninstallEntry.DisplayName)"
}

$true
```

第四階段：解除安裝 (Uninstall)
指令 (PowerShell):

```powershell
Write-Host "正在透過 winget 解除安裝 Steam，請稍候..."

if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget 未安裝或不在 PATH 中，請先安裝 App Installer"
}

& winget uninstall --id Valve.Steam --silent --accept-source-agreements

if ($LASTEXITCODE -ne 0) {
    throw "winget 解除安裝失敗，錯誤代碼: $LASTEXITCODE"
}

Write-Host "Steam 已送出解除安裝，等待系統移除完成..."

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
    throw "Steam 解除安裝精靈已結束，但系統仍偵測到 Steam 安裝資訊。"
}

Write-Host "Steam 已完成解除安裝。"
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80072EE2,網路連線逾時或遭防火牆封鎖,1. 測試網路連線 2. 暫時停用防火牆重試
