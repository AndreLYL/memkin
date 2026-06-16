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
