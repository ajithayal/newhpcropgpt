#!/usr/bin/env bash
# ==============================================================================
# AYAL HPC Manager — Production & Development Service Launcher
# Starts Backend API (Uvicorn) and Frontend UI / Web Gateway
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================="
echo "   Starting AYAL HPC Manager (Linux)"
echo "======================================================="
echo ""

# 1. Environment check
if [ -f "$SCRIPT_DIR/.env" ]; then
    echo "[INFO] Loading configuration from .env..."
    set -a
    [ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env"
    set +a
fi

BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# 2. Check Python Virtualenv
PYTHON_BIN="python3"
if [ -f "$BACKEND_DIR/.venv/bin/python" ]; then
    PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
elif [ -f "$BACKEND_DIR/venv/bin/python" ]; then
    PYTHON_BIN="$BACKEND_DIR/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
fi

echo "[1/2] Starting Backend API on http://0.0.0.0:8000..."
cd "$BACKEND_DIR"
$PYTHON_BIN -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "[INFO] Backend API active (PID: $BACKEND_PID)"

# 3. Start Frontend
echo "[2/2] Starting Frontend UI on http://0.0.0.0:3000..."
cd "$FRONTEND_DIR"
FRONTEND_PID=""

if [ -d "$FRONTEND_DIR/dist" ] && command -v npx >/dev/null 2>&1; then
    npx vite preview --port 3000 --host 0.0.0.0 &
    FRONTEND_PID=$!
    echo "[INFO] Production build preview active (PID: $FRONTEND_PID)"
elif command -v npm >/dev/null 2>&1; then
    npm run dev -- --port 3000 --host 0.0.0.0 &
    FRONTEND_PID=$!
    echo "[INFO] Development server active (PID: $FRONTEND_PID)"
elif [ -d "$FRONTEND_DIR/dist" ] && command -v python3 >/dev/null 2>&1; then
    python3 -m http.server 3000 --directory "$FRONTEND_DIR/dist" &
    FRONTEND_PID=$!
    echo "[INFO] Static server active (PID: $FRONTEND_PID)"
else
    echo "[WARN] Node.js/npm not found. Please ensure Nginx or Node is running to serve the frontend."
fi

cleanup() {
    echo ""
    echo "[INFO] Stopping AYAL HPC services..."
    [ -n "$BACKEND_PID" ] && kill -TERM "$BACKEND_PID" 2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && kill -TERM "$FRONTEND_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "[INFO] Services stopped cleanly."
}
trap cleanup SIGINT SIGTERM EXIT

echo ""
echo "======================================================="
echo "   AYAL HPC is RUNNING!"
echo "   Web UI:   http://localhost:3000"
echo "   API Docs: http://localhost:8000/api/docs"
echo "======================================================="
echo "Press Ctrl+C to stop all AYAL HPC services..."

wait
