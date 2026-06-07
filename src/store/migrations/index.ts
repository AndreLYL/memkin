import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigration(version: number, name: string): Migration {
  const filename = `${String(version).padStart(3, "0")}_${name}.sql`;
  const sql = readFileSync(join(__dirname, filename), "utf-8");
  return { version, name, sql };
}

// Add new migrations here, in ascending version order.
export const MIGRATIONS: Migration[] = [
  loadMigration(1, "lifecycle_columns"),
  loadMigration(2, "provenance_columns"),
  loadMigration(3, "lifecycle_tier"),
];

export async function runMigrations(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await pg.query<{ version: number }>("SELECT version FROM schema_migrations");
  const appliedVersions = new Set(applied.rows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    await pg.exec(migration.sql);
    await pg.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
  }
}
