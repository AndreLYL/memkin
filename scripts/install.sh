#!/bin/sh
# memkin one-command installer — Mac + Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/AndreLYL/memkin/main/scripts/install.sh | sh
set -eu

STABLE_CONFIG="${MEMKIN_CONFIG:-$HOME/.memkin/memkin.yaml}"
MIN_NODE_MAJOR=18

# DRYRUN=1 prints commands instead of running them (used by tests).
run() {
  if [ "${MEMKIN_INSTALL_DRYRUN:-0}" = "1" ]; then
    echo "DRYRUN: $*"
  else
    "$@"
  fi
}

log()  { printf '\033[36m[memkin]\033[0m %s\n' "$1"; }
fail() { printf '\033[31m[memkin] %s\033[0m\n' "$1" >&2; exit 1; }

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

ensure_node() {
  if [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ]; then
    log "Node $(node -v) OK"
    return
  fi
  log "Node >= $MIN_NODE_MAJOR not found — installing…"
  if command -v brew >/dev/null 2>&1; then
    run brew install node
  elif command -v apt-get >/dev/null 2>&1; then
    run sh -c 'curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs'
  else
    fail "Could not auto-install Node. Please install Node >= $MIN_NODE_MAJOR from https://nodejs.org then re-run."
  fi
  [ "$(node_major)" -ge "$MIN_NODE_MAJOR" ] || fail "Node install did not produce a usable node >= $MIN_NODE_MAJOR."
}

ensure_memkin() {
  log "Installing memkin globally (npm i -g memkin@latest)…"
  if ! run npm install -g memkin@latest; then
    fail "Global install failed. If this is a permissions (EACCES) error, set an npm prefix you own (npm config set prefix ~/.npm-global) or re-run with sudo."
  fi
}

run_wizard_if_needed() {
  if [ -f "$STABLE_CONFIG" ]; then
    log "Existing config found at $STABLE_CONFIG — skipping setup wizard."
    return
  fi
  mkdir -p "$(dirname "$STABLE_CONFIG")"
  log "Launching setup wizard in your browser…"
  run memkin init --web -c "$STABLE_CONFIG" &
  WIZARD_PID=$!
  log "Waiting for you to finish the wizard (fill your LLM API key and Save)…"
  i=0
  while [ ! -f "$STABLE_CONFIG" ]; do
    i=$((i + 1))
    [ "$i" -gt 600 ] && { kill "$WIZARD_PID" 2>/dev/null || true; fail "Timed out waiting for setup. Finish the wizard, then re-run this installer."; }
    sleep 1
  done
  log "Config saved. Stopping the wizard…"
  kill "$WIZARD_PID" 2>/dev/null || true
  wait "$WIZARD_PID" 2>/dev/null || true
}

start_service() {
  log "Starting the always-on background service + wiring your AI agents…"
  # --linger (Linux only): keep the systemd user service running after SSH
  # logout — otherwise the daemon (and managed Postgres) stops with the last
  # login session. Best-effort inside memkin; harmless on desktop Linux.
  LINGER_FLAG=""
  [ "$(uname -s)" = "Linux" ] && LINGER_FLAG="--linger"
  run memkin up $LINGER_FLAG -c "$STABLE_CONFIG"
  log "Done. Manage it with:  memkin status  |  memkin down"
}

main() {
  ensure_node
  ensure_memkin
  run_wizard_if_needed
  start_service
  log "✅ memkin is installed and running as a background service."
}
main "$@"
