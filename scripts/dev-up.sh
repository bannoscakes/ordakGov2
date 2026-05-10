#!/usr/bin/env bash
#
# Canonical local-dev loop for Ordak Go. ONE command, everything hot-reloads:
#   - Embedded admin (Remix routes in `app/routes/*`) → hot-reload via Vite
#     served through the named tunnel.
#   - Theme app extension `cart-block` → hot-reload via `shopify app dev`'s
#     Development preview pushed to ordakgo-v3.
#   - Functions (delivery-rate-filter, cart-validation) → rebuilt on save.
#
# Architecture:
#   - Stable named cloudflared tunnel `ordak-go-dev` is permanently routed via
#     Cloudflare DNS to https://dev.ordak.vip → http://localhost:5173.
#   - shopify.app.ordak-go.toml pins all URLs to https://dev.ordak.vip.
#   - Partners URLs are synced via one-time `shopify app deploy --no-release`
#     (idempotent; sentinel file makes repeat runs skip).
#
# Sequence:
#   1. Stop anything we previously started (idempotent).
#   2. Start `cloudflared tunnel run ordak-go-dev` in background.
#   3. If the Partners-pushed URL differs: build extensions and
#      `shopify app deploy --no-release` to push toml. Else skip.
#   4. Start Vite (`npm run vite:dev`) in background.
#   5. Run `shopify app dev` in foreground (interactive — login + storefront
#      password prompt + extension hot-reload).
#   6. On Ctrl-C / exit: tear down cloudflared + Vite cleanly via dev-down.sh.
#
# Iteration loop after this script is running:
#   edit a file → save → see it on ordakgo-v3 (admin or storefront) →
#   commit → push → PR. No `shopify app deploy`, no `shopify app release`.
#
# For App Store production deploys: separate command, NOT this script. See
# `docs/DEV_SETUP.md` § Production deploys.
#
# Logs and PIDs land in .dev-logs/ (gitignored). Use `npm run dev:logs` to
# tail, `npm run dev:down` to stop background processes if this script crashed.

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

# Idempotency-guarded teardown. Registered immediately after cloudflared
# starts so any subsequent failure (Partners deploy hang, Vite bind error,
# `shopify app dev` crash, Ctrl-C) tears the tunnel + Vite down cleanly.
# The guard prevents the EXIT-then-INT double-fire that bash's `set -e`
# can produce when a foreground child exits non-zero.
_cleaned=0
cleanup() {
  [[ "$_cleaned" -eq 1 ]] && return
  _cleaned=1
  printf '\n'
  log "Tearing down cloudflared + Vite ..."
  "$ROOT/scripts/dev-down.sh" --quiet || true
  log "Stopped."
}

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

# Trap registered NOW — covers every failure path from this point on,
# including `shopify app deploy` hangs and Vite bind errors.
trap cleanup EXIT INT TERM

# Wait for the tunnel to register a connection.
tunnel_ready() {
  pid_alive "$CF_PID" && grep -q "Registered tunnel connection" "$LOG_DIR/cloudflared.log"
}
if ! wait_until 30 tunnel_ready; then
  err "cloudflared did not register a connection within 30s."
  err "Tail of $LOG_DIR/cloudflared.log:"
  tail -n 30 "$LOG_DIR/cloudflared.log" >&2
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
    err "Tunnel is up but Partners may still be on the old URL — OAuth and"
    err "the cart-block round-trip will likely fail. Stop with 'npm run"
    err "dev:down' and investigate before continuing."
    exit 1
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
  err "Vite did not announce 'Local: ...:5173' within 30s."
  err "Tail of $LOG_DIR/vite.log:"
  tail -n 20 "$LOG_DIR/vite.log" >&2
  err "Cannot continue without Vite — the embedded admin would load blank."
  exit 1
fi
# (cleanup trap registered earlier, right after cloudflared starts)

cat <<EOF

✓ Background services up.
  App URL    $APP_URL
  Admin      https://admin.shopify.com/store/ordakgo-v3/apps/ordak-go
  Tail logs  npm run dev:logs (in another terminal)

Now starting \`shopify app dev\` in foreground for extension hot-reload.
Ctrl-C exits everything cleanly.

EOF

# 6. shopify app dev in foreground. We do NOT pass --tunnel-url — the CLI
#    interprets a `:443` URL as "bind locally to port 443" (EACCES, requires
#    root). Instead, the toml's URLs are pinned to https://dev.ordak.vip and
#    the CLI uses those as the public face; its internal proxy binds to a
#    free high port automatically. The named cloudflared tunnel (started in
#    step 2) is what makes dev.ordak.vip reachable — it routes inbound HTTPS
#    to localhost:5173 (Vite). --no-update silences the CLI version-check.
#    The CLI prompts for the dev store's storefront password (`theuld`) on
#    first run; that's interactive — only you can answer.
shopify app dev \
  --config ordak-go \
  --store=ordakgo-v3.myshopify.com \
  --no-update
