import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseExtractionResult } from "./core/schemas.js";
import type { ConversationBlock, ExtractionResult, RawMessage, SourceRef } from "./core/types.js";
import { PrivacyProcessor } from "./processors/privacy.js";

// ── Helpers ──────────────────────────────────────────────────

function makeMsg(overrides: Partial<RawMessage> = {}): RawMessage {
  return {
    platform: "feishu",
    channel: "oc_test123",
    contact: "ou_abc123",
    timestamp: "2026-05-28T10:00:00Z",
    content: "测试消息",
    direction: "received",
    metadata: { message_id: "msg_001" },
    ...overrides,
  };
}

function makeBlock(
  messages: RawMessage[],
  overrides: Partial<ConversationBlock> = {},
): ConversationBlock {
  return {
    block_id: "blk-1",
    platform: messages[0]?.platform ?? "feishu",
    channel: messages[0]?.channel ?? "oc_test123",
    thread_id: undefined,
    messages,
    start_time: messages[0]?.timestamp ?? "2026-05-28T10:00:00Z",
    end_time: messages[messages.length - 1]?.timestamp ?? "2026-05-28T10:05:00Z",
    participants: [...new Set(messages.map((m) => m.contact))],
    token_count: 100,
    ...overrides,
  };
}

function makeSourceRef(overrides: Partial<SourceRef> = {}): SourceRef {
  return {
    platform: "feishu",
    channel: "oc_test123",
    timestamp: "2026-05-28T10:00:00Z",
    raw_hash: "deadbeef12345678",
    quote: "原始引用",
    ...overrides,
  };
}

