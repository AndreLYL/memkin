import { describe, expect, it } from "vitest";
import { createEngine } from "../../src/store/engine-factory.js";

describe("createEngine", () => {
  it("returns a PgliteExecutor when engine is pglite/undefined", async () => {
    const ex = await createEngine({ store: { engine: "pglite", data_dir: undefined } } as any);
    expect(typeof ex.query).toBe("function");
    await ex.close();
  });
  it("throws on unknown engine", async () => {
    await expect(createEngine({ store: { engine: "mongo" } } as any)).rejects.toThrow(/engine/i);
  });
});
