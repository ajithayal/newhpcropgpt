@echo off
setlocal
cd /d "%~dp0"
title AYAL HPC - Deployment Installer
echo =======================================================
echo    AYAL HPC - Windows Installer
echo =======================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Deployment failed with exit code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
echo.
echo Deployment finished successfully.
pause
