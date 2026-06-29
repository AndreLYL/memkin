import { describe, expect, it } from "vitest";
import { validateStoreConfig } from "../../src/core/config.js";

describe("validateStoreConfig", () => {
  it("postgres without database_url throws", () => {
    expect(() => validateStoreConfig({ engine: "postgres" })).toThrow(/database_url/);
  });

  it("unresolved ${ENV} throws", () => {
    expect(() =>
      validateStoreConfig({ engine: "postgres", database_url: "${DATABASE_URL}" }, [
        "DATABASE_URL",
      ]),
    ).toThrow(/未解析|unresolved|DATABASE_URL/i);
  });

  it("resolved ${ENV} (not in missing) passes", () => {
    expect(() =>
      validateStoreConfig({ engine: "postgres", database_url: "${DATABASE_URL}" }, []),
    ).not.toThrow();
  });

  it("invalid engine throws", () => {
    expect(() => validateStoreConfig({ engine: "mongo" } as any)).toThrow(/engine/i);
  });

  it("bad pool_size throws", () => {
    expect(() =>
      validateStoreConfig({ engine: "postgres", database_url: "postgres://x/y", pool_size: 0 }),
    ).toThrow(/pool_size/i);
  });

  it("non-integer pool_size throws", () => {
    expect(() =>
      validateStoreConfig({
        engine: "postgres",
        database_url: "postgres://x/y",
        pool_size: 1.5,
      }),
    ).toThrow(/pool_size/i);
  });

  it("bad url throws", () => {
    expect(() => validateStoreConfig({ engine: "postgres", database_url: "not-a-url" })).toThrow(
      /url/i,
    );
  });

  it("pglite/empty passes", () => {
    expect(() => validateStoreConfig({})).not.toThrow();
    expect(() => validateStoreConfig({ engine: "pglite" })).not.toThrow();
  });

  it("postgres with valid url and pool_size passes", () => {
    expect(() =>
      validateStoreConfig({
        engine: "postgres",
        database_url: "postgres://user:pw@host/db",
        pool_size: 5,
      }),
    ).not.toThrow();
  });

  // engine=managed tests
  it("accepts engine=managed without database_url", () => {
    expect(() => validateStoreConfig({ engine: "managed" })).not.toThrow();
  });

  it("accepts store.managed with runtime_dir only", () => {
    expect(() =>
      validateStoreConfig({ engine: "managed", managed: { runtime_dir: "/tmp/pg" } }),
    ).not.toThrow();
  });

  it("rejects store.managed.runtime_dir empty string", () => {
    expect(() =>
      validateStoreConfig({ engine: "managed", managed: { runtime_dir: "" } }),
    ).toThrow(/runtime_dir/i);
  });

  it("rejects unknown engine and message lists managed as supported", () => {
    expect(() => validateStoreConfig({ engine: "mongo" } as any)).toThrow(/managed/i);
  });
});
