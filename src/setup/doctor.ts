import { Pool } from "pg";

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
