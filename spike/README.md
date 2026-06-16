# Spike A — PGLite explicit blobs in a compiled Bun binary

Phase-0 go/no-go #1 for MemoArk desktop packaging.

**Question:** Can a `bun build --compile` product open a PGLite database and run
vector queries when PGLite's WASM/extension assets are placed *beside* the binary
and passed as explicit blobs (instead of being embedded in `$bunfs`)?

**Result: GO ✅** — the compiled binary opens the DB and runs vector queries in
both in-memory and on-disk (`dataDir`) modes.

---

## Step 1 — Reproduce the baseline failure

`bun build --compile` succeeds and `--help` works, but opening the DB fails
because PGLite tries to read its data bundle from the read-only `$bunfs` virtual
filesystem, where the asset is not embedded:

```
$ bun run compile          # OK, produces dist-bin/memoark
$ ./dist-bin/memoark --help    # OK
$ ./dist-bin/memoark consolidate
Consolidate failed: ENOENT: no such file or directory, open '/$bunfs/root/pglite.data'
```

So the default packaging path cannot open the database. This is the problem the
spike solves.

## Step 2 — `PGliteOptions` signature (confirmed)

From `node_modules/@electric-sql/pglite/dist/pglite-DYCFVi62.d.ts` (lines 494–512):

```ts
pgliteWasmModule?: WebAssembly.Module;
initdbWasmModule?: WebAssembly.Module;
fsBundle?: Blob | File;
```

Note the field is `fsBundle` (NOT `wasmModule`). `fsBundle` is the `pglite.data`
bundle; omitting it makes PGLite default to reading `$bunfs/pglite.data` → ENOENT.

## Mechanism that makes it work

1. **Assets placed beside the binary**, not embedded. Four files live in an
   `assets/` directory next to the executable: `pglite.wasm`, `initdb.wasm`,
   `pglite.data`, `vector.tar.gz`.
2. **Base directory resolution**: in a compiled binary `import.meta.url` is
   `$bunfs/...`, so we detect that and switch to `dirname(process.execPath)` to
   locate the real on-disk assets. When run via `bun` (dev), we use
   `import.meta.dir`.
3. **Explicit blobs for the core engine**:
   - `pgliteWasmModule` ← `WebAssembly.compile(pglite.wasm)`
   - `initdbWasmModule` ← `WebAssembly.compile(initdb.wasm)`
   - `fsBundle` ← `new Blob([pglite.data])` (REQUIRED, else `$bunfs` ENOENT)
4. **Custom `vector` extension overriding `bundlePath`**: the stock
   `@electric-sql/pglite/vector` import hardcodes its tarball path to `$bunfs`, so
   in a compiled binary it can't find `vector.tar.gz`. We supply a minimal
   extension object whose `setup()` returns
   `bundlePath: new URL("file://" + asset("vector.tar.gz"))`, pointing at the
   real on-disk tarball.

## Step 5 — `bun` direct run (dev mode)

```
$ node spike/copy-pglite-assets.mjs && bun spike/pglite-explicit-blobs.ts
VECTOR_OK[memory]: [1,2,3]
VECTOR_OK[dataDir]: [1,2,3]
SPIKE_A_PASS
```

## Step 6 — Compiled binary run

```
$ bun build --compile spike/pglite-explicit-blobs.ts --outfile spike/memoark-spike
$ mkdir -p spike/dist-run/assets
$ cp spike/memoark-spike spike/dist-run/
$ cp spike/assets/* spike/dist-run/assets/
$ cd spike/dist-run && ./memoark-spike
VECTOR_OK[memory]: [1,2,3]
VECTOR_OK[dataDir]: [1,2,3]
SPIKE_A_PASS
```

The compiled binary, run from a clean staging dir with assets beside it, opens
the DB, creates the `vector` extension, and runs a `::vector` query in BOTH
in-memory and persistent (`dataDir`) modes.

## GO / NO-GO #1 — **GO**

A `bun build --compile` product CAN open PGLite and run vector queries, provided:

- PGLite assets are shipped *beside* the binary (sidecar `assets/` dir), not
  embedded in `$bunfs`.
- Base dir is resolved via `process.execPath` when running compiled.
- `pgliteWasmModule`, `initdbWasmModule`, and `fsBundle` are passed as explicit
  blobs (`fsBundle` is mandatory).
- The `vector` extension's `bundlePath` is overridden with a `file://` URL to the
  on-disk `vector.tar.gz` (the stock import points at `$bunfs` and fails).

### Implications for desktop packaging

- The app must ship a sidecar `assets/` directory (~16 MB: pglite.wasm 9.4 MB,
  pglite.data 6 MB, initdb.wasm 0.4 MB, vector.tar.gz 44 KB) alongside the binary.
- The DB bootstrap in `src/` will need to centralize this option construction and
  the `$bunfs` → `process.execPath` base-dir switch.

## Files

- `copy-pglite-assets.mjs` — copies the 4 PGLite assets from node_modules into `spike/assets/`.
- `pglite-explicit-blobs.ts` — the spike: builds explicit-blob opts + custom
  vector extension, runs vector query in memory and dataDir modes.

> Binaries (`memoark-spike`, `dist-run/`) and `assets/` are gitignored — only the
> source scripts and this README are committed.

---

# Spike B — react-force-graph-2d in Linux WebKitGTK (Tauri webview)

Phase-0 go/no-go #2 for MemoArk desktop packaging.

