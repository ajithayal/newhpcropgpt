$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   Starting AYAL HPC Manager (Windows PowerShell)     " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$backendBat = Join-Path $PSScriptRoot "scripts\start_backend.bat"
$frontendBat = Join-Path $PSScriptRoot "scripts\start_frontend.bat"

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
