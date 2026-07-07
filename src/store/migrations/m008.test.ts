import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { describe, expect, it } from "vitest";
import { PersonIdentityStore } from "../../core/person-identity.js";
import { Database, loadSchemaSql } from "../database.js";
import { runMigrations } from "../migrations/index.js";
import type { SqlConn } from "../sql-executor.js";

function pgAsConn(pg: PGlite): SqlConn {
  return {
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
      pg.query<T>(sql, params),
    exec: (sql: string) => pg.exec(sql).then(() => undefined),
  };
}

describe("M008 — generalize person_handles to entity_handles", () => {
  it("creates entity_handles with entity_type + scope namespace columns", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.query(
        `INSERT INTO entity_handles (entity_type, scope, kind, value, canonical_slug, strength)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ["project", "global", "name", "memkin", "project/memkin", "strong"],
      );
      const row = await db.executor.query<{
        entity_type: string;
        scope: string;
        kind: string;
        value: string;
        canonical_slug: string;
        strength: string;
        created_at: string;
      }>("SELECT * FROM entity_handles WHERE value = $1", ["memkin"]);
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0].entity_type).toBe("project");
      expect(row.rows[0].scope).toBe("global");
      expect(row.rows[0].canonical_slug).toBe("project/memkin");
    } finally {
      await db.close();
    }
  });

  it("namespaces handles by entity type: same (kind, value) may map per type", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      // "Codex" as a tool and "Codex" as a project must coexist.
      await db.executor.query(
        `INSERT INTO entity_handles (entity_type, scope, kind, value, canonical_slug)
         VALUES ('tool', 'global', 'name', 'codex', 'tool/codex'),
                ('project', 'global', 'name', 'codex', 'project/codex')`,
      );
      const rows = await db.executor.query<{ entity_type: string; canonical_slug: string }>(
        "SELECT entity_type, canonical_slug FROM entity_handles WHERE value = 'codex' ORDER BY entity_type",
      );
      expect(rows.rows).toEqual([
        { entity_type: "project", canonical_slug: "project/codex" },
        { entity_type: "tool", canonical_slug: "tool/codex" },
      ]);
      // But within one namespace the (entity_type, scope, kind, value) key is unique.
      await expect(
        db.executor.query(
          `INSERT INTO entity_handles (entity_type, scope, kind, value, canonical_slug)
           VALUES ('tool', 'global', 'name', 'codex', 'tool/codex-2')`,
        ),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("rejects unknown entity types via the CHECK constraint", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await expect(
        db.executor.query(
          `INSERT INTO entity_handles (entity_type, scope, kind, value, canonical_slug)
           VALUES ('gadget', 'global', 'name', 'x', 'gadget/x')`,
        ),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  });

  it("preserves pre-migration person handle rows as entity_type='person'", async () => {
    // Fresh PGlite with only schema.sql applied — legacy person_handles rows must
    // survive the generalization with entity_type='person'.
    const freshPg = new PGlite({ extensions: { vector, pg_trgm } });
    try {
      await freshPg.exec(loadSchemaSql());
      await freshPg.query(
        `INSERT INTO person_handles (kind, value, canonical_slug, strength)
         VALUES ('name', '王建都', 'person/wang-jiandu', 'strong'),
                ('nickname', '龙哥', 'person/li-yinglong', 'weak')`,
      );

      await runMigrations(pgAsConn(freshPg));

      const rows = await freshPg.query<{
        entity_type: string;
        scope: string;
        kind: string;
        value: string;
        canonical_slug: string;
        strength: string;
      }>(
        "SELECT entity_type, scope, kind, value, canonical_slug, strength FROM entity_handles ORDER BY kind",
      );
      expect(rows.rows).toEqual([
        {
          entity_type: "person",
          scope: "global",
          kind: "name",
          value: "王建都",
          canonical_slug: "person/wang-jiandu",
          strength: "strong",
        },
        {
          entity_type: "person",
          scope: "global",
          kind: "nickname",
          value: "龙哥",
          canonical_slug: "person/li-yinglong",
          strength: "weak",
        },
      ]);
    } finally {
      await freshPg.close();
    }
  });

  it("keeps a person_handles compat view so legacy readers still see person rows", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.query(
        `INSERT INTO entity_handles (entity_type, scope, kind, value, canonical_slug)
         VALUES ('person', 'global', 'email', 'alice@example.com', 'person/alice'),
                ('tool', 'global', 'name', 'vitest', 'tool/vitest')`,
      );
      const rows = await db.executor.query<{ kind: string; value: string }>(
        "SELECT kind, value FROM person_handles ORDER BY kind",
      );
      // Only the person row is visible through the compat view.
      expect(rows.rows).toEqual([{ kind: "email", value: "alice@example.com" }]);
    } finally {
      await db.close();
    }
  });

  it("survives schema.sql re-application: person_handles table is NOT resurrected", async () => {
    // Database.create re-runs schema.sql on every boot. After M008 renamed the
    // table, the compat view must occupy the person_handles name so
    // CREATE TABLE IF NOT EXISTS person_handles skips instead of recreating a
    // parallel (empty) registry.
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    try {
      await db.executor.query(
        `INSERT INTO entity_handles (entity_type, scope, kind, value, canonical_slug)
         VALUES ('person', 'global', 'name', 'bob', 'person/bob')`,
      );
      // Simulate a second boot: re-apply schema.sql + migrations.
      await db.executor.exec(loadSchemaSql(768));
      await runMigrations(db.executor);

      const kind = await db.executor.query<{ relkind: string }>(
        "SELECT relkind FROM pg_class WHERE relname = 'person_handles'",
      );
      expect(kind.rows).toEqual([{ relkind: "v" }]); // still a view, not a table
      const rows = await db.executor.query<{ value: string }>("SELECT value FROM person_handles");
      expect(rows.rows).toEqual([{ value: "bob" }]); // data intact
    } finally {
      await db.close();
    }
  });

  it("old person handles still resolve through PersonIdentityStore after migration", async () => {
    const freshPg = new PGlite({ extensions: { vector, pg_trgm } });
    try {
      await freshPg.exec(loadSchemaSql());
      await freshPg.query(
        `INSERT INTO person_handles (kind, value, canonical_slug, strength)
         VALUES ('email', 'carol@example.com', 'person/carol', 'strong')`,
      );
      await runMigrations(pgAsConn(freshPg));

      const store = new PersonIdentityStore({
        query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) =>
          freshPg.query<T>(sql, params),
        exec: (sql: string) => freshPg.exec(sql).then(() => undefined),
        transaction: async <T>(fn: (tx: SqlConn) => Promise<T>) => fn(pgAsConn(freshPg)),
        close: async () => {},
        bootstrap: async (fn: (conn: SqlConn) => Promise<void>) => fn(pgAsConn(freshPg)),
      });
      expect(await store.resolveHandle("email", "carol@example.com")).toBe("person/carol");
    } finally {
      await freshPg.close();
    }
  });
});
