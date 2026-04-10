@echo off
setlocal enabledelayedexpansion
title AI PC Agent — Build Tool v0.4

color 0A
echo.
echo  =====================================================
echo    AI PC Agent ^| Full Build Script
echo    Node Sidecar + Tauri -^> Windows .exe Installer
echo  =====================================================
echo.

:: ─────────────────────────────────────────────────────────
:: Check project root
:: ─────────────────────────────────────────────────────────
if not exist "package.json" (
    echo  [ERROR] Run this script from the aipc-agent project root.
    echo  Example: cd C:\dev\aipc-agent ^&^& build.bat
    pause & exit /b 1
)

if not exist "src-tauri\tauri.conf.json" (
    echo  [ERROR] src-tauri\tauri.conf.json not found.
    echo  This project requires Tauri to be already initialized.
    pause & exit /b 1
)

echo  Project: %CD%
echo.

:: ─────────────────────────────────────────────────────────
:: STEP 1 — Node.js
:: ─────────────────────────────────────────────────────────
echo  [1/7] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Node.js not found. Downloading Node.js 20 LTS...
    curl -fsSL "https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi" -o "%TEMP%\node-installer.msi"
    if errorlevel 1 (
        echo  [ERROR] Download failed. Check your internet connection.
        pause & exit /b 1
    )
    echo  [INFO] Installing Node.js - silent...
    msiexec /i "%TEMP%\node-installer.msi" /quiet /norestart ADDLOCAL=ALL
    del "%TEMP%\node-installer.msi" >nul 2>&1
    rem Reload PATH
    for /f "tokens=2*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "PATH=%%B;!PATH!"
    where node >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Node.js install seems complete but node not on PATH yet.
        echo  [FIX]   Please close this window, open a new terminal, and re-run build.bat
        pause & exit /b 1
    )
)
for /f "tokens=*" %%v in ('node --version 2^>nul') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

:: ─────────────────────────────────────────────────────────
:: STEP 2 — npm install
:: ─────────────────────────────────────────────────────────
echo.
echo  [2/7] Installing npm dependencies...
call npm install --loglevel error
if errorlevel 1 (
    echo  [ERROR] npm install failed.
    echo  [FIX]   Try running: npm install
    pause & exit /b 1
)
echo  [OK] npm packages ready

echo.
echo  [2b] Installing Playwright Chromium...
set "PLAYWRIGHT_BROWSERS_PATH=%CD%\src-tauri\resources\playwright-browsers"
if not exist "src-tauri\resources" mkdir "src-tauri\resources"
if exist "src-tauri\resources\playwright-browsers" rmdir /s /q "src-tauri\resources\playwright-browsers"
call npx playwright install chromium
if errorlevel 1 (
    echo  [ERROR] Playwright Chromium install failed.
    echo  [FIX]   Check network access and try again.
    pause & exit /b 1
)
echo  [OK] Playwright Chromium ready
echo  [INFO] Chromium path: src-tauri\resources\playwright-browsers

:: ─────────────────────────────────────────────────────────
:: STEP 3 — pkg (bundle Node server -> .exe)
:: ─────────────────────────────────────────────────────────
echo.
echo  [3/7] Checking pkg - Node.js to exe bundler...
call npm exec -- pkg --version >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Installing pkg...
    call npm install --save-dev pkg
    if errorlevel 1 (
        echo  [ERROR] Failed to install pkg.
        pause & exit /b 1
    )
)
echo  [OK] pkg ready

:: Get Rust target triple for the sidecar filename
echo.
echo  [3b] Detecting Rust target triple...
where rustc >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=2" %%h in ('rustc -Vv 2^>nul ^| findstr /i "host"') do set RUST_TARGET=%%h
)
if "!RUST_TARGET!"=="" (
    rem Default x86_64 Windows target
    set RUST_TARGET=x86_64-pc-windows-msvc
    echo  [WARN] rustc not found yet, defaulting to: !RUST_TARGET!
) else (
    echo  [OK] Target triple: !RUST_TARGET!
)

:: Create binaries dir
if not exist "src-tauri\binaries" mkdir "src-tauri\binaries"

