#!/usr/bin/env bash
# =============================================================================
# build-pg-runtime.sh
#
# Purpose:
#   Build a RELOCATABLE PostgreSQL 17 + pgvector + pg_trgm tarball for macOS.
#   The tarball is self-contained: no external dylib references to Homebrew,
#   /usr/local, or any other host-specific path. Runtime links resolve via
#   @rpath / @loader_path only.
#
# Requirements:
#   - Must run on a macOS 15 (Sequoia) runner (arm64 or x86_64).
#   - Requires: Xcode CLT, e2fsprogs (for uuid), python3 (for json), curl.
#   - PG_SHA256 and PGVECTOR_SHA MUST be pinned before production use (see TODOs).
#
# Usage:
#   PG_SHA256=<real-sha256> PGVECTOR_SHA=<real-sha256> ./scripts/build-pg-runtime.sh
#
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Config — all overridable via environment
# ---------------------------------------------------------------------------

# PostgreSQL 17.x source tarball
# Pin: https://ftp.postgresql.org/pub/source/v17.5/
PG_VERSION="${PG_VERSION:-17.5}"

# Official sha256 for postgresql-17.5.tar.bz2
# Source: https://ftp.postgresql.org/pub/source/v17.5/postgresql-17.5.tar.bz2.sha256
# NOTE: must be updated whenever PG_VERSION changes.
PG_SHA256="${PG_SHA256:-fcb7ab38e23b264d1902cb25e6adafb4525a6ebcbd015434aeef9eda80f528d8}"

# pgvector pinned release tag
PGVECTOR_REF="${PGVECTOR_REF:-v0.8.0}"

# sha256 of the pgvector v0.8.0 source archive
# Source: https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.0.tar.gz (commit 2627c5ff775ae6d7aef0c430121ccf857842d2f2)
# NOTE: must be updated whenever PGVECTOR_REF changes.
PGVECTOR_SHA="${PGVECTOR_SHA:-867a2c328d4928a5a9d6f052cd3bc78c7d60228a9b914ad32aa3db88e9de27b0}"

# Build staging prefix (all PG files land here before tarring)
STAGE="${STAGE:-/tmp/memkin-pg-stage}"

# Where the final tarball + sha256 are written
OUT_DIR="${OUT_DIR:-/tmp/memkin-pg-out}"

MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-15.0}"
export MACOSX_DEPLOYMENT_TARGET

# ---------------------------------------------------------------------------
# Arch detection
# ---------------------------------------------------------------------------
_raw_arch="$(uname -m)"
case "$_raw_arch" in
  arm64)  ARCH="arm64" ;;
  x86_64) ARCH="x64"   ;;
  *)
    echo "ERROR: unsupported arch: $_raw_arch" >&2
    exit 1
    ;;
esac
echo "==> arch: $ARCH (raw: $_raw_arch)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
WORK_DIR="$(mktemp -d /tmp/memkin-pg-build.XXXXXX)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

log()  { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }
die()  { echo "ERROR: $*" >&2; exit 1; }

sha256_file() {
  # Returns the sha256 hex of a file, works on macOS (shasum -a 256)
  shasum -a 256 "$1" | awk '{print $1}'
}

# ---------------------------------------------------------------------------
# Step 1: Download PostgreSQL source
# ---------------------------------------------------------------------------
PG_TARBALL="postgresql-${PG_VERSION}.tar.bz2"
PG_URL="https://ftp.postgresql.org/pub/source/v${PG_VERSION}/${PG_TARBALL}"
PG_SRC_DIR="${WORK_DIR}/postgresql-${PG_VERSION}"

log "Downloading PostgreSQL ${PG_VERSION} ..."
curl -fL --retry 3 --retry-delay 5 -o "${WORK_DIR}/${PG_TARBALL}" "$PG_URL"

# Verify sha256 — FAIL LOUDLY if the placeholder is still in place
if [[ "$PG_SHA256" == "TODO_PIN_SHA256" ]]; then
  warn "######################################################################"
  warn "# PG_SHA256 is NOT set — skipping integrity check.                   #"
  warn "# THIS IS UNSAFE FOR PRODUCTION. Set PG_SHA256 to the official value.#"
  warn "# See: ${PG_URL}.sha256                                               #"
  warn "######################################################################"
