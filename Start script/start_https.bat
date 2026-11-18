@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title AYAL HPC Platform - HTTPS 443 Service
echo ===============================================================
echo     AYAL HPC Management Platform (HTTPS Port 443)
echo ===============================================================
echo.

:: Detect primary active IPv4 IP address
set SYSTEM_IP=192.9.56.129
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address" ^| findstr /v "172.28 169.254"') do (
    set "RAW_IP=%%a"
    set "SYSTEM_IP=!RAW_IP: =!"
    goto :ip_found
)
:ip_found
echo Detected System IP: %SYSTEM_IP%
echo.

:: Ensure SSL certificates are present
if not exist "certs\server.crt" (
    echo [INFO] Generating SSL Certificates for %SYSTEM_IP%...
    backend\.venv\Scripts\python.exe scripts\generate_ssl_certs.py
)

:: 1. Start Backend API on port 8000
echo [1/2] Starting AYAL HPC Backend on http://127.0.0.1:8000...
start "AYAL HPC Backend API" cmd /k "cd backend && ..\backend\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000"

:: Wait for backend to be ready
timeout /t 3 >nul

:: 2. Start HTTPS Gateway on port 443
echo [2/2] Starting AYAL HPC HTTPS Gateway on port 443...
start "AYAL HPC HTTPS 443 Gateway" cmd /k "backend\.venv\Scripts\python.exe scripts\https_gateway.py"

:: Wait for gateway to initialize
timeout /t 3 >nul

echo.
echo ===============================================================
echo   AYAL HPC Platform is RUNNING on Port 443!
echo.
echo   System IP HTTPS URL: https://%SYSTEM_IP%/
echo   Localhost HTTPS URL: https://localhost/
echo   Backend REST API:    http://127.0.0.1:8000/api/docs
echo ===============================================================
echo.
echo Launching default web browser to https://%SYSTEM_IP%/ ...
start https://%SYSTEM_IP%/

echo.
echo Press any key to stop all AYAL HPC services...
pause >nul

taskkill /FI "WINDOWTITLE eq AYAL HPC HTTPS 443 Gateway*" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq AYAL HPC Backend API*" /F >nul 2>&1
echo Services stopped successfully.
