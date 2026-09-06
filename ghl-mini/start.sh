#!/usr/bin/env bash
# Boot ghl-mini. Creates .env on first run.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "First run — creating .env"
  cp .env.example .env
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|^GHL_SECRET=.*|GHL_SECRET=$SECRET|" .env
  else
    sed -i "s|^GHL_SECRET=.*|GHL_SECRET=$SECRET|" .env
  fi
  echo ""
  echo "  Your settings file is here:"
  echo ""
  echo "      $(pwd)/.env"
  echo ""
  echo "  It starts with a dot, so Finder and Explorer hide it by default."
  echo "  Open it with whichever of these works on your machine:"
  echo ""
  echo "      open -e .env      # Mac"
  echo "      notepad .env      # Windows"
  echo "      code .env         # VS Code"
  echo "      nano .env         # any terminal"
  echo ""
  echo "  Set OWNER_EMAIL and OWNER_PASSWORD, paste your Google Maps key,"
  echo "  then run ./start.sh again."
  echo ""
  exit 0
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  echo "Node 22.5 or newer is required (built-in SQLite). You have $(node -v)."
  exit 1
fi

exec node server/index.js
