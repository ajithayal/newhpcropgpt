#!/usr/bin/env bash
# ==============================================================================
# AjiCorehpc Manager — Unified Production & Local Installer
# Supports automatic OS detection for Linux (AlmaLinux, Rocky, RHEL, Ubuntu, Debian)
# and Windows (Git Bash, MSYS2, Cygwin, WSL).
# ==============================================================================

set -eo pipefail

# ------------------------------------------------------------------------------
# Color Definitions
# ------------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
log_step()    { echo -e "${CYAN}${BOLD}[STEP]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_success() { echo -e "${GREEN}${BOLD}[SUCCESS]${NC} $1"; }

# ------------------------------------------------------------------------------
# Banner
# ------------------------------------------------------------------------------
print_banner() {
    echo -e "${BLUE}${BOLD}"
    cat << "EOF"
    ___       _ _   ____                  _                  
   /   |     (_) | / ___|___  _ __ ___   | |__  _ __   ___  
  / /| |     | | | |   / _ \| '__/ _ \  | '_ \| '_ \ / __| 
 / ___ \     | | | |__| (_) | | |  __/  | | | | |_) | (__  
/_/   \_\   _/ |_|  \____\___/|_|  \___|  |_| |_| .__/ \___| 
          |__/                                  |_|        
             AjiCorehpc Manager — Cluster Deployer
EOF
    echo -e "${NC}"
}

# ------------------------------------------------------------------------------
# Identify Script Directory
# ------------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -W 2>/dev/null || cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ------------------------------------------------------------------------------
# Operating System Detection
# ------------------------------------------------------------------------------
detect_os() {
    OS_UNAME="$(uname -s 2>/dev/null || echo "Unknown")"
    IS_WINDOWS=false
    IS_LINUX=false
    IS_WSL=false

    case "$OS_UNAME" in
        Linux*)
            if grep -qi microsoft /proc/version 2>/dev/null; then
                IS_WSL=true
                IS_LINUX=true
                OS_TYPE="Linux (WSL)"
            else
                IS_LINUX=true
                OS_TYPE="Linux (Native)"
            fi
            ;;
        CYGWIN*|MINGW*|MSYS*)
            IS_WINDOWS=true
            OS_TYPE="Windows ($OS_UNAME)"
            ;;
        *)
            if [ -n "${COMSPEC:-}" ] || [ -n "${SYSTEMROOT:-}" ]; then
                IS_WINDOWS=true
                OS_TYPE="Windows"
            else
                OS_TYPE="Unknown ($OS_UNAME)"
            fi
            ;;
    esac

    log_info "Detected Host Platform: ${BOLD}${OS_TYPE}${NC}"
}

# ------------------------------------------------------------------------------
# Secret Generator (Python or OpenSSL fallback)
# ------------------------------------------------------------------------------
generate_secret() {
    if command -v python3 &>/dev/null; then
        python3 -c "import secrets; print(secrets.token_hex(32))"
    elif command -v py &>/dev/null; then
        py -c "import secrets; print(secrets.token_hex(32))"
    elif command -v python &>/dev/null; then
        python -c "import secrets; print(secrets.token_hex(32))"
    elif command -v openssl &>/dev/null; then
        openssl rand -hex 32
    else
        echo "ajicorehpc-$(date +%s%N)-$RANDOM" | sha256sum | head -c 64
    fi
}

