import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../../core/config.js";
import { provisionManaged } from "./managed-engine.js";

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), "mk-")); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

const fakeRuntime = { pgMajor: "17", root: "/rt", bin: "/rt/bin", postgres: "/rt/bin/postgres", pgCtl: "/rt/bin/pg_ctl", initdb: "/rt/bin/initdb", createdb: "/rt/bin/createdb", pgIsReady: "/rt/bin/pg_isready", libDir: "/rt/lib", extensionDir: "/rt/ext" };

function makeDeps(spy: { ensured: boolean }) {
  return {
    home,
    provider: { ensure: async () => fakeRuntime },
    makeSupervisor: (_rt: unknown, _home: string) => ({
      ensureUp: async () => { spy.ensured = true; },
    }),
  };
}

describe("provisionManaged", () => {
  it("clones full config, replaces only store (P0-1)", async () => {
    const cfg = {
      embedding: { dimensions: 768, provider: "openai", model: "m" },
      store: { engine: "managed", pool_size: 7 },
    } as unknown as Config;
    const spy = { ensured: false };
    const { pgConfig, supervisor } = await provisionManaged(cfg, makeDeps(spy));
    expect(spy.ensured).toBe(true);
    expect(supervisor).toBeDefined();
    // embedding preserved (critical: fingerprint reads it)
    expect(pgConfig.embedding).toEqual(cfg.embedding);
    // store swapped to postgres + derived url with fixed port + preserved pool_size
    expect(pgConfig.store.engine).toBe("postgres");
    expect(pgConfig.store.database_url).toContain("port=54329");
    expect(pgConfig.store.pool_size).toBe(7);
    // original config not mutated
    expect(cfg.store.engine).toBe("managed");
    // pglite data_dir must not bleed into postgres config
    expect(pgConfig.store.data_dir).toBeUndefined();
  });

  it("runs ensure + ensureUp inside the managed lock (serialized)", async () => {
    const cfg = { embedding: { dimensions: 768 }, store: { engine: "managed" } } as unknown as Config;
    const order: string[] = [];
    const deps = {
      home,
      provider: { ensure: async () => { order.push("ensure"); return fakeRuntime; } },
      makeSupervisor: () => ({ ensureUp: async () => { order.push("ensureUp"); } }),
    };
    await provisionManaged(cfg, deps);
    expect(order).toEqual(["ensure", "ensureUp"]);
  });
});
