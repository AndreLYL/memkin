import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StoreAdapter } from "../../src/adapters/store.js";
import type {
  Decision,
  Discovery,
  Entity,
  ExtractionResult,
  Knowledge,
  Link,
  SourceRef,
  TaskSignal,
  TimelineEntry,
} from "../../src/core/types.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

describe("StoreAdapter", () => {
  let db: Database;
  let adapter: StoreAdapter;
  let pages: PageStore;
  let chunks: ChunkStore;
  let graph: GraphStore;
  let tags: TagStore;
  let timeline: TimelineStore;

  beforeEach(async () => {
    db = await Database.create(); // In-memory PGlite
    pages = new PageStore(db.pg);
    chunks = new ChunkStore(db.pg);
    graph = new GraphStore(db.pg);
    tags = new TagStore(db.pg);
    timeline = new TimelineStore(db.pg);

    adapter = new StoreAdapter({
      pages,
      chunks,
      graph,
      tags,
      timeline,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  function createSourceRef(platform = "test", channel = "test-channel"): SourceRef {
    return {
      platform,
      channel,
      timestamp: new Date().toISOString(),
      raw_hash: createHash("sha256").update(`${platform}-${channel}-${Date.now()}`).digest("hex"),
      quote: "Sample quote from test",
    };
  }

  describe("healthCheck", () => {
    it("should return ok when all stores are available", async () => {
      const result = await adapter.healthCheck();
      expect(result.ok).toBe(true);
      expect(result.message).toContain("ready");
    });
  });

  describe("push - entities", () => {
    it("should write entity to pages, chunks, and tags", async () => {
      const entity: Entity = {
        slug: "test-entity",
        name: "Test Entity",
        type: "person",
        context: "This is a test entity context.",
        confidence: "direct",
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [entity],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const pushResult = await adapter.push([result]);

      expect(pushResult.written).toBeGreaterThan(0);
      expect(pushResult.errors).toHaveLength(0);

      // Verify page was created
      const page = await pages.getPage("test-entity");
      expect(page).not.toBeNull();
      expect(page?.title).toBe("Test Entity");
      expect(page?.type).toBe("person");
      expect(page?.compiled_truth).toContain("This is a test entity context.");

      // Verify chunks were created
      const pageChunks = await chunks.getChunks("test-entity");
      expect(pageChunks.length).toBeGreaterThan(0);

      // Verify entity tag was added
      const pageTags = await tags.getTags("test-entity");
      expect(pageTags).toContain("entity");
    });

    it("should deduplicate by source_hash", async () => {
      const entity: Entity = {
        slug: "test-entity",
        name: "Test Entity",
        type: "person",
        context: "Test context",
        confidence: "direct",
      };

      const sourceRef = createSourceRef();
      const result: ExtractionResult = {
        source: sourceRef,
        entities: [entity],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      // First push
      const pushResult1 = await adapter.push([result]);
      expect(pushResult1.written).toBeGreaterThan(0);

      // Second push with same source_hash
      const pushResult2 = await adapter.push([result]);
      expect(pushResult2.skipped).toBeGreaterThan(0);
      expect(pushResult2.written).toBe(0);
    });
  });

  describe("push - decisions", () => {
    it("should write decision with links, tags, and timeline", async () => {
      // First create entity pages that the decision will reference
      await pages.putPage(
        "entity-a",
        `---
title: Entity A
type: person
---
## Context
Entity A context`,
      );

      const decision: Decision = {
        summary: "Important decision made",
        reasoning: "This is the reasoning behind the decision",
        alternatives: ["Alternative 1", "Alternative 2"],
        entities: ["entity-a"],
        date: "2024-01-15",
        confidence: "direct",
        source: createSourceRef(),
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [],
        links: [],
        decisions: [decision],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const pushResult = await adapter.push([result]);

      expect(pushResult.written).toBeGreaterThan(0);
      expect(pushResult.errors).toHaveLength(0);

      // Verify decision page was created
      const slug = "decisions/important-decision-made";
      const page = await pages.getPage(slug);
      expect(page).not.toBeNull();
      expect(page?.title).toBe("Important decision made");
      expect(page?.type).toBe("decision");
      expect(page?.compiled_truth).toContain("This is the reasoning behind the decision");

      // Verify decision tag was added
      const pageTags = await tags.getTags(slug);
      expect(pageTags).toContain("decision");

      // Verify link to entity was created
      const links = await graph.getLinks(slug);
      expect(links.some((l) => l.to_slug === "entity-a")).toBe(true);

      // Verify timeline entry was added to entity
      const entityTimeline = await timeline.getTimeline("entity-a");
      expect(entityTimeline.some((e) => e.summary.includes("Important decision made"))).toBe(true);
    });
  });

  describe("push - tasks", () => {
    it("should write task with tags", async () => {
      const task: TaskSignal = {
        title: "Complete task implementation",
        status: "open",
        owner: "test-user",
        project: "test-project",
        confidence: "direct",
        source: createSourceRef(),
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [task],
        discoveries: [],
        knowledge: [],
      };

      const pushResult = await adapter.push([result]);

      expect(pushResult.written).toBeGreaterThan(0);
      expect(pushResult.errors).toHaveLength(0);

      // Verify task page was created
      const slug = "tasks/complete-task-implementation";
      const page = await pages.getPage(slug);
      expect(page).not.toBeNull();
      expect(page?.title).toBe("Complete task implementation");
      expect(page?.type).toBe("task");

      // Verify task tag was added
      const pageTags = await tags.getTags(slug);
      expect(pageTags).toContain("task");
    });
  });

  describe("push - discoveries", () => {
    it("should write discovery with links and tags", async () => {
      // Create entity first
      await pages.putPage(
        "entity-b",
        `---
title: Entity B
type: concept
---
## Context
Entity B context`,
      );

      const discovery: Discovery = {
        summary: "Discovered pattern in code",
        detail: "Detailed explanation of the pattern",
        type: "pattern",
        entities: ["entity-b"],
        confidence: "inferred",
        source: createSourceRef(),
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [discovery],
        knowledge: [],
      };

      const pushResult = await adapter.push([result]);

      expect(pushResult.written).toBeGreaterThan(0);
      expect(pushResult.errors).toHaveLength(0);

      // Verify discovery page was created
      const slug = "discoveries/discovered-pattern-in-code";
      const page = await pages.getPage(slug);
      expect(page).not.toBeNull();
      expect(page?.title).toBe("Discovered pattern in code");
      expect(page?.type).toBe("discovery-pattern");

      // Verify tags
      const pageTags = await tags.getTags(slug);
      expect(pageTags).toContain("discovery");
      expect(pageTags).toContain("pattern");

      // Verify link to entity
      const links = await graph.getLinks(slug);
      expect(links.some((l) => l.to_slug === "entity-b")).toBe(true);
    });
  });

  describe("push - knowledge", () => {
    it("should write knowledge with links and tags", async () => {
      // Create related entity
      await pages.putPage(
        "entity-c",
        `---
title: Entity C
type: tool
---
## Context
Entity C context`,
      );

      const knowledge: Knowledge = {
        topic: "programming",
        content: "Important programming knowledge to remember",
        source_type: "conversation",
        related_entities: ["entity-c"],
        confidence: "direct",
        source: createSourceRef(),
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [knowledge],
      };

      const pushResult = await adapter.push([result]);

      expect(pushResult.written).toBeGreaterThan(0);
      expect(pushResult.errors).toHaveLength(0);

      // Verify knowledge page was created
      const knowledgePages = await pages.listPages({ type: "knowledge" });
      expect(knowledgePages.length).toBeGreaterThan(0);

      const knowledgePage = knowledgePages[0];
      expect(knowledgePage.compiled_truth).toContain("Important programming knowledge to remember");

      // Verify tags
      const pageTags = await tags.getTags(knowledgePage.slug);
      expect(pageTags).toContain("knowledge");
      expect(pageTags).toContain("programming");

      // Verify link to related entity
      const links = await graph.getLinks(knowledgePage.slug);
      expect(links.some((l) => l.to_slug === "entity-c")).toBe(true);
    });

    it("should skip speculative confidence knowledge", async () => {
      const knowledge: Knowledge = {
        topic: "speculation",
        content: "Speculative knowledge should be skipped",
        source_type: "conversation",
        related_entities: [],
        confidence: "speculative",
        source: createSourceRef(),
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [knowledge],
      };

      const pushResult = await adapter.push([result]);

      expect(pushResult.skipped).toBe(1);
      expect(pushResult.written).toBe(0);
    });
  });

  describe("push - timeline entries", () => {
    it("should write timeline entries to entity pages", async () => {
      // Create entity first
      await pages.putPage(
        "timeline-entity",
        `---
title: Timeline Entity
type: person
---
## Context
Timeline entity context`,
      );

      const timelineEntry: TimelineEntry = {
        date: "2024-01-20",
        summary: "Important event occurred",
        entities: ["timeline-entity"],
        confidence: "direct",
        source: createSourceRef(),
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [timelineEntry],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const pushResult = await adapter.push([result]);

      expect(pushResult.written).toBeGreaterThan(0);
      expect(pushResult.errors).toHaveLength(0);

      // Verify timeline entry was added
      const entries = await timeline.getTimeline("timeline-entity");
      expect(entries.some((e) => e.summary === "Important event occurred")).toBe(true);
    });
  });

  describe("push - links", () => {
    it("should create links between entities", async () => {
      // Create two entities
      await pages.putPage(
        "from-entity",
        `---
title: From Entity
type: person
---
## Context
From context`,
      );

      await pages.putPage(
        "to-entity",
        `---
title: To Entity
type: organization
---
## Context
To context`,
      );

      const link: Link = {
        from: "from-entity",
        to: "to-entity",
        type: "works_at",
        context: "Works at relationship",
        confidence: "direct",
        source: createSourceRef(),
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [],
        links: [link],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const pushResult = await adapter.push([result]);

      expect(pushResult.written).toBeGreaterThan(0);
      expect(pushResult.errors).toHaveLength(0);

      // Verify link was created
      const links = await graph.getLinks("from-entity");
      expect(links.some((l) => l.to_slug === "to-entity" && l.link_type === "works_at")).toBe(true);
    });
  });

  describe("halflife_days stamping", () => {
    it("stamps halflife_days=90 on newly written decision pages", async () => {
      const decision: Decision = {
        summary: "Adopt trunk-based development",
        entities: [],
        date: "2024-01-15",
        confidence: "direct",
        source: createSourceRef(),
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [],
          timeline: [],
          links: [],
          decisions: [decision],
          tasks: [],
          discoveries: [],
          knowledge: [],
          preferences: [],
          references: [],
        },
      ]);

      const page = await pages.getPage("decisions/adopt-trunk-based-development");
      expect(page?.halflife_days).toBe(90);
    });

    it("stamps halflife_days=90 on newly written task pages", async () => {
      const task: TaskSignal = {
        title: "Write onboarding doc",
        status: "open",
        source: createSourceRef(),
        confidence: "direct",
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [],
          timeline: [],
          links: [],
          decisions: [],
          tasks: [task],
          discoveries: [],
          knowledge: [],
          preferences: [],
          references: [],
        },
      ]);

      const page = await pages.getPage("tasks/write-onboarding-doc");
      expect(page?.halflife_days).toBe(90);
    });

    it("stamps halflife_days=90 on newly written discovery pages", async () => {
      const discovery: Discovery = {
        summary: "Local Docker DNS resolution is broken",
        type: "pattern",
        entities: [],
        source: createSourceRef(),
        confidence: "direct",
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [],
          timeline: [],
          links: [],
          decisions: [],
          tasks: [],
          discoveries: [discovery],
          knowledge: [],
          preferences: [],
          references: [],
        },
      ]);

      const page = await pages.getPage("discoveries/local-docker-dns-resolution-is-broken");
      expect(page?.halflife_days).toBe(90);
    });

    it("stamps halflife_days=365 on newly written knowledge pages", async () => {
      const knowledge: Knowledge = {
        topic: "feishu-api",
        content: "Feishu API global rate limit is 50 QPS",
        source_type: "document",
        related_entities: [],
        source: createSourceRef(),
        confidence: "direct",
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [],
          timeline: [],
          links: [],
          decisions: [],
          tasks: [],
          discoveries: [],
          knowledge: [knowledge],
          preferences: [],
          references: [],
        },
      ]);

      const all = await pages.listPages({ type: "knowledge" });
      expect(all).toHaveLength(1);
      expect(all[0].halflife_days).toBe(365);
    });

    it("stamps halflife_days=NULL (permanent) on newly written entity pages", async () => {
      const entity: Entity = {
        slug: "person/carol",
        name: "Carol",
        type: "person",
        context: "New team member",
        confidence: "direct",
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [entity],
          timeline: [],
          links: [],
          decisions: [],
          tasks: [],
          discoveries: [],
          knowledge: [],
          preferences: [],
          references: [],
        },
      ]);

      const page = await pages.getPage("person/carol");
      expect(page?.halflife_days).toBeNull();
    });
  });
});