# ------------------------------------------------------------------------------
# Windows Deployment Implementation
# ------------------------------------------------------------------------------
deploy_windows() {
    log_step "Starting Windows Environment Deployment for AYAL HPC..."

    # 1. Locate Python 3.10+
    PYTHON_CMD=""
    if command -v py &>/dev/null && py -3.11 -V &>/dev/null; then
        PYTHON_CMD="py -3.11"
    elif command -v py &>/dev/null; then
        PYTHON_CMD="py"
    elif command -v python3 &>/dev/null; then
        PYTHON_CMD="python3"
    elif command -v python &>/dev/null; then
        PYTHON_CMD="python"
    fi

    if [ -z "$PYTHON_CMD" ]; then
        log_error "Python was not found on PATH. Please install Python 3.11+ from https://www.python.org/downloads/."
        exit 1
    fi
    PY_VER=$($PYTHON_CMD -V 2>&1)
    log_info "Using Python: $PY_VER ($PYTHON_CMD)"

    # 2. Locate Node.js & npm
    if ! command -v node &>/dev/null; then
        log_error "Node.js is not found on PATH. Please install Node.js 18+ from https://nodejs.org/."
        exit 1
    fi
    if ! command -v npm &>/dev/null; then
        log_error "npm is not found on PATH."
        exit 1
    fi
    log_info "Using Node.js: $(node -v) | npm: $(npm -v)"

    # 3. Setup Python Virtual Environment
    VENV_DIR="backend/.venv"
    if [ ! -d "$VENV_DIR" ]; then
        log_step "Creating Python virtual environment in $VENV_DIR..."
        $PYTHON_CMD -m venv "$VENV_DIR"
    else
        log_info "Virtual environment already exists in $VENV_DIR."
    fi

    # Activate Virtual Environment
    if [ -f "$VENV_DIR/Scripts/activate" ]; then
        # shellcheck disable=SC1091
        source "$VENV_DIR/Scripts/activate"
        VENV_PY="$VENV_DIR/Scripts/python.exe"
    elif [ -f "$VENV_DIR/bin/activate" ]; then
        # shellcheck disable=SC1091
        source "$VENV_DIR/bin/activate"
        VENV_PY="$VENV_DIR/bin/python"
    else
        VENV_PY="$PYTHON_CMD"
    fi

    # 4. Install Python Dependencies
    log_step "Installing backend Python packages from backend/requirements.txt..."
    "$VENV_PY" -m pip install --upgrade pip --quiet
    "$VENV_PY" -m pip install -r backend/requirements.txt

    # 5. Setup Environment Configuration (.env)
    if [ ! -f ".env" ]; then
        log_step "Generating production .env configuration..."
        SEC_KEY=$(generate_secret)
        FERNET_KEY=$(generate_secret)
        LIC_KEY=$(generate_secret)

        cat << EOF > .env
# AYAL HPC Environment Configuration
AJICOREHPC_DATABASE_URL=sqlite+aiosqlite:///ajicorehpc.db
DATABASE_URL=sqlite+aiosqlite:///ajicorehpc.db
AJICOREHPC_REDIS_URL=redis://localhost:6379/0
AJICOREHPC_SECRET_KEY=${FERNET_KEY}
SECRET_KEY=${SEC_KEY}
AJICOREHPC_LICENSE_SIGNING_SECRET=${LIC_KEY}
LICENSE_SIGNING_SECRET=${LIC_KEY}
AJICOREHPC_INSTALL_PATH=${SCRIPT_DIR}
INSTALL_PATH=${SCRIPT_DIR}
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
PROMETHEUS_URL=http://localhost:9090
EOF
        log_success ".env created with generated cryptographic secrets."
    else
        log_info "Existing .env found. Keeping current settings."
    fi

    # Also mirror .env into backend/ for local development execution
    cp -f .env backend/.env 2>/dev/null || true

    # 6. Apply Database Migrations
    log_step "Initializing database and running migrations..."
    (
        cd backend
        "$VENV_PY" -m alembic upgrade head || true
    )

    # 7. Install Frontend Packages & Build Production Bundle
    log_step "Installing frontend dependencies..."
    (
        cd frontend
        npm install --quiet
        log_step "Building frontend production bundle..."
        npm run build
    )

    # 8. Create Windows Launcher Scripts
    log_step "Creating Windows launcher scripts (start.bat & start.ps1)..."

    cat << "EOF" > start.bat
@echo off
setlocal
cd /d "%~dp0"
title AYAL HPC Manager - Services
echo =======================================================
echo    Starting AYAL HPC Manager (Windows)
echo =======================================================
echo.

if exist "backend\.venv\Scripts\python.exe" (
    set "PY_EXE=backend\.venv\Scripts\python.exe"
) else (
    set "PY_EXE=python"
)

echo [1/2] Starting Backend API on http://localhost:8000...
start "AYAL HPC Backend API" cmd /k "cd backend && ..\%PY_EXE% -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

echo [2/2] Starting Frontend UI on http://localhost:3000...
start "AYAL HPC Frontend UI" cmd /k "cd frontend && npx vite --port 3000 --host 0.0.0.0"

timeout /t 3 >nul
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
echo Done.
EOF

    cat << "EOF" > start.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "   Starting AYAL HPC Manager (Windows PowerShell)     " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

$pyPath = Join-Path $PSScriptRoot "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $pyPath)) {
    $pyPath = "python"
}

