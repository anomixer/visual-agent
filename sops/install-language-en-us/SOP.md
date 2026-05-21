# AI PC Agent SOP File v1

1. Metadata
ID: sys_lang_en_us

Name: Install the English (United States) Language Pack and Input Method
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
$target = 'en-US'
function Get-AipcLanguageTags {
    $tags = @()
    if (Get-Command Get-InstalledLanguage -ErrorAction SilentlyContinue) {
        $tags += @(Get-InstalledLanguage -ErrorAction SilentlyContinue | ForEach-Object {
            $_.LanguageId; $_.LanguageTag; $_.LocaleName; $_.Language
        })
    }
    $tags += @(Get-WinUserLanguageList -ErrorAction SilentlyContinue | ForEach-Object { $_.LanguageTag })
    $tags | Where-Object { $_ } | Select-Object -Unique
}
@(Get-AipcLanguageTags) -contains $target
```

Expected Result: Return True when the language pack is already installed or already in the user language list.

## Install
Commands (PowerShell):
```powershell
$ErrorActionPreference = 'Stop'
$target = 'en-US'

function Install-AipcLanguagePack {
    param([string]$LanguageTag)
    if (Get-Command Install-Language -ErrorAction SilentlyContinue) {
        Install-Language -Language $LanguageTag -ErrorAction Stop
        return
    }

    $capabilities = @(
        "Language.Basic~~~$LanguageTag~0.0.1.0",
        "Language.OCR~~~$LanguageTag~0.0.1.0",
        "Language.TextToSpeech~~~$LanguageTag~0.0.1.0",
        "Language.Speech~~~$LanguageTag~0.0.1.0"
    )
    foreach ($capability in $capabilities) {
        try {
            $cap = Get-WindowsCapability -Online -Name $capability -ErrorAction Stop
            if ($cap.State -ne 'Installed') {
                Add-WindowsCapability -Online -Name $capability -ErrorAction Stop | Out-Null
            }
        } catch {
            Write-Warning "Optional language capability $capability was not installed: $($_.Exception.Message)"
        }
    }
}

Install-AipcLanguagePack -LanguageTag $target

$langList = Get-WinUserLanguageList
if (-not (@($langList | ForEach-Object { $_.LanguageTag }) -contains $target)) {
    $newEntry = (New-WinUserLanguageList $target)[0]
    [void]$langList.Add($newEntry)
    Set-WinUserLanguageList -LanguageList $langList -Force -ErrorAction Stop
}
UI Message: "Requesting the English (United States) language pack from Microsoft. This may take a few minutes..."
```

## Verify
Commands (PowerShell):
```powershell
$target = 'en-US'
$tags = @()
if (Get-Command Get-InstalledLanguage -ErrorAction SilentlyContinue) {
    $tags += @(Get-InstalledLanguage -ErrorAction SilentlyContinue | ForEach-Object {
        $_.LanguageId; $_.LanguageTag; $_.LocaleName; $_.Language
    })
}
$tags += @(Get-WinUserLanguageList -ErrorAction SilentlyContinue | ForEach-Object { $_.LanguageTag })
$basicCapabilityInstalled = $false
try {
    $basicCapabilityInstalled = (Get-WindowsCapability -Online -Name "Language.Basic~~~$target~0.0.1.0" -ErrorAction Stop).State -eq 'Installed'
} catch {}
if ((@($tags | Where-Object { $_ } | Select-Object -Unique) -contains $target) -or $basicCapabilityInstalled) {
    $true
} else {
    throw "The $target language pack was not found."
}
```

## Uninstall
Commands (PowerShell):
```powershell
$ErrorActionPreference = 'Stop'
$target = 'en-US'
$installLanguageMap = @{
    '0409' = 'en-US'
    '0404' = 'zh-TW'
    '0804' = 'zh-CN'
    '0411' = 'ja-JP'
}
$installCode = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\Language' -ErrorAction Stop).InstallLanguage
$originalLanguage = $installLanguageMap[$installCode]
$installedTags = @()
if (Get-Command Get-InstalledLanguage -ErrorAction SilentlyContinue) {
    $installedTags += @(Get-InstalledLanguage -ErrorAction SilentlyContinue | ForEach-Object {
        $_.LanguageId; $_.LanguageTag; $_.LocaleName; $_.Language
    })
}
$installedTags += @(Get-WinUserLanguageList -ErrorAction SilentlyContinue | ForEach-Object { $_.LanguageTag })
$installedTags = @($installedTags | Where-Object { $_ } | Select-Object -Unique)

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

if (Get-Command Uninstall-Language -ErrorAction SilentlyContinue) {
    Uninstall-Language -Language $target -ErrorAction Stop
} else {
    foreach ($capability in @("Language.Basic~~~$target~0.0.1.0", "Language.OCR~~~$target~0.0.1.0", "Language.TextToSpeech~~~$target~0.0.1.0", "Language.Speech~~~$target~0.0.1.0")) {
        try {
            $cap = Get-WindowsCapability -Online -Name $capability -ErrorAction Stop
            if ($cap.State -eq 'Installed') {
                Remove-WindowsCapability -Online -Name $capability -ErrorAction Stop | Out-Null
            }
        } catch {
            Write-Warning "Optional language capability $capability was not removed: $($_.Exception.Message)"
        }
    }
}
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80070005,Administrator permission missing or UAC was denied,1. Run again as Administrator 2. Confirm the UAC prompt was approved
Access is denied,Administrator permission missing or UAC was denied,1. Run again as Administrator 2. Confirm the UAC prompt was approved
0x80070422,Windows Update service is disabled,1. Start the wuauserv service 2. Run the installation again
0x8024402C,Network timeout or proxy issue,1. Check network connectivity 2. Ask the user to retry after disabling VPN if applicable
InsufficientSpace,System drive does not have enough free space,1. Perform disk cleanup 2. Ask the user to free disk space
