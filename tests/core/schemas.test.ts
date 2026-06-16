/**
 * Tests for Zod schemas and validation functions
 */

import { describe, expect, it } from "vitest";
import {
  KnowledgeSchema,
  PreferenceSchema,
  parseExtractionResult,
  parseSignificanceVerdict,
  ReferenceSchema,
  SourceRefCoreSchema,
  SourceRefSchema,
} from "../../src/core/schemas.js";
import type { ExtractionResult, SignificanceVerdict } from "../../src/core/types.js";

describe("ExtractionResult schema validation", () => {
  it("should parse valid ExtractionResult JSON", () => {
    const validData: ExtractionResult = {
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-05-19T12:00:00Z",
        message_id: "msg-123",
        raw_hash: "abc123",
        quote: "Discussing the new API design",
      },
      entities: [
        {
          slug: "api-redesign",
          name: "API Redesign Project",
          type: "project",
          context: "Major refactoring of REST API",
          confidence: "direct",
        },
      ],
      timeline: [
        {
          date: "2026-05-19",
          summary: "Started API redesign discussion",
          entities: ["api-redesign"],
          source: {
            platform: "slack",
            channel: "#engineering",
            timestamp: "2026-05-19T12:00:00Z",
            raw_hash: "abc123",
            quote: "Let's start the API redesign",
          },
          confidence: "direct",
        },
      ],
      links: [
        {
          from: "john-doe",
          to: "api-redesign",
          type: "works_on",
          context: "John is leading the API redesign",
          confidence: "direct",
          source: {
            platform: "slack",
            channel: "#engineering",
            timestamp: "2026-05-19T12:00:00Z",
            raw_hash: "abc123",
            quote: "John is leading the API redesign",
          },
        },
      ],
      decisions: [
        {
          summary: "Use GraphQL instead of REST",
          reasoning: "Better type safety and flexibility",
          alternatives: ["Keep REST", "Use gRPC"],
          entities: ["api-redesign"],
          date: "2026-05-19",
          confidence: "direct",
          source: {
            platform: "slack",
            channel: "#engineering",
            timestamp: "2026-05-19T12:00:00Z",
            raw_hash: "abc123",
            quote: "We decided to go with GraphQL",
          },
        },
      ],
      tasks: [
        {
          title: "Design GraphQL schema",
          status: "open",
          owner: "john-doe",
          project: "api-redesign",
          confidence: "direct",
          source: {
            platform: "slack",
            channel: "#engineering",
            timestamp: "2026-05-19T12:00:00Z",
            raw_hash: "abc123",
            quote: "John will design the GraphQL schema",
          },
        },
      ],
      discoveries: [
        {
          summary: "API redesign requires careful versioning",
          type: "insight",
          entities: ["api-redesign"],
          confidence: "inferred",
          source: {
            platform: "slack",
            channel: "#engineering",
            timestamp: "2026-05-19T12:00:00Z",
            raw_hash: "abc123",
            quote: "We need to think about backwards compatibility",
          },
        },
      ],
      knowledge: [],
      preferences: [
        {
          summary: "Team prefers TypeScript for API development",
          category: "tooling",
          entities: ["api-redesign"],
          confidence: "inferred",
          source: {
            platform: "slack",
            channel: "#engineering",
            timestamp: "2026-05-19T12:00:00Z",
            raw_hash: "abc123",
            quote: "Everyone seems comfortable with TypeScript",
          },
        },
      ],
      references: [],
    };

    const result = parseExtractionResult(validData);
    expect(result).toEqual(validData);
  });

  it("should default raw_hash and quote when missing", () => {
    const data = {
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-05-19T12:00:00Z",
      },
      entities: [],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
    };

    const result = parseExtractionResult(data);
    expect(result.source.raw_hash).toBe("");
    expect(result.source.quote).toBe("");
  });

  it("rejects invalid confidence values", () => {
    const data = {
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-05-19T12:00:00Z",
        raw_hash: "abc123",
        quote: "test",
      },
      entities: [
        {
          slug: "test",
          name: "Test Entity",
          type: "project",
          context: "test context",
          confidence: "invalid_confidence",
        },
      ],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
    };

    expect(() => parseExtractionResult(data)).toThrow();
  });

  it("rejects invalid entity types", () => {
    const data = {
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-05-19T12:00:00Z",
        raw_hash: "abc123",
        quote: "test",
      },
      entities: [
        {
          slug: "test",
          name: "Test Entity",
          type: "invalid_type",
          context: "test context",
          confidence: "direct",
        },
      ],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
    };

    expect(() => parseExtractionResult(data)).toThrow();
  });
});

