# SP2 Follow-up — Publish the managed Postgres runtime

SP2 ships the full managed-Postgres engine (supervisor, two-phase HBA, recovery, CLI/daemon wiring), but the **actual relocatable PG17 + pgvector tarball is not published yet**. Until it is, `memoark up` with `engine: managed` **fails fast** with an actionable error (it never silently falls back to PGLite). This doc is the remaining "publish" step — it requires a real macOS CI run and cannot be done locally.

## State today

- Build pipeline pinned and ready: `scripts/build-pg-runtime.sh` + `.github/workflows/build-pg-runtime.yml`. PG/pgvector sha256 and all GHA action commit SHAs are pinned — **no manual sha entry needed to run it**.
- `RUNTIME_MANIFEST` in `src/store/managed/pg-runtime-provider.ts` still has placeholder asset checksums (`TODO_PIN_ARM64_SHA256` / `TODO_PIN_X64_SHA256`) and a placeholder `baseUrl`. These can only be filled **after** the tarballs are built and attached to a release — their values ARE the build output.

## Steps to publish (post-merge, on GitHub)

1. **Trigger the build.** Either:
   - Actions → `build-pg-runtime` → "Run workflow" (workflow_dispatch), or
   - push a tag matching `pg-runtime-*` (e.g. `git tag pg-runtime-17.5-1 && git push origin pg-runtime-17.5-1`) to also run the `release` job that attaches assets.
2. **Let it build + smoke-test** on `macos-15` (arm64) and `macos-15-intel` (x64). The gated smoke step runs `initdb` → start → `createdb memoark` → `CREATE EXTENSION vector, pg_trgm` → `SELECT '[1,2,3]'::vector` on a clean runner. The `otool -l` audit in the script fails the build if any binary links outside `/usr/lib`, `/System`, or `@rpath`/`@loader_path` (proves relocatability).
3. **Collect the outputs** — two assets + their sidecars:
   - `memoark-pg-darwin-arm64.tar.gz` + `.sha256`
   - `memoark-pg-darwin-x64.tar.gz` + `.sha256`
4. **Pin the manifest** in `src/store/managed/pg-runtime-provider.ts`:
   ```ts
   export const RUNTIME_MANIFEST = {
     version: "17.5-1",
     baseUrl: "https://github.com/AndreLYL/memoark/releases/download/pg-runtime-17.5-1", // confirm this matches the tag
     assets: {
       arm64: { file: "memoark-pg-darwin-arm64.tar.gz", sha256: "<arm64 .sha256 contents>" },
       x64:   { file: "memoark-pg-darwin-x64.tar.gz",   sha256: "<x64 .sha256 contents>" },
     },
   } as const;
   ```
   Bump `version` and the tag together whenever the runtime is rebuilt.
5. **Verify end-to-end** on a real mac (see `docs/sp2-managed-smoke-checklist.md`): `memoark up` should download the tarball, verify the sha256, extract, `initdb`, start, bootstrap, and serve — zero config.

## Optional, later — make managed the default beyond mac-fresh-install

Today managed is chosen only on a genuine fresh macOS install (`new-install.ts`); the silent `createStores` default stays pglite. Flipping the broader default belongs in **SP2b** (after linux/win runtimes exist), not here.

## Guard rails already in place (so a half-published state is safe)

- Placeholder sha → `ensure()` throws "checksum not pinned" **before any network I/O**.
- Missing runtime + no `MEMOARK_PG_RUNTIME_DIR` → hard-fail "run `memoark up`".
- `MEMOARK_PG_RUNTIME_DIR` escape hatch lets developers point at a hand-built runtime without the published tarball.
