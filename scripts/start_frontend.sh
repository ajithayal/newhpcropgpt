#!/usr/bin/env bash
# AYAL HPC Manager — Frontend Starter (Linux)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR/frontend"

echo "[INFO] Starting AYAL HPC Frontend UI on http://0.0.0.0:3000 ..."

if [ -d "dist" ] && command -v npx >/dev/null 2>&1; then
    exec npx vite preview --port 3000 --host 0.0.0.0
elif command -v npm >/dev/null 2>&1; then
    exec npm run dev -- --port 3000 --host 0.0.0.0
else
    echo "[ERROR] Neither dist nor npm found to start frontend."
    exit 1
fi