describe("SourceRef v2 schema", () => {
  it("requires SourceRefCore fields in the strict core schema", () => {
    expect(() =>
      SourceRefCoreSchema.parse({
        platform: "wechat",
        channel: "dm/wechat/wxid_123",
        timestamp: "2026-06-04T10:00:00.000Z",
        raw_hash: "hash-123",
        quote: "部署方案已确认",
      }),
    ).not.toThrow();

    expect(() =>
      SourceRefCoreSchema.parse({
        platform: "wechat",
        channel: "dm/wechat/wxid_123",
        timestamp: "2026-06-04T10:00:00.000Z",
        quote: "缺少 raw_hash",
      }),
    ).toThrow();
  });

  it("accepts SourceRef v2 extension fields", () => {
    const parsed = SourceRefSchema.parse({
      platform: "feishu",
      source_type: "dm",
      channel: "dm/feishu/oc_123",
      channel_name: "张三",
      timestamp: "2026-06-04T10:00:00.000Z",
      start_time: "2026-06-04T09:55:00.000Z",
      end_time: "2026-06-04T10:05:00.000Z",
      external_id: "om_001",
      message_ids: ["om_001", "om_002"],
      thread_id: "thread_001",
      conversation_id: "oc_123",
      author: { id: "ou_alice", name: "Alice", role: "author" },
      participants: [
        { id: "ou_alice", name: "Alice", role: "sender" },
        { id: "ou_bob", name: "Bob", role: "participant" },
      ],
      account_id: "account_1",
      tenant_id: "tenant_1",
      sensitivity: "high",
      raw_hash: "hash-123",
      quote: "我们决定本周上线",
      metadata: { chat_type: "p2p" },
    });

    expect(parsed.source_type).toBe("dm");
    expect(parsed.channel_name).toBe("张三");
    expect(parsed.message_ids).toEqual(["om_001", "om_002"]);
    expect(parsed.participants?.[0]).toEqual({
      id: "ou_alice",
      name: "Alice",
      role: "sender",
    });
    expect(parsed.metadata).toEqual({ chat_type: "p2p" });
  });

  it("keeps legacy SourceRef compatibility for raw_hash and quote", () => {
    const parsed = SourceRefSchema.parse({
      platform: "slack",
      channel: "#engineering",
      timestamp: "2026-05-19T12:00:00Z",
    });

    expect(parsed.raw_hash).toBe("");
    expect(parsed.quote).toBe("");
  });
});

describe("SignificanceVerdict schema validation", () => {
  it("should parse valid SignificanceVerdict", () => {
    const validVerdict: SignificanceVerdict = {
      worth_processing: true,
      reason: "Contains important technical decisions",
      topics: ["api-design", "architecture"],
      confidence: 0.85,
    };

    const result = parseSignificanceVerdict(validVerdict);
    expect(result).toEqual(validVerdict);
  });

  it("should throw ZodError when required field is missing", () => {
    const invalidVerdict = {
      worth_processing: true,
      reason: "test",
      // missing topics
      confidence: 0.8,
    };

    expect(() => parseSignificanceVerdict(invalidVerdict)).toThrow(/topics.*Required/);
  });

  it("should throw ZodError when confidence is out of range", () => {
    const invalidVerdict = {
      worth_processing: true,
      reason: "test",
      topics: ["test"],
      confidence: 1.5, // Out of range (0-1)
    };

    expect(() => parseSignificanceVerdict(invalidVerdict)).toThrow(/confidence/);
  });

  it("should throw ZodError when confidence is negative", () => {
    const invalidVerdict = {
      worth_processing: true,
      reason: "test",
      topics: ["test"],
      confidence: -0.1, // Negative
    };

    expect(() => parseSignificanceVerdict(invalidVerdict)).toThrow(/confidence/);
  });

  it("should accept confidence at boundaries (0 and 1)", () => {
    const verdict1: SignificanceVerdict = {
      worth_processing: false,
      reason: "test",
      topics: [],
      confidence: 0,
    };

    const verdict2: SignificanceVerdict = {
      worth_processing: true,
      reason: "test",
      topics: ["test"],
      confidence: 1,
    };

    expect(parseSignificanceVerdict(verdict1)).toEqual(verdict1);
    expect(parseSignificanceVerdict(verdict2)).toEqual(verdict2);
  });

  it("should throw ZodError when worth_processing is not boolean", () => {
    const invalidVerdict = {
      worth_processing: "yes", // Should be boolean
      reason: "test",
      topics: ["test"],
      confidence: 0.8,
    };

    expect(() => parseSignificanceVerdict(invalidVerdict)).toThrow(/worth_processing/);
  });
});

