import { Pool } from "pg";

/** Returns a DSN scoped to a fresh isolated schema; extensions pre-installed in public (visible cross-schema). */
export async function makeIsolatedPgUrl(base: string, schema: string): Promise<string> {
  const admin = new Pool({ connectionString: base });
  try {
    await admin.query("CREATE EXTENSION IF NOT EXISTS vector");
    await admin.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schema}`);
  } finally {
    await admin.end();
  }
  const u = new URL(base);
  // connection-level: every connection from this pool gets search_path set via libpq options
  u.searchParams.set("options", `-c search_path=${schema},public`);
  return u.toString();
}
