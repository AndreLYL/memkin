import { existsSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { createPgRuntimeProvider } from "../store/managed/pg-runtime-provider.js";
import { managedPaths, readManagedState } from "../store/managed/pg-paths.js";
import type { ManagedStoreConfig } from "../core/config.js";

export interface PgCheck {
  connected: boolean;
  vectorReady: boolean;
  canCreate: boolean;
}

/**
 * Checks Postgres connectivity and pgvector creatability for `memoark doctor`.
 *
 * vectorReady is true if:
 *   - the vector extension is already installed (pg_extension), OR
 *   - the extension is available AND the current role can CREATE it
 *     (probed via an actual CREATE EXTENSION IF NOT EXISTS — rolled back on success;
 *      if it permanently installs, that's fine too since IF NOT EXISTS is idempotent).
 */
export async function checkPostgres(url: string): Promise<PgCheck> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await pool.query("SELECT 1");

    // Already installed?
    const inst = await pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'");
    if (inst.rows.length > 0) {
      return { connected: true, vectorReady: true, canCreate: true };
    }

    // Available in the cluster?
    const avail = await pool.query("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'");
    if (avail.rows.length === 0) {
      return { connected: true, vectorReady: false, canCreate: false };
    }

    // Can the current role actually create it?
    // Try inside a savepoint so we can roll back even if it succeeds.
    let canCreate = false;
    try {
      await pool.query("BEGIN");
      await pool.query("SAVEPOINT _doctor_vector_probe");
      await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
      canCreate = true;
      await pool.query("ROLLBACK TO SAVEPOINT _doctor_vector_probe");
      await pool.query("RELEASE SAVEPOINT _doctor_vector_probe");
      await pool.query("ROLLBACK");
    } catch {
      try {
        await pool.query("ROLLBACK");
      } catch {
        // ignore cleanup errors
      }
      canCreate = false;
    }

    return { connected: true, vectorReady: canCreate, canCreate };
  } catch {
    return { connected: false, vectorReady: false, canCreate: false };
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Managed Postgres doctor check
// ---------------------------------------------------------------------------

export type DoctorSeverity = "ok" | "warn" | "fail";

export interface ManagedDoctorCheck {
  name: string;
  severity: DoctorSeverity;
  message: string;
}

export interface CheckManagedDeps {
  /** Home directory (e.g. os.homedir()) */
  home: string;
  /** From config.store.managed */
  managedConfig?: ManagedStoreConfig;
  /** Injected fs probe — defaults to existsSync; override in tests */
  fileExists?: (p: string) => boolean;
}

/**
 * Runs the three managed-Postgres doctor checks:
 *  1. Runtime binaries present and valid
 *  2. Cluster initialized (pgdata/PG_VERSION exists)
 *  3. Managed state file present (reports port/socketDir/pgVersion)
 *
 * Pure-ish: all side-effects are injectable via `deps`.
 */
export async function checkManagedPostgres(
  deps: CheckManagedDeps,
): Promise<ManagedDoctorCheck[]> {
  const { home, managedConfig, fileExists = existsSync } = deps;
  const PG_MAJOR = "17";
  const results: ManagedDoctorCheck[] = [];

  // 1 — runtime check
  let runtimeOk = false;
  try {
    const provider = createPgRuntimeProvider({
      home,
      pgMajor: PG_MAJOR,
      runtimeDir: managedConfig?.runtime_dir,
    });
    await provider.ensure();
    results.push({
      name: "managed-runtime",
      severity: "ok",
      message: "Managed Postgres runtime binaries present and valid",
    });
    runtimeOk = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({
      name: "managed-runtime",
      severity: "fail",
      message: `Managed Postgres runtime not ready: ${msg}`,
    });
  }

  // 2 — cluster initialized (pgdata/PG_VERSION)
  const paths = managedPaths(home, PG_MAJOR);
  const pgVersionFile = join(paths.pgdata, "PG_VERSION");
  if (fileExists(pgVersionFile)) {
    results.push({
      name: "managed-cluster",
      severity: "ok",
      message: `Cluster initialized at ${paths.pgdata}`,
    });
  } else {
    results.push({
      name: "managed-cluster",
      severity: runtimeOk ? "warn" : "fail",
      message: `Cluster not initialized at ${paths.pgdata} — run \`memoark up\` to provision`,
    });
  }

  // 3 — managed state file
  const state = readManagedState(paths);
  if (state) {
    results.push({
      name: "managed-state",
      severity: "ok",
      message:
        `Managed state present — pgVersion=${state.pgVersion}, port=${state.fixedPort}, socketDir=${state.socketDir}`,
    });
  } else {
    results.push({
      name: "managed-state",
      severity: "warn",
      message: "Managed state not present — not provisioned, run \`memoark up\`",
    });
  }

  return results;
}