else
  log "Verifying PostgreSQL tarball sha256 ..."
  ACTUAL_SHA="$(sha256_file "${WORK_DIR}/${PG_TARBALL}")"
  if [[ "$ACTUAL_SHA" != "$PG_SHA256" ]]; then
    die "PostgreSQL tarball sha256 mismatch!\n  expected: $PG_SHA256\n  actual:   $ACTUAL_SHA"
  fi
  log "sha256 OK: $ACTUAL_SHA"
fi

log "Extracting PostgreSQL source ..."
tar xjf "${WORK_DIR}/${PG_TARBALL}" -C "$WORK_DIR"

# ---------------------------------------------------------------------------
# Step 2: Configure PostgreSQL
# ---------------------------------------------------------------------------
log "Configuring PostgreSQL ..."
cd "$PG_SRC_DIR"
./configure \
  --prefix="$STAGE" \
  --without-openssl \
  --without-readline \
  --with-uuid=e2fs \
  CFLAGS="-O2 -mmacosx-version-min=${MACOSX_DEPLOYMENT_TARGET}" \
  LDFLAGS="-Wl,-rpath,@loader_path/../lib -mmacosx-version-min=${MACOSX_DEPLOYMENT_TARGET}"

# Note on --without-readline: the managed cluster is non-interactive (no psql
# history needed); removing readline keeps the build simpler and avoids any
# Homebrew readline dependency. If psql interactive use is needed later, remove
# this flag and add a readline relocatability step.

# Note on --without-openssl: the managed cluster uses Unix domain sockets only
# (listen_addresses=''), so TLS is not needed. This removes the OpenSSL bundling
# problem entirely.

# ---------------------------------------------------------------------------
# Step 3: Build PostgreSQL (world-bin includes all contrib extensions)
# ---------------------------------------------------------------------------
NCPU="$(sysctl -n hw.ncpu)"
log "Building PostgreSQL with -j${NCPU} (world-bin for contrib incl. pg_trgm) ..."
make -j"${NCPU}" world-bin
make install-world-bin

# ---------------------------------------------------------------------------
# Step 4: Build pgvector
# ---------------------------------------------------------------------------
PGVECTOR_SRC="${WORK_DIR}/pgvector"
PGVECTOR_ARCHIVE="${WORK_DIR}/pgvector-${PGVECTOR_REF}.tar.gz"
PGVECTOR_URL="https://github.com/pgvector/pgvector/archive/refs/tags/${PGVECTOR_REF}.tar.gz"

log "Downloading pgvector ${PGVECTOR_REF} ..."
curl -fL --retry 3 --retry-delay 5 -o "$PGVECTOR_ARCHIVE" "$PGVECTOR_URL"

if [[ "$PGVECTOR_SHA" == "TODO_PIN_SHA256" ]]; then
  warn "######################################################################"
  warn "# PGVECTOR_SHA is NOT set — skipping integrity check.                #"
  warn "# THIS IS UNSAFE FOR PRODUCTION. Set PGVECTOR_SHA to the sha256 of   #"
  warn "# ${PGVECTOR_URL}                                                     #"
  warn "######################################################################"
else
  log "Verifying pgvector archive sha256 ..."
  ACTUAL_VEC_SHA="$(sha256_file "$PGVECTOR_ARCHIVE")"
  if [[ "$ACTUAL_VEC_SHA" != "$PGVECTOR_SHA" ]]; then
    die "pgvector archive sha256 mismatch!\n  expected: $PGVECTOR_SHA\n  actual:   $ACTUAL_VEC_SHA"
  fi
  log "pgvector sha256 OK: $ACTUAL_VEC_SHA"
fi

log "Extracting pgvector ..."
mkdir -p "$PGVECTOR_SRC"
tar xzf "$PGVECTOR_ARCHIVE" -C "$PGVECTOR_SRC" --strip-components=1

