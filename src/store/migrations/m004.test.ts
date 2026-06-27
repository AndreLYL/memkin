import { describe, expect, it } from "vitest";
import { Database } from "../database.js";

describe("M004 — identity_cache.display_name DROP NOT NULL", () => {
  it("allows NULL display_name after migration", async () => {
    // Database.create runs loadSchemaSql + runMigrations on a fresh in-memory PGLite.
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    await db.executor.query(
      "INSERT INTO identity_cache (platform, external_id, display_name) VALUES ($1, $2, $3)",
      ["feishu:chat", "group/oc_test_failure", null],
    );
    const row = await db.executor.query<{ display_name: string | null }>(
      "SELECT display_name FROM identity_cache WHERE external_id = $1",
      ["group/oc_test_failure"],
    );
    expect(row.rows[0]?.display_name).toBeNull();
    await db.executor.close();
  });
});
