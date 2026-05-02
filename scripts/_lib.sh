# shellcheck shell=bash
# Shared helpers for dev-up.sh / dev-down.sh / dev-logs.sh.

log() { printf '\033[36m[dev]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[dev]\033[0m %s\n' "$*" >&2; }
err() { printf '\033[31m[dev]\033[0m %s\n' "$*" >&2; }

# Replace KEY=... line in a dotenv file, or append if missing.
update_env_var() {
  local key="$1" val="$2" envfile="$3"
  if grep -qE "^${key}=" "$envfile"; then
    KEY="$key" VAL="$val" perl -i -pe '
      BEGIN { $k = $ENV{KEY}; $v = $ENV{VAL} }
      s/^\Q$k\E=.*/$k=$v/
    ' "$envfile"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$envfile"
  fi
}

# Rewrite the Partners-facing URLs in shopify.app.ordak-go.toml so they all
# point at the live tunnel host. application_url ends with `/`; redirect_urls
# stays a one-element list; [app_proxy].url ends with `/apps/proxy`.
update_toml_urls() {
  local url="$1" toml="$2"
  URL="$url" perl -i -pe '
    BEGIN { $u = $ENV{URL} }
    s|^application_url = ".*"|application_url = "$u/"|;
    s|^redirect_urls = \[ "[^"]*" \]|redirect_urls = [ "$u/api/auth" ]|;
    s|^url = "[^"]*/apps/proxy"|url = "$u/apps/proxy"|;
  ' "$toml"
}

# True if a process with the given PID is alive.
pid_alive() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }

# Wait until $cmd returns 0, up to $timeout seconds. Sleeps 1s between tries.
wait_until() {
  local timeout="$1"; shift
  local i
  for ((i = 0; i < timeout; i++)); do
    if "$@"; then return 0; fi
    sleep 1
  done
  return 1
}