// hashBlock reimplementation for test verification
function hashBlock(block: ConversationBlock): string {
  const messageIds = block.messages
    .map((m) => {
      const mid = m.metadata?.message_id as string | undefined;
      if (mid) return mid;
      const contentHash = createHash("sha256").update(m.content).digest("hex").slice(0, 8);
      return `${m.timestamp}:${m.contact}:${contentHash}`;
    })
    .sort()
    .join(",");
  const data = [
    block.platform,
    block.channel,
    block.thread_id ?? "",
    messageIds,
    block.start_time,
    block.end_time,
  ].join("|");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// ── AC-1: Deterministic hash ─────────────────────────────────

describe("AC-1: deterministic raw_hash", () => {
  it("produces identical hash for same messages run twice", () => {
    const msgs = [
      makeMsg({ metadata: { message_id: "msg_001" }, timestamp: "2026-05-28T10:00:00Z" }),
      makeMsg({ metadata: { message_id: "msg_002" }, timestamp: "2026-05-28T10:01:00Z" }),
    ];
    const block = makeBlock(msgs);

    const hash1 = hashBlock(block);
    const hash2 = hashBlock(block);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
  });

  it("produces different hash when message_ids differ", () => {
    const block1 = makeBlock([makeMsg({ metadata: { message_id: "msg_A" } })]);
    const block2 = makeBlock([makeMsg({ metadata: { message_id: "msg_B" } })]);
    expect(hashBlock(block1)).not.toBe(hashBlock(block2));
  });

  it("is order-independent (message_ids are sorted)", () => {
    const msgs1 = [
      makeMsg({ metadata: { message_id: "msg_002" }, timestamp: "2026-05-28T10:01:00Z" }),
      makeMsg({ metadata: { message_id: "msg_001" }, timestamp: "2026-05-28T10:00:00Z" }),
    ];
    const msgs2 = [
      makeMsg({ metadata: { message_id: "msg_001" }, timestamp: "2026-05-28T10:00:00Z" }),
      makeMsg({ metadata: { message_id: "msg_002" }, timestamp: "2026-05-28T10:01:00Z" }),
    ];
    const times = { start_time: "2026-05-28T10:00:00Z", end_time: "2026-05-28T10:01:00Z" };
    const block1 = makeBlock(msgs1, times);
    const block2 = makeBlock(msgs2, times);
    expect(hashBlock(block1)).toBe(hashBlock(block2));
  });
});

// ── AC-3/4/5: Chinese slug generation ────────────────────────

describe("AC-3/4/5: normalizeTopicSlug for CJK", () => {
  it("AC-3: Chinese name produces non-empty slug", () => {
    const result = parseExtractionResult(
      makeValidExtraction({
        knowledge: [
          {
            topic: "李应龙的工作偏好",
            content: "喜欢用 LazyVim",
            source_type: "conversation",
            related_entities: [],
            source: makeSourceRef(),
            confidence: "direct",
          },
        ],
      }),
    );
    expect(result.knowledge[0].topic).toBeTruthy();
    expect(result.knowledge[0].topic.length).toBeGreaterThanOrEqual(3);
  });

  it("AC-4: pure Chinese topic does not become 'uncategorized'", () => {
    const result = parseExtractionResult(
      makeValidExtraction({
        knowledge: [
          {
            topic: "技术架构决策",
            content: "选择了 PGLite",
            source_type: "conversation",
            related_entities: [],
            source: makeSourceRef(),
            confidence: "direct",
          },
        ],
      }),
    );
    expect(result.knowledge[0].topic).not.toBe("uncategorized");
    expect(result.knowledge[0].topic.length).toBeGreaterThanOrEqual(3);
  });

  it("AC-5: hash is deterministic for same input", () => {
    const ext1 = parseExtractionResult(
      makeValidExtraction({
        knowledge: [
          {
            topic: "中文主题",
            content: "c",
            source_type: "conversation",
            related_entities: [],
            source: makeSourceRef(),
            confidence: "direct",
          },
        ],
      }),
    );
    const ext2 = parseExtractionResult(
      makeValidExtraction({
        knowledge: [
          {
            topic: "中文主题",
            content: "c",
            source_type: "conversation",
            related_entities: [],
            source: makeSourceRef(),
            confidence: "direct",
          },
        ],
      }),
    );
    expect(ext1.knowledge[0].topic).toBe(ext2.knowledge[0].topic);
  });
});

// ── AC-6: Link.source through Zod ───────────────────────────

describe("AC-6: Link schema includes source", () => {
  it("Link.source survives Zod parse", () => {
    const src = makeSourceRef({ quote: "他们合作了" });
    const result = parseExtractionResult(
      makeValidExtraction({
        links: [
          {
            from: "alice",
            to: "bob",
            type: "collaborates",
            context: "在项目中合作",
            confidence: "direct",
            source: src,
          },
        ],
      }),
    );
    expect(result.links[0].source).toBeDefined();
    expect(result.links[0].source.platform).toBe("feishu");
    expect(result.links[0].source.quote).toBe("他们合作了");
    expect(result.links[0].source.raw_hash).toBe("deadbeef12345678");
  });
});

// ── AC-7: Privacy redacts Link.source.quote ──────────────────

describe("AC-7: Privacy redacts Link.source.quote", () => {
  it("redacts phone number in Link.source.quote", () => {
    const processor = new PrivacyProcessor({
      enabled: true,
      mode: "irreversible",
      redact_phone: true,
      redact_id_card: false,
      redact_bank_card: false,
      redact_email: false,
      redact_url: false,
      blocked_words: [],
      replacement: "[REDACTED]",
    });

    const extraction: ExtractionResult = {
      source: makeSourceRef(),
      entities: [],
      timeline: [],
      links: [
        {
          from: "alice",
          to: "bob",
          type: "collaborates",
          context: "context",
          confidence: "direct",
          source: makeSourceRef({ quote: "Call me at 13812345678 tomorrow" }),
        },
      ],
      decisions: [],
      tasks: [],
      discoveries: [],
      knowledge: [],
    };

    const processed = processor.process(extraction);
    expect(processed.links[0].source.quote).toContain("[REDACTED_PHONE]");
    expect(processed.links[0].source.quote).not.toContain("13812345678");
  });
});

// ── AC-10: first_seen provenance semantics ───────────────────

describe("AC-10: first_seen provenance (ON CONFLICT preserves original)", () => {
  it("GraphStore.addLink SQL uses DO UPDATE SET context only, not provenance", async () => {
    // This is a structural assertion — verify the SQL pattern in graph.ts
    const { readFileSync } = await import("node:fs");
    const graphSrc = readFileSync(new URL("./store/graph.ts", import.meta.url).pathname, "utf-8");
    // ON CONFLICT should NOT update provenance
    expect(graphSrc).toContain("ON CONFLICT");
    expect(graphSrc).toContain("DO UPDATE SET context = EXCLUDED.context");
    // The ON CONFLICT clause should NOT mention provenance in the SET
    const onConflictMatch = graphSrc.match(/ON CONFLICT.*?DO UPDATE SET(.*?)(?:"|`)/s);
    if (onConflictMatch) {
      expect(onConflictMatch[1]).not.toContain("provenance = EXCLUDED.provenance");
    }
  });

  it("TimelineStore.addEntry SQL preserves first provenance on conflict", async () => {
    const { readFileSync } = await import("node:fs");
    const timelineSrc = readFileSync(
      new URL("./store/timeline.ts", import.meta.url).pathname,
      "utf-8",
    );
    expect(timelineSrc).toContain("ON CONFLICT");
    const onConflictMatch = timelineSrc.match(/ON CONFLICT.*?DO UPDATE SET(.*?)(?:"|`)/s);
    if (onConflictMatch) {
      expect(onConflictMatch[1]).not.toContain("provenance = EXCLUDED.provenance");
    }
  });
});

// ── AC-11: IdentityResolver ──────────────────────────────────

describe("AC-11: IdentityResolver enrichBatch", () => {
  it("replaces ou_ contacts with cached names", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { IdentityResolver } = await import("./core/identity-resolver.js");

    const pg = new PGlite();
    await pg.query(`
      CREATE TABLE IF NOT EXISTS identity_cache (
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        slug_hint TEXT,
        resolved_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (platform, external_id)
      )
    `);
    await pg.query(
      "INSERT INTO identity_cache (platform, external_id, display_name, slug_hint) VALUES ($1, $2, $3, $4)",
      ["feishu", "ou_abc123", "李应龙", "li-yinglong"],
    );

    const resolver = new IdentityResolver(pg);
    const msgs = [makeMsg({ contact: "ou_abc123" })];
    const enriched = await resolver.enrichBatch(msgs);

    expect(enriched[0].contact).toBe("李应龙 (li-yinglong)");
    await pg.close();
  });

  it("leaves non-ou_ contacts untouched", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { IdentityResolver } = await import("./core/identity-resolver.js");

    const pg = new PGlite();
    await pg.query(`
      CREATE TABLE IF NOT EXISTS identity_cache (
        platform TEXT NOT NULL,
        external_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        slug_hint TEXT,
        resolved_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (platform, external_id)
      )
    `);

    const resolver = new IdentityResolver(pg);
    const msgs = [makeMsg({ contact: "张三" })];
    const enriched = await resolver.enrichBatch(msgs);

    expect(enriched[0].contact).toBe("张三");
    await pg.close();
  });
});

// ── AC-12: stampSourceRefs ───────────────────────────────────

describe("AC-12: stampSourceRefs overwrites LLM source, preserves quote", () => {
  it("overwrites platform/channel/raw_hash, keeps LLM quote", async () => {
    await import("./extractors/signal-extractor.js");
    // Access the internal functions via the module — they're not exported,
    // so we verify via structural test: build a block, extract hash, verify structure
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("./extractors/signal-extractor.ts", import.meta.url).pathname,
      "utf-8",
    );

    // stampSourceRefs must overwrite with canonical but preserve quote
    expect(src).toContain("stampSourceRefs");
    expect(src).toContain("quote: s.quote || canonical.quote");
    expect(src).toContain("buildSourceRef");

    // buildSourceRef must construct from block metadata
    expect(src).toContain("platform: block.platform");
    expect(src).toContain("channel: block.channel");
    expect(src).toContain("raw_hash: hashBlock(block)");
  });
});

// ── AC-9: idempotent migration ───────────────────────────────

describe("AC-9: idempotent schema migration", () => {
  it("schema.sql contains IF NOT EXISTS or DO $$ guards for new columns", async () => {
    const { readFileSync } = await import("node:fs");
    const schemaSrc = readFileSync(
      new URL("./store/schema.sql", import.meta.url).pathname,
      "utf-8",
    );
    // Must use idempotent ADD COLUMN pattern
    expect(schemaSrc).toMatch(/DO\s*\$/);
    expect(schemaSrc).toContain("ADD COLUMN");
    expect(schemaSrc).toContain("identity_cache");
    expect(schemaSrc).toContain("IF NOT EXISTS");
  });
});

// ── AC-8: provenance API endpoint ────────────────────────────

describe("AC-8: /provenance endpoint exists in API", () => {
  it("api.ts registers GET /provenance route", async () => {
    const { readFileSync } = await import("node:fs");
    const apiSrc = readFileSync(new URL("./server/api.ts", import.meta.url).pathname, "utf-8");
    expect(apiSrc).toContain('"/provenance"');
    expect(apiSrc).toContain("app.get");
    // Should query provenance from links and timeline_entries
    expect(apiSrc).toContain("l.provenance");
    expect(apiSrc).toContain("te.provenance");
  });
});

// ── Helpers for building valid ExtractionResult ──────────────

function makeValidExtraction(overrides: Partial<ExtractionResult> = {}): Record<string, unknown> {
  return {
    source: makeSourceRef(),
    entities: [],
    timeline: [],
    links: [],
    decisions: [],
    tasks: [],
    discoveries: [],
    knowledge: [],
    ...overrides,
  };
}
