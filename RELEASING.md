# Releasing Memkin

Memkin is distributed as an npm package and runs via `npx memkin` or a global
install. Releases are automated by `.github/workflows/release.yml`.

## One-time setup

1. Create an npm **automation** access token with publish rights for the
   `memkin` package (npm → Account → Access Tokens → Generate → Automation).
2. Add it to the GitHub repo as a secret named **`NPM_TOKEN`**
   (Settings → Secrets and variables → Actions → New repository secret).

## Cutting a release

1. Bump `version` in `package.json` (follow semver), e.g. `0.3.0`.
2. Update `CHANGELOG.md`.
3. Commit on `main`.
4. Tag and push — the tag **must** match `package.json` (`v` + version):

   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```

The `Release` workflow then:

- verifies the tag matches `package.json`,
- runs typecheck + lint + tests + build,
- **smoke-tests `node dist/cli.js --help`** (proves the published artifact runs
  on plain Node — guards against missing bundled assets or unresolved imports),
- publishes to npm with provenance (`npm publish --provenance --access public`),
- creates a GitHub Release with auto-generated notes.

## After release

Users can install with:

```bash
npx memkin@latest          # run without installing
npm install -g memkin      # global install
```

## Standalone single-file binaries — status

`bun run compile` produces a single executable (`dist-bin/memkin`) via
`bun build --compile`. Project-owned assets are already self-contained: schema,
migrations, extractor prompts, and the version are embedded as constants, and
`react-devtools-core` is bundled so the binary starts.

**Current limitation:** commands that open the database fail in the compiled
binary with `Extension bundle not found: vector.tar.gz` / `ENOENT pglite.data`.
PGlite resolves its own WASM runtime and the pgvector extension bundle from the
filesystem at runtime, and `bun build --compile` does not embed those transitive
WASM assets (see [oven-sh/bun#6567](https://github.com/oven-sh/bun/issues/6567)).
So today the binary runs only the non-DB commands (`--version`, `--help`,
`doctor`). Because Memkin is database-centric, **npm/npx is the supported
install path** and the release workflow ships that.

Paths to a real "download-and-run" experience (pick one later):

1. **Ship binary + a small assets folder** (PGlite wasm/data + `vector.tar.gz`)
   and point PGlite at them — no longer truly single-file, but no Node needed.
2. **Tauri desktop app** — bundle the Bun backend as a sidecar with PGlite's
   assets as real files; this sidesteps the single-file WASM limitation and is
   also the better fit for the non-technical, double-click-to-run audience.
3. Wait for Bun #6567 / wire PGlite's explicit `wasmModule` + `fsBundle` blobs.

See `docs/PACKAGING_AND_README_RESEARCH.md` §4 for the full feasibility analysis.
