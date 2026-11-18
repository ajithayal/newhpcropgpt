@echo off
cd /d "%~dp0..\frontend"
echo [INFO] Starting AYAL HPC Frontend UI on http://localhost:3000 ...
call npx vite --port 3000 --host 0.0.0.0
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Frontend UI stopped with exit code %ERRORLEVEL%.
    pause
)