echo.
echo  [INFO] Bundling via pkg . -^> sidecar binary...
echo  [INFO] Output: src-tauri\binaries\server-!RUST_TARGET!.exe
echo  [INFO] - This includes: src/**, public/**, skills/**
echo  [INFO] - Chromium resource: src-tauri\resources\playwright-browsers
echo.
call npm exec -- pkg . --targets node18-win-x64 --output "src-tauri/binaries/server-!RUST_TARGET!.exe" --compress GZip
if errorlevel 1 (
    echo.
    echo  [ERROR] pkg bundling failed.
    echo  [HINT]  Common reasons:
    echo          - Missing native modules, try: npm rebuild
    echo          - Out of memory, close other apps
    pause & exit /b 1
)
echo.
echo  [OK] Sidecar binary ready:
echo       src-tauri\binaries\server-!RUST_TARGET!.exe
for %%F in ("src-tauri\binaries\server-!RUST_TARGET!.exe") do echo       Size: %%~zF bytes

:: ─────────────────────────────────────────────────────────
:: STEP 4 — Visual Studio Build Tools check
:: ─────────────────────────────────────────────────────────
echo.
echo  [4/7] Checking Visual Studio Build Tools - required by Rust...
set MSVC_FOUND=0
for %%P in (
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC"
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC"
    "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Tools\MSVC"
) do (
    if exist "%%~P" set MSVC_FOUND=1
)
if "!MSVC_FOUND!"=="0" (
    echo  [WARN] Visual Studio Build Tools not detected.
    echo.
    echo  Rust needs MSVC C++ toolchain. Options:
    echo    1. Install VS Build Tools - recommended, ~4GB:
    echo       winget install Microsoft.VisualStudio.2022.BuildTools
    echo       Then select: Desktop development with C++
    echo.
    echo    2. Use GNU toolchain - faster option, ~300MB:
    echo       winget install MSYS2.MSYS2
    echo       Then: rustup target add x86_64-pc-windows-gnu
    echo.
    echo  Press any key to continue anyway, build may fail...
    pause >nul
) else (
    echo  [OK] MSVC C++ toolchain found
)

:: ─────────────────────────────────────────────────────────
:: STEP 5 — Rust
:: ─────────────────────────────────────────────────────────
echo.
echo  [5/7] Checking Rust...
where rustc >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Rust not found. Downloading rustup...
    curl -fsSL "https://win.rustup.rs/x86_64" -o "%TEMP%\rustup-init.exe"
    if errorlevel 1 (
        echo  [ERROR] Failed to download rustup. Check internet connection.
        pause & exit /b 1
    )
    echo  [INFO] Installing Rust stable - this takes 3-5 minutes...
    "%TEMP%\rustup-init.exe" -y --default-toolchain stable --profile minimal
    del "%TEMP%\rustup-init.exe" >nul 2>&1
    set "PATH=%USERPROFILE%\.cargo\bin;!PATH!"
    where rustc >nul 2>&1
    if errorlevel 1 (
        echo  [ERROR] Rust installed but not on PATH yet.
        echo  [FIX]   Close this window and re-run build.bat
        pause & exit /b 1
    )
)
for /f "tokens=*" %%v in ('rustc --version 2^>nul') do set RUST_VER=%%v
echo  [OK] %RUST_VER%

:: ─────────────────────────────────────────────────────────
:: STEP 6 — Tauri CLI
:: ─────────────────────────────────────────────────────────
echo.
echo  [6/7] Checking Tauri CLI...
call npm exec -- tauri --version >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Installing @tauri-apps/cli@2 - local devDependency...
    call npm install --save-dev @tauri-apps/cli@2
    if errorlevel 1 (
        echo  [ERROR] Tauri CLI install failed.
        pause & exit /b 1
    )
)
for /f "tokens=*" %%v in ('npm exec -- tauri --version 2^>nul') do set TAURI_VER=%%v
echo  [OK] Tauri CLI %TAURI_VER%

:: ─────────────────────────────────────────────────────────
:: STEP 7 — Tauri Build
:: ─────────────────────────────────────────────────────────
echo.
echo  =====================================================
echo  [7/7] Building Tauri app...
echo.
echo  First build downloads Rust crates - ~500MB, and
echo  compiles everything - expect 10-20 minutes.
echo  Subsequent builds are much faster.
echo  =====================================================
echo.

call npm exec -- tauri build
if errorlevel 1 (
    echo.
    echo  =====================================================
    echo  [ERROR] Tauri build failed!
    echo  =====================================================
    echo.
    echo  Common causes and fixes:
    echo.
    echo  1. Missing C++ Build Tools:
    echo     winget install Microsoft.VisualStudio.2022.BuildTools
    echo     - workload: Desktop development with C++
    echo.
    echo  2. Missing WebView2 Runtime:
    echo     winget install Microsoft.EdgeWebView2Runtime
    echo.
    echo  3. Missing icon files:
    echo     Check: src-tauri\icons\ - need .ico, .png, .icns
    echo     Run: npm exec -- tauri icon public\icons\icon.png
    echo.
    echo  4. Sidecar rename issue:
    echo     Ensure binary name matches: server-!RUST_TARGET!.exe
    echo     in src-tauri\tauri.conf.json ^> bundle.externalBin
    echo.
    echo  Full logs are above. Check Cargo errors carefully.
    echo  =====================================================
    pause & exit /b 1
)

:: ─────────────────────────────────────────────────────────
:: Done
:: ─────────────────────────────────────────────────────────
echo.
color 0B
echo  =====================================================
echo    BUILD SUCCESSFUL!
echo  =====================================================
echo.

set "BUNDLE=src-tauri\target\release\bundle"

echo  Output files:
echo.
if exist "%BUNDLE%\nsis" (
    echo  [NSIS Installer]
    for %%F in ("%BUNDLE%\nsis\*.exe") do (
        echo    %%~nxF  ^(%%~zF bytes^)
        echo    Path: %CD%\%BUNDLE%\nsis\%%~nxF
    )
    echo.
)
if exist "%BUNDLE%\msi" (
    echo  [MSI Installer]
    for %%F in ("%BUNDLE%\msi\*.msi") do (
        echo    %%~nxF  ^(%%~zF bytes^)
        echo    Path: %CD%\%BUNDLE%\msi\%%~nxF
    )
    echo.
)

echo  Opening output folder...
if exist "%BUNDLE%\nsis" (
    explorer "%CD%\%BUNDLE%\nsis"
) else if exist "%BUNDLE%\msi" (
    explorer "%CD%\%BUNDLE%\msi"
) else (
    explorer "%CD%\src-tauri\target\release"
)

echo.
pause
