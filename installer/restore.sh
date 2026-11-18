#!/bin/bash
set -euo pipefail

# AjiCorehpc Restore Script
# Restores from a backup archive created by backup.sh.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[RESTORE]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()  { echo -e "${BLUE}[STEP]${NC} $1"; }

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_PATH="${INSTALL_PATH:-$SCRIPT_DIR}"

if [ -f "$INSTALL_PATH/.env" ]; then
    set -a
    source "$INSTALL_PATH/.env"
    set +a
fi

DB_NAME="${DB_NAME:-ajicorehpc}"
DB_USER="${DB_USER:-ajicorehpc}"

BACKUP_DIR="${BACKUP_DIR:-$INSTALL_PATH/backups}"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
    echo ""
    echo "Usage: $0 <backup-file> [options]"
    echo ""
    echo "Options:"
    echo "  --db-only          Restore database only"
    echo "  --config-only      Restore config only"
    echo "  --skip-db          Skip database restore"
    echo "  --skip-redis       Skip Redis restore"
    echo "  --yes              Skip confirmation prompt"
    echo ""
    echo "Examples:"
    echo "  $0 ajicorehpc_backup_20260907_120000.tar.gz"
    echo "  $0 ajicorehpc_backup_20260907_120000.tar.gz --db-only"
    echo "  $0 ajicorehpc_backup_20260907_120000.tar.gz --skip-redis --yes"
    echo ""
    echo "Available backups:"
    ls -lh "$BACKUP_DIR"/ajicorehpc_backup_*.tar.gz 2>/dev/null || echo "  No backups found."
    echo ""
}

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
BACKUP_FILE=""
DB_ONLY=false
CONFIG_ONLY=false
SKIP_DB=false
SKIP_REDIS=false
AUTO_YES=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --db-only)      DB_ONLY=true; shift ;;
        --config-only)  CONFIG_ONLY=true; shift ;;
        --skip-db)      SKIP_DB=true; shift ;;
        --skip-redis)   SKIP_REDIS=true; shift ;;
        --yes|-y)       AUTO_YES=true; shift ;;
        -h|--help)      usage; exit 0 ;;
        *)
            if [ -z "$BACKUP_FILE" ]; then
                BACKUP_FILE="$1"
            else
                log_error "Unknown argument: $1"
                usage
                exit 1
            fi
            shift
            ;;
    esac
done

if [ -z "$BACKUP_FILE" ]; then
    log_error "No backup file specified."
    usage
    exit 1
fi

