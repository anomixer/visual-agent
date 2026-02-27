1. 基本資訊 (Metadata)
ID: rec_install_chrome

名稱: 安裝 Google Chrome
分類: 瀏覽器
風險等級: 低

2. 需求環境 (Prerequisites)
OS: Windows 10 / 11

權限: 需要 Administrator (觸發 UAC)
網路: 必須 (需要下載安裝檔)

3. 執行流程 (Execution Steps)

第一階段：環境檢測 (Check)
指令 (PowerShell): 
```powershell
if (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe" -or Test-Path "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") { $true } else { $false }
```

預期結果: 若回傳 True 則標記為「已安裝」，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
Invoke-WebRequest -Uri "https://dl.google.com/chrome/install/latest/chrome_installer.exe" -OutFile "$env:TEMP\chrome_installer.exe"
Start-Process -FilePath "$env:TEMP\chrome_installer.exe" -Args "/silent /install" -Wait
Remove-Item "$env:TEMP\chrome_installer.exe" -Force
UI 顯示內容: 「正在從 Google 伺服器下載 Chrome 並安裝...」
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
if (Test-Path "C:\Program Files\Google\Chrome\Application\chrome.exe" -or Test-Path "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe") { $true } else { $false }
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80072EE2,網路連線逾時或遭防火牆封鎖,1. 測試網路連線 2. 暫時停用防火牆重試
