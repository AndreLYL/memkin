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

## Double-click E2E — ⚠️ NOT GO (one blocker)

Launching `MemoArk.app` via Finder:
- ✅ Tauri window opens (splash).
- ❌ **Sidecar dies immediately**: `serve` resolves its config as `cwd/memoark.yaml`, but a Finder-launched app has `cwd=/`, so it prints `No configuration file found` and `exit(1)`. Backend never starts → webview stuck on splash.

Reproduced exactly by running the bundled sidecar from `cwd=/`.

### Root cause (architectural gap, not in the 2a plan)

Memoark config is **project-local** (`memoark.yaml` in a working dir). A desktop app has no working dir and **no user-global config location exists yet**. Two coupled sub-problems:
1. **Config discovery** — the Tauri shell must point `serve` at a stable config path.
2. **First-run** — even with a config, `serve` eager-constructs the OpenAI embedding client and crashes without an API key, so a first launch needs the setup wizard.

### Options (need a product decision)

- **A. Existing-user path (smallest)** — Rust passes `--config <stable path>` (e.g. `~/.memoark/memoark.yaml`) and we establish that as the user-global config home; works for a user who already ran `memoark init`. First-run setup deferred to 2b.
- **B. First-run setup in-app** — desktop launches the setup wizard when no config/key, then transitions to serve. Larger; overlaps 2b.
- **C. Bundle a default config** — ship a starter `memoark.yaml`; still needs the API key, so doesn't fully solve first-run.

**Recommendation:** A for 2a (get the developer's own double-click GO), then fold first-run setup into 2b.

## GO / NO-GO

**Mechanics GO, first-launch NO-GO.** Everything the 2a plan set out to build — explicit-blobs PGLite, compiled sidecar, Tauri shell, spawn→READY→navigate→cleanup, bundled `.app` — is implemented and verified. The remaining blocker is config discovery for a windowless app, which the plan/spec did not anticipate and which needs a product decision before the double-click flow can reach the dashboard.
