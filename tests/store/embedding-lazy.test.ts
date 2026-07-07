/**
 * F2 — EmbeddingService lazy construction + first-use guard.
 *
 * Contract:
 *   - The constructor is side-effect free: no OpenAI client is built and the
 *     injected `beforeFirstUse` guard is NOT called. This lets read-only
 *     commands (search FTS / export) build the stores without embedding
 *     credentials and without tripping the embedding-fingerprint gate.
 *   - The first real embedding operation (embedText / embedStale) runs the
 *     guard BEFORE touching the network client or the database. A throwing
 *     guard (fingerprint mismatch) therefore blocks only embedding paths.
 */
import { describe, expect, it, vi } from "vitest";
import { EmbeddingService } from "../../src/store/embedding.js";
import type { SqlConn } from "../../src/store/sql-executor.js";

const { constructorSpy, createSpy } = vi.hoisted(() => ({
  constructorSpy: vi.fn(),
  createSpy: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    embeddings = {
      create: createSpy.mockImplementation(
        async (params: { input: string | string[]; dimensions?: number }) => {
          const inputs = Array.isArray(params.input) ? params.input : [params.input];
          return {
            data: inputs.map((_: string, i: number) => ({
              embedding: Array(params.dimensions ?? 768).fill(0.5),
              index: i,
            })),
          };
        },
      ),
    };
    constructor(opts: unknown) {
      constructorSpy(opts);
    }
  },
}));

function makePgSpy(): { pg: SqlConn; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { pg: { query, exec: vi.fn() } as unknown as SqlConn, query };
}

describe("EmbeddingService — lazy construction", () => {
  it("constructor builds no OpenAI client and never calls the guard", () => {
    constructorSpy.mockClear();
    const guard = vi.fn();
    const { pg } = makePgSpy();

    new EmbeddingService(
      pg,
      { provider: "openai", model: "text-embedding-3-small", dimensions: 768 },
      { beforeFirstUse: guard },
    );

    expect(constructorSpy).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
  });

  it("embedText: a throwing guard blocks before any client construction", async () => {
    constructorSpy.mockClear();
    const guard = vi.fn(() => {
      throw new Error("Embedding fingerprint mismatch: db=a config=b");
    });
    const { pg } = makePgSpy();
    const svc = new EmbeddingService(
      pg,
      { provider: "openai", model: "text-embedding-3-small", dimensions: 768 },
      { beforeFirstUse: guard },
    );

    await expect(svc.embedText("hello")).rejects.toThrow(/fingerprint mismatch/i);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(constructorSpy).not.toHaveBeenCalled();
  });

  it("embedStale: a throwing guard blocks before any database access", async () => {
    const guard = vi.fn(() => {
      throw new Error("Embedding fingerprint mismatch: db=a config=b");
    });
    const { pg, query } = makePgSpy();
    const svc = new EmbeddingService(
      pg,
      { provider: "openai", model: "text-embedding-3-small", dimensions: 768 },
      { beforeFirstUse: guard },
    );

    await expect(svc.embedStale()).rejects.toThrow(/fingerprint mismatch/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("passing guard: embedText works and the client is constructed exactly once", async () => {
    constructorSpy.mockClear();
    const guard = vi.fn();
    const { pg } = makePgSpy();
    const svc = new EmbeddingService(
      pg,
      { provider: "openai", model: "text-embedding-3-small", dimensions: 768, apiKey: "sk-x" },
      { beforeFirstUse: guard },
    );

    const v1 = await svc.embedText("one");
    const v2 = await svc.embedText("two");
    expect(v1).toHaveLength(768);
    expect(v2).toHaveLength(768);
    expect(guard).toHaveBeenCalled();
    expect(constructorSpy).toHaveBeenCalledTimes(1);
  });

  it("no guard injected: behaves as before (backwards compatible)", async () => {
    const { pg } = makePgSpy();
    const svc = new EmbeddingService(pg, {
      provider: "openai",
      model: "text-embedding-3-small",
      dimensions: 768,
      apiKey: "sk-x",
    });
    await expect(svc.embedText("plain")).resolves.toHaveLength(768);
  });
});