log "Building pgvector with OPTFLAGS='' (avoids -march=native → illegal instruction on other CPUs) ..."
cd "$PGVECTOR_SRC"
make PG_CONFIG="${STAGE}/bin/pg_config" OPTFLAGS=""
make PG_CONFIG="${STAGE}/bin/pg_config" OPTFLAGS="" install

# ---------------------------------------------------------------------------
# Step 5: Relocatability hardening
# ---------------------------------------------------------------------------

# 5a: Rewrite install names to @rpath-based references.
#
# After a prefix-install, dylibs in $STAGE/lib/* have their install names set to
# absolute paths under $STAGE. Binaries that link them also have LC_LOAD_DYLIB
# records pointing to $STAGE. We rewrite both so the tarball is portable:
#   - Each dylib's own install name → @rpath/<basename>
#   - Each binary's load commands referencing $STAGE/lib/... → @rpath/<basename>
#   - Each binary gets an LC_RPATH of @loader_path/../lib (if not already present)
#
# NOTE: The exact set of dylibs may need adjustment on the first real CI run.
#       Run `otool -L $STAGE/bin/postgres` to see what's linked.

log "Rewriting Mach-O install names for relocatability ..."

# Collect all dylibs under $STAGE/lib
while IFS= read -r -d '' dylib; do
  # Set the dylib's own install name to @rpath/<basename>
  basename_dylib="$(basename "$dylib")"
  install_name_tool -id "@rpath/${basename_dylib}" "$dylib"
done < <(find "$STAGE/lib" -name "*.dylib" -print0 2>/dev/null)

# For each Mach-O binary AND dylib, rewrite load commands pointing to $STAGE
rewrite_load_cmds() {
  local binary="$1"
  # Get all linked dylibs
  while IFS= read -r linked; do
    linked="$(echo "$linked" | awk '{print $1}')"
    if [[ "$linked" == "${STAGE}/lib/"* ]]; then
      local base
      base="$(basename "$linked")"
      install_name_tool -change "$linked" "@rpath/${base}" "$binary"
    fi
  done < <(otool -L "$binary" | tail -n +2)

  # Add @loader_path/../lib rpath if not already present
  if ! otool -l "$binary" | grep -q "@loader_path/../lib"; then
    install_name_tool -add_rpath "@loader_path/../lib" "$binary" 2>/dev/null || true
  fi
}

# Walk binaries
while IFS= read -r -d '' bin_file; do
  if file "$bin_file" | grep -q "Mach-O"; then
    rewrite_load_cmds "$bin_file"
  fi
done < <(find "$STAGE/bin" -type f -print0 2>/dev/null)

# Walk dylibs (they also have load commands for inter-dylib deps)
while IFS= read -r -d '' dylib; do
  if file "$dylib" | grep -q "Mach-O"; then
    rewrite_load_cmds "$dylib"
  fi
done < <(find "$STAGE/lib" -name "*.dylib" -print0 2>/dev/null)

# 5b: Audit — fail if any Mach-O references an external/host path.
#
# Allowed references: /usr/lib, /System, @rpath, @loader_path, @executable_path,
# and paths inside $STAGE itself (should be none after the rewrite above).
# Any reference to /opt/homebrew, /usr/local, or other external prefixes → FAIL.

log "Auditing Mach-O binaries for external rpath/dylib references ..."

VIOLATIONS=()

