import { describe, it, expect } from "vitest";
import { Database } from "../../src/store/database.js";
import { makeIsolatedPgUrl } from "../test-helpers/pg-harness.js";

const BASE = process.env.MEMOARK_TEST_PG_URL;
const d = BASE ? describe : describe.skip;

d("concurrent bootstrap (advisory lock)", () => {
  it("two concurrent Database.create on same schema → no duplicate schema_migrations versions", async () => {
    const url = await makeIsolatedPgUrl(BASE!, "memoark_race");
    const cfg = { store: { engine: "postgres", database_url: url } } as any;
    const [a, b] = await Promise.all([Database.create(cfg), Database.create(cfg)]);
    const dup = await a.executor.query<{ version: number; c: number }>(
      "SELECT version, count(*)::int c FROM schema_migrations GROUP BY version HAVING count(*) > 1",
    );
    expect(dup.rows).toEqual([]); // no version applied twice
    // sanity: schema_migrations has the expected migrations (>0)
    const total = await a.executor.query<{ c: number }>("SELECT count(*)::int c FROM schema_migrations");
    expect(total.rows[0].c).toBeGreaterThan(0);
    await a.close();
    await b.close();
  });
});
