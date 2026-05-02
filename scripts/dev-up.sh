#!/usr/bin/env bash
#
# Boots the Ordak Go dev environment in the background. Replaces the
# 3-terminal copy-paste flow described in docs/DEV_SETUP.md.
#
# Sequence:
#   1. Stop anything we previously started (idempotent).
#   2. Start cloudflared quick-tunnel → http://localhost:5173 in background.
#   3. Parse the *.trycloudflare.com URL out of cloudflared's stdout.
#   4. If the URL changed since last run: rewrite SHOPIFY_APP_URL in .env,
#      rewrite the three URL fields in shopify.app.ordak-go.toml, and push
#      the new app config to Partners via `shopify app deploy --allow-updates`.
#   5. Start `npm run vite:dev` in background.
#   6. Print where the app is reachable.
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
TOML_FILE="$ROOT/shopify.app.ordak-go.toml"
LAST_URL_FILE="$LOG_DIR/last-pushed-url.txt"

if [[ ! -f "$ENV_FILE" ]]; then
  err ".env not found at $ENV_FILE. See docs/DEV_SETUP.md for the template."
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  err "cloudflared not found. Install with: brew install cloudflared"
  exit 1
fi

# 1. Idempotency: stop anything we previously started.
"$ROOT/scripts/dev-down.sh" --quiet || true

# 2. cloudflared in background.
log "Starting cloudflared quick-tunnel → http://localhost:5173 ..."
: > "$LOG_DIR/cloudflared.log"
nohup cloudflared tunnel --url http://localhost:5173 \
  >> "$LOG_DIR/cloudflared.log" 2>&1 &
CF_PID=$!
echo "$CF_PID" > "$LOG_DIR/cloudflared.pid"

# 3. Wait for trycloudflare URL.
log "Waiting for tunnel URL (up to 60s) ..."
URL=""
for i in $(seq 1 60); do
  if ! pid_alive "$CF_PID"; then
    err "cloudflared exited before issuing a URL. Last 30 lines:"
    tail -n 30 "$LOG_DIR/cloudflared.log" >&2
    exit 1
  fi
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cloudflared.log" | head -1 || true)"
  [[ -n "$URL" ]] && break
  sleep 1
done
if [[ -z "$URL" ]]; then
  err "cloudflared did not produce a *.trycloudflare.com URL in 60s."
  err "Tail of $LOG_DIR/cloudflared.log:"
  tail -n 30 "$LOG_DIR/cloudflared.log" >&2
  "$ROOT/scripts/dev-down.sh" --quiet
  exit 1
fi
log "Tunnel URL: $URL"
echo "$URL" > "$LOG_DIR/current-tunnel-url.txt"

# 4. Sync .env, toml, and Partners app config (only if URL changed).
PREV_URL=""
[[ -f "$LAST_URL_FILE" ]] && PREV_URL="$(cat "$LAST_URL_FILE")"
if [[ "$PREV_URL" == "$URL" ]]; then
  log "Tunnel URL unchanged since last run; skipping config push."
else
  log "URL changed; updating .env, building extensions, pushing to Partners ..."
  update_env_var SHOPIFY_APP_URL "$URL" "$ENV_FILE"

  # Rewrite the toml with the live URL just long enough for `shopify app deploy`
  # to push it. Restore on the way out so git stays clean — only `.env` (which
  # is gitignored) keeps the ephemeral URL.
  TOML_BACKUP="$LOG_DIR/toml.bak"
  cp "$TOML_FILE" "$TOML_BACKUP"
  update_toml_urls "$URL" "$TOML_FILE"

  : > "$LOG_DIR/deploy.log"

  if ! npm run --silent build:extensions >> "$LOG_DIR/deploy.log" 2>&1; then
    err "Extension build failed. Check $LOG_DIR/deploy.log."
    mv "$TOML_BACKUP" "$TOML_FILE"
    err "Tunnel + Vite still up. Stop with 'npm run dev:down'."
    exit 1
  fi

  log "Pushing config to Partners via 'shopify app deploy' (~30s) ..."
  if shopify app deploy \
      --config ordak-go \
      --allow-updates \
      --message "dev tunnel URL refresh" \
      >> "$LOG_DIR/deploy.log" 2>&1; then
    echo "$URL" > "$LAST_URL_FILE"
    log "Partners config updated."
  else
    err "shopify app deploy failed. Check $LOG_DIR/deploy.log."
    err "App may still work if Partners URL is unchanged from a previous version."
  fi

  # Restore the toml (Shopify CLI may also have edited it during deploy — e.g.
  # writing extension UIDs. Discard those too; if the user wants to keep them,
  # they re-run deploy outside dev:up.)
  mv "$TOML_BACKUP" "$TOML_FILE"
fi

# 5. Vite in background. It reads .env at startup, so this must come after
#    the .env update.
log "Starting Vite (npm run vite:dev) ..."
: > "$LOG_DIR/vite.log"
nohup npm run --silent vite:dev >> "$LOG_DIR/vite.log" 2>&1 &
VITE_PID=$!
echo "$VITE_PID" > "$LOG_DIR/vite.pid"

# 6. Wait for Vite to bind to :5173.
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
  App URL    $URL
  Admin      https://admin.shopify.com/store/ordak-go-dev/apps/ordak-go
  Tail logs  npm run dev:logs
  Stop       npm run dev:down

EOF
