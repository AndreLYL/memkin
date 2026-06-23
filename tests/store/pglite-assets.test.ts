import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { describe, expect, it } from "vitest";
import { resolveAssetDir } from "../../src/store/pglite-assets.js";

describe("resolveAssetDir", () => {
  it("prefers explicit override (Tauri resource dir)", () => {
    expect(
      resolveAssetDir({ override: "/res/assets", execDir: "/app/bin", nodeModulesDir: "/nm" }),
    ).toBe("/res/assets");
  });
  it("falls back to execDir/assets in compiled binary", () => {
    expect(
      resolveAssetDir({ override: undefined, execDir: "/app/bin", nodeModulesDir: "/nm" }),
    ).toBe("/app/bin/assets");
  });
  it("uses node_modules pglite dist in dev (no execDir)", () => {
    expect(
      resolveAssetDir({
        override: undefined,
        execDir: undefined,
        nodeModulesDir: "/nm/pglite/dist",
      }),
    ).toBe("/nm/pglite/dist");
  });
});

describe("pg_trgm availability", () => {
  it("loads pg_trgm and supports ILIKE substring + similarity on Chinese", async () => {
    const pg = new PGlite({ extensions: { vector, pg_trgm } });
    await pg.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
    await pg.exec("CREATE TABLE t (body text); INSERT INTO t VALUES ('讨论了认证中间件的重构');");
    const hit = await pg.query<{ c: number }>(
      "SELECT count(*)::int AS c FROM t WHERE body ILIKE '%' || $1 || '%'",
      ["中间件"],
    );
    expect(hit.rows[0].c).toBe(1);
    const sim = await pg.query<{ s: number }>("SELECT similarity($1, body) AS s FROM t", [
      "认证中间件",
    ]);
    expect(Number(sim.rows[0].s)).toBeGreaterThan(0);
    await pg.close();
  });
});
