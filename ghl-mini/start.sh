#!/usr/bin/env bash
# Boot ghl-mini. First run creates .env and a login for you automatically.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Get the LTS build from https://nodejs.org then run this again."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  echo "Node 22.5 or newer is required (this uses Node's built-in SQLite)."
  echo "You have $(node -v). Get the LTS build from https://nodejs.org"
  exit 1
fi

exec node server/index.js
