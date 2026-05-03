#!/usr/bin/env bash
#
# Stops processes started by scripts/dev-up.sh: vite (5173) and cloudflared.
# Reads PIDs from .dev-logs/*.pid; falls back to lsof on :5173.
# Runs cleanly even when nothing is running.
#
# Pass --quiet to suppress per-step output (used by dev-up.sh on restart).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# shellcheck source=./_lib.sh
source "$ROOT/scripts/_lib.sh"

LOG_DIR="$ROOT/.dev-logs"
QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

say() { (( QUIET )) || log "$*"; }

stop_pid_file() {
  local name="$1"
  local pidfile="$LOG_DIR/$name.pid"
  [[ -f "$pidfile" ]] || return 0
  local pid
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  if pid_alive "$pid"; then
    say "Stopping $name (pid $pid) ..."
    kill "$pid" 2>/dev/null || true
    # Give it a beat to exit cleanly.
    for _ in 1 2 3 4 5; do
      pid_alive "$pid" || break
      sleep 0.5
    done
    pid_alive "$pid" && kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
}

stop_pid_file vite
stop_pid_file cloudflared

# Catch a stray process bound to 5173 (e.g. a Vite started by hand).
PORT_PIDS="$(lsof -ti tcp:5173 2>/dev/null || true)"
if [[ -n "$PORT_PIDS" ]]; then
  say "Killing stray :5173 holders: $PORT_PIDS"
  # shellcheck disable=SC2086
  kill $PORT_PIDS 2>/dev/null || true
  sleep 0.5
  PORT_PIDS="$(lsof -ti tcp:5173 2>/dev/null || true)"
  [[ -n "$PORT_PIDS" ]] && kill -9 $PORT_PIDS 2>/dev/null || true
fi

(( QUIET )) || log "Stopped."
