#!/usr/bin/env bash
#
# Boots the Ordak Go dev environment in the background. Replaces the
# 3-terminal copy-paste flow described in docs/DEV_SETUP.md.
#
# Architecture:
#   - Stable named cloudflared tunnel `ordak-go-dev` is permanently routed via
#     Cloudflare DNS to https://dev.ordak.vip → http://localhost:5173.
#   - shopify.app.ordak-go.toml pins all URLs to https://dev.ordak.vip and is
#     committed in that state — no per-restart rewriting.
#   - Partners gets the URL via `shopify app deploy` ONCE (first run after the
#     URL changes); a sentinel file makes subsequent runs skip the deploy.
#
# Sequence:
#   1. Stop anything we previously started (idempotent).
#   2. Start `cloudflared tunnel run ordak-go-dev` in background.
#   3. If the Partners-pushed URL differs from APP_URL: build extensions and
#      `shopify app deploy` to push toml. Else skip.
#   4. Start `npm run vite:dev` in background.
#   5. Print where the app is reachable.
#
# Logs and PIDs land in .dev-logs/ (gitignored). Use `npm run dev:logs` to
# tail, `npm run dev:down` to stop.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=./_lib.sh
source "$ROOT/scripts/_lib.sh"

LOG_DIR="$ROOT/.dev-logs"
mkdir -p "$LOG_DIR"
ENV_FILE="$ROOT/.env"
LAST_URL_FILE="$LOG_DIR/last-pushed-url.txt"

if [[ ! -f "$ENV_FILE" ]]; then
  err ".env not found at $ENV_FILE. See docs/DEV_SETUP.md for the template."
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  err "cloudflared not found. Install with: brew install cloudflared"
  exit 1
fi

# Read the canonical app URL from .env (single source of truth for the
# running server). The toml is expected to match — `shopify app deploy` syncs.
APP_URL="$(grep -E '^SHOPIFY_APP_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [[ -z "$APP_URL" ]]; then
  err "SHOPIFY_APP_URL not set in $ENV_FILE."
  exit 1
fi

TUNNEL_NAME="ordak-go-dev"

# 1. Idempotency: stop anything we previously started.
"$ROOT/scripts/dev-down.sh" --quiet || true

# 2. Named cloudflared tunnel in background. Reads ~/.cloudflared/config.yml
#    for routing — see that file for the localhost:5173 ingress rule.
log "Starting cloudflared tunnel '$TUNNEL_NAME' → $APP_URL ..."
: > "$LOG_DIR/cloudflared.log"
nohup cloudflared tunnel run "$TUNNEL_NAME" \
  >> "$LOG_DIR/cloudflared.log" 2>&1 &
CF_PID=$!
echo "$CF_PID" > "$LOG_DIR/cloudflared.pid"

# Wait for the tunnel to register a connection.
tunnel_ready() {
  pid_alive "$CF_PID" && grep -q "Registered tunnel connection" "$LOG_DIR/cloudflared.log"
}
if ! wait_until 30 tunnel_ready; then
  err "cloudflared did not register a connection within 30s."
  err "Tail of $LOG_DIR/cloudflared.log:"
  tail -n 30 "$LOG_DIR/cloudflared.log" >&2
  "$ROOT/scripts/dev-down.sh" --quiet
  exit 1
fi
log "Tunnel registered."

# 3. Push Partners config — only when the URL hasn't been pushed yet.
PREV_URL=""
[[ -f "$LAST_URL_FILE" ]] && PREV_URL="$(cat "$LAST_URL_FILE")"
if [[ "$PREV_URL" == "$APP_URL" ]]; then
  log "Partners already on $APP_URL; skipping deploy."
else
  log "Building theme extensions ..."
  : > "$LOG_DIR/deploy.log"
  if ! npm run --silent build:extensions >> "$LOG_DIR/deploy.log" 2>&1; then
    err "Extension build failed. Check $LOG_DIR/deploy.log."
    err "Tunnel still up. Stop with 'npm run dev:down'."
    exit 1
  fi

  log "Pushing config to Partners via 'shopify app deploy' (~30s) ..."
  if shopify app deploy \
      --config ordak-go \
      --allow-updates \
      --message "Switch to stable named tunnel ($APP_URL)" \
      >> "$LOG_DIR/deploy.log" 2>&1; then
    echo "$APP_URL" > "$LAST_URL_FILE"
    log "Partners config updated."
  else
    err "shopify app deploy failed. Check $LOG_DIR/deploy.log."
    err "App may still work if Partners URL already matches $APP_URL."
  fi
fi

# 4. Vite in background.
log "Starting Vite (npm run vite:dev) ..."
: > "$LOG_DIR/vite.log"
nohup npm run --silent vite:dev >> "$LOG_DIR/vite.log" 2>&1 &
VITE_PID=$!
echo "$VITE_PID" > "$LOG_DIR/vite.pid"

vite_bound() {
  pid_alive "$VITE_PID" && grep -q "Local:.*5173" "$LOG_DIR/vite.log"
}
if ! wait_until 30 vite_bound; then
  warn "Vite did not announce 'Local: ...:5173' within 30s."
  warn "Tail of $LOG_DIR/vite.log:"
  tail -n 20 "$LOG_DIR/vite.log" >&2
  warn "Tunnel is up; you can investigate without restarting cloudflared."
fi

cat <<EOF

✓ Dev environment up.
  App URL    $APP_URL
  Admin      https://admin.shopify.com/store/ordak-go-dev/apps/ordak-go
  Tail logs  npm run dev:logs
  Stop       npm run dev:down

EOF
