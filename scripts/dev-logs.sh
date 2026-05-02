#!/usr/bin/env bash
#
# Tails vite + cloudflared logs together. Ctrl-C to stop tailing (does NOT
# stop the underlying processes — use `npm run dev:down` for that).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"

if [[ ! -d "$LOG_DIR" ]]; then
  echo "No $LOG_DIR — has 'npm run dev:up' been run yet?" >&2
  exit 1
fi

# touch so tail doesn't error if a side hasn't logged yet
touch "$LOG_DIR/vite.log" "$LOG_DIR/cloudflared.log"

exec tail -F \
  "$LOG_DIR/vite.log" \
  "$LOG_DIR/cloudflared.log"
