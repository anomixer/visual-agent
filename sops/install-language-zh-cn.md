# AI PC Agent SOP File v1

1. 基本資訊 (Metadata)
ID: sys_lang_zh_cn

名稱: 安裝 Simplified Chinese 語言包與輸入法
分類: 系統設定 / 語系
風險等級: 低 (系統原生功能)

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11

權限: 需要 Administrator (觸發 UAC)
網路: 需要網際網路連接 (下載語言包)

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell): 
```powershell
$installed = @(Get-InstalledLanguage) | Where-Object {
    $_.LanguageId -eq 'zh-CN' -or
    $_.LanguageTag -eq 'zh-CN' -or
    $_.LocaleName -eq 'zh-CN' -or
    $_.Language -eq 'zh-CN'
}
[bool]$installed
```

預期結果: 若回傳 True 則標記為「已安裝」，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
$ErrorActionPreference = 'Stop'
Install-Language -Language zh-CN -ErrorAction Stop
$langList = Get-WinUserLanguageList
if (-not ($langList.LanguageTag -contains 'zh-CN')) {
    $langList.Add('zh-CN')
    Set-WinUserLanguageList -LanguageList $langList -Force -ErrorAction Stop
}
UI 顯示內容: 「正在向 Microsoft 伺服器請求 Simplified Chinese 語言包，這可能需要幾分鐘...」
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
$installed = @(Get-InstalledLanguage) | Where-Object {
    $_.LanguageId -eq 'zh-CN' -or
    $_.LanguageTag -eq 'zh-CN' -or
    $_.LocaleName -eq 'zh-CN' -or
    $_.Language -eq 'zh-CN'
}
if ($installed) {
    $true
} else {
    throw "找不到 zh-CN 語言包"
}
```

第四階段：解除安裝 (Uninstall)
指令 (PowerShell):

```powershell
$ErrorActionPreference = 'Stop'
$target = 'zh-CN'
$installLanguageMap = @{
    '0409' = 'en-US'
    '0404' = 'zh-TW'
    '0804' = 'zh-CN'
    '0411' = 'ja-JP'
}
$installCode = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\Language' -ErrorAction Stop).InstallLanguage
$originalLanguage = $installLanguageMap[$installCode]
$installedTags = @((Get-InstalledLanguage | ForEach-Object {
    $_.LanguageId, $_.LanguageTag, $_.LocaleName, $_.Language
}) | Where-Object { $_ } | Select-Object -Unique)

if (-not ($installedTags -contains $target)) {
    throw "$target 尚未安裝，無需移除。"
}

if ($originalLanguage -eq $target) {
    throw "不可移除系統原始安裝語言 $target。"
}

if ($installedTags.Count -le 1) {
    throw "系統至少要保留一個語言，無法移除唯一語言 $target。"
}

$langList = Get-WinUserLanguageList
$newList = New-Object 'System.Collections.Generic.List[Microsoft.InternationalSettings.Commands.WinUserLanguage]'
foreach ($lang in $langList) {
    if ($lang.LanguageTag -ne $target) {
        [void]$newList.Add($lang)
    }
}
if ($newList.Count -eq 0) {
    throw "移除後會沒有任何使用者語言，已中止。"
}
Set-WinUserLanguageList -LanguageList $newList -Force -ErrorAction Stop
Uninstall-Language -Language $target -ErrorAction Stop
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80070005,沒有系統管理員權限或 UAC 被拒絕,1. 以系統管理員身分重新執行  2. 確認 UAC 已允許
Access is denied,沒有系統管理員權限或 UAC 被拒絕,1. 以系統管理員身分重新執行  2. 確認 UAC 已允許
0x80070422,Windows Update 服務被停用,1. 啟動 wuauserv 服務  2. 重新執行安裝
0x8024402C,網路連線逾時或代理伺服器問題,1. 檢查網路狀態  2. 建議使用者關閉 VPN 後重試
InsufficientSpace,系統槽空間不足,1. 執行磁碟清理建議  2. 提示使用者清理空間