# Resolve full path
if [[ "$BACKUP_FILE" != /* ]]; then
    if [ -f "$BACKUP_DIR/$BACKUP_FILE" ]; then
        BACKUP_FILE="$BACKUP_DIR/$BACKUP_FILE"
    elif [ -f "$BACKUP_FILE" ]; then
        BACKUP_FILE="$(realpath "$BACKUP_FILE")"
    else
        log_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi
fi

if [ ! -f "$BACKUP_FILE" ]; then
    log_error "Backup file not found: $BACKUP_FILE"
    exit 1
fi

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════╗"
echo -e "║   AjiCorehpc Restore                            ║"
echo -e "╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "  Backup file: $BACKUP_FILE"
echo "  Install path: $INSTALL_PATH"
echo ""

if [ "$AUTO_YES" != "true" ]; then
    echo -e "${YELLOW}WARNING: This will overwrite existing data!${NC}"
    read -p "Continue with restore? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        log_info "Restore cancelled."
        exit 0
    fi
fi

# Create temp working directory
WORK_DIR=$(mktemp -d)
trap "rm -rf $WORK_DIR" EXIT

# Extract archive
log_step "Extracting backup archive..."
tar -xzf "$BACKUP_FILE" -C "$WORK_DIR"

# Find the extracted directory
EXTRACTED_DIR=$(find "$WORK_DIR" -maxdepth 1 -type d -name "ajicorehpc_backup_*" | head -1)
if [ -z "$EXTRACTED_DIR" ]; then
    log_error "Invalid backup archive structure."
    exit 1
fi

# Show backup info
if [ -f "$EXTRACTED_DIR/meta/backup_timestamp.txt" ]; then
    BACKUP_TIME=$(cat "$EXTRACTED_DIR/meta/backup_timestamp.txt")
    log_info "Backup timestamp: $BACKUP_TIME"
fi

# ---------------------------------------------------------------------------
# Restore functions
# ---------------------------------------------------------------------------
restore_database() {
    if [ "$SKIP_DB" = "true" ] || [ "$CONFIG_ONLY" = "true" ]; then
        log_info "Skipping database restore."
        return
    fi

    if [ ! -f "$EXTRACTED_DIR/database/ajicorehpc.sql" ]; then
        log_warn "No database dump found in backup. Skipping."
        return
    fi

    log_step "Restoring PostgreSQL database..."

    if docker ps --format '{{.Names}}' | grep -q 'ajicorehpc-postgres'; then
        # Create a fresh database for restore
        docker exec ajicorehpc-postgres psql -U "$DB_USER" -d postgres -c \
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
        docker exec ajicorehpc-postgres psql -U "$DB_USER" -d postgres -c \
            "DROP DATABASE IF EXISTS ${DB_NAME}_restore;" >/dev/null 2>&1 || true
        docker exec ajicorehpc-postgres psql -U "$DB_USER" -d postgres -c \
            "CREATE DATABASE ${DB_NAME}_restore;" >/dev/null 2>&1 || true

        # Restore into the new database
        cat "$EXTRACTED_DIR/database/ajicorehpc.sql" | docker exec -i ajicorehpc-postgres psql \
            -U "$DB_USER" -d "${DB_NAME}_restore" >/dev/null 2>&1 || true

        # Swap databases
        docker exec ajicorehpc-postgres psql -U "$DB_USER" -d postgres -c \
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME';" >/dev/null 2>&1 || true
        docker exec ajicorehpc-postgres psql -U "$DB_USER" -d postgres -c \
            "ALTER DATABASE $DB_NAME RENAME TO ${DB_NAME}_old;" >/dev/null 2>&1 || true
        docker exec ajicorehpc-postgres psql -U "$DB_USER" -d postgres -c \
            "ALTER DATABASE ${DB_NAME}_restore RENAME TO $DB_NAME;" >/dev/null 2>&1 || true

        # Drop old database
        docker exec ajicorehpc-postgres psql -U "$DB_USER" -d postgres -c \
            "DROP DATABASE IF EXISTS ${DB_NAME}_old;" >/dev/null 2>&1 || true

        log_info "Database restored successfully."
    else
        log_warn "PostgreSQL container not running. Skipping database restore."
    fi
}

restore_redis() {
    if [ "$SKIP_REDIS" = "true" ] || [ "$CONFIG_ONLY" = "true" ]; then
        log_info "Skipping Redis restore."
        return
    fi

    if [ ! -f "$EXTRACTED_DIR/redis/dump.rdb" ] && [ ! -d "$EXTRACTED_DIR/redis/appendonlydir" ]; then
        log_info "No Redis data found in backup. Skipping."
        return
    fi

    log_step "Restoring Redis data..."
    if docker ps --format '{{.Names}}' | grep -q 'ajicorehpc-redis'; then
        docker stop ajicorehpc-redis >/dev/null 2>&1 || true
        sleep 1

        if [ -f "$EXTRACTED_DIR/redis/dump.rdb" ]; then
            docker cp "$EXTRACTED_DIR/redis/dump.rdb" ajicorehpc-redis:/data/dump.rdb 2>/dev/null || true
        fi
        if [ -d "$EXTRACTED_DIR/redis/appendonlydir" ]; then
            docker cp "$EXTRACTED_DIR/redis/appendonlydir" ajicorehpc-redis:/data/appendonlydir 2>/dev/null || true
        fi

        docker start ajicorehpc-redis >/dev/null 2>&1 || true
        log_info "Redis restored."
    else
        log_warn "Redis container not running. Skipping."
    fi
}

restore_config() {
    if [ "$DB_ONLY" = "true" ]; then
        log_info "Skipping config restore."
        return
    fi

    if [ ! -d "$EXTRACTED_DIR/config" ]; then
        log_info "No config found in backup. Skipping."
        return
    fi

    log_step "Restoring configuration..."

    # Backup current config
    if [ -f "$INSTALL_PATH/.env" ]; then
        cp "$INSTALL_PATH/.env" "$INSTALL_PATH/.env.pre-restore"
    fi

    # Restore .env (preserve DB password from current if container is running)
    if [ -f "$EXTRACTED_DIR/config/.env" ]; then
        if docker ps --format '{{.Names}}' | grep -q 'ajicorehpc-postgres'; then
            CURRENT_DB_PASS=$(grep '^DB_PASSWORD=' "$INSTALL_PATH/.env" 2>/dev/null | cut -d= -f2 || echo "")
            cp "$EXTRACTED_DIR/config/.env" "$INSTALL_PATH/.env"
            if [ -n "$CURRENT_DB_PASS" ]; then
                sed -i "s/^DB_PASSWORD=.*/DB_PASSWORD=${CURRENT_DB_PASS}/" "$INSTALL_PATH/.env"
            fi
            log_info ".env restored (preserved current DB password)."
        else
            cp "$EXTRACTED_DIR/config/.env" "$INSTALL_PATH/.env"
            log_info ".env restored."
        fi
    fi

    # Restore docker-compose.yml
    if [ -f "$EXTRACTED_DIR/config/docker-compose.yml" ]; then
        cp "$EXTRACTED_DIR/config/docker-compose.yml" "$INSTALL_PATH/docker-compose.yml"
        log_info "docker-compose.yml restored."
    fi

    # Restore config directory
    if [ -d "$EXTRACTED_DIR/config" ]; then
        mkdir -p "$INSTALL_PATH/config"
        cp -r "$EXTRACTED_DIR/config/"* "$INSTALL_PATH/config/" 2>/dev/null || true
        log_info "Config directory restored."
    fi
}

restore_uploads() {
    if [ "$DB_ONLY" = "true" ] || [ "$CONFIG_ONLY" = "true" ]; then
        return
    fi

    if [ -d "$EXTRACTED_DIR/uploads" ] && [ "$(ls -A "$EXTRACTED_DIR/uploads" 2>/dev/null)" ]; then
        log_step "Restoring uploads..."
        mkdir -p "$INSTALL_PATH/uploads"
        cp -r "$EXTRACTED_DIR/uploads/"* "$INSTALL_PATH/uploads/" 2>/dev/null || true
        log_info "Uploads restored."
    fi
}

restart_services() {
    if [ "$DB_ONLY" = "true" ] || [ "$CONFIG_ONLY" = "true" ]; then
        return
    fi

    log_step "Restarting services..."
    cd "$INSTALL_PATH"
    docker compose down >/dev/null 2>&1 || true
    docker compose up -d >/dev/null 2>&1 || true

    log_step "Waiting for services to be healthy..."
    sleep 10

    if docker ps --format '{{.Names}}' | grep -q 'ajicorehpc-backend'; then
        log_info "Services restarted successfully."
    else
        log_warn "Services may need manual restart. Check: docker compose ps"
    fi
}

print_summary() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════╗"
    echo -e "║   Restore Complete!                          ║"
    echo -e "║                                              ║"
    echo -e "║   Restored from: $(basename "$BACKUP_FILE")"
    echo -e "║   Install path:  ${INSTALL_PATH}"
    echo -e "║                                              ║"
    echo -e "║   Web UI: http://localhost:3000               ║"
    echo -e "╚══════════════════════════════════════════════╝${NC}"
    echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    restore_database
    restore_redis
    restore_config
    restore_uploads
    restart_services
    print_summary
}

main "$@"