describe("LinkType validation", () => {
  it("should accept all valid link types", () => {
    const linkTypes = [
      "works_on",
      "works_at",
      "reports_to",
      "collaborates",
      "depends_on",
      "mentions",
      "approves",
      "uses",
      "custom",
    ];

    linkTypes.forEach((type) => {
      const data = {
        source: {
          platform: "slack",
          channel: "#engineering",
          timestamp: "2026-05-19T12:00:00Z",
          raw_hash: "abc123",
          quote: "test",
        },
        entities: [],
        timeline: [],
        links: [
          {
            from: "entity-a",
            to: "entity-b",
            type,
            context: "test context",
            confidence: "direct",
            source: {
              platform: "slack",
              channel: "#engineering",
              timestamp: "2026-05-19T12:00:00Z",
              raw_hash: "abc123",
              quote: "test context",
            },
          },
        ],
        decisions: [],
        tasks: [],
        discoveries: [],
      };

      expect(() => parseExtractionResult(data)).not.toThrow();
    });
  });
});

describe("TaskSignal status validation", () => {
  it("should accept all valid task statuses", () => {
    const statuses = ["open", "in_progress", "done", "cancelled"];

    statuses.forEach((status) => {
      const data = {
        source: {
          platform: "slack",
          channel: "#engineering",
          timestamp: "2026-05-19T12:00:00Z",
          raw_hash: "abc123",
          quote: "test",
        },
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [
          {
            title: "Test task",
            status,
            confidence: "direct",
            source: {
              platform: "slack",
              channel: "#engineering",
              timestamp: "2026-05-19T12:00:00Z",
              raw_hash: "abc123",
              quote: "test",
            },
          },
        ],
        discoveries: [],
      };

      expect(() => parseExtractionResult(data)).not.toThrow();
    });
  });
});

describe("Discovery type validation", () => {
  it("should accept all valid discovery types", () => {
    const types = ["procedure", "pattern", "insight", "risk"];

    types.forEach((type) => {
      const data = {
        source: {
          platform: "slack",
          channel: "#engineering",
          timestamp: "2026-05-19T12:00:00Z",
          raw_hash: "abc123",
          quote: "test",
        },
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [
          {
            summary: "Test discovery",
            type,
            entities: [],
            confidence: "direct",
            source: {
              platform: "slack",
              channel: "#engineering",
              timestamp: "2026-05-19T12:00:00Z",
              raw_hash: "abc123",
              quote: "test",
            },
          },
        ],
      };

      expect(() => parseExtractionResult(data)).not.toThrow();
    });
  });
});