Write-Host "[1/2] Launching Backend API (Port 8000)..." -ForegroundColor Green
$backendProc = Start-Process -FilePath cmd.exe -ArgumentList "/k `"cd /d `"$PSScriptRoot\backend`" && `"$pyPath`" -m uvicorn app.main:app --host 0.0.0.0 --port 8000`"" -PassThru

Write-Host "[2/2] Launching Frontend UI (Port 3000)..." -ForegroundColor Green
$frontendProc = Start-Process -FilePath cmd.exe -ArgumentList "/k `"cd /d `"$PSScriptRoot\frontend`" && npx vite --port 3000 --host 0.0.0.0`"" -PassThru

Start-Sleep -Seconds 3
Start-Process "http://localhost:3000"

Write-Host "`nAYAL HPC Manager is RUNNING!" -ForegroundColor Green
Write-Host "Web UI:   http://localhost:3000" -ForegroundColor White
Write-Host "API Docs: http://localhost:8000/api/docs`n" -ForegroundColor White
Write-Host "Press Enter to stop all services..." -ForegroundColor Yellow
[Console]::ReadLine() | Out-Null

Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $frontendProc.Id -Force -ErrorAction SilentlyContinue
Write-Host "Services stopped." -ForegroundColor Gray
EOF

    log_success "Windows deployment complete!"
    echo ""
    echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}   AjiCorehpc Manager — Deployment Successful! (Windows)        ${NC}"
    echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════════${NC}"
    echo -e "  To start the application at any time, execute:"
    echo -e "    ${CYAN}${BOLD}./start.bat${NC}   (or double-click start.bat in Explorer)"
    echo -e "    ${CYAN}${BOLD}./start.ps1${NC}   (PowerShell)"
    echo ""
    echo -e "  Web Application:   ${BOLD}http://localhost:3000${NC}"
    echo -e "  Backend OpenAPI:   ${BOLD}http://localhost:8000/api/docs${NC}"
    echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# ------------------------------------------------------------------------------
