#!/bin/bash
set -euo pipefail

AjiCorehpc_VERSION="1.0.0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(dirname "$SCRIPT_DIR")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════╗"
    echo "║       AjiCorehpc Installer v${AjiCorehpc_VERSION}                ║"
    echo "║    HPC Cluster Management & Monitoring      ║"
    echo "╚══════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()    { echo -e "${BLUE}[STEP]${NC} $1"; }

detect_distro() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        DISTRO_ID="${ID}"
        DISTRO_VERSION="${VERSION_ID}"
    elif [ -f /etc/redhat-release ]; then
        DISTRO_ID="rhel"
        DISTRO_VERSION=$(grep -oP '[0-9]+' /etc/redhat-release | head -1)
    else
        DISTRO_ID="unknown"
        DISTRO_VERSION=""
    fi
    log_info "Detected distro: ${DISTRO_ID} ${DISTRO_VERSION}"
}

install_docker_rhel() {
    log_step "Installing Docker on ${DISTRO_ID}..."
    sudo dnf remove -y docker docker-client docker-client-latest docker-common \
        docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null || true
    sudo dnf install -y yum-utils
    sudo yum-config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
    sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable --now docker
    sudo usermod -aG docker "$USER"
    log_info "Docker installed via dnf/yum."
}

install_docker_debian() {
    log_step "Installing Docker on ${DISTRO_ID}..."
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${DISTRO_ID}/gpg" | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${DISTRO_ID} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo systemctl enable --now docker
    sudo usermod -aG docker "$USER"
    log_info "Docker installed via apt."
}

install_docker_fallback() {
    log_step "Installing Docker using convenience script..."
    curl -fsSL https://get.docker.com | sh
    sudo systemctl enable --now docker
    sudo usermod -aG docker "$USER"
    log_info "Docker installed via convenience script."
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_warn "Docker is not installed."
        read -p "Install Docker? (y/n): " install_docker
        if [[ "$install_docker" == "y" ]]; then
            detect_distro
            case "$DISTRO_ID" in
                rhel|centos|rocky|almalinux|ol|fedora)
                    install_docker_rhel ;;
                debian|ubuntu|linuxmint|pop)
                    install_docker_debian ;;
                *)
                    install_docker_fallback ;;
            esac
        else
            log_error "Docker is required. Exiting."
            exit 1
        fi
    fi
    log_info "Docker version: $(docker --version)"

    if ! docker compose version &> /dev/null; then
        log_warn "Docker Compose plugin not found. Installing..."
        COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep -oP '"tag_name": "\K(.*)(?=")')
        sudo mkdir -p /usr/local/lib/docker/cli-plugins
        sudo curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
            -o /usr/local/lib/docker/cli-plugins/docker-compose
        sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
        log_info "Docker Compose plugin installed."
    fi
    log_info "Docker and Docker Compose are ready."
}

get_install_path() {
    echo ""
    log_step "Select Install/Data Directory"
    echo "AjiCorehpc stores config, data, logs, packages, and backups here."
    echo ""
    echo "  1) /opt/ajicorehpc        (Recommended)"
    echo "  2) /home/ajicorehpc"
    echo "  3) ./ajicorehpc           (Current directory)"
    echo ""
    local default_path="/opt/ajicorehpc"
    read -p "Enter install path [${default_path}]: " custom_path
    INSTALL_PATH="${custom_path:-$default_path}"
    mkdir -p "$INSTALL_PATH" 2>/dev/null || sudo mkdir -p "$INSTALL_PATH"
    if [ ! -w "$INSTALL_PATH" ]; then
        log_warn "Directory not writable. Fixing permissions..."
        sudo chown -R "$(whoami)" "$INSTALL_PATH"
    fi
    log_info "Install path: $INSTALL_PATH"
}

generate_secrets() {
    log_step "Generating secure keys..."
    DB_PASSWORD=$(openssl rand -hex 16)
    REDIS_PASSWORD=$(openssl rand -hex 16)
    SECRET_KEY=$(openssl rand -hex 32)
    LICENSE_SIGNING_SECRET=$(openssl rand -hex 32)

    cat > "$INSTALL_PATH/.env" <<ENVEOF
# AjiCorehpc Environment Configuration
# Generated by installer on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Database
DB_PASSWORD=${DB_PASSWORD}

# Redis
REDIS_PASSWORD=${REDIS_PASSWORD}

# JWT Secret Key
SECRET_KEY=${SECRET_KEY}

# License Signing Secret
LICENSE_SIGNING_SECRET=${LICENSE_SIGNING_SECRET}

# Install path
INSTALL_PATH=${INSTALL_PATH}

# CORS origins
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Prometheus (optional)
PROMETHEUS_URL=http://prometheus:9090
ENVEOF
    chmod 600 "$INSTALL_PATH/.env"
    log_info "Secrets saved to ${INSTALL_PATH}/.env"
}

create_directories() {
    log_step "Creating directory structure..."
    mkdir -p "$INSTALL_PATH"/{config,logs,uploads,packages,postgres,redis,backups}
    log_info "Directories created."
}

copy_source() {
    log_step "Copying AjiCorehpc source to ${INSTALL_PATH}..."
    if [ ! -d "$SOURCE_DIR/backend" ]; then
        log_error "Source not found at $SOURCE_DIR/backend"
        exit 1
    fi
    cp -r "$SOURCE_DIR/backend" "$INSTALL_PATH/"
    cp -r "$SOURCE_DIR/frontend" "$INSTALL_PATH/"
    [ -d "$SOURCE_DIR/config" ] && cp -r "$SOURCE_DIR/config/"* "$INSTALL_PATH/config/" 2>/dev/null || true
    [ -f "$SOURCE_DIR/installer/backup.sh" ] && cp "$SOURCE_DIR/installer/backup.sh" "$INSTALL_PATH/" && chmod +x "$INSTALL_PATH/backup.sh"
    [ -f "$SOURCE_DIR/installer/restore.sh" ] && cp "$SOURCE_DIR/installer/restore.sh" "$INSTALL_PATH/" && chmod +x "$INSTALL_PATH/restore.sh"
    log_info "Source copied."
}

