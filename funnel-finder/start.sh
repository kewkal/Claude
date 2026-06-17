#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing Python dependencies..."
pip install -r "$ROOT/requirements.txt" -q

echo "==> Installing Playwright browsers..."
playwright install chromium --with-deps -q 2>/dev/null || playwright install chromium -q

echo "==> Starting backend on http://localhost:8000 ..."
cd "$ROOT"
PYTHONPATH="$ROOT" uvicorn backend.main:app --reload --port 8000 &
BACKEND_PID=$!

echo "==> Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install -q

echo "==> Starting frontend on http://localhost:5173 ..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Winning Funnel Finder is running!"
echo "  Open: http://localhost:5173"
echo ""
echo "  Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
