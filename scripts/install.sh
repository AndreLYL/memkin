#!/bin/sh
# memkin one-command installer — Mac + Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/AndreLYL/memkin/main/scripts/install.sh | sh
set -eu

# shellcheck disable=SC2034 # consumed by main() added in Task 2
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
