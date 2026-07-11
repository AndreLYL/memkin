#!/usr/bin/env bash
# =============================================================================
# build-pg-runtime-linux.sh
#
# Purpose:
#   Build a RELOCATABLE PostgreSQL 17 + pgvector + pg_trgm tarball for Linux.
#   The tarball is self-contained: no external references to build-host paths.
#   Runtime links resolve via $ORIGIN-relative RPATH only.
#
# Why a separate script from build-pg-runtime.sh (macOS):
#   The relocatability-hardening step is fundamentally platform-specific — macOS
#   uses Mach-O load commands rewritten with install_name_tool/otool (@rpath,
#   @loader_path), Linux uses ELF RUNPATH/RPATH rewritten with patchelf
#   ($ORIGIN). Sharing one script would mean branching almost every step on
#   platform, which is harder to read/audit than two parallel, independently
#   reviewable scripts. Everything else (download, configure flags, build
#   targets, required-file list) is close enough to mac's script that this file
#   mirrors its structure section-for-section.
#
# Requirements:
#   - Must run on an Ubuntu x86_64 or aarch64 GitHub-hosted runner.
#   - Requires: build-essential, bison, flex, uuid-dev, zlib1g-dev, patchelf,
#     curl, python3 (all installed by the "Install build dependencies" step in
#     .github/workflows/build-pg-runtime.yml before this script runs).
#   - PG_SHA256 and PGVECTOR_SHA are the SAME values as build-pg-runtime.sh —
#     both scripts download the identical upstream *source* tarball, only the
#     compiled *output* differs by platform.
#
# Usage:
#   PG_SHA256=<real-sha256> PGVECTOR_SHA=<real-sha256> ./scripts/build-pg-runtime-linux.sh
#
# CAVEAT: this script has not yet been exercised on a real CI run (no Linux
# build/smoke-test has happened yet as of this commit). The relocatability
# audit in particular may need small adjustments once real RUNPATH/NEEDED
# output from a live build is inspected — see the comment above audit_binary().
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
# NOTE: must be updated whenever PG_VERSION changes. Same value as build-pg-runtime.sh
# (source tarball is platform-independent).
PG_SHA256="${PG_SHA256:-fcb7ab38e23b264d1902cb25e6adafb4525a6ebcbd015434aeef9eda80f528d8}"

# pgvector pinned release tag
PGVECTOR_REF="${PGVECTOR_REF:-v0.8.0}"

# sha256 of the pgvector v0.8.0 source archive
# Source: https://github.com/pgvector/pgvector/archive/refs/tags/v0.8.0.tar.gz (commit 2627c5ff775ae6d7aef0c430121ccf857842d2f2)
# NOTE: must be updated whenever PGVECTOR_REF changes. Same value as build-pg-runtime.sh.
PGVECTOR_SHA="${PGVECTOR_SHA:-867a2c328d4928a5a9d6f052cd3bc78c7d60228a9b914ad32aa3db88e9de27b0}"

# Build staging prefix (all PG files land here before tarring)
STAGE="${STAGE:-/tmp/memkin-pg-stage}"

# Where the final tarball + sha256 are written
OUT_DIR="${OUT_DIR:-/tmp/memkin-pg-out}"

# ---------------------------------------------------------------------------
# Arch detection
# ---------------------------------------------------------------------------
_raw_arch="$(uname -m)"
case "$_raw_arch" in
  aarch64) ARCH="arm64" ;;
  x86_64)  ARCH="x64"   ;;
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
  # Returns the sha256 hex of a file, works on Linux (sha256sum)
  sha256sum "$1" | awk '{print $1}'
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
  CFLAGS="-O2"

# Note on --without-readline: the managed cluster is non-interactive (no psql
# history needed); removing readline keeps the build simpler and avoids a
# host-glibc-version-specific libreadline runtime dependency. If psql
# interactive use is needed later, remove this flag and add a readline
# relocatability step.

# Note on --without-openssl: the managed cluster uses Unix domain sockets only
# (listen_addresses=''), so TLS is not needed. This removes the OpenSSL
# bundling problem entirely (OpenSSL's ABI/soname varies a lot across distros).

# Note on --with-uuid=e2fs: on Linux this resolves against libuuid (uuid-dev
# package, part of util-linux) — same flag name as macOS's e2fsprogs-provided
# uuid, different underlying package, same API.

