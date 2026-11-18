#!/bin/bash
set -euo pipefail

# AjiCorehpc Backup Script
# Creates timestamped backups of database, config, uploads, and application data.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[BACKUP]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${BLUE}[STEP]${NC} $1"; }

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_PATH="${INSTALL_PATH:-$SCRIPT_DIR}"

# Load .env if present
if [ -f "$INSTALL_PATH/.env" ]; then
    set -a
    source "$INSTALL_PATH/.env"
    set +a
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ajicorehpc}"
DB_USER="${DB_USER:-ajicorehpc}"
DB_PASSWORD="${DB_PASSWORD:-}"

BACKUP_DIR="${BACKUP_DIR:-$INSTALL_PATH/backups}"
TIMESTAMP="$(date -u +"%Y%m%d_%H%M%S")"
BACKUP_NAME="ajicorehpc_backup_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"
ARCHIVE_NAME="${BACKUP_NAME}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed."
    exit 1
fi

if [ ! -d "$INSTALL_PATH" ]; then
    log_error "Install path not found: $INSTALL_PATH"
    exit 1
fi

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------
backup_database() {
    log_step "Backing up PostgreSQL database..."
    mkdir -p "$BACKUP_PATH/database"

    if docker ps --format '{{.Names}}' | grep -q 'ajicorehpc-postgres'; then
        docker exec ajicorehpc-postgres pg_dump -U "$DB_USER" -d "$DB_NAME" \
            --no-owner --no-acl --clean --if-exists \
            > "$BACKUP_PATH/database/ajicorehpc.sql" 2>/dev/null
        log_info "Database dump saved ($(wc -c < "$BACKUP_PATH/database/ajicorehpc.sql") bytes)"
    else
        log_warn "PostgreSQL container not running. Skipping database backup."
        echo "-- Database backup skipped: container not running" > "$BACKUP_PATH/database/ajicorehpc.sql"
    fi
}

backup_redis() {
    log_step "Backing up Redis data..."
    mkdir -p "$BACKUP_PATH/redis"

    if docker ps --format '{{.Names}}' | grep -q 'ajicorehpc-redis'; then
        docker exec ajicorehpc-redis redis-cli -a "${REDIS_PASSWORD:-}" BGSAVE >/dev/null 2>&1 || true
        sleep 2
        docker cp ajicorehpc-redis:/data/dump.rdb "$BACKUP_PATH/redis/dump.rdb" 2>/dev/null || true
        docker cp ajicorehpc-redis:/data/appendonlydir "$BACKUP_PATH/redis/appendonlydir" 2>/dev/null || true
        log_info "Redis data saved."
    else
        log_warn "Redis container not running. Skipping."
    fi
}

backup_config() {
    log_step "Backing up configuration..."
    mkdir -p "$BACKUP_PATH/config"

    [ -f "$INSTALL_PATH/.env" ] && cp "$INSTALL_PATH/.env" "$BACKUP_PATH/config/"
    [ -f "$INSTALL_PATH/docker-compose.yml" ] && cp "$INSTALL_PATH/docker-compose.yml" "$BACKUP_PATH/config/"
    [ -d "$INSTALL_PATH/config" ] && cp -r "$INSTALL_PATH/config/"* "$BACKUP_PATH/config/" 2>/dev/null || true

    log_info "Configuration files saved."
}

backup_uploads() {
    log_step "Backing up uploads..."
    if [ -d "$INSTALL_PATH/uploads" ] && [ "$(ls -A "$INSTALL_PATH/uploads" 2>/dev/null)" ]; then
        cp -r "$INSTALL_PATH/uploads" "$BACKUP_PATH/uploads"
        log_info "Uploads saved."
    else
        log_info "No uploads to backup."
    fi
}

backup_logs() {
    log_step "Backing up recent logs..."
    mkdir -p "$BACKUP_PATH/logs"
    if [ -d "$INSTALL_PATH/logs" ]; then
        find "$INSTALL_PATH/logs" -name "*.log" -mtime -7 -exec cp {} "$BACKUP_PATH/logs/" \; 2>/dev/null || true
        log_info "Recent logs saved."
    fi
}

backup_container_info() {
    log_step "Saving container information..."
    mkdir -p "$BACKUP_PATH/meta"
    docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' > "$BACKUP_PATH/meta/containers.txt" 2>/dev/null || true
    docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}' > "$BACKUP_PATH/meta/images.txt" 2>/dev/null || true
    echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > "$BACKUP_PATH/meta/backup_timestamp.txt"
    echo "$AjiCorehpc_VERSION" > "$BACKUP_PATH/meta/version.txt" 2>/dev/null || true
    log_info "Container info saved."
}

create_archive() {
    log_step "Creating backup archive..."
    cd "$BACKUP_DIR"
    tar -czf "$ARCHIVE_NAME" "$BACKUP_NAME"
    rm -rf "$BACKUP_PATH"
    ARCHIVE_SIZE=$(du -h "$ARCHIVE_PATH" | cut -f1)
    log_info "Archive created: $ARCHIVE_PATH ($ARCHIVE_SIZE)"
}

cleanup_old_backups() {
    log_step "Cleaning up backups older than ${RETENTION_DAYS} days..."
    DELETED=$(find "$BACKUP_DIR" -name "ajicorehpc_backup_*.tar.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
    log_info "Removed $DELETED old backup(s)."
}

print_summary() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════╗"
    echo -e "║   Backup Complete!                           ║"
    echo -e "║                                              ║"
    echo -e "║   File: ${ARCHIVE_PATH}"
    echo -e "║   Size: ${ARCHIVE_SIZE}"
    echo -e "║                                              ║"
    echo -e "║   Restore: ./restore.sh ${ARCHIVE_NAME}"
    echo -e "╚══════════════════════════════════════════════╝${NC}"
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════╗"
    echo -e "║   AjiCorehpc Backup                             ║"
    echo -e "║   $(date -u +"%Y-%m-%d %H:%M:%S UTC")                    ║"
    echo -e "╚══════════════════════════════════════════════╝${NC}"
    echo ""

    backup_database
    backup_redis
    backup_config
    backup_uploads
    backup_logs
    backup_container_info
    create_archive
    cleanup_old_backups
    print_summary
}

main "$@"
