@echo off
setlocal
cd /d "%~dp0"
title AYAL HPC Manager - Services
echo =======================================================
echo    Starting AYAL HPC Manager (Windows)
echo =======================================================
echo.

:: 1. Self-healing pre-flight check: Virtual environment
if not exist "%~dp0backend\.venv\Scripts\python.exe" (
    echo [INFO] Backend virtual environment not detected in backend\.venv.
    echo [INFO] Running one-time deployment installer first...
    call "%~dp0deploy.bat"
    if not exist "%~dp0backend\.venv\Scripts\python.exe" (
        echo [ERROR] Deployment failed or incomplete.
        pause
        exit /b 1
    )
)

:: 2. Self-healing pre-flight check: Frontend dependencies
if not exist "%~dp0frontend\node_modules\" (
    echo [INFO] Frontend packages not detected. Installing dependencies...
    cd /d "%~dp0frontend"
    call npm install
    cd /d "%~dp0"
)

echo [1/2] Starting Backend API on http://localhost:8000...
start "AYAL HPC Backend API" cmd /k ""%~dp0scripts\start_backend.bat""

echo [2/2] Starting Frontend UI on http://localhost:3000...
start "AYAL HPC Frontend UI" cmd /k ""%~dp0scripts\start_frontend.bat""

echo.
echo Waiting for services to initialize...
timeout /t 5 >nul

echo.
echo Launching Web Browser at http://localhost:3000...
start http://localhost:3000

echo.
echo =======================================================
echo   AYAL HPC Manager is RUNNING!
echo   Web UI:   http://localhost:3000
echo   API Docs: http://localhost:8000/api/docs
echo =======================================================
echo Press any key to stop all AYAL HPC server windows...
pause >nul
taskkill /FI "WINDOWTITLE eq AYAL HPC Backend API*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq AYAL HPC Frontend UI*" /F >nul 2>&1
taskkill /IM node.exe /F >nul 2>&1
echo Done.
