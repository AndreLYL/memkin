import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StoreContext } from "../../src/server/api.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TimelineStore } from "../../src/store/timeline.js";
import { computeInputHash, read, write } from "../../src/synth/cache.js";
import type { AssembledCandidate, SynthesisResult } from "../../src/synth/types.js";

const candidates: AssembledCandidate[] = [
  { ref: 1, slug: "decisions/a", title: "A", type: "decision", text: "alpha", date: "2026-06-01" },
];

function makeResult(scope: SynthesisResult["meta"]["scope"]): SynthesisResult {
  return {
    intent: "recall",
    answer: "synthesized answer [1]",
    citations: [{ ref: 1, slug: "decisions/a", title: "A" }],
    gaps: [],
    meta: { model: "mock", generated_at: new Date().toISOString(), scope, cached: false },
  };
}

describe("synth/cache", () => {
  let db: Database;
  let stores: StoreContext;

  beforeEach(async () => {
    db = await Database.create();
    stores = {
      db,
      pages: new PageStore(db.executor),
      chunks: new ChunkStore(db.executor),
      graph: new GraphStore(db.executor),
      timeline: new TimelineStore(db.executor),
      search: new SearchEngine(db.executor),
    } as unknown as StoreContext;
  });
  afterEach(async () => {
    await db.close();
  });

  it("entity scope: writes & reads frontmatter.synth[intent]", async () => {
    await stores.pages.putPage("people/zhang-san", "---\ntitle: Zhang San\ntype: person\n---\nbio");
    const scope = { entity: "people/zhang-san" };
    const hash = computeInputHash(candidates);
    await write("recall", scope, makeResult(scope), hash, stores);

    const page = await stores.pages.getPage("people/zhang-san");
    const synth = page?.frontmatter.synth as Record<string, { input_hash: string }> | undefined;
    expect(synth?.recall?.input_hash).toBe(hash);

    const hit = await read("recall", scope, hash, stores);
    expect(hit?.answer).toBe("synthesized answer [1]");
  });

  it("entity scope: cache write does not bump updated_at or re-embed the carrier", async () => {
    await stores.pages.putPage(
      "people/zhang-san",
      "---\ntitle: Zhang San\ntype: person\n---\nZhang San is a teammate.",
    );
    const before = await stores.pages.getPage("people/zhang-san");
    const chunksBefore = await stores.chunks.getChunks("people/zhang-san");

    const scope = { entity: "people/zhang-san" };
    const hash = computeInputHash(candidates);
    await write("recall", scope, makeResult(scope), hash, stores);

    const after = await stores.pages.getPage("people/zhang-san");
    const chunksAfter = await stores.chunks.getChunks("people/zhang-san");

    expect(String(after?.updated_at)).toBe(String(before?.updated_at));
    expect(chunksAfter.length).toBe(chunksBefore.length);

    // Cache is still readable.
    const hit = await read("recall", scope, hash, stores);
    expect(hit?.answer).toBe("synthesized answer [1]");
  });

  it("entity scope: input_hash change invalidates the cache", async () => {
    await stores.pages.putPage("people/zhang-san", "---\ntitle: Z\ntype: person\n---\nbio");
    const scope = { entity: "people/zhang-san" };
    const hash = computeInputHash(candidates);
    await write("recall", scope, makeResult(scope), hash, stores);

    const stale = await read("recall", scope, "different-hash", stores);
    expect(stale).toBeNull();
  });

  it("time scope: writes a reports/<intent>/<from..to> knowledge page", async () => {
    const scope = { time: { from: "2026-06-22", to: "2026-06-22" } };
    const hash = computeInputHash(candidates);
    await write("daily", scope, makeResult(scope), hash, stores);

    const page = await stores.pages.getPage("reports/daily/2026-06-22..2026-06-22");
    expect(page).not.toBeNull();
    expect(page?.type).toBe("knowledge");
    expect(page?.frontmatter.is_report).toBe(true);

    const hit = await read("daily", scope, hash, stores);
    expect(hit?.answer).toBe("synthesized answer [1]");
  });

  it("query scope: not cached (read always misses, write is a no-op)", async () => {
    const scope = { query: "anything" };
    const hash = computeInputHash(candidates);
    await write("recall", scope, makeResult(scope), hash, stores);
    expect(await read("recall", scope, hash, stores)).toBeNull();
  });
});
