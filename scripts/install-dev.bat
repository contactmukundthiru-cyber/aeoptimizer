@echo off
REM Pulse for After Effects - Development Installation Script (Windows)
REM This script sets up the development environment for Pulse

echo ========================================
echo Pulse for After Effects - Dev Setup
echo ========================================
echo.

REM Get script directory
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%.."
set "CEP_DIR=%PROJECT_DIR%\cep-extension"

echo Project directory: %PROJECT_DIR%
echo.

REM CEP extensions directory
set "CEP_EXTENSIONS_DIR=%APPDATA%\Adobe\CEP\extensions"

REM Step 1: Enable debug mode for CEP
echo Step 1: Enabling CEP debug mode...
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.8" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo   Debug mode enabled for CSXS versions 8-11
echo.

REM Step 2: Create CEP extensions directory if needed
echo Step 2: Setting up CEP extensions directory...
if not exist "%CEP_EXTENSIONS_DIR%" mkdir "%CEP_EXTENSIONS_DIR%"
echo   CEP directory: %CEP_EXTENSIONS_DIR%
echo.

REM Step 3: Create symlink to extension
echo Step 3: Creating symlink to extension...
set "EXTENSION_LINK=%CEP_EXTENSIONS_DIR%\com.pulse.aeoptimizer"

if exist "%EXTENSION_LINK%" (
    echo   Removing existing link/folder...
    rmdir "%EXTENSION_LINK%" 2>nul
    del "%EXTENSION_LINK%" 2>nul
)

REM Create directory junction (works without admin in most cases)
mklink /D "%EXTENSION_LINK%" "%CEP_DIR%"
if %ERRORLEVEL% neq 0 (
    echo   Error: Failed to create symlink. Try running as Administrator.
    echo   Alternatively, copy the cep-extension folder to:
    echo   %CEP_EXTENSIONS_DIR%\com.pulse.aeoptimizer
    pause
    exit /b 1
)
echo   Symlink created successfully
echo.

REM Step 4: Install worker dependencies
echo Step 4: Installing worker dependencies...
cd /d "%PROJECT_DIR%\worker"
call npm install
if %ERRORLEVEL% neq 0 (
    echo   Error: npm install failed
    pause
    exit /b 1
)
echo   Dependencies installed
echo.

REM Step 5: Create icons directory
echo Step 5: Creating icons directory...
if not exist "%CEP_DIR%\icons" mkdir "%CEP_DIR%\icons"
echo   Note: Add your icon.png to %CEP_DIR%\icons\
echo.

echo ========================================
echo Installation Complete!
echo ========================================
echo.
echo Next steps:
echo   1. Start the worker:  cd worker ^&^& npm start
echo   2. Restart After Effects
echo   3. Open Window ^> Extensions ^> Pulse
echo.
echo If the extension doesn't appear:
echo   - Ensure After Effects is CC 2019 or later
echo   - Check that debug mode is enabled
echo   - Look for errors in the debug console
echo.
pause