# Linux Deployment Implementation
# ------------------------------------------------------------------------------
deploy_linux() {
    log_step "Starting Linux Production Deployment for AYAL HPC..."

    # 1. Distro Detection
    DISTRO_ID=""
    DISTRO_VER=""
    if [ -f /etc/os-release ]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        DISTRO_ID="${ID:-linux}"
        DISTRO_VER="${VERSION_ID:-}"
    fi
    log_info "Operating System: $DISTRO_ID $DISTRO_VER"

    # 2. Check Privileges
    IS_ROOT=false
    if [ "$(id -u)" -eq 0 ]; then
        IS_ROOT=true
    fi

    # 3. System Hardware Verification
    TOTAL_MEM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo "4096")
    if [ "$TOTAL_MEM_MB" -lt 1800 ]; then
        log_warn "System memory is low (${TOTAL_MEM_MB}MB). At least 2048MB is recommended for HPC cluster control."
    fi

    # 4. Install Missing Package Dependencies
    log_step "Checking and installing required Linux runtime packages..."
    case "$DISTRO_ID" in
        almalinux|rocky|rhel|centos|fedora|ol)
            if [ "$IS_ROOT" = true ]; then
                dnf install -y python3.11 python3.11-pip python3.11-devel nodejs npm nginx git curl \
                    openssl gcc openldap-devel cyrus-sasl-devel 2>/dev/null || \
                dnf install -y python3 python3-pip python3-devel nodejs npm nginx git curl gcc || true
            else
                log_warn "Running without root privileges; assuming system packages (python3, node, nginx) are already installed."
            fi
            ;;
        ubuntu|debian)
            if [ "$IS_ROOT" = true ]; then
                apt-get update -y
                apt-get install -y python3.11 python3.11-venv python3.11-dev nodejs npm nginx git curl \
                    libldap2-dev libsasl2-dev gcc build-essential 2>/dev/null || \
                apt-get install -y python3 python3-venv python3-dev nodejs npm nginx git curl gcc || true
            else
                log_warn "Running without root privileges; assuming system packages are already installed."
            fi
            ;;
        *)
            log_warn "Generic Linux detected. Ensuring python3, node, and npm are available..."
            ;;
    esac

    # 5. Detect Python executable
    PYTHON_CMD=""
    for cmd in python3.11 python3 python; do
        if command -v "$cmd" &>/dev/null; then
            PYTHON_CMD="$cmd"
            break
        fi
    done

    if [ -z "$PYTHON_CMD" ]; then
        log_error "Python 3 is required but not installed."
        exit 1
    fi
    log_info "Using Python: $($PYTHON_CMD -V)"

    # 6. Setup Python Virtual Environment
    VENV_DIR="$SCRIPT_DIR/backend/.venv"
    if [ ! -d "$VENV_DIR" ]; then
        log_step "Creating Python virtual environment in $VENV_DIR..."
        $PYTHON_CMD -m venv "$VENV_DIR"
    fi

    # shellcheck disable=SC1091
    source "$VENV_DIR/bin/activate"
    pip install --upgrade pip --quiet
    log_step "Installing Python requirements..."
    pip install -r "$SCRIPT_DIR/backend/requirements.txt"

    # 7. Frontend Dependencies and Build
    log_step "Building frontend application..."
    (
        cd "$SCRIPT_DIR/frontend"
        npm install --quiet
        npm run build
    )

    # 8. Setup Environment Configuration (.env)
    if [ ! -f "$SCRIPT_DIR/.env" ]; then
        log_step "Generating production .env configuration..."
        SEC_KEY=$(generate_secret)
        FERNET_KEY=$(generate_secret)
        LIC_KEY=$(generate_secret)

        cat << EOF > "$SCRIPT_DIR/.env"
