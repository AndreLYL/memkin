import { describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { makeIsolatedPgUrl } from "../test-helpers/pg-harness.js";

const BASE = process.env.MEMKIN_TEST_PG_URL;
type Case = { name: string; makeConfig: () => Promise<any> };
const cases: Case[] = [
  { name: "pglite", makeConfig: async () => ({ store: { engine: "pglite" } }) },
  ...(BASE
    ? [
        {
          name: "postgres",
          makeConfig: async () => ({
            store: {
              engine: "postgres",
              database_url: await makeIsolatedPgUrl(BASE, "memkin_parity"),
            },
          }),
        },
      ]
    : []),
];

describe.each(cases)("PageStore + memkin_meta parity on $name", ({ makeConfig }) => {
  it("putPage/getPage roundtrip and memkin_meta exists", async () => {
    const db = await Database.create((await makeConfig()) as any);
    const pages = new PageStore(db.executor);
    await pages.putPage("decisions/x", "---\ntitle: X\ntype: decision\n---\nbody");
    const p = await pages.getPage("decisions/x");
    expect(p?.slug).toBe("decisions/x");
    // memkin_meta table must exist (created by schema bootstrap)
    const meta = await db.executor.query<{ c: number }>("SELECT count(*)::int c FROM memkin_meta");
    expect(meta.rows[0].c).toBeGreaterThanOrEqual(0);
    await db.close();
  });
});
