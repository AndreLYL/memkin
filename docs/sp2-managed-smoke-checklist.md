# SP2 Managed Postgres — Smoke Checklist (mac)

Manual end-to-end verification for the self-managed local Postgres engine. Run on macOS (arm64 or x64). Logic is unit-tested with an injectable command runner; this checklist exercises the REAL path with a real runtime.

## 0. Prerequisites — obtain a runtime

The managed engine needs a relocatable PG17 + pgvector + pg_trgm bundle. Two ways:

- **Built tarball (production path):** run the CI workflow `.github/workflows/build-pg-runtime.yml` on a macOS-15 runner (after pinning `PG_SHA256` / `PGVECTOR_SHA` / action SHAs and the `RUNTIME_MANIFEST` checksums in `src/store/managed/pg-runtime-provider.ts`). Download the asset.
- **Dev runtime (escape hatch):** assemble a directory matching the expected layout and point `MEMOARK_PG_RUNTIME_DIR` at it:
  ```
  <root>/bin/{postgres,pg_ctl,initdb,createdb,pg_isready,psql,pg_config}
  <root>/lib/postgresql/vector.dylib
  <root>/share/postgresql/extension/{vector.control,pg_trgm.control}
  ```
  e.g. from a local Homebrew PG17 + pgvector (dev-only; not relocatable/distributable).

```bash
export MEMOARK_PG_RUNTIME_DIR=/path/to/runtime   # dev escape hatch
```

## 1. Fresh install → managed by default (P1-5)

- [ ] On a machine with NO `~/.memoark/memoark.yaml` and NO `~/.memoark/data`: run `memoark init` (or `memoark up`). The generated config has `store.engine: managed`.
- [ ] On a machine WITH existing `~/.memoark/data` (legacy pglite): `memoark init` keeps `engine: pglite` — NEVER silently switches. (Verify the generated yaml.)
- [ ] `--force` regeneration of an existing config does NOT flip the engine.

## 2. `memoark up` — foreground provision (P0-3/P0-4)

- [ ] `memoark up` with `engine: managed` provisions in the FOREGROUND before enabling autostart: runtime ensured → `initdb` → cluster started → `createdb memoark` → `CREATE EXTENSION vector, pg_trgm` → full `Database.create` (schema + migrations) → then launchd is enabled.
- [ ] No 10s readiness timeout breach: the daemon's own startup is a fast warm path (`pg_ctl status` + maybe start), since all heavy work happened in the foreground.
- [ ] `~/.memoark/managed-pg.json` state exists with pgdata, fixedPort (54329), socketDir, runtimeRoot, pgVersion, pgCtlPath, logPath.

## 3. Security — two-phase HBA + socket-only (P0-2/P0-3)

- [ ] `~/.memoark/pgdata/postgresql.conf` has `listen_addresses = ''` (no TCP), `unix_socket_directories` → `~/.memoark/run`, `unix_socket_permissions = 0700`.
- [ ] `~/.memoark/run` is `chmod 0700`.
- [ ] After bootstrap, `~/.memoark/pgdata/pg_hba.conf` is the FINAL policy: `local memoark memoark trust` + reject everything else (NOT the temp bootstrap-user line).
- [ ] No TCP listener: `lsof -iTCP -sTCP:LISTEN | rg 54329` returns nothing (socket-only).
- [ ] Restart the daemon (`memoark down` then `memoark up`, or kill+relaunch): HBA stays the FINAL restrictive policy — NOT loosened back to the temp HBA.

## 4. Multi-agent shared memory (the north star)

- [ ] With the daemon running, point ≥2 MCP agents at `http://127.0.0.1:3928/mcp`. Concurrent reads/writes succeed with NO single-writer lock contention (real Postgres concurrency).
- [ ] `query`/`put_page` via MCP work end-to-end; vector search returns results (`SELECT '[...]'::vector` path exercised).

## 5. Health & recovery (P1-1/P1-2)

- [ ] `GET /health` returns 200 with `pg_ok: true` while PG is up.
- [ ] Kill the postmaster (`pg_ctl stop` or `kill <postmaster pid>`). Within the recovery loop interval the supervisor restarts it (clears any stale `postmaster.pid`); `/health` recovers to `pg_ok: true`. While down, `/health` is 503.
- [ ] Kill the daemon process (NOT the cluster): the postmaster keeps running; relaunch the daemon → it reuses the running cluster (`pg_ctl status` hit), data uninterrupted.

## 6. `memoark down` — three-state (P0-3)

- [ ] With the daemon installed and running: `memoark down` bootouts the service, then stops the managed PG (`pg_ctl stop -m fast`) and removes daemon state.
- [ ] CLI-only PG (no daemon job): `memoark down` recognizes `notLoaded` and still stops the managed PG safely (does NOT refuse).
- [ ] If bootout fails / daemon still alive: `memoark down` does NOT stop PG and does NOT wipe daemon state; reports an actionable error.

## 7. Config-center store change = restart-required (P1-2)

- [ ] Change `store.engine`/`store.managed` in the config UI and save: the server logs a restart-required warning and does NOT silently hot-swap the database (the running daemon keeps its current connection until restart).

## 8. doctor & status

- [ ] `memoark doctor` (engine managed) reports runtime/cluster/extension health WITHOUT triggering a download (uses `verify()`).
- [ ] `memoark status` shows the managed PG: pgdata, port, socketDir, pgVersion, cluster running state — secret-free.

## 9. Failure UX (hard-fail, never silent pglite)

- [ ] Missing runtime + no `MEMOARK_PG_RUNTIME_DIR` → hard-fail with actionable message (run `memoark up`); never silently falls back to pglite.
- [ ] Corrupt/mismatched checksum on download → hard-fail with expected-vs-actual.
- [ ] PG_VERSION / runtime major mismatch → hard-fail with backup/migration guidance; NEVER auto-wipes pgdata.

## 10. No regression for existing users

- [ ] An `engine: pglite` config behaves exactly as before (data_dir expanded, no managed code path).
- [ ] An `engine: postgres` (external DATABASE_URL) config connects to the external DB (P0-1 fix — previously the CLI silently forced pglite).