# Note: we deliberately do NOT bake @loader_path/$ORIGIN into LDFLAGS at
# configure time here (unlike the macOS script's LDFLAGS trick), because
# reliably escaping a literal `$ORIGIN` through configure → sub-make → the
# linker across PG's build system is fragile. Instead RPATH/RUNPATH is set
# entirely post-build via patchelf in Step 5, which is simpler and auditable
# in one place.

# ---------------------------------------------------------------------------
# Step 3: Build PostgreSQL (world-bin includes all contrib extensions)
# ---------------------------------------------------------------------------
NCPU="$(nproc)"
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
# Step 5: Relocatability hardening (ELF / patchelf)
# ---------------------------------------------------------------------------

# 5a: Set RPATH on every ELF binary/library so they resolve their shared-lib
# dependencies relative to their own location instead of $STAGE (a build-host
# temp path that won't exist on the machine running `memkin up`).
#   - bin/*                       → $ORIGIN/../lib      (executables)
#   - lib/postgresql/*.so         → $ORIGIN              (extension modules)
#   - lib/*.so* (e.g. libpq.so)   → $ORIGIN               (shared libs)
#
# NOTE: the exact set of directories may need adjustment on the first real CI
# run — inspect `find $STAGE -type f -exec file {} \; | grep ELF` to confirm
# nothing was missed.

log "Setting RPATH on ELF binaries/libraries for relocatability ..."

is_elf() {
  file "$1" 2>/dev/null | grep -q "ELF"
}

set_rpath() {
  local target="$1" rpath="$2"
  # --force-rpath: write a legacy DT_RPATH (searched before LD_LIBRARY_PATH)
  # rather than DT_RUNPATH (searched after), which is more predictable when
  # the runtime is invoked via `memkin up` with an arbitrary environment.
  patchelf --force-rpath --set-rpath "$rpath" "$target"
}

while IFS= read -r -d '' bin_file; do
  if is_elf "$bin_file"; then
    set_rpath "$bin_file" '$ORIGIN/../lib'
  fi
done < <(find "$STAGE/bin" -type f -print0 2>/dev/null)

while IFS= read -r -d '' lib_file; do
  if is_elf "$lib_file"; then
    set_rpath "$lib_file" '$ORIGIN'
  fi
done < <(find "$STAGE/lib" -type f \( -name "*.so" -o -name "*.so.*" \) -print0 2>/dev/null)

# 5b: Audit — fail if any ELF binary's RPATH/RUNPATH references an absolute
# build-host path (the STAGE dir or WORK_DIR) instead of $ORIGIN.
#
# We deliberately audit RPATH/RUNPATH only, not DT_NEEDED sonames: NEEDED
# entries on Linux are almost always bare sonames (e.g. libc.so.6, libm.so.6,
# libuuid.so.1) resolved via the dynamic linker's search path, not embedded
# absolute paths — the actual portability risk on Linux is a leaked RPATH
# pointing back at $STAGE, which is what this checks.

log "Auditing ELF binaries for external RPATH/RUNPATH references ..."

VIOLATIONS=()

audit_binary() {
  local binary="$1"
  local rpath
  rpath="$(patchelf --print-rpath "$binary" 2>/dev/null || true)"
  [[ -z "$rpath" ]] && return 0

  IFS=':' read -ra entries <<<"$rpath"
  for entry in "${entries[@]}"; do
    case "$entry" in
      '$ORIGIN'|'$ORIGIN/'*)
        # allowed
        ;;
      *)
        VIOLATIONS+=("$binary: RPATH entry '$entry' (EXTERNAL / not \$ORIGIN-relative)")
        ;;
    esac
  done
}

while IFS= read -r -d '' f; do
  if is_elf "$f"; then
    audit_binary "$f"
  fi
done < <(find "$STAGE/bin" "$STAGE/lib" -type f -print0 2>/dev/null)

if [[ ${#VIOLATIONS[@]} -gt 0 ]]; then
  echo "" >&2
  echo "RELOCATABILITY AUDIT FAILED — external references found:" >&2
  for v in "${VIOLATIONS[@]}"; do
    echo "  x $v" >&2
  done
  echo "" >&2
  die "Tarball would not be portable. Fix RPATH before shipping."
fi

log "Relocatability audit passed — no external RPATH references found."

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
  "${STAGE}/lib/postgresql/vector.so"
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
    "built_for":    "linux",
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

TARBALL_NAME="memkin-pg-linux-${ARCH}.tar.gz"
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
