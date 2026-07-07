/**
 * Tests for embedding fingerprint consistency logic.
 *
 * F2 contract: a fingerprint mismatch no longer fails the database open
 * (that blocked read-only commands like `search --mode fts` and `export`).
 * Instead the mismatch is RECORDED and surfaced only when an embedding
 * operation actually runs, via Database.assertEmbeddingConsistent().
 *
 * Strategy: use an in-memory PGLite DB (no data_dir) to avoid the ~4 GB
 * WASM heap cost of initialising a disk-backed cluster inside vitest's fork
 * worker. We seed memkin_meta directly, then verify the mismatch detection.
 *
 * "Reopening" semantics are achieved by:
 *   1. Database.create writes the fingerprint on first open.
 *   2. We call the exported ensureEmbeddingConsistency directly on the same
 *      connection with a different config — this is the exact code path that
 *      Database.create would take on a real reopen.
 */
import { describe, expect, it } from "vitest";
import {
  Database,
  embeddingMismatchError,
  ensureEmbeddingConsistencyForTest,
} from "../../src/store/database.js";
import { fingerprintString, readMeta, writeMeta } from "../../src/store/store-meta.js";

describe("embedding fingerprint — unit (in-memory)", () => {
  it("fingerprintString produces expected format", () => {
    expect(
      fingerprintString({ provider: "ollama", model: "nomic-embed-text", dimensions: 768 }),
    ).toBe("ollama:nomic-embed-text:768");
    expect(
      fingerprintString({ provider: "openai", model: "text-embedding-3-large", dimensions: 1536 }),
    ).toBe("openai:text-embedding-3-large:1536");
  });

  it("Database.create writes the embedding fingerprint into memkin_meta", async () => {
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

  it("mismatch is reported — not thrown — and the stored fingerprint is untouched", async () => {
    // Create DB, write first fingerprint
    const db = await Database.create(
      {
        store: { engine: "pglite" },
        embedding: { provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
      } as any,
      { embeddingDimensions: 768 },
    );

    // Simulate "reopen with bge-m3": overwrite meta to mimic a different prior open,
    // then call ensureEmbeddingConsistency with the new config — this is the exact
    // code path Database.create takes on a real reopen. It must NOT throw (read-only
    // commands need the open to succeed); it must return the mismatch instead.
    await writeMeta(db.executor, "embedding_fingerprint", "ollama:nomic-embed-text:768");

    const differentConfig = {
      embedding: { provider: "ollama", model: "bge-m3", dimensions: 768 },
    } as any;

    const mismatch = await ensureEmbeddingConsistencyForTest(db.executor, 768, differentConfig);
    expect(mismatch).toEqual({
      have: "ollama:nomic-embed-text:768",
      want: "ollama:bge-m3:768",
    });

    // No silent rewrite of the shared library: fingerprint stays as-is.
    expect(await readMeta(db.executor, "embedding_fingerprint")).toBe(
      "ollama:nomic-embed-text:768",
    );

    await db.close();
  });

  it("same fingerprint on reuse reports no mismatch", async () => {
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

    await expect(
      ensureEmbeddingConsistencyForTest(db.executor, 768, sameConfig),
    ).resolves.toBeNull();

    await db.close();
  });

  it("assertEmbeddingConsistent on a fresh (consistent) database does not throw", async () => {
    const db = await Database.create(
      {
        store: { engine: "pglite" },
        embedding: { provider: "ollama", model: "nomic-embed-text", dimensions: 768 },
      } as any,
      { embeddingDimensions: 768 },
    );

    expect(() => db.assertEmbeddingConsistent()).not.toThrow();

    await db.close();
  });

  it("embeddingMismatchError carries both actionable remediations", () => {
    const err = embeddingMismatchError({
      have: "ollama:nomic-embed-text:768",
      want: "openai:text-embedding-3-large:1536",
    });

    // Names both fingerprints so the user can see exactly what diverged.
    expect(err.message).toContain('"ollama:nomic-embed-text:768"');
    expect(err.message).toContain('"openai:text-embedding-3-large:1536"');
    // Option 1: revert the config to match the database.
    expect(err.message).toMatch(/revert|change .*config|match the database/i);
    // Option 2: manual full re-embed steps, ending in `memkin embed`.
    expect(err.message).toMatch(/re-embed/i);
    expect(err.message).toContain("memkin embed");
    expect(err.message).toContain("embedding_fingerprint");
  });
});
