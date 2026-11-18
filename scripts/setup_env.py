#!/usr/bin/env python3
"""
AjiCorehpc Manager — Automated Environment & Launcher Initializer
Initializes production/local .env configuration with cryptographically secure tokens,
configures database URLs based on host OS, and generates Windows launcher scripts.
"""

import os
import sys
import secrets
from pathlib import Path

def main():
    root = Path(__file__).resolve().parent.parent
    is_windows = os.name == "nt" or sys.platform.startswith("win")
    
    env_file = root / ".env"
    backend_env_file = root / "backend" / ".env"
    
    # 1. Generate .env if missing
    if not env_file.exists():
        sec_key = secrets.token_hex(32)
        fernet_key = secrets.token_hex(32)
        lic_key = secrets.token_hex(32)
        
        if is_windows:
            db_url = "sqlite+aiosqlite:///ajicorehpc.db"
        else:
            db_url = "postgresql+asyncpg://ajicorehpc:ajicorehpc_secret_2026@localhost:5432/ajicorehpc"
            
        content = f"""# AYAL HPC Environment Configuration
AJICOREHPC_DATABASE_URL={db_url}
DATABASE_URL={db_url}
AJICOREHPC_REDIS_URL=redis://localhost:6379/0
AJICOREHPC_SECRET_KEY={fernet_key}
SECRET_KEY={sec_key}
AJICOREHPC_LICENSE_SIGNING_SECRET={lic_key}
LICENSE_SIGNING_SECRET={lic_key}
AJICOREHPC_INSTALL_PATH={root.as_posix()}
INSTALL_PATH={root.as_posix()}
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
PROMETHEUS_URL=http://localhost:9090
"""
        env_file.write_text(content, encoding="utf-8")
        print(f"[SUCCESS] Created .env configuration at {env_file}")
    else:
        print(f"[INFO] Existing .env found at {env_file}")

    # 2. Mirror .env to backend/.env
    if env_file.exists():
        backend_env_file.write_text(env_file.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"[SUCCESS] Mirrored .env into {backend_env_file}")

    # 3. On Windows, generate start.bat and start.ps1 and sub-scripts
    if is_windows:
        scripts_dir = root / "scripts"
        scripts_dir.mkdir(parents=True, exist_ok=True)
        
        start_backend_bat = r"""@echo off
cd /d "%~dp0..\backend"
echo [INFO] Starting AYAL HPC Backend API on http://localhost:8000 ...
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
) else if exist "Scripts\python.exe" (
    "Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
) else (
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Backend API stopped with exit code %ERRORLEVEL%.
    pause
)
"""
        (scripts_dir / "start_backend.bat").write_text(start_backend_bat, encoding="ascii")

        start_frontend_bat = r"""@echo off
cd /d "%~dp0..\frontend"
echo [INFO] Starting AYAL HPC Frontend UI on http://localhost:3000 ...
call npx vite --port 3000 --host 0.0.0.0
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Frontend UI stopped with exit code %ERRORLEVEL%.
    pause
)
"""
        (scripts_dir / "start_frontend.bat").write_text(start_frontend_bat, encoding="ascii")

        start_bat = r"""@echo off
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
"""
        (root / "start.bat").write_text(start_bat, encoding="ascii")

        start_ps1 = """$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   Starting AYAL HPC Manager (Windows PowerShell)     " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$backendBat = Join-Path $PSScriptRoot "scripts\\start_backend.bat"
$frontendBat = Join-Path $PSScriptRoot "scripts\\start_frontend.bat"

Write-Host "[1/2] Launching Backend API (Port 8000)..." -ForegroundColor Green
$backendProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "`"$backendBat`"" -PassThru

Write-Host "[2/2] Launching Frontend UI (Port 3000)..." -ForegroundColor Green
$frontendProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "`"$frontendBat`"" -PassThru

Write-Host "`nWaiting for services to initialize..." -ForegroundColor Gray
Start-Sleep -Seconds 5
Start-Process "http://localhost:3000"

Write-Host "`nAYAL HPC Manager is RUNNING!" -ForegroundColor Green
Write-Host "Web UI:   http://localhost:3000" -ForegroundColor White
Write-Host "API Docs: http://localhost:8000/api/docs`n" -ForegroundColor White
Write-Host "Press Enter to stop all services..." -ForegroundColor Yellow
[Console]::ReadLine() | Out-Null

Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Services stopped." -ForegroundColor Gray
"""
        (root / "start.ps1").write_text(start_ps1, encoding="utf-8")
        print("[SUCCESS] Generated start.bat, start.ps1, and sub-launchers.")

if __name__ == "__main__":
    main()
