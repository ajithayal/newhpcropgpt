# ==============================================================================
# AYAL HPC - Windows Native Deployment Script (PowerShell)
# Installs backend Python virtual environment, dependencies, frontend packages,
# generates secure cryptographic configuration, runs database migrations, and creates
# one-click launcher scripts.
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$Start,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=======================================================" -ForegroundColor Blue
Write-Host "     AYAL HPC - Windows Deployer             " -ForegroundColor Blue
Write-Host "=======================================================" -ForegroundColor Blue

# ------------------------------------------------------------------------------
# 1. Environment and Tool Detection
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] Detecting Prerequisites (Python and Node.js)..." -ForegroundColor Cyan

$pythonExe = $null
if (Get-Command "py.exe" -ErrorAction SilentlyContinue) {
    try {
        $testVer = & py.exe -3.11 -V 2>&1
        if ($LASTEXITCODE -eq 0) {
            $pythonExe = "py.exe -3.11"
        }
    } catch {}
    if (-not $pythonExe) {
        $pythonExe = "py.exe"
    }
} elseif (Get-Command "python.exe" -ErrorAction SilentlyContinue) {
    $pythonExe = "python.exe"
}

if (-not $pythonExe) {
    Write-Host "[ERROR] Python was not found on PATH. Please install Python 3.11+." -ForegroundColor Red
    exit 1
}

$pyVer = & cmd /c "$pythonExe -V" 2>&1
Write-Host "[INFO] Using Python: $pyVer ($pythonExe)" -ForegroundColor Green

if (-not (Get-Command "node.exe" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not found on PATH. Please install Node.js 18+." -ForegroundColor Red
    exit 1
}

$nodeVer = & node -v
Write-Host "[INFO] Using Node.js: $nodeVer" -ForegroundColor Green

# ------------------------------------------------------------------------------
# 2. Virtual Environment Setup
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] Setting up Python virtual environment in backend\.venv..." -ForegroundColor Cyan

$venvPath = Join-Path $PSScriptRoot "backend\.venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    Write-Host "[INFO] Creating virtual environment at $venvPath..." -ForegroundColor Green
    & cmd /c "$pythonExe -m venv `"$venvPath`""
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to create virtual environment." -ForegroundColor Red
        exit 1
    }
    Write-Host "[SUCCESS] Virtual environment created." -ForegroundColor Green
} else {
    Write-Host "[INFO] Virtual environment already exists in backend\.venv." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# 3. Installing Backend Dependencies
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] Installing backend Python packages from backend\requirements.txt..." -ForegroundColor Cyan

& "$venvPython" -m pip install --upgrade pip --quiet
$reqPath = Join-Path $PSScriptRoot "backend\requirements.txt"
& "$venvPython" -m pip install -r "$reqPath"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to install Python requirements." -ForegroundColor Red
    exit 1
}
Write-Host "[SUCCESS] Backend dependencies installed successfully." -ForegroundColor Green

# ------------------------------------------------------------------------------
# 4. Environment Configuration (.env) and Launcher Generation
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] Configuring environment and launchers..." -ForegroundColor Cyan
$setupPy = Join-Path $PSScriptRoot "scripts\setup_env.py"
& "$venvPython" "$setupPy"

# ------------------------------------------------------------------------------
# 5. Database Migrations
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] Initializing database and applying Alembic migrations..." -ForegroundColor Cyan

Push-Location (Join-Path $PSScriptRoot "backend")
try {
    & "$venvPython" -m alembic upgrade head
    Write-Host "[SUCCESS] Database schema up-to-date." -ForegroundColor Green
} catch {
    Write-Host "[WARN] Alembic note: $_" -ForegroundColor Yellow
} finally {
    Pop-Location
}

# ------------------------------------------------------------------------------
# 6. Frontend Build
# ------------------------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "[STEP] Building frontend production bundle..." -ForegroundColor Cyan
    Push-Location (Join-Path $PSScriptRoot "frontend")
    try {
        Write-Host "[INFO] Running npm install..." -ForegroundColor Green
        & npm install --quiet
        Write-Host "[INFO] Running npm run build..." -ForegroundColor Green
        & npm run build
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[SUCCESS] Frontend bundle built successfully." -ForegroundColor Green
        } else {
            Write-Host "[WARN] Frontend build exited with code $LASTEXITCODE." -ForegroundColor Yellow
        }
    } finally {
        Pop-Location
    }
}

# ------------------------------------------------------------------------------
# Completion Summary
# ------------------------------------------------------------------------------
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Green
Write-Host "   AYAL HPC Deployment Completed!            " -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Green
Write-Host '  To launch the application:' -ForegroundColor White
Write-Host '    Double-click:  start.bat' -ForegroundColor Yellow
Write-Host '    Or PowerShell: .\start.ps1' -ForegroundColor Yellow
Write-Host '  Web Application: http://localhost:3000' -ForegroundColor White
Write-Host '  Backend OpenAPI: http://localhost:8000/api/docs' -ForegroundColor White
Write-Host '=======================================================' -ForegroundColor Green
Write-Host ''

if ($Start) {
    Write-Host 'Starting services now as requested...' -ForegroundColor Cyan
    $startScript = Join-Path $PSScriptRoot 'start.ps1'
    & $startScript
}