describe("KnowledgeSchema", () => {
  const validKnowledge = {
    topic: "react-hooks",
    content: "React useEffect runs twice in StrictMode during development",
    source_type: "teaching",
    related_entities: ["tool/react"],
    valid_at: "2026-05-20T14:30:00Z",
    invalid_at: "2026-12-31T23:59:59Z",
    source: {
      platform: "claude-code",
      channel: "session-abc",
      timestamp: "2026-05-20T14:30:00Z",
      raw_hash: "a1b2c3d4",
      quote: "useEffect will run twice in dev mode because StrictMode intentionally...",
    },
    confidence: "direct",
  };

  it("parses valid Knowledge", () => {
    const result = KnowledgeSchema.parse(validKnowledge);
    expect(result.topic).toBe("react-hooks");
    expect(result.content).toContain("useEffect");
    expect(result.source_type).toBe("teaching");
    expect(result.confidence).toBe("direct");
  });

  it("normalizes non-ASCII topic to kebab-case", () => {
    const result = KnowledgeSchema.parse({
      ...validKnowledge,
      topic: "飞书 API 限流",
    });
    expect(result.topic).toMatch(/^[a-z0-9一-鿿]+(-[a-z0-9一-鿿]+)*$/);
    expect(result.topic).not.toBe("");
  });

  it("normalizes topic with special characters", () => {
    const result = KnowledgeSchema.parse({
      ...validKnowledge,
      topic: "React.useEffect() / StrictMode",
    });
    expect(result.topic).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("falls back to hash for empty-after-normalize topic", () => {
    const result = KnowledgeSchema.parse({
      ...validKnowledge,
      topic: "!!!",
    });
    // Topic "!!!" normalizes to empty string, so slug is just the hash
    expect(result.topic).toMatch(/^[a-f0-9]{12}$/);
  });

  it("truncates long topic to 80 chars", () => {
    const result = KnowledgeSchema.parse({
      ...validKnowledge,
      topic: "a".repeat(200),
    });
    expect(result.topic.length).toBeLessThanOrEqual(80);
  });

  it("rejects empty topic", () => {
    expect(() => KnowledgeSchema.parse({ ...validKnowledge, topic: "" })).toThrow();
  });

  it("rejects invalid source_type", () => {
    expect(() => KnowledgeSchema.parse({ ...validKnowledge, source_type: "unknown" })).toThrow();
  });

  it("validates valid_at as ISO 8601 datetime", () => {
    expect(() => KnowledgeSchema.parse({ ...validKnowledge, valid_at: "not-a-date" })).toThrow();
  });

  it("rejects invalid_at before valid_at", () => {
    expect(() =>
      KnowledgeSchema.parse({
        ...validKnowledge,
        valid_at: "2026-12-31T00:00:00Z",
        invalid_at: "2026-01-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("accepts missing valid_at and invalid_at", () => {
    const { valid_at, invalid_at, ...rest } = validKnowledge;
    const result = KnowledgeSchema.parse(rest);
    expect(result.valid_at).toBeUndefined();
    expect(result.invalid_at).toBeUndefined();
  });

  it("accepts empty related_entities", () => {
    const result = KnowledgeSchema.parse({
      ...validKnowledge,
      related_entities: [],
    });
    expect(result.related_entities).toEqual([]);
  });
});

describe("ExtractionResultSchema with knowledge", () => {
  it("defaults knowledge to empty array for backward compat", () => {
    const minimal = {
      source: {
        platform: "test",
        channel: "test",
        timestamp: "2026-01-01T00:00:00Z",
      },
      entities: [],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
    };
    const result = parseExtractionResult(minimal);
    expect(result.knowledge).toEqual([]);
  });

  it("parses knowledge array in ExtractionResult", () => {
    const full = {
      source: {
        platform: "test",
        channel: "test",
        timestamp: "2026-01-01T00:00:00Z",
      },
      entities: [],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
      knowledge: [
        {
          topic: "react-hooks",
          content: "useEffect runs twice in StrictMode",
          source_type: "teaching",
          related_entities: [],
          source: {
            platform: "test",
            channel: "test",
            timestamp: "2026-01-01T00:00:00Z",
            raw_hash: "abc123",
            quote: "test quote",
          },
          confidence: "direct",
        },
      ],
    };
    const result = parseExtractionResult(full);
    expect(result.knowledge).toHaveLength(1);
    expect(result.knowledge[0].topic).toBe("react-hooks");
  });
});

describe("PreferenceSchema", () => {
  it("parses a valid preference", () => {
    const result = PreferenceSchema.parse({
      summary: "Prefers async communication over meetings",
      category: "communication",
      entities: ["person/alice"],
      source: {
        platform: "slack",
        channel: "#general",
        timestamp: "2026-06-01T10:00:00Z",
        raw_hash: "hash1",
        quote: "I'd rather we just write things down than meet",
      },
      confidence: "direct",
    });
    expect(result.category).toBe("communication");
    expect(result.entities).toEqual(["person/alice"]);
  });

  it("rejects an invalid category", () => {
    expect(() =>
      PreferenceSchema.parse({
        summary: "Likes pizza",
        category: "food", // not in the enum
        entities: [],
        source: {
          platform: "slack",
          channel: "#general",
          timestamp: "2026-06-01T10:00:00Z",
          raw_hash: "hash1",
          quote: "q",
        },
        confidence: "direct",
      }),
    ).toThrow();
  });
});

describe("ReferenceSchema", () => {
  it("parses a valid reference", () => {
    const result = ReferenceSchema.parse({
      title: "JWT Best Practices Guide",
      url: "https://example.com/jwt-guide",
      summary: "Covers token expiration and signing algorithm choices",
      trigger: "When implementing JWT-based auth",
      entities: ["tool/jwt"],
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-06-01T10:00:00Z",
        raw_hash: "hash2",
        quote: "Check this out: https://example.com/jwt-guide",
      },
      confidence: "direct",
    });
    expect(result.url).toBe("https://example.com/jwt-guide");
    expect(result.trigger).toBe("When implementing JWT-based auth");
  });

  it("requires url and title", () => {
    expect(() =>
      ReferenceSchema.parse({
        summary: "A guide",
        entities: [],
        source: {
          platform: "slack",
          channel: "#general",
          timestamp: "2026-06-01T10:00:00Z",
          raw_hash: "hash2",
          quote: "q",
        },
        confidence: "direct",
      }),
    ).toThrow();
  });
});

describe("ExtractionResult schema with preferences and references", () => {
  it("accepts preferences and references arrays, defaulting to empty when absent", () => {
    const minimal = parseExtractionResult({
      source: {
        platform: "slack",
        channel: "#general",
        timestamp: "2026-06-01T10:00:00Z",
        raw_hash: "hash3",
        quote: "q",
      },
      entities: [],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
      knowledge: [],
    });
    expect(minimal.preferences).toEqual([]);
    expect(minimal.references).toEqual([]);
  });
});
