#!/usr/bin/env bash
# run.sh — local app launcher (frontend now; backend once it exists).
#
# Kills any previous instance (tracked by PID file) and relaunches. This is a
# LOCAL dev convenience only — it makes no commits and deploys nothing.
#
# Usage:
#   ./run.sh                 # restart everything (default: start)
#   ./run.sh start           # kill previous, then launch
#   ./run.sh stop            # kill running processes, leave nothing behind
#   ./run.sh restart         # alias for start
#   ./run.sh status          # show what's running
#   ./run.sh logs [frontend|backend]   # tail a service log
#
# Env overrides:
#   FRONTEND_PORT       (default 3000)
#   NEXT_PUBLIC_ASSET_PREFIX  (default /ports/$FRONTEND_PORT)
#       The workshop proxy serves the dev server under /ports/<port>/ and
#       STRIPS that prefix before forwarding. The page is still served at "/"
#       (so no basePath), but Next must emit /_next/* assets under the prefix
#       or every asset request 404s. Set to "" for a bare localhost run.
#
set -euo pipefail

# -------- constants --------
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.run"            # PID files + logs (gitignored)
FRONTEND_DIR="$ROOT/frontend"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
export NEXT_PUBLIC_ASSET_PREFIX="${NEXT_PUBLIC_ASSET_PREFIX-/ports/$FRONTEND_PORT}"

mkdir -p "$RUN_DIR"

# -------- helpers --------
pidfile() { echo "$RUN_DIR/$1.pid"; }
logfile() { echo "$RUN_DIR/$1.log"; }

# Kill a tracked service by PID file, including its process group (dev servers
# spawn children). Safe to call when nothing is running.
kill_service() {
  local name="$1" pf
  pf="$(pidfile "$name")"
  [ -f "$pf" ] || return 0
  local pid
  pid="$(cat "$pf" 2>/dev/null || true)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    echo "  stopping $name (pid $pid)"
    # negative pid → whole process group; fall back to plain pid
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pf"
}

is_running() {
  local pf
  pf="$(pidfile "$1")"
  [ -f "$pf" ] && kill -0 "$(cat "$pf" 2>/dev/null)" 2>/dev/null
}

# Launch a command in its own session, detached from this script so it
# survives after run.sh exits. The helper shell writes its OWN pid then
# exec's the target, so the recorded pid IS the long-lived session leader —
# which makes `kill -- -<pid>` (process group) reliable in kill_service.
launch() {
  local name="$1" dir="$2"; shift 2
  local lf pf; lf="$(logfile "$name")"; pf="$(pidfile "$name")"
  echo "  starting $name → $lf"
  setsid bash -c 'cd "$1" || exit 1; echo "$$" >"$2"; shift 2; exec "$@"' \
    _ "$dir" "$pf" "$@" >"$lf" 2>&1 </dev/null &
  disown 2>/dev/null || true
}

# -------- services --------
start_frontend() {
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "  ! frontend deps missing — run 'pnpm install' in $FRONTEND_DIR" >&2
  fi
  launch frontend "$FRONTEND_DIR" pnpm dev --port "$FRONTEND_PORT"
}

# Backend is not wired yet. The infra (AppSync/Lambda) lives in ./infra (CDK)
# and ./lambda. When there is a locally-runnable backend (e.g. a mock GraphQL
# server or `sam local` / `cdk watch`), implement start_backend below and add
# it to the start/stop/status loops. Until then this is a deliberate no-op.
start_backend() {
  : # TODO(backend): launch local API once BACKEND-009 (AppSync SDL) is runnable
}

# Services run on start. Add "backend" here once start_backend does something.
SERVICES=(frontend)

# -------- commands --------
cmd_stop() {
  echo "stopping…"
  for s in "${SERVICES[@]}"; do kill_service "$s"; done
}

cmd_start() {
  cmd_stop
  echo "starting (asset prefix: '${NEXT_PUBLIC_ASSET_PREFIX:-<none>}')…"
  start_frontend
  echo
  echo "frontend (direct): http://localhost:$FRONTEND_PORT/"
  echo "(behind the workshop proxy, open the /ports/$FRONTEND_PORT/ URL — keep the trailing slash)"
}

cmd_status() {
  for s in "${SERVICES[@]}"; do
    if is_running "$s"; then
      echo "  $s: running (pid $(cat "$(pidfile "$s")"))"
    else
      echo "  $s: stopped"
    fi
  done
}

cmd_logs() {
  local name="${1:-frontend}" lf
  lf="$(logfile "$name")"
  [ -f "$lf" ] || { echo "no log for '$name' at $lf" >&2; exit 1; }
  tail -f "$lf"
}

case "${1:-start}" in
  start|restart) cmd_start ;;
  stop)          cmd_stop ;;
  status)        cmd_status ;;
  logs)          shift; cmd_logs "${1:-frontend}" ;;
  *) echo "usage: $0 {start|stop|restart|status|logs [service]}" >&2; exit 1 ;;
esac
