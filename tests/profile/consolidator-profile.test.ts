import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Consolidator } from "../../src/consolidator/consolidator.js";
import type { ProfileConfig } from "../../src/core/config.js";
import * as profileSynth from "../../src/profile/profile-synth.js";
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
  tz_offset_hours: 8,
  ...over,
});

describe("consolidator profile synthesis wiring (gated)", () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create();
  });
  afterEach(async () => {
    await db.close();
    vi.restoreAllMocks();
  });

  function makeConsolidator(profileConfig: ProfileConfig) {
    const pages = new PageStore(db.executor);
    const graph = new GraphStore(db.executor);
    const tags = new TagStore(db.executor);
    const timeline = new TimelineStore(db.executor);
    const behavior = new PersonBehaviorStore(db.executor);
    const llm = { chat: vi.fn().mockResolvedValue("[]") };
    const consolidator = new Consolidator({ pages, graph, tags, timeline }, llm, {
      profile: profileConfig,
      profileStores: { pages, graph, timeline, behavior },
    });
    return consolidator;
  }

  it("calls synthesizeProfiles during consolidateWarm when enabled", async () => {
    const spy = vi.spyOn(profileSynth, "synthesizeProfiles").mockResolvedValue(0);
    const c = makeConsolidator(cfg({ enabled: true }));
    await c.consolidateWarm();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does NOT call synthesizeProfiles when disabled", async () => {
    const spy = vi.spyOn(profileSynth, "synthesizeProfiles").mockResolvedValue(0);
    const c = makeConsolidator(cfg({ enabled: false }));
    await c.consolidateWarm();
    expect(spy).not.toHaveBeenCalled();
  });
});
