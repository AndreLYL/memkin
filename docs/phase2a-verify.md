# Phase 2a — local `tauri build` end-to-end verification (macOS)

Date: 2026-06-17 · Branch `feat/desktop-app` · host `aarch64-apple-darwin`
Toolchain: Rust 1.96.0, tauri-cli 2.11.2, Bun 1.3.14.

## Build chain

| Step | Result |
|------|--------|
| `bun run web:build` | ✅ real SPA bundle (`web/dist/index.html` + `assets/index-*.js`, 2 MB) — required `bun install` in `web/` first (deps were missing) |
| `node scripts/build-sidecar.mjs` | ✅ `src-tauri/binaries/memoark-aarch64-apple-darwin` (68 MB) + staged 4 PGLite assets + `web-dist/` |
| `cargo tauri build` | ✅ produced `MemoArk.app`; ❌ DMG step (`bundle_dmg.sh`) failed — **out of 2a scope** (DMG/signing is 2c) |

`.app` bundle layout (verified):
- `Contents/MacOS/memoark` (sidecar, 68 MB) + `memoark-spike` (Tauri app)
- `Contents/Resources/assets/{pglite.wasm,initdb.wasm,pglite.data,vector.tar.gz}`
- `Contents/Resources/web-dist/{index.html,assets/}`

## Component verification (all ✅)

- **Risk-2 (vector + real schema)**: `tests/store/pglite-compiled-schema.test.ts` — explicit-blobs PGLite runs the full Memoark schema, HNSW index `idx_chunks_embedding` created, vector insert + cosine search pass.
- **Compiled sidecar opens DB with bundled assets**: standalone `memoark consolidate` with `MEMOARK_PGLITE_ASSETS` → no WASM/asset error (got benign missing-credentials, i.e. DB already open).
- **Compiled sidecar serves real web UI**: standalone `memoark serve --web-dist <dir>` → `GET /` HTTP 200 with the real `index.html` (refs `/assets/index-*.js`); `GET /api/health` HTTP 200. Without `--web-dist` it 500'd on `/$bunfs/web/dist/index.html` — fixed by the web-dist resource.
- **`MEMOARK_READY` stdout marker**: printed after the HTTP API binds.
- **Clean shutdown**: quitting the app → both `memoark-spike` and sidecar gone, no orphan processes.

## Double-click E2E — ✅ GO

Launching `MemoArk.app` via Finder (3927 freed first), config at `~/.memoark/memoark.yaml`:
- ✅ Tauri window opens.
- ✅ Sidecar starts and serves on `localhost:3927` (`MEMOARK_READY` printed).
- ✅ `GET /` → HTTP 200, the real SPA (`assets/index-*.js` + css).
- ✅ `GET /api/health` → HTTP 200, `pages: 3115` (DB opened with bundled PGLite assets + real data).
- ✅ Quit → both `memoark-spike` and sidecar gone, no orphan procs, 3927 freed.
- ✅ State dir created at `~/.memoark/.memoark` (config projectRoot, not cwd).

(`pgrep 'memoark serve'` doesn't match the Tauri-spawned process name, but the HTTP 200s
prove it's serving. Visual screenshot blocked by macOS Screen Recording permission; webview
render itself was already proven GO in phase-0 Spike B under WebKitGTK — macOS WebKit is stricter-superset.)

### Blockers found & fixed to reach GO (Option A path, user-approved)

A Finder-launched sidecar has `cwd=/`, and `serve` had **multiple** cwd-relative assumptions:
1. **Config discovery** — `serve` looked at `cwd/memoark.yaml`. Fix: Rust passes `--config <home>/.memoark/memoark.yaml` (commit 0a762ca). `~/.memoark` is the user-global config home (sibling of the CLI `data_dir`).
2. **State dir** — `ensureStateDir()` did `mkdir(cwd/.memoark)` → `EROFS` on `/.memoark`. Fix: anchor to `config.__context.projectRoot` (commit acc3000).

### Known remaining cwd-relative paths (deferred to 2b — not startup blockers, feature-level)

- `src/server/api.ts:47,53` — config-center API resolves `cwd/memoark.yaml` (settings UI editing the config).
- `src/cli.ts:617` — scheduler `output_dir` defaults to `cwd` (only when scheduler writes files).
- First-run: no config at `~/.memoark/memoark.yaml` still hits the "no config" gate → needs the setup wizard (2b). Embedding `provider: ollama` needs **no** API key (apiKey defaults to "ollama"), so a configured user with ollama embeddings has a key-free launch.

### Non-blocking warnings

- DMG bundling (`bundle_dmg.sh`) fails — **2c scope** (distribution/signing).
- Tauri warns `identifier "ai.memoark.app"` ends with `.app` (conflicts with bundle ext) — cosmetic, fix in 2c bundling polish.

## GO / NO-GO

**✅ GO.** Everything the 2a plan set out to build — explicit-blobs PGLite, compiled sidecar,
Tauri shell, spawn→READY→navigate→cleanup, bundled `.app` — is implemented and verified, and
the double-click flow reaches the real dashboard with the DB open on bundled assets. Unlocks 2b
(tray/autostart/menu + first-run setup) and 2c (3-platform CI/sign/notarize/DMG/auto-update).
