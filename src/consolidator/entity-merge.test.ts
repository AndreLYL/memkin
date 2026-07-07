import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../store/database.js";
import { EntityMergeSuggestionStore } from "../store/entity-suggestions.js";
import { GraphStore } from "../store/graph.js";
import { PageStore } from "../store/pages.js";
import { TagStore } from "../store/tags.js";
import { TimelineStore } from "../store/timeline.js";
import { Consolidator } from "./consolidator.js";
import { detectEntityMergeCandidates } from "./entity-merge.js";

describe("detectEntityMergeCandidates", () => {
  it("groups exact same-title same-type pages (check-dupes logic)", () => {
    const candidates = detectEntityMergeCandidates([
      { slug: "tool/larkclihttpclient", type: "tool", title: "LarkCliHttpClient" },
      { slug: "tool/lark-cli-http-client", type: "tool", title: "LarkCliHttpClient" },
      { slug: "tool/lark-cli-http", type: "tool", title: "LarkCliHttpClient" },
      { slug: "project/other", type: "project", title: "Something Else" },
    ]);
    const sameName = candidates.filter((c) => c.reason === "same_name");
    // Three duplicates fold into the first sorted slug: 2 suggestions.
    expect(sameName).toHaveLength(2);
    for (const s of sameName) {
      expect(s.into_slug).toBe("tool/lark-cli-http");
      expect(s.entity_type).toBe("tool");
    }
  });

  it("suggests Levenshtein-close titles within the same type only", () => {
    const candidates = detectEntityMergeCandidates([
      { slug: "tool/lark-cli-http-client", type: "tool", title: "LarkCliHttpClient" },
      { slug: "tool/lark-cli-httpclient", type: "tool", title: "LarkCliHttpCliet" }, // 1 edit
      { slug: "project/lark-thing", type: "project", title: "LarkCliHttpClient" }, // cross type — not levenshtein
    ]);
    const lev = candidates.filter((c) => c.reason === "levenshtein");
    expect(lev).toHaveLength(1);
    expect(lev[0].entity_type).toBe("tool");
    const pair = [lev[0].from_slug, lev[0].into_slug].sort();
    expect(pair).toEqual(["tool/lark-cli-http-client", "tool/lark-cli-httpclient"]);
  });

  it("does NOT suggest distant titles", () => {
    const candidates = detectEntityMergeCandidates([
      { slug: "tool/vitest", type: "tool", title: "Vitest" },
      { slug: "tool/biome", type: "tool", title: "Biome" },
    ]);
    expect(candidates).toEqual([]);
  });

  it("suggests person pages whose titles are pinyin-equivalent", () => {
    const candidates = detectEntityMergeCandidates([
      { slug: "person/li-ming", type: "person", title: "李明" },
      { slug: "person/li-ming-2", type: "person", title: "李鸣" }, // same pinyin li-ming
      { slug: "person/wang-jiandu", type: "person", title: "王建都" },
    ]);
    const pinyin = candidates.filter((c) => c.reason === "pinyin");
    expect(pinyin).toHaveLength(1);
    const pair = [pinyin[0].from_slug, pinyin[0].into_slug].sort();
    expect(pair).toEqual(["person/li-ming", "person/li-ming-2"]);
  });

  it("does not double-report a pair already covered by same_name", () => {
    const candidates = detectEntityMergeCandidates([
      { slug: "tool/a", type: "tool", title: "SameTitle" },
      { slug: "tool/b", type: "tool", title: "SameTitle" },
    ]);
    expect(candidates.filter((c) => c.reason === "same_name")).toHaveLength(1);
    expect(candidates.filter((c) => c.reason === "levenshtein")).toHaveLength(0);
  });
});

describe("Consolidator entity-merge sweep", () => {
  let db: Database;
  let suggestions: EntityMergeSuggestionStore;
  let consolidator: Consolidator;

  beforeEach(async () => {
    db = await Database.create(undefined, { embeddingDimensions: 768 });
    suggestions = new EntityMergeSuggestionStore(db.executor);
    consolidator = new Consolidator({
      pages: new PageStore(db.executor),
      graph: new GraphStore(db.executor),
      tags: new TagStore(db.executor),
      timeline: new TimelineStore(db.executor),
      entitySuggestions: suggestions,
    });
    await db.executor.query(
      `INSERT INTO pages (slug, type, title, compiled_truth) VALUES
         ('tool/larkclihttpclient', 'tool', 'LarkCliHttpClient', 'x'),
         ('tool/lark-cli-http-client', 'tool', 'LarkCliHttpClient', 'x')`,
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it("hot consolidation aggregates suggestions into the store", async () => {
    const result = await consolidator.runOnce("hot");
    expect(result.entityMergeSuggestions).toBe(1);
    const pending = await suggestions.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].reason).toBe("same_name");
  });

  it("dry run detects but does not write", async () => {
    const result = await consolidator.runOnce("hot", true);
    expect(result.entityMergeSuggestions).toBe(1);
    expect(await suggestions.listPending()).toHaveLength(0);
  });
});
