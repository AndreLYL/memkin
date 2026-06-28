import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProvider } from "../../src/extractors/providers/mock.js";
import type { StoreContext } from "../../src/server/api.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TimelineStore } from "../../src/store/timeline.js";
import { staleRule } from "../../src/synth/gaps.js";
import { synthesize } from "../../src/synth/index.js";
import { registerIntent } from "../../src/synth/intent.js";
import type { IntentTemplate } from "../../src/synth/types.js";

describe("synth/engine synthesize", () => {
  let db: Database;
  let stores: StoreContext;

  beforeEach(async () => {
    db = await Database.create();
    const pages = new PageStore(db.executor);
    const chunks = new ChunkStore(db.executor);
    const graph = new GraphStore(db.executor);
    const timeline = new TimelineStore(db.executor);
    const search = new SearchEngine(db.executor);
    stores = { db, pages, chunks, graph, timeline, search } as unknown as StoreContext;

    await pages.putPage(
      "people/zhang-san",
      "---\ntitle: Zhang San\ntype: person\n---\nZhang San is a teammate.",
    );
    const d = await pages.putPage(
      "decisions/ship-it",
      "---\ntitle: Ship It\ntype: decision\n---\nWe decided to ship the feature on Friday.",
    );
    await chunks.rechunk(d.id, d.compiled_truth);
    await graph.addLink("decisions/ship-it", "people/zhang-san", "mentions");
  });

  afterEach(async () => {
    await db.close();
  });

  it("recall over an entity returns a SynthesisResult with answer, valid citation, gaps", async () => {
    const provider = createMockProvider(new Map([["", "We agreed to ship on Friday [1]."]]));
    const result = await synthesize("recall", { entity: "people/zhang-san" }, { stores, provider });
    expect(result.answer).toBeTruthy();
    expect(result.citations.length).toBeGreaterThanOrEqual(1);
    expect(result.citations[0].ref).toBe(1);
    expect(Array.isArray(result.gaps)).toBe(true);
    expect(result.meta.cached).toBe(false);
  });

  it("second call with the same scope hits the cache (provider called once)", async () => {
    const chat = vi.fn().mockResolvedValue("Shipped on Friday [1].");
    const provider = { chat };
    const scope = { entity: "people/zhang-san" };

    const first = await synthesize("recall", scope, { stores, provider });
    expect(first.meta.cached).toBe(false);
    const second = await synthesize("recall", scope, { stores, provider });
    expect(second.meta.cached).toBe(true);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("short-circuits on empty candidates without calling the provider", async () => {
    const chat = vi.fn().mockResolvedValue("should not be called");
    const provider = { chat };

    const result = await synthesize(
      "recall",
      { entity: "people/does-not-exist" },
      { stores, provider },
    );

    expect(chat).toHaveBeenCalledTimes(0);
    expect(result.answer).toBe("(未找到相关记忆)");
    expect(result.citations).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.meta.cached).toBe(false);
  });

  it("invokes sortCandidates and buildPinnedContext hooks", async () => {
    const sortCandidates = vi.fn(async (cands) => [...cands].reverse());
    const buildPinnedContext = vi.fn(async () => "PINNED-FRAMEWORK-TEXT");
    let seenPrompt = "";

    const hookedIntent: IntentTemplate = {
      id: "hooked-test",
      format: "single",
      buildScope: (args) => ({ entity: args.entity as string | undefined, limit: 30 }),
      systemPrompt: "hooked",
      gapRules: [staleRule],
      sortCandidates,
      buildPinnedContext,
    };
    registerIntent(hookedIntent);

    const provider = {
      chat: vi.fn(async (messages) => {
        seenPrompt = messages.map((m: { content: string }) => m.content).join("\n");
        return "answer [1]";
      }),
    };

    await synthesize("hooked-test", { entity: "people/zhang-san" }, { stores, provider });
    expect(sortCandidates).toHaveBeenCalledTimes(1);
    expect(buildPinnedContext).toHaveBeenCalledTimes(1);
    expect(seenPrompt).toContain("PINNED-FRAMEWORK-TEXT");
  });

  it("engine.ts and scope.ts do not import any concrete intent module (no reverse dependency)", () => {
    // The registration barrel `intents/index.js` is allowed (Spec 7 §四); importing a
    // specific concrete intent (e.g. intents/recall) from the generic layer is not.
    const root = join(process.cwd(), "src", "synth");
    const engine = readFileSync(join(root, "engine.ts"), "utf8");
    const scope = readFileSync(join(root, "scope.ts"), "utf8");
    const concreteIntentImport = /intents\/(?!index)[a-z-]+/;
    expect(engine).not.toMatch(concreteIntentImport);
    expect(scope).not.toMatch(concreteIntentImport);
    // scope.ts must not touch the intents layer at all
    expect(scope).not.toMatch(/intents\//);
  });
});