audit_binary() {
  local binary="$1"

  # Check LC_LOAD_DYLIB entries
  while IFS= read -r linked; do
    linked="$(echo "$linked" | awk '{print $1}')"
    case "$linked" in
      /usr/lib/*|/System/*|@rpath/*|@loader_path/*|@executable_path/*)
        # allowed
        ;;
      "${STAGE}"*)
        # Still under STAGE — rewrite may have missed this; record as violation
        VIOLATIONS+=("$binary: LC_LOAD_DYLIB → $linked (still under STAGE, rewrite missed it)")
        ;;
      *)
        VIOLATIONS+=("$binary: LC_LOAD_DYLIB → $linked (EXTERNAL)")
        ;;
    esac
  done < <(otool -L "$binary" 2>/dev/null | tail -n +2)

  # Check LC_RPATH entries
  while IFS= read -r rpath_entry; do
    case "$rpath_entry" in
      @loader_path/*|@executable_path/*|@rpath/*)
        # allowed
        ;;
      /usr/lib|/System/*)
        # allowed (unusual but harmless)
        ;;
      *)
        VIOLATIONS+=("$binary: LC_RPATH → $rpath_entry (EXTERNAL)")
        ;;
    esac
  done < <(otool -l "$binary" 2>/dev/null | awk '/LC_RPATH/{found=1} found && /path /{print $2; found=0}')
}

while IFS= read -r -d '' f; do
  if file "$f" | grep -q "Mach-O"; then
    audit_binary "$f"
  fi
done < <(find "$STAGE/bin" "$STAGE/lib" -type f -print0 2>/dev/null)

if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo "" >&2
  echo "RELOCATABILITY AUDIT FAILED — external references found:" >&2
  for v in "${VIOLATIONS[@]}"; do
    echo "  ✗ $v" >&2
  done
  echo "" >&2
  die "Tarball would not be portable. Fix install names before shipping."
fi

log "Relocatability audit passed — no external references found."

# ---------------------------------------------------------------------------
# Step 6: Verify required files exist
# ---------------------------------------------------------------------------
log "Verifying required files ..."

REQUIRED_BINS=(
  "${STAGE}/bin/postgres"
  "${STAGE}/bin/pg_ctl"
  "${STAGE}/bin/initdb"
  "${STAGE}/bin/createdb"
  "${STAGE}/bin/pg_isready"
  "${STAGE}/bin/psql"
  "${STAGE}/bin/pg_config"
)

REQUIRED_EXTS=(
  "${STAGE}/lib/postgresql/vector.dylib"
  "${STAGE}/share/postgresql/extension/vector.control"
  "${STAGE}/share/postgresql/extension/pg_trgm.control"
)

for f in "${REQUIRED_BINS[@]}" "${REQUIRED_EXTS[@]}"; do
  if [[ ! -f "$f" ]]; then
    die "Required file missing: $f"
  fi
  log "  OK: $f"
done

# ---------------------------------------------------------------------------
# Step 7: Write manifest.json and copy licenses
# ---------------------------------------------------------------------------
log "Writing manifest and copying licenses ..."

python3 - <<EOF
import json, sys
manifest = {
    "pg_version":   "${PG_VERSION}",
    "pgvector_ref": "${PGVECTOR_REF}",
    "arch":         "${ARCH}",
    "built_for":    "darwin",
    "min_macos":    "15.0"
}
with open("${STAGE}/manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)
    f.write("\n")
EOF

mkdir -p "${STAGE}/share/licenses"
cp "${PG_SRC_DIR}/COPYRIGHT"          "${STAGE}/share/licenses/PostgreSQL-COPYRIGHT"
cp "${PGVECTOR_SRC}/LICENSE"          "${STAGE}/share/licenses/pgvector-LICENSE"

# ---------------------------------------------------------------------------
# Step 8: Package tarball
# ---------------------------------------------------------------------------
log "Packaging tarball ..."
mkdir -p "$OUT_DIR"

TARBALL_NAME="memkin-pg-darwin-${ARCH}.tar.gz"
TARBALL_PATH="${OUT_DIR}/${TARBALL_NAME}"

# tar the STAGE contents (not the directory itself, so extraction puts files at
# the root of wherever the consumer extracts it)
tar czf "$TARBALL_PATH" -C "$STAGE" .

# Compute and write the sha256 sidecar
sha256_file "$TARBALL_PATH" > "${TARBALL_PATH}.sha256"

log "Tarball: $TARBALL_PATH"
log "SHA256:  $(cat "${TARBALL_PATH}.sha256")"
log ""
log "Build complete. Artifacts:"
log "  $TARBALL_PATH"
log "  ${TARBALL_PATH}.sha256"
