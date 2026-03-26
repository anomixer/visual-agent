# AI PC Agent SOP File v1

1. Metadata
ID: sys_lang_zh_cn

Name: Install the Simplified Chinese Language Pack and Input Method
Category: System Settings / Language
Risk Level: Low (native Windows feature)

2. Prerequisites
OS: Windows 10 / 11
Permissions: Administrator (triggers UAC)
Network: Required (internet connection needed to download language packs)

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
$installed = @(Get-InstalledLanguage) | Where-Object {
    $_.LanguageId -eq 'zh-CN' -or
    $_.LanguageTag -eq 'zh-CN' -or
    $_.LocaleName -eq 'zh-CN' -or
    $_.Language -eq 'zh-CN'
}
[bool]$installed
```

Expected Result: Return True when the language pack is already installed, so the action phase can be skipped.

## Install
Commands (PowerShell):
```powershell
$ErrorActionPreference = 'Stop'
Install-Language -Language zh-CN -ErrorAction Stop
$langList = Get-WinUserLanguageList
if (-not ($langList.LanguageTag -contains 'zh-CN')) {
    $langList.Add('zh-CN')
    Set-WinUserLanguageList -LanguageList $langList -Force -ErrorAction Stop
}
UI Message: "Requesting the Simplified Chinese language pack from Microsoft. This may take a few minutes..."
```

## Verify
Commands (PowerShell):
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
    throw "The zh-CN language pack was not found."
}
```

## Uninstall
Commands (PowerShell):
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
    throw "$target is not installed, so there is nothing to remove."
}

if ($originalLanguage -eq $target) {
    throw "The original Windows installation language $target cannot be removed."
}

if ($installedTags.Count -le 1) {
    throw "Windows must keep at least one language. The only remaining language $target cannot be removed."
}

$langList = Get-WinUserLanguageList
$newList = New-Object 'System.Collections.Generic.List[Microsoft.InternationalSettings.Commands.WinUserLanguage]'
foreach ($lang in $langList) {
    if ($lang.LanguageTag -ne $target) {
        [void]$newList.Add($lang)
    }
}
if ($newList.Count -eq 0) {
    throw "Removing $target would leave the user with no language configured. Operation stopped."
}
Set-WinUserLanguageList -LanguageList $newList -Force -ErrorAction Stop
Uninstall-Language -Language $target -ErrorAction Stop
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80070005,Administrator permission missing or UAC was denied,1. Run again as Administrator 2. Confirm the UAC prompt was approved
Access is denied,Administrator permission missing or UAC was denied,1. Run again as Administrator 2. Confirm the UAC prompt was approved
0x80070422,Windows Update service is disabled,1. Start the wuauserv service 2. Run the installation again
0x8024402C,Network timeout or proxy issue,1. Check network connectivity 2. Ask the user to retry after disabling VPN if applicable
InsufficientSpace,System drive does not have enough free space,1. Perform disk cleanup 2. Ask the user to free disk space