# AYAL HPC Environment Configuration
AJICOREHPC_DATABASE_URL=postgresql+asyncpg://ajicorehpc:ajicorehpc_secret_2026@localhost:5432/ajicorehpc
DATABASE_URL=postgresql+asyncpg://ajicorehpc:ajicorehpc_secret_2026@localhost:5432/ajicorehpc
AJICOREHPC_REDIS_URL=redis://localhost:6379/0
AJICOREHPC_SECRET_KEY=${FERNET_KEY}
SECRET_KEY=${SEC_KEY}
AJICOREHPC_LICENSE_SIGNING_SECRET=${LIC_KEY}
LICENSE_SIGNING_SECRET=${LIC_KEY}
AJICOREHPC_INSTALL_PATH=${SCRIPT_DIR}
INSTALL_PATH=${SCRIPT_DIR}
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
PROMETHEUS_URL=http://localhost:9090
EOF
        log_success ".env created with secure cryptographic tokens."
    fi

    cp -f "$SCRIPT_DIR/.env" "$SCRIPT_DIR/backend/.env" 2>/dev/null || true

    # 9. Database Migrations
    log_step "Running Alembic database migrations..."
    (
        cd "$SCRIPT_DIR/backend"
        alembic upgrade head || true
    )

    # 10. Systemd Integration (if running as root on systemd Linux)
    if [ "$IS_ROOT" = true ] && [ -d /etc/systemd/system ]; then
        log_step "Configuring systemd service units..."

        # Create unprivileged service user if not present
        id -u ajicorehpc &>/dev/null || useradd -r -s /sbin/nologin -d "$SCRIPT_DIR" ajicorehpc || true

        # Install backend service unit
        sed -e "s|/opt/ajicorehpc|${SCRIPT_DIR}|g" "$SCRIPT_DIR/deploy/ajicorehpc-backend.service" \
            > /etc/systemd/system/ajicorehpc-backend.service 2>/dev/null || true

        cp -f "$SCRIPT_DIR/deploy/ajicorehpc.target" /etc/systemd/system/ajicorehpc.target 2>/dev/null || true

        # Configure Nginx Reverse Proxy
        if [ -d /etc/nginx/conf.d ]; then
            sed -e "s|/opt/ajicorehpc|${SCRIPT_DIR}|g" "$SCRIPT_DIR/deploy/nginx-ajicorehpc.conf" \
                > /etc/nginx/conf.d/ajicorehpc.conf 2>/dev/null || true
        elif [ -d /etc/nginx/sites-available ]; then
            sed -e "s|/opt/ajicorehpc|${SCRIPT_DIR}|g" "$SCRIPT_DIR/deploy/nginx-ajicorehpc.conf" \
                > /etc/nginx/sites-available/ajicorehpc.conf 2>/dev/null || true
            ln -sf /etc/nginx/sites-available/ajicorehpc.conf /etc/nginx/sites-enabled/ 2>/dev/null || true
        fi

        systemctl daemon-reload 2>/dev/null || true
        systemctl enable ajicorehpc.target 2>/dev/null || true
        systemctl enable ajicorehpc-backend 2>/dev/null || true
        systemctl restart nginx 2>/dev/null || true
        log_success "Systemd daemons and Nginx reverse proxy registered."
    fi

    # 11. Create Linux Control Script (ajicorehpc.sh)
    cat << "EOF" > "$SCRIPT_DIR/ajicorehpc.sh"
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-start}" in
    start)
        echo "Starting AYAL HPC Manager daemons..."
        if command -v systemctl &>/dev/null && [ "$(id -u)" -eq 0 ]; then
            systemctl start ajicorehpc.target
        else
            source "$SCRIPT_DIR/backend/.venv/bin/activate"
            nohup python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 > "$SCRIPT_DIR/backend.log" 2>&1 &
            echo $! > "$SCRIPT_DIR/backend.pid"
            echo "Started backend (PID $(cat "$SCRIPT_DIR/backend.pid")). Logs: $SCRIPT_DIR/backend.log"
        fi
        ;;
    stop)
        echo "Stopping AYAL HPC Manager..."
        if command -v systemctl &>/dev/null && [ "$(id -u)" -eq 0 ]; then
            systemctl stop ajicorehpc.target
        else
            [ -f "$SCRIPT_DIR/backend.pid" ] && kill "$(cat "$SCRIPT_DIR/backend.pid")" 2>/dev/null && rm -f "$SCRIPT_DIR/backend.pid"
            echo "Stopped."
        fi
        ;;
    status)
        if command -v systemctl &>/dev/null && [ "$(id -u)" -eq 0 ]; then
            systemctl status ajicorehpc.target
        else
            if [ -f "$SCRIPT_DIR/backend.pid" ] && ps -p "$(cat "$SCRIPT_DIR/backend.pid")" > /dev/null; then
                echo "AYAL HPC Backend is RUNNING (PID $(cat "$SCRIPT_DIR/backend.pid"))."
            else
                echo "AYAL HPC Backend is STOPPED."
            fi
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|status}"
        ;;
esac
EOF
    chmod +x "$SCRIPT_DIR/ajicorehpc.sh"

    log_success "Linux deployment complete!"
    echo ""
    echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}${BOLD}   AjiCorehpc Manager — Deployment Successful! (Linux)          ${NC}"
    echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════════${NC}"
    echo -e "  Web Application:   ${BOLD}http://localhost:3000${NC} (or port 80 if Nginx active)"
    echo -e "  Backend OpenAPI:   ${BOLD}http://localhost:8000/api/docs${NC}"
    echo -e "  Daemon Control:    ${CYAN}${BOLD}./ajicorehpc.sh {start|stop|status}${NC}"
    if [ "$IS_ROOT" = true ]; then
        echo -e "  Systemd Target:    ${CYAN}${BOLD}systemctl status ajicorehpc.target${NC}"
        echo -e "  Backend Logs:      ${CYAN}${BOLD}journalctl -u ajicorehpc-backend -f${NC}"
    fi
    echo -e "${GREEN}${BOLD}═════════════════════════════════════════════════════════════════${NC}"
    echo ""
}

# ------------------------------------------------------------------------------
# Main Dispatcher
# ------------------------------------------------------------------------------
main() {
    print_banner
    detect_os

    if [ "$IS_WINDOWS" = true ]; then
        deploy_windows
    else
        deploy_linux
    fi
}

main "$@"
