import { describe, expect, it } from "vitest";
import { PgliteExecutor } from "../../src/store/pglite-executor.js";

describe("PgliteExecutor", () => {
  it("query/exec/transaction work in-memory (no dataDir = no lock)", async () => {
    const ex = await PgliteExecutor.create(undefined, {});
    await ex.exec("CREATE TABLE t (id int, v text)");
    await ex.query("INSERT INTO t VALUES ($1,$2)", [1, "a"]);
    const r = await ex.query<{ id: number; v: string }>("SELECT * FROM t");
    expect(r.rows).toEqual([{ id: 1, v: "a" }]);
    const out = await ex.transaction(async (tx) => {
      await tx.query("INSERT INTO t VALUES ($1,$2)", [2, "b"]);
      return (await tx.query("SELECT count(*)::int AS c FROM t")).rows[0];
    });
    expect((out as { c: number }).c).toBe(2);
    await ex.close();
  });
});
