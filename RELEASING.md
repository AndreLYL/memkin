# Releasing Memoark

Memoark is distributed as an npm package and runs via `npx memoark` or a global
install. Releases are automated by `.github/workflows/release.yml`.

## One-time setup

1. Create an npm **automation** access token with publish rights for the
   `memoark` package (npm → Account → Access Tokens → Generate → Automation).
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
npx memoark@latest          # run without installing
npm install -g memoark      # global install
```

## Roadmap: standalone single-file binaries

A future enhancement is shipping prebuilt single-file executables (no Node
required) for Windows / macOS / Linux via `bun build --compile`, attached to the
GitHub Release. This needs two prerequisites first (tracked separately):

1. Embed remaining runtime assets (`schema.sql` and the extractor prompt
   markdown) the same way migrations were inlined, so the compiled binary has no
   filesystem dependency.
2. Resolve `ink`'s optional `react-devtools-core` import (add the dependency or
   lazy-load the TUI) so the binary starts cleanly.

See `docs/PACKAGING_AND_README_RESEARCH.md` §4 for the full feasibility analysis.
