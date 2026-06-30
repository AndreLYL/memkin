import { describe, expect, it, vi } from "vitest";
import { createStores, defaultManagedDeps, resolveDb } from "./cli-stores.js";
import type { LoadedConfig } from "./core/config.js";
import type { ManagedSupervisor } from "./store/managed/managed-engine.js";
import type { RuntimePaths } from "./store/managed/pg-runtime-provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal executor stub that satisfies SqlExecutor without crashing stores */
function makeExecutorStub() {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "query") return async () => ({ rows: [] });
        if (prop === "exec") return async () => {};
        if (prop === "transaction")
          return async (fn: (c: unknown) => Promise<unknown>) =>
            fn({
              query: async () => ({ rows: [] }),
              exec: async () => {},
            });
        if (prop === "bootstrap")
          return async (fn: (c: unknown) => Promise<void>) =>
            fn({
              query: async () => ({ rows: [] }),
              exec: async () => {},
            });
        if (prop === "close") return async () => {};
        return undefined;
      },
    },
  );
}

/** Minimal Database stub */
function makeDbStub(overrides?: object) {
  return {
    executor: makeExecutorStub(),
    embeddingDimensions: 1536,
    close: async () => {},
    ...overrides,
  } as unknown as import("./store/database.js").Database;
}

/** Build a minimal LoadedConfig for a given engine */
function makeConfig(
  engine: "pglite" | "postgres" | "managed",
  extra: Partial<LoadedConfig> = {},
): LoadedConfig {
  return {
    store: {
      engine,
      data_dir: engine === "pglite" ? "~/x" : undefined,
      database_url: engine === "postgres" ? "postgresql://localhost/test" : undefined,
    },
    embedding: {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 768,
    },
    search: {
      pool_by_page: 10,
      llm_rewrite: false,
    },
    __context: {
      configPath: "/tmp/memoark.yaml",
      projectRoot: "/tmp",
      missingEnvVars: [],
    },
    ...extra,
  } as LoadedConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveDb — engine branching", () => {
  it("pglite: expands data_dir to absolute path and passes dims", async () => {
    const config = makeConfig("pglite"); // data_dir: "~/x"
    const stub = makeDbStub();
    const dbCreate = vi.fn().mockResolvedValue(stub);

    await resolveDb(config, { dbCreate });

    expect(dbCreate).toHaveBeenCalledTimes(1);
    const [receivedConfig, receivedOpts] = dbCreate.mock.calls[0];

    // data_dir must be absolute (expanded from ~/x)
    expect(typeof receivedConfig.store.data_dir).toBe("string");
    expect(receivedConfig.store.data_dir).not.toMatch(/^~/);
    expect(receivedConfig.store.data_dir).toMatch(/\/x$/);

    // engine must be pglite
    expect(receivedConfig.store.engine).toBe("pglite");

    // dims must come from config.embedding.dimensions (768)
    expect(receivedOpts.embeddingDimensions).toBe(768);
  });

  it("postgres: passes config through WITHOUT forcing pglite (P0-1 regression)", async () => {
    const config = makeConfig("postgres");
    const stub = makeDbStub();
    const dbCreate = vi.fn().mockResolvedValue(stub);

    await resolveDb(config, { dbCreate });

    expect(dbCreate).toHaveBeenCalledTimes(1);
    const [receivedConfig, receivedOpts] = dbCreate.mock.calls[0];

    // MUST NOT be downgraded to pglite
    expect(receivedConfig.store.engine).toBe("postgres");
    // database_url must survive intact
    expect(receivedConfig.store.database_url).toBe("postgresql://localhost/test");
    // dims
    expect(receivedOpts.embeddingDimensions).toBe(768);
  });

  it("managed: calls provision, threads supervisor, passes pgConfig to dbCreate", async () => {
    const config = makeConfig("managed");
    const sentinel = {
      ensureUp: vi.fn(),
      status: vi.fn().mockResolvedValue("running"),
      restartIfDown: vi.fn().mockResolvedValue(false),
      dispose: vi.fn(),
    } satisfies ManagedSupervisor;
    const pgConfig = makeConfig("postgres");
    const provision = vi.fn().mockResolvedValue({ supervisor: sentinel, pgConfig });
    const stub = makeDbStub();
    const dbCreate = vi.fn().mockResolvedValue(stub);

    const result = await resolveDb(config, { dbCreate, provision });

    // provision called with the original config
    expect(provision).toHaveBeenCalledTimes(1);
    expect(provision.mock.calls[0][0]).toBe(config);

    // dbCreate received the pgConfig from provision
    expect(dbCreate).toHaveBeenCalledTimes(1);
    expect(dbCreate.mock.calls[0][0]).toBe(pgConfig);

    // returned supervisor is the sentinel
    expect(result.supervisor).toBe(sentinel);
  });

  it("dims always come from config.embedding.dimensions (non-default 768)", async () => {
    for (const engine of ["pglite", "postgres"] as const) {
      const config = makeConfig(engine);
      const stub = makeDbStub();
      const dbCreate = vi.fn().mockResolvedValue(stub);

      await resolveDb(config, { dbCreate });

      const [, opts] = dbCreate.mock.calls[0];
      expect(opts.embeddingDimensions).toBe(768);
    }
  });
});

