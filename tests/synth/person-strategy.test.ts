import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockProvider } from "../../src/extractors/providers/mock.js";
import type { StoreContext } from "../../src/server/api.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TimelineStore } from "../../src/store/timeline.js";
import { synthesize } from "../../src/synth/index.js";
import { getIntent } from "../../src/synth/intent.js";
import { personStrategyIntent } from "../../src/synth/intents/person-strategy.js";

describe("synth person_strategy intent", () => {
  let db: Database;
  let stores: StoreContext;
  let pages: PageStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.executor);
    const chunks = new ChunkStore(db.executor);
    const graph = new GraphStore(db.executor);
    const timeline = new TimelineStore(db.executor);
    const search = new SearchEngine(db.executor);
    stores = { db, pages, chunks, graph, timeline, search } as unknown as StoreContext;

    await pages.putPage("people/zhang-san", "---\ntitle: Zhang San\ntype: person\n---\nZhang San.");
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

  it("is registered and resolvable", () => {
    expect(getIntent("person_strategy").id).toBe("person_strategy");
  });

  it("systemPrompt carries the ethics guardrail (suggestions, not manipulation)", () => {
    expect(personStrategyIntent.systemPrompt).toContain("操纵");
    expect(personStrategyIntent.systemPrompt).toContain("[n]");
    expect(personStrategyIntent.staleDays).toBe(21);
  });

  it("buildPinnedContext renders frontmatter.profile, undefined when absent", async () => {
    // No profile yet
    const none = await personStrategyIntent.buildPinnedContext?.(
      { entity: "people/zhang-san" },
      stores as never,
    );
    expect(none).toBeUndefined();

    // With a profile
    await pages.putPage(
      "people/zhang-san",
      "---\ntitle: Zhang San\ntype: person\nprofile:\n  trait:\n    insufficient: false\n    dimensions:\n      - axis: D\n        level: high\n  four_color:\n    colors:\n      - 🔴 红\n    disclaimer: 通俗映射，非临床诊断\n  relation:\n    tone: 合作顺畅\n---\nZhang San.",
    );
    const rendered = await personStrategyIntent.buildPinnedContext?.(
      { entity: "people/zhang-san" },
      stores as never,
    );
    expect(rendered).toBeTruthy();
    expect(rendered).toContain("合作顺畅");
    expect(rendered).toContain("通俗映射，非临床诊断");
  });

  it("end-to-end synthesize returns cited advice and injects goal into the prompt", async () => {
    await pages.putPage("people/zhang-san", "---\ntitle: Zhang San\ntype: person\n---\nZhang San.");
    let seenPrompt = "";
    const provider = {
      chat: vi.fn(async (messages: { content: string }[]) => {
        seenPrompt = messages.map((m) => m.content).join("\n");
        return "建议先同步进度再提需求 [1]。";
      }),
    };
    const result = await synthesize(
      "person_strategy",
      { entity: "people/zhang-san" },
      { stores, provider },
      { extra: { goal: "推动他批准预算" }, noCache: true },
    );
    expect(result.answer).toContain("[1]");
    expect(result.citations.length).toBeGreaterThanOrEqual(1);
    expect(seenPrompt).toContain("推动他批准预算");
  });
});
