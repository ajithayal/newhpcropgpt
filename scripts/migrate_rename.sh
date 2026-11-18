#!/usr/bin/env bash
# =============================================================================
# AjiCorehpc Manager - Idempotent Migration & Rename Script
# Migrates legacy 'ayalhpc' / 'layahpc' installations to 'ajicorehpc'.
# =============================================================================
set -euo pipefail

OLD_NAME="ayalhpc"
OLD_NAME_ALT="layahpc"
NEW_NAME="ajicorehpc"

OLD_PATH="/opt/${OLD_NAME}"
OLD_PATH_ALT="/opt/${OLD_NAME_ALT}"
NEW_PATH="/opt/${NEW_NAME}"

BACKUP_DIR="/var/backups/${NEW_NAME}-migration-$(date +%Y%m%d%H%M%S)"

echo "=== Starting Migration & Rename to ${NEW_NAME} ==="

if [[ $EUID -ne 0 ]]; then
   echo "ERROR: This script must be run as root." >&2
   exit 1
fi

mkdir -p "${BACKUP_DIR}"
echo "[1/7] Creating backup directory at ${BACKUP_DIR}..."

# 1. Stop legacy systemd services if running
echo "[2/7] Stopping legacy services..."
systemctl stop ${OLD_NAME}-backend.service 2>/dev/null || true
systemctl stop ${OLD_NAME_ALT}-backend.service 2>/dev/null || true
systemctl stop ${OLD_NAME}.target 2>/dev/null || true

# 2. Database backup & rename (if postgres is active)
echo "[3/7] Backing up and renaming PostgreSQL database..."
if command -v sudo >/dev/null && sudo -u postgres psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "${OLD_NAME}"; then
    echo "Dumping ${OLD_NAME} database..."
    sudo -u postgres pg_dump "${OLD_NAME}" > "${BACKUP_DIR}/${OLD_NAME}.sql" 2>/dev/null || true
    echo "Renaming database ${OLD_NAME} -> ${NEW_NAME}..."
    sudo -u postgres psql -c "ALTER DATABASE ${OLD_NAME} RENAME TO ${NEW_NAME};" 2>/dev/null || true
    sudo -u postgres psql -c "ALTER ROLE ${OLD_NAME} RENAME TO ${NEW_NAME};" 2>/dev/null || true
elif command -v sudo >/dev/null && sudo -u postgres psql -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "${OLD_NAME_ALT}"; then
    echo "Dumping ${OLD_NAME_ALT} database..."
    sudo -u postgres pg_dump "${OLD_NAME_ALT}" > "${BACKUP_DIR}/${OLD_NAME_ALT}.sql" 2>/dev/null || true
    echo "Renaming database ${OLD_NAME_ALT} -> ${NEW_NAME}..."
    sudo -u postgres psql -c "ALTER DATABASE ${OLD_NAME_ALT} RENAME TO ${NEW_NAME};" 2>/dev/null || true
    sudo -u postgres psql -c "ALTER ROLE ${OLD_NAME_ALT} RENAME TO ${NEW_NAME};" 2>/dev/null || true
else
    echo "No legacy PostgreSQL database found or PostgreSQL not local. Skipping DB rename."
fi

# 3. Migrate installation directory
echo "[4/7] Migrating installation directory..."
TARGET_SOURCE=""
if [[ -d "${OLD_PATH}" ]]; then
    TARGET_SOURCE="${OLD_PATH}"
elif [[ -d "${OLD_PATH_ALT}" ]]; then
    TARGET_SOURCE="${OLD_PATH_ALT}"
fi

if [[ -n "${TARGET_SOURCE}" ]] && [[ "${TARGET_SOURCE}" != "${NEW_PATH}" ]]; then
    echo "Copying ${TARGET_SOURCE} -> ${NEW_PATH}..."
    cp -a "${TARGET_SOURCE}" "${NEW_PATH}"
    echo "Migration source preserved at ${TARGET_SOURCE}. Can be removed after verification."
elif [[ -d "${NEW_PATH}" ]]; then
    echo "Destination ${NEW_PATH} already exists."
fi

# 4. Create/update system user & permissions
echo "[5/7] Configuring system user '${NEW_NAME}'..."
if ! id -u "${NEW_NAME}" >/dev/null 2>&1; then
    useradd -r -s /sbin/nologin -d "${NEW_PATH}" -M "${NEW_NAME}" 2>/dev/null || true
fi
if [[ -d "${NEW_PATH}" ]]; then
    chown -R "${NEW_NAME}:${NEW_NAME}" "${NEW_PATH}"
fi

# 5. Update systemd units and Nginx
echo "[6/7] Updating systemd units and Nginx reverse proxy..."
if [[ -f "${NEW_PATH}/deploy/ajicorehpc-backend.service" ]]; then
    cp -f "${NEW_PATH}/deploy/ajicorehpc-backend.service" /etc/systemd/system/ajicorehpc-backend.service
fi
if [[ -f "${NEW_PATH}/deploy/ajicorehpc.target" ]]; then
    cp -f "${NEW_PATH}/deploy/ajicorehpc.target" /etc/systemd/system/ajicorehpc.target
fi

# Clean up old systemd units
rm -f /etc/systemd/system/${OLD_NAME}-backend.service /etc/systemd/system/${OLD_NAME_ALT}-backend.service
rm -f /etc/systemd/system/${OLD_NAME}.target /etc/systemd/system/${OLD_NAME_ALT}.target

systemctl daemon-reload

if [[ -f "${NEW_PATH}/deploy/nginx-ajicorehpc.conf" ]]; then
    if [[ -d /etc/nginx/conf.d ]]; then
        rm -f /etc/nginx/conf.d/${OLD_NAME}.conf /etc/nginx/conf.d/${OLD_NAME_ALT}.conf
        cp -f "${NEW_PATH}/deploy/nginx-ajicorehpc.conf" /etc/nginx/conf.d/ajicorehpc.conf
        nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
    fi
fi

# 6. Start new services & verify
echo "[7/7] Starting ${NEW_NAME} services..."
systemctl enable --now ajicorehpc-backend.service 2>/dev/null || true

sleep 2
if systemctl is-active --quiet ajicorehpc-backend.service 2>/dev/null; then
    echo "SUCCESS: ajicorehpc-backend.service is active (running)."
else
    echo "NOTE: ajicorehpc-backend service status:"
    systemctl status ajicorehpc-backend.service --no-pager 2>/dev/null || true
fi

echo "=== Migration to ${NEW_NAME} Completed Successfully ==="
