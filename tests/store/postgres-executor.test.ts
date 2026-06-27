import { describe, it, expect } from "vitest";
import { makeIsolatedPgUrl } from "../test-helpers/pg-harness.js";

const BASE = process.env.MEMOARK_TEST_PG_URL;
const d = BASE ? describe : describe.skip;

d("PostgresExecutor", () => {
  it("query {rows}, multi-statement exec, transaction commit + rollback", async () => {
    const url = await makeIsolatedPgUrl(BASE!, "memoark_pgexec_test");
    const { PostgresExecutor } = await import("../../src/store/postgres-executor.js");
    const ex = await PostgresExecutor.create({ store: { engine: "postgres", database_url: url } } as any);
    await ex.exec("CREATE TABLE t (id int, e vector(3)); CREATE INDEX ix ON t USING hnsw (e vector_cosine_ops)");
    await ex.query("INSERT INTO t VALUES ($1, $2::vector)", [1, "[0.1,0.2,0.3]"]);
    expect((await ex.query<{ id: number }>("SELECT id FROM t")).rows).toEqual([{ id: 1 }]);
    await expect(ex.transaction(async (tx) => { await tx.query("INSERT INTO t VALUES (2,'[0,0,0]')"); throw new Error("boom"); })).rejects.toThrow("boom");
    expect((await ex.query<{ c: number }>("SELECT count(*)::int c FROM t")).rows[0].c).toBe(1);
    await ex.close();
  });
  it("bootstrap runs fn under advisory lock", async () => {
    const url = await makeIsolatedPgUrl(BASE!, "memoark_pgboot_test");
    const { PostgresExecutor } = await import("../../src/store/postgres-executor.js");
    const ex = await PostgresExecutor.create({ store: { engine: "postgres", database_url: url } } as any);
    let ran = false;
    await ex.bootstrap(async (conn) => { await conn.exec("CREATE TABLE b (id int)"); ran = true; });
    expect(ran).toBe(true);
    await ex.close();
  });
});
