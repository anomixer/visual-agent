1. 基本資訊 (Metadata)
ID: sys_lang_ja_jp

名稱: 安裝日文語言包與輸入法
分類: 系統設定 / 語系
風險等級: 低 (系統原生功能)

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11

權限: 需要 Administrator (觸發 UAC)
網路: 需要網際網路連接 (下載語件包)

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell): 
```powershell
(Get-InstalledLanguage | Select-Object -ExpandProperty LanguageId) -contains "ja-JP"
```

預期結果: 若回傳 True 則標記為「已安裝」，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
Install-Language -Language ja-JP
Set-WinUserLanguageList -LanguageList (New-WinUserLanguageList -Language ja-JP) -Force
UI 顯示內容: 「正在向 Microsoft 伺服器請求日文語言包，這可能需要幾分鐘...」
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
$installed = Get-InstalledLanguage | Where-Object {$_.LanguageId -eq "ja-JP"}
if ($installed) {
    $true
} else {
    throw "找不到 ja-JP 語言包"
}
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80070422,Windows Update 服務被停用,1. 啟動 wuauserv 服務  2. 重新執行安裝
0x8024402C,網路連線逾時或代理伺服器問題,1. 檢查網路狀態  2. 建議使用者關閉 VPN 後重試
InsufficientSpace,系統槽空間不足,1. 執行磁碟清理建議  2. 提示使用者清理空間
