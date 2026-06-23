# ============================================================
# Visual Agent — Copilot 移除驗證腳本 (VM 測試用)
# 
# 執行方式（需管理員 PowerShell）：
#   powershell -ExecutionPolicy Bypass -File verify-remove-copilot.ps1
#
# 此腳本做三件事：
#   1. 顯示目前 Copilot 狀態 (BEFORE)
#   2. 執行移除動作
#   3. 再次確認狀態 (AFTER)
# ============================================================

function Write-Section($title) {
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor Cyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 60) -ForegroundColor Cyan
}

function Check-CopilotStatus {
    $hkcu = Get-ItemProperty `
        -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" `
        -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue

    $hklm = Get-ItemProperty `
        -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" `
        -Name "TurnOffWindowsCopilot" -ErrorAction SilentlyContinue

    $app = Get-AppxPackage -Name "Microsoft.Windows.Copilot" -ErrorAction SilentlyContinue

    Write-Host ""
    Write-Host "[HKCU] TurnOffWindowsCopilot = " -NoNewline
    if ($hkcu -and $hkcu.TurnOffWindowsCopilot -eq 1) {
        Write-Host "1 (已停用 ✓)" -ForegroundColor Green
    } else {
        Write-Host "(未設定)" -ForegroundColor Yellow
    }

    Write-Host "[HKLM] TurnOffWindowsCopilot = " -NoNewline
    if ($hklm -and $hklm.TurnOffWindowsCopilot -eq 1) {
        Write-Host "1 (已停用 ✓)" -ForegroundColor Green
    } else {
        Write-Host "(未設定)" -ForegroundColor Yellow
    }

    Write-Host "[APP]  Microsoft.Windows.Copilot = " -NoNewline
    if ($app) {
        Write-Host "已安裝 (Version: $($app.Version))" -ForegroundColor Red
    } else {
        Write-Host "不存在 / 已移除 ✓" -ForegroundColor Green
    }
}

# ── STEP 1: 顯示目前狀態 ────────────────────────────────────────────

Write-Section "BEFORE — 執行前狀態"
Check-CopilotStatus

# ── STEP 2: 執行移除 ─────────────────────────────────────────────────

Write-Section "執行移除動作"

# 2-1. 寫入 HKCU Policy
Write-Host "`n[1/4] 正在設定 HKCU 登錄檔..." -ForegroundColor Cyan
try {
    if (-not (Test-Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot")) {
        New-Item -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" -Force | Out-Null
    }
    Set-ItemProperty `
        -Path "HKCU:\Software\Policies\Microsoft\Windows\WindowsCopilot" `
        -Name "TurnOffWindowsCopilot" -Value 1 -Type DWord -Force
    Write-Host "  → 完成 ✓" -ForegroundColor Green
} catch {
    Write-Host "  → 失敗: $_" -ForegroundColor Red
}

# 2-2. 寫入 HKLM Policy（需要管理員）
Write-Host "[2/4] 正在設定 HKLM 登錄檔 (需要管理員)..." -ForegroundColor Cyan
try {
    if (-not (Test-Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot")) {
        New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" -Force | Out-Null
    }
    Set-ItemProperty `
        -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" `
        -Name "TurnOffWindowsCopilot" -Value 1 -Type DWord -Force
    Write-Host "  → 完成 ✓" -ForegroundColor Green
} catch {
    Write-Host "  → 失敗 (可能需要管理員): $_" -ForegroundColor Red
}

# 2-3. 移除 Copilot AppxPackage（目前使用者）
Write-Host "[3/4] 正在移除 Copilot AppxPackage (目前使用者)..." -ForegroundColor Cyan
try {
    $pkg = Get-AppxPackage -Name "Microsoft.Windows.Copilot" -ErrorAction SilentlyContinue
    if ($pkg) {
        $pkg | Remove-AppxPackage -ErrorAction Stop
        Write-Host "  → 已移除 ✓" -ForegroundColor Green
    } else {
        Write-Host "  → 本機未安裝此 App，跳過" -ForegroundColor Gray
    }
} catch {
    Write-Host "  → 失敗: $_" -ForegroundColor Red
}

# 2-4. 移除 Copilot AppxPackage（所有使用者，需要管理員）
Write-Host "[4/4] 正在移除 Copilot AppxPackage (AllUsers)..." -ForegroundColor Cyan
try {
    $pkgAll = Get-AppxPackage -AllUsers -Name "Microsoft.Windows.Copilot" -ErrorAction SilentlyContinue
    if ($pkgAll) {
        $pkgAll | Remove-AppxPackage -AllUsers -ErrorAction Stop
        Write-Host "  → 已移除 ✓" -ForegroundColor Green
    } else {
        Write-Host "  → 本機未安裝此 App (AllUsers)，跳過" -ForegroundColor Gray
    }
} catch {
    Write-Host "  → 失敗 (可能需要管理員): $_" -ForegroundColor Red
}

# ── STEP 3: 確認結果 ──────────────────────────────────────────────────

Write-Section "AFTER — 執行後狀態"
Check-CopilotStatus

# ── 提示重新登入 ──────────────────────────────────────────────────────

Write-Host ""
Write-Host "================================================" -ForegroundColor Yellow
Write-Host "  ⚠️  登錄檔 Policy 需要【重新登入 / 重開機】才會生效" -ForegroundColor Yellow
Write-Host "  重開機後請確認工作列上的 Copilot 圖示是否消失" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "按任意鍵結束..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
