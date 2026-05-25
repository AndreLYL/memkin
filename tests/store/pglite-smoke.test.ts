import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { describe, expect, it } from "vitest";

describe("PGLite smoke test", () => {
  it("initializes with pgvector extension", async () => {
    const db = new PGlite({ extensions: { vector } });
    await db.exec("CREATE EXTENSION IF NOT EXISTS vector");
    const result = await db.query("SELECT 1 AS ok");
    expect(result.rows[0].ok).toBe(1);

    // Verify vector type works
    await db.exec("CREATE TABLE test_vec (id SERIAL, v vector(3))");
    await db.exec("INSERT INTO test_vec (v) VALUES ('[1,2,3]')");
    const vecResult = await db.query("SELECT v FROM test_vec");
    expect(vecResult.rows).toHaveLength(1);

    await db.close();
  });
});
