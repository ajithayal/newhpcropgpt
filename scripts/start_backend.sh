#!/usr/bin/env bash
# AYAL HPC Manager — Backend Starter (Linux)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR/backend"

echo "[INFO] Starting AYAL HPC Backend API on http://0.0.0.0:8000 ..."

PYTHON_BIN="python3"
if [ -f ".venv/bin/python" ]; then
    PYTHON_BIN=".venv/bin/python"
elif [ -f "venv/bin/python" ]; then
    PYTHON_BIN="venv/bin/python"
fi

exec $PYTHON_BIN -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
