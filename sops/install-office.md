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
if (Get-Command "soffice" -ErrorAction Ignore -or Test-Path "C:\Program Files\LibreOffice\program\soffice.exe") { $true } else { $false }
```

預期結果: 若回傳 True 則標記為「已安裝」，跳過執行。

第二階段：安裝 (Install)
指令 (PowerShell):

```powershell
UI 顯示內容: 「正在為您準備辦公軟體 (全自動安裝開源 LibreOffice 中...)」
winget install -e --id TheDocumentFoundation.LibreOffice --accept-package-agreements --accept-source-agreements --silent
```

第三階段：驗證 (Verify)
指令 (PowerShell): 
```powershell
if (Get-Command "soffice" -ErrorAction Ignore -or Test-Path "C:\Program Files\LibreOffice\program\soffice.exe") { $true } else { $false }
```

4. 自動排錯邏輯 (Error Handling)

錯誤代碼 / 訊息,可能原因,AI 自動修復行動
0x80072EE2,網路連線逾時或遭防火牆封鎖,1. 測試網路連線 2. 暫時停用防火牆重試
