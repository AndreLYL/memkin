import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileConfig } from "../../src/core/config.js";
import { synthesizeProfiles } from "../../src/profile/profile-synth.js";
import type { ProfileObject } from "../../src/profile/types.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { PersonBehaviorStore } from "../../src/store/person-behavior.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

const cfg = (over: Partial<ProfileConfig> = {}): ProfileConfig => ({
  enabled: true,
  allow: [],
  deny: [],
  min_sample_size: 20,
  ...over,
});

describe("profile/profile-synth synthesizeProfiles", () => {
  let db: Database;
  let pages: PageStore;
  let graph: GraphStore;
  let chunks: ChunkStore;
  let tags: TagStore;
  let timeline: TimelineStore;
  let behavior: PersonBehaviorStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.pg);
    graph = new GraphStore(db.pg);
    chunks = new ChunkStore(db.pg);
    tags = new TagStore(db.pg);
    timeline = new TimelineStore(db.pg);
    behavior = new PersonBehaviorStore(db.pg);
  });
  afterEach(async () => {
    await db.close();
  });

  function stores() {
    return { pages, graph, chunks, tags, timeline, behavior };
  }

  it("writes insufficient profile with empty dimensions when sample is too small", async () => {
    await pages.putPage("people/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    await behavior.upsertContribution({
      person_slug: "people/alice",
      msg_count: 5, // < min_sample_size (20)
      sum_msg_chars: 50,
      initiated_count: 1,
      reply_count: 1,
      resp_latency_n: 0,
      resp_latency_sum_s: 0,
      hour_histogram: new Array(24).fill(0),
      at_count: 0,
    });

    const llm = { chat: vi.fn() };
    const count = await synthesizeProfiles(stores(), llm, cfg());
    expect(count).toBe(1);
    // No LLM call for insufficient people
    expect(llm.chat).not.toHaveBeenCalled();

    const page = await pages.getPage("people/alice");
    const profile = page?.frontmatter.profile as ProfileObject;
    expect(profile.trait.insufficient).toBe(true);
    expect(profile.trait.dimensions).toEqual([]);
    expect(profile.four_color.colors).toEqual([]);
  });

  it("writes a full profile with evidence_refs and confidence when sample is sufficient", async () => {
    await pages.putPage("people/bob", "---\ntitle: Bob\ntype: person\n---\nBob.");
    await behavior.upsertContribution({
      person_slug: "people/bob",
      msg_count: 50,
      sum_msg_chars: 500,
      initiated_count: 20,
      reply_count: 10,
      resp_latency_n: 10,
      resp_latency_sum_s: 600,
      hour_histogram: new Array(24).fill(0).map((_, i) => (i === 9 ? 30 : 0)),
      at_count: 5,
    });

    const llmJson = JSON.stringify({
      trait: {
        dimensions: [
          {
            axis: "D",
            level: "high",
            confidence: "high",
            evidence_count: 4,
            evidence_refs: ["decisions/ship-it"],
            note: "直接给结论",
          },
        ],
        insufficient: false,
      },
      relation: {
        tone: "合作顺畅",
        concerns: ["进度"],
        landmines: [],
        evidence_refs: ["decisions/ship-it"],
      },
    });
    const llm = { chat: vi.fn().mockResolvedValue(llmJson) };

    const count = await synthesizeProfiles(stores(), llm, cfg());
    expect(count).toBe(1);
    expect(llm.chat).toHaveBeenCalledTimes(1);
    // structured json call
    const opts = llm.chat.mock.calls[0][1];
    expect(opts?.responseFormat).toBe("json");

    const page = await pages.getPage("people/bob");
    const profile = page?.frontmatter.profile as ProfileObject;
    expect(profile.trait.insufficient).toBe(false);
    expect(profile.trait.dimensions[0].axis).toBe("D");
    expect(profile.trait.dimensions[0].evidence_refs).toContain("decisions/ship-it");
    expect(profile.trait.dimensions[0].confidence).toBe("high");
    expect(profile.four_color.colors).toEqual(["🔴 红"]);
    expect(profile.four_color.disclaimer).toContain("通俗映射，非临床诊断");
    expect(profile.relation.tone).toBe("合作顺畅");
  });

  it("respects deny list (skips denied person)", async () => {
    await pages.putPage("people/carol", "---\ntitle: Carol\ntype: person\n---\nCarol.");
    await behavior.upsertContribution({
      person_slug: "people/carol",
      msg_count: 50,
      sum_msg_chars: 500,
      initiated_count: 10,
      reply_count: 10,
      resp_latency_n: 5,
      resp_latency_sum_s: 100,
      hour_histogram: new Array(24).fill(0),
      at_count: 0,
    });
    const llm = { chat: vi.fn() };
    const count = await synthesizeProfiles(stores(), llm, cfg({ deny: ["people/carol"] }));
    expect(count).toBe(0);
    expect(llm.chat).not.toHaveBeenCalled();
  });
});
