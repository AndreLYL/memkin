/**
 * Tests for embedding fingerprint fail-fast logic.
 *
 * Strategy: use an in-memory PGLite DB (no data_dir) to avoid the ~4 GB
 * WASM heap cost of initialising a disk-backed cluster inside vitest's fork
 * worker. We seed memoark_meta directly, then verify the mismatch detection.
 *
 * "Reopening" semantics are achieved by:
 *   1. Database.create writes the fingerprint on first open.
 *   2. We call the exported ensureEmbeddingConsistency directly on the same
 *      connection with a different config — this is the exact code path that
 *      Database.create would take on a real reopen.
 */
import { describe, it, expect } from "vitest";
import { Database } from "../../src/store/database.js";
import {
  fingerprintString,
  writeMeta,
  readMeta,
} from "../../src/store/store-meta.js";
import { ensureEmbeddingConsistencyForTest } from "../../src/store/database.js";

describe("embedding fingerprint — unit (in-memory)", () => {
  it("fingerprintString produces expected format", () => {
    expect(
      fingerprintString({ provider: "ollama", model: "nomic-embed-text", dimensions: 768 }),
    ).toBe("ollama:nomic-embed-text:768");
    expect(
      fingerprintString({ provider: "openai", model: "text-embedding-3-large", dimensions: 1536 }),
    ).toBe("openai:text-embedding-3-large:1536");
  });

  it("Database.create writes the embedding fingerprint into memoark_meta", async () => {
    const db = await Database.create(
      {
        store: { engine: "pglite" },
        embedding: { provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
      } as any,
      { embeddingDimensions: 768 },
    );
    const stored = await readMeta(db.executor, "embedding_fingerprint");
    expect(stored).toBe("ollama:nomic-embed-text:768");
    await db.close();
  });

  it("fail-fast when stored fingerprint differs (same dims, different model)", async () => {
    // Create DB, write first fingerprint
    const db = await Database.create(
      {
        store: { engine: "pglite" },
        embedding: { provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
      } as any,
      { embeddingDimensions: 768 },
    );

    // Simulate "reopen with bge-m3": overwrite meta to mimic a different prior open,
    // then call ensureEmbeddingConsistency with the new config — must throw.
    await writeMeta(db.executor, "embedding_fingerprint", "ollama:nomic-embed-text:768");

    const differentConfig = {
      embedding: { provider: "ollama", model: "bge-m3", dimensions: 768 },
    } as any;

    await expect(
      ensureEmbeddingConsistencyForTest(db.executor, 768, differentConfig),
    ).rejects.toThrow(/fingerprint|model|embedding/i);

    await db.close();
  });

  it("same fingerprint on reuse does not throw", async () => {
    const db = await Database.create(
      {
        store: { engine: "pglite" },
        embedding: { provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
      } as any,
      { embeddingDimensions: 768 },
    );

    const sameConfig = {
      embedding: { provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
    } as any;

    // Should not throw — fingerprint matches
    await expect(
      ensureEmbeddingConsistencyForTest(db.executor, 768, sameConfig),
    ).resolves.toBeUndefined();

    await db.close();
  });
});
