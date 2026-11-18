@echo off
cd /d "%~dp0..\backend"
echo [INFO] Starting AYAL HPC Backend API on http://localhost:8000 ...
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
) else if exist "Scripts\python.exe" (
    "Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
) else (
    python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
)
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Backend API stopped with exit code %ERRORLEVEL%.
    pause
)