**Question:** Tauri uses the system webview. On Linux that is **WebKitGTK**, not
Chromium. The knowledge-graph page renders with `react-force-graph`. Does
`react-force-graph-2d` actually render inside Linux WebKitGTK, or does the
rendering-engine difference break it?

**Method:** A standalone React + Vite probe (`spike/webview-probe/`) renders a
4-node ring graph from **mock data** (no `/api`, no router, no backend — avoids a
false negative from an empty graph). A minimal Tauri 2.x shell
(`spike/src-tauri/`) wraps the probe's `dist/`. Because macOS cannot exercise
WebKitGTK, verification runs on a GitHub Actions **ubuntu-latest** runner that
installs `libwebkit2gtk-4.1-dev`, builds the Tauri app, launches it headless
under Xvfb, and screenshots the X root window
(`.github/workflows/spike-linux-webview.yml`).

## Result: **NO-GO ❌** (with an important caveat about root cause)

The screenshot artifact shows a **uniform blank frame** — the WebKitGTK default
white document background. **None** of the probe's content painted:

- not the dark `#102030` body background we set,
- not the bright-red `DOM_OK` DOM banner (a plain `<div>`, not canvas),
- not the force-graph canvas (green nodes / yellow links).

Two CI iterations, both green builds, both blank renders:

| Iteration | Window | Screenshot evidence |
|-----------|--------|---------------------|
| 1 (`5f70e3d`) | 800×600 (Tauri default) | Off-white WebKitGTK window mapped in the top-left; rest is Xvfb black. No graph. |
| 2 (`b86d7ac`) | 1280×900 + colored nodes + DOM banner + `zoomToFit` | Window fills screen (config applied) but the **entire** frame is uniform off-white. No body bg, no DOM banner, no canvas. |

CI logs (both runs), screenshot step:
- Binary found and launched: `binary: spike/src-tauri/target/release/memoark-spike`.
- `document.title = "RENDER_DONE"` **never** propagated — the `wmctrl -l | grep RENDER_DONE` loop timed out all 30 iterations in both runs (no `render done` printed). The screenshot was taken after the fixed `sleep`, ~32 s post-launch, so timing is not the cause.
- `libEGL warning: DRI3 error: Could not get DRI3 device` / `Ensure your X server supports DRI3 to get accelerated rendering` — no GPU/WebGL accel under Xvfb. (ForceGraph2D uses the 2D canvas context, so this alone should not blank it.)

### Honest read of the root cause

The frame being the WebKitGTK **empty-document default white** — with even a plain
DOM `<div>` failing to paint — means the React app **did not boot / paint at all**,
rather than "the canvas specifically failed." Because plain DOM also did not
render, the most plausible cause is that the **modern Vite 8 production bundle
(very recent ES syntax) did not execute in the older JavaScriptCore shipped with
ubuntu's `libwebkit2gtk-4.1`** — a JS-engine/transpile-target mismatch, not
necessarily a `react-force-graph`/canvas incompatibility. This spike therefore
proves the *out-of-the-box* path is broken; it does **not** isolate the failure to
the graph library. That distinction matters for the decision below.

## GO / NO-GO #2 — **NO-GO** (do not assume zero front-end changes for the Tauri/Linux path)

The assumption that "Tauri = zero front-end changes because it's the same web app"
does **not** hold for Linux WebKitGTK as tested. The probe rendered nothing.

### Recommended next steps (in order of cost)

1. **Pin the build target to what WebKitGTK 4.1 supports** (cheapest, likely root
   cause): set Vite `build.target` to a conservative baseline (e.g.
   `["es2020","safari14"]` / `webkit`-friendly), add legacy/transpile, and disable
   modern-only output. Re-run the same CI. If the `DOM_OK` banner then appears,
   the JS-engine theory is confirmed and the fix is a build-config change, not an
   architecture change. **This should be tried before any architecture decision.**
2. **2D-canvas confirmation**: once DOM paints, verify ForceGraph2D specifically.
   If DOM paints but canvas stays blank → force `nodeCanvasObject` / disable any
   WebGL path; ForceGraph2D is 2D-canvas so it should work without DRI3.
3. **WebKitGTK WebGL/GPU flags**: only relevant if a WebGL path is involved
   (`react-force-graph` 3D or `regl`); for the 2D variant, software canvas should
   suffice — DRI3 accel is not required.
4. **Escalate to spec §7.2 (Electron fallback)**: only if (1)–(3) fail, i.e. even a
   conservatively-transpiled build won't paint in WebKitGTK. Electron bundles
   Chromium, eliminating the engine-difference risk at the cost of bundle size.

### Files (Spike B)

- `webview-probe/{package.json,vite.config.ts,index.html,main.tsx}` — standalone
  React + Vite probe rendering a mock 4-node ring graph (no backend).
- `src-tauri/` — minimal Tauri 2.x shell; `frontendDist` → `../webview-probe/dist`;
  Cargo package renamed to `memoark-spike` so `cargo build` emits a binary the CI
  `find` matches; window sized 1280×900 to match the Xvfb screen.
- `../.github/workflows/spike-linux-webview.yml` — ubuntu CI: install WebKitGTK +
  Xvfb, build probe + Tauri, launch headless, screenshot, upload artifact.

> `webview-probe/node_modules`, `webview-probe/dist`, and `src-tauri/target` are
> gitignored. The CI rebuilds `dist/` and `target/` from source each run. The
> screenshot artifact (`linux-graph.png`) is downloaded per-run, not committed.
