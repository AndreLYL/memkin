import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { troubleshootIntent } from "../../src/synth/intents/troubleshoot.js";
import type { AssembledCandidate } from "../../src/synth/types.js";

describe("synth/troubleshoot intent", () => {
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

    // precedes chain: step-1 -> step-2 -> step-3 (insert reverse so targets pre-exist)
    const p3 = await pages.putPage(
      "playbook/activation-step-3",
      "---\ntitle: 激活排查步骤3\ntype: playbook\n---\n步骤3：检查传感器，无法激活。",
    );
    const p2 = await pages.putPage(
      "playbook/activation-step-2",
      "---\ntitle: 激活排查步骤2\ntype: playbook\n---\n步骤2：看日志，无法激活。\n[[precedes:playbook/activation-step-3]]",
    );
    const p1 = await pages.putPage(
      "playbook/activation-step-1",
      "---\ntitle: 激活排查步骤1\ntype: playbook\n---\n步骤1：去 /log 执行 grep deact，无法激活。\n[[precedes:playbook/activation-step-2]]",
    );
    for (const p of [p1, p2, p3]) await chunks.rechunk(p.id, p.compiled_truth);
  });

  afterEach(async () => {
    await db.close();
  });

  it("is registered and resolvable via getIntent", () => {
    const intent = getIntent("troubleshoot");
    expect(intent.id).toBe("troubleshoot");
    expect(intent.format).toBe("single");
  });

  it("buildScope returns query + types:[playbook] + limit", () => {
    const scope = troubleshootIntent.buildScope({ query: "无法激活" });
    expect(scope).toEqual({ query: "无法激活", types: ["playbook"], limit: 10 });
  });

  it("sortCandidates pre-orders candidates by the precedes chain", async () => {
    // Feed candidates out of order; the hook should reorder by precedes.
    const candidates: AssembledCandidate[] = [
      { ref: 1, slug: "playbook/activation-step-2", title: "步骤2", type: "playbook", text: "b" },
      { ref: 2, slug: "playbook/activation-step-1", title: "步骤1", type: "playbook", text: "a" },
      { ref: 3, slug: "playbook/activation-step-3", title: "步骤3", type: "playbook", text: "c" },
    ];
    const ordered = await troubleshootIntent.sortCandidates?.(candidates, stores);
    expect(ordered?.map((c) => c.slug)).toEqual([
      "playbook/activation-step-1",
      "playbook/activation-step-2",
      "playbook/activation-step-3",
    ]);
  });

  it("end-to-end synthesize returns ordered troubleshooting steps with [n] refs", async () => {
    const provider = createMockProvider(
      new Map([["", "1. 先 grep [1]\n2. 再看日志 [2]\n3. 查传感器 [3]"]]),
    );
    const scope = troubleshootIntent.buildScope({ query: "无法激活" });
    const result = await synthesize("troubleshoot", scope, { stores, provider });
    expect(result.answer).toContain("[1]");
    expect(result.citations.length).toBeGreaterThanOrEqual(1);
  });
});