generate_compose() {
    log_step "Generating docker-compose.yml..."

    DB_PASS=$(grep '^DB_PASSWORD=' "$INSTALL_PATH/.env" | cut -d= -f2)
    REDIS_PASS=$(grep '^REDIS_PASSWORD=' "$INSTALL_PATH/.env" | cut -d= -f2)
    SEC_KEY=$(grep '^SECRET_KEY=' "$INSTALL_PATH/.env" | cut -d= -f2)
    LIC_KEY=$(grep '^LICENSE_SIGNING_SECRET=' "$INSTALL_PATH/.env" | cut -d= -f2)

    cat > "$INSTALL_PATH/docker-compose.yml" <<YAML
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: ajicorehpc-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ajicorehpc
      POSTGRES_USER: ajicorehpc
      POSTGRES_PASSWORD: ${DB_PASS}
    volumes:
      - ./postgres:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ajicorehpc"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: ajicorehpc-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass ${REDIS_PASS}
    volumes:
      - ./redis:/data
    ports:
      - "127.0.0.1:6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASS}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    container_name: ajicorehpc-backend
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql+asyncpg://ajicorehpc:${DB_PASS}@postgres:5432/ajicorehpc
      REDIS_URL: redis://:${REDIS_PASS}@redis:6379/0
      SECRET_KEY: ${SEC_KEY}
      LICENSE_SIGNING_SECRET: ${LIC_KEY}
      INSTALL_PATH: ${INSTALL_PATH}
      CORS_ORIGINS: http://localhost:3000,http://localhost:5173
      PROMETHEUS_URL: http://prometheus:9090
    volumes:
      - ./config:/app/config
      - ./logs:/app/logs
      - ./uploads:/app/uploads
      - ./packages:/app/packages
      - ./backups:/app/backups
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - "127.0.0.1:8000:8000"

  frontend:
    build: ./frontend
    container_name: ajicorehpc-frontend
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - "3000:80"

volumes:
  postgres_data:
  redis_data:
YAML
    log_info "docker-compose.yml generated."
}

deploy() {
    log_step "Building and deploying AjiCorehpc..."
    cd "$INSTALL_PATH"
    docker compose build
    docker compose up -d

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════╗"
    echo -e "║   AjiCorehpc deployed successfully!            ║"
    echo -e "║                                              ║"
    echo -e "║   Web UI:  http://localhost:3000              ║"
    echo -e "║   API:     http://localhost:8000/api/docs     ║"
    echo -e "║                                              ║"
    echo -e "║   Install path: ${INSTALL_PATH}"
    echo -e "║                                              ║"
    echo -e "║   Backup:   ${INSTALL_PATH}/backup.sh"
    echo -e "║   Restore:  ${INSTALL_PATH}/restore.sh <file>"
    echo -e "║   Stop:     cd ${INSTALL_PATH} && docker compose down"
    echo -e "║   Logs:     cd ${INSTALL_PATH} && docker compose logs -f"
    echo -e "╚══════════════════════════════════════════════╝${NC}"
    echo ""
}

usage() {
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  (no args)    Full installation"
    echo "  backup       Create a backup"
    echo "  restore FILE Restore from backup file"
    echo "  uninstall    Remove AjiCorehpc"
    echo "  status       Show service status"
    echo "  logs         Follow logs"
    echo ""
}

uninstall() {
    echo ""
    log_warn "This will stop AjiCorehpc and remove all data."
    read -p "Type 'YES' to confirm: " confirm
    if [ "$confirm" != "YES" ]; then
        log_info "Uninstall cancelled."
        return
    fi
    cd "$INSTALL_PATH" 2>/dev/null && docker compose down -v 2>/dev/null || true
    sudo rm -rf "$INSTALL_PATH"
    log_info "AjiCorehpc removed."
}

show_status() {
    cd "$INSTALL_PATH" 2>/dev/null && docker compose ps || echo "Not deployed at $INSTALL_PATH"
}

show_logs() {
    cd "$INSTALL_PATH" 2>/dev/null && docker compose logs -f || echo "Not deployed at $INSTALL_PATH"
}

case "${1:-install}" in
    install)
        print_banner
        check_docker
        get_install_path
        generate_secrets
        create_directories
        copy_source
        generate_compose
        deploy
        ;;
    backup)
        if [ -f "$INSTALL_PATH/backup.sh" ]; then
            bash "$INSTALL_PATH/backup.sh"
        elif [ -f "$SCRIPT_DIR/backup.sh" ]; then
            bash "$SCRIPT_DIR/backup.sh"
        else
            log_error "backup.sh not found"
            exit 1
        fi
        ;;
    restore)
        if [ -z "${2:-}" ]; then
            log_error "Usage: $0 restore <backup-file>"
            exit 1
        fi
        if [ -f "$INSTALL_PATH/restore.sh" ]; then
            bash "$INSTALL_PATH/restore.sh" "$2"
        elif [ -f "$SCRIPT_DIR/restore.sh" ]; then
            bash "$SCRIPT_DIR/restore.sh" "$2"
        else
            log_error "restore.sh not found"
            exit 1
        fi
        ;;
    uninstall)
        uninstall
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        log_error "Unknown command: $1"
        usage
        exit 1
        ;;
esac
