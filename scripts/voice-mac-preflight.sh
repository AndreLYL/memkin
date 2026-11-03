#!/usr/bin/env bash
# Read-only readiness report; no installation, signing or account changes.
set -u
if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This preflight is intended for macOS.' >&2
  exit 1
fi
printf 'Architecture: %s\n' "$(uname -m)"
sw_vers
if command -v xcodebuild >/dev/null 2>&1; then
  xcodebuild -version
  xcodebuild -showsdks
else
  printf '%s\n' 'Install the full Xcode app and open it once.'
fi
if command -v node >/dev/null 2>&1; then node --version; else printf '%s\n' 'Node.js is not installed.'; fi
if command -v python3 >/dev/null 2>&1; then python3 --version; else printf '%s\n' 'Python 3 is not installed.'; fi
printf '%s\n' 'Record iOS and watchOS versions manually from Settings > General > About.'