describe("createStores — integration with resolveDb", () => {
  it("returns all expected store keys including supervisor for managed", async () => {
    const config = makeConfig("managed");
    const sentinel = {
      ensureUp: vi.fn(),
      status: vi.fn().mockResolvedValue("running"),
      restartIfDown: vi.fn().mockResolvedValue(false),
      dispose: vi.fn(),
    } satisfies ManagedSupervisor;
    const pgConfig = makeConfig("postgres");
    const provision = vi.fn().mockResolvedValue({ supervisor: sentinel, pgConfig });
    const stub = makeDbStub();
    const dbCreate = vi.fn().mockResolvedValue(stub);

    const stores = await createStores(config, { dbCreate, provision });

    expect(stores.db).toBe(stub);
    expect(stores.supervisor).toBe(sentinel);
    expect(stores.pages).toBeDefined();
    expect(stores.chunks).toBeDefined();
    expect(stores.embedding).toBeDefined();
    expect(stores.search).toBeDefined();
    expect(stores.graph).toBeDefined();
    expect(stores.tags).toBeDefined();
    expect(stores.timeline).toBeDefined();
  });

  it("supervisor is undefined for pglite", async () => {
    const config = makeConfig("pglite");
    const stub = makeDbStub();
    const dbCreate = vi.fn().mockResolvedValue(stub);

    const stores = await createStores(config, { dbCreate });

    expect(stores.supervisor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// defaultManagedDeps — stub is gone, real supervisor is wired (Phase 3 WARNING-1)
// ---------------------------------------------------------------------------

describe("defaultManagedDeps — makeSupervisor returns real supervisor", () => {
  it("does NOT throw and returns an object with ensureUp/status/restartIfDown/dispose", () => {
    const config = makeConfig("managed");
    const deps = defaultManagedDeps(config);

    // Minimal RuntimePaths that satisfies the type without touching the FS
    const fakeRuntime: RuntimePaths = {
      pgMajor: "17",
      root: "/tmp/fake-pg",
      bin: "/tmp/fake-pg/bin",
      postgres: "/tmp/fake-pg/bin/postgres",
      pgCtl: "/tmp/fake-pg/bin/pg_ctl",
      initdb: "/tmp/fake-pg/bin/initdb",
      createdb: "/tmp/fake-pg/bin/createdb",
      pgIsReady: "/tmp/fake-pg/bin/pg_isready",
      libDir: "/tmp/fake-pg/lib/postgresql",
      extensionDir: "/tmp/fake-pg/share/postgresql/extension",
    };

    // Must not throw — this was the failing assertion before the fix
    const supervisor = deps.makeSupervisor(fakeRuntime, "/tmp/fake-home");

    // Must expose all methods required by ManagedSupervisor
    expect(typeof supervisor.ensureUp).toBe("function");
    expect(typeof supervisor.status).toBe("function");
    expect(typeof supervisor.restartIfDown).toBe("function");
    expect(typeof supervisor.dispose).toBe("function");
  });
});
