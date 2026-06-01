/**
 * Tests for SignalExtractor
 */

import { describe, expect, it } from "vitest";
import type { CanonicalisedBlock, ConversationBlock, ExtractionResult } from "../../src/core/types";
import { createMockProvider } from "../../src/extractors/providers/mock";
import { createSignalExtractor } from "../../src/extractors/signal-extractor";

const createTestBlock = (): ConversationBlock => ({
  block_id: "test-block-1",
  platform: "slack",
  channel: "#general",
  thread_id: "thread-123",
  messages: [
    {
      platform: "slack",
      channel: "#general",
      contact: "alice",
      timestamp: "2024-01-15T10:00:00Z",
      content: "We need to implement the new auth system using JWT",
      direction: "sent",
    },
    {
      platform: "slack",
      channel: "#general",
      contact: "bob",
      timestamp: "2024-01-15T10:01:00Z",
      content: "Good idea. I'll work on it this week",
      direction: "received",
    },
  ],
  start_time: "2024-01-15T10:00:00Z",
  end_time: "2024-01-15T10:01:00Z",
  participants: ["alice", "bob"],
  token_count: 50,
});

const createValidExtractionResult = (): ExtractionResult => ({
  source: {
    platform: "slack",
    channel: "#general",
    timestamp: "2024-01-15T10:00:00Z",
    thread_id: "thread-123",
    raw_hash: "hash123",
    quote: "We need to implement the new auth system using JWT",
  },
  entities: [
    {
      slug: "project/auth-system",
      name: "Auth System",
      type: "project",
      context: "New authentication system using JWT",
      confidence: "direct",
    },
    {
      slug: "person/bob",
      name: "Bob",
      type: "person",
      context: "Developer working on auth system",
      confidence: "direct",
    },
  ],
  timeline: [
    {
      date: "2024-01-15",
      summary: "Decision to implement JWT-based auth system",
      entities: ["project/auth-system", "person/bob"],
      source: {
        platform: "slack",
        channel: "#general",
        timestamp: "2024-01-15T10:00:00Z",
        raw_hash: "hash123",
        quote: "We need to implement the new auth system using JWT",
      },
      confidence: "direct",
    },
  ],
  links: [
    {
      from: "person/bob",
      to: "project/auth-system",
      type: "works_on",
      context: "Bob committed to working on auth system this week",
      confidence: "direct",
      source: {
        platform: "slack",
        channel: "#general",
        timestamp: "2024-01-15T10:00:00Z",
        raw_hash: "hash123",
        quote: "Bob committed to working on auth system this week",
      },
    },
  ],
  decisions: [
    {
      summary: "Use JWT for authentication",
      reasoning: "Team agreed to implement JWT-based auth system",
      entities: ["project/auth-system"],
      date: "2024-01-15",
      confidence: "direct",
      source: {
        platform: "slack",
        channel: "#general",
        timestamp: "2024-01-15T10:00:00Z",
        raw_hash: "hash123",
        quote: "We need to implement the new auth system using JWT",
      },
    },
  ],
  tasks: [],
  discoveries: [],
  knowledge: [],
});

describe("SignalExtractor", () => {
  describe("successful extraction", () => {
    it("returns BlockResult.ok with valid LLM response", async () => {
      const validResult = createValidExtractionResult();
      // Mock provider matches on any prompt containing the conversation
      const mockProvider = createMockProvider(
        new Map([["we need to implement the new auth system", JSON.stringify(validResult)]]),
      );

      const extractor = createSignalExtractor(mockProvider);
      const block = createTestBlock();
      const result = await extractor.extract(block);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.entities).toHaveLength(2);
        expect(result.data.timeline).toHaveLength(1);
        expect(result.data.links).toHaveLength(1);
        expect(result.data.decisions).toHaveLength(1);
      }
    });

    it("handles empty signals arrays", async () => {
      const emptyResult: ExtractionResult = {
        source: {
          platform: "slack",
          channel: "#general",
          timestamp: "2024-01-15T10:00:00Z",
          raw_hash: "hash123",
          quote: "Small talk, no significant content",
        },
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const mockProvider = createMockProvider(
        new Map([["we need to implement the new auth system", JSON.stringify(emptyResult)]]),
      );

      const extractor = createSignalExtractor(mockProvider);
      const block = createTestBlock();
      const result = await extractor.extract(block);

      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.data.entities).toHaveLength(0);
        expect(result.data.timeline).toHaveLength(0);
      }
    });
  });

  describe("validation and retry", () => {
    it("returns BlockResult.failed when LLM returns invalid JSON initially", async () => {
      const invalidJson = '{ "entities": "not an array" }';
      const mockProvider = createMockProvider(
        new Map([["we need to implement the new auth system", invalidJson]]),
      );

      const extractor = createSignalExtractor(mockProvider);
      const block = createTestBlock();
      const result = await extractor.extract(block);

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.error).toContain("validation failed");
      }
    });

    it("retries once on validation failure with error feedback", async () => {
      let callCount = 0;
      const invalidJson = '{ "entities": "not an array" }';
      const validResult = createValidExtractionResult();

      const mockProvider = {
        async chat() {
          callCount++;
          if (callCount === 1) {
            return invalidJson; // First call fails
          }
          return JSON.stringify(validResult); // Second call succeeds
        },
      };

      const extractor = createSignalExtractor(mockProvider);
      const block = createTestBlock();
      const result = await extractor.extract(block);

      expect(callCount).toBe(2); // Should have retried
      expect(result.status).toBe("ok");
    });

    it("returns BlockResult.failed after second validation failure", async () => {
      let callCount = 0;
      const invalidJson = '{ "entities": "not an array" }';

      const mockProvider = {
        async chat() {
          callCount++;
          return invalidJson; // Always fails
        },
      };

      const extractor = createSignalExtractor(mockProvider);
      const block = createTestBlock();
      const result = await extractor.extract(block);

      expect(callCount).toBe(2); // Should have retried once
      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.error).toContain("validation failed");
      }
    });

    it("returns BlockResult.failed on malformed JSON", async () => {
      const malformedJson = "{ invalid json }";
      const mockProvider = createMockProvider(
        new Map([["we need to implement the new auth system", malformedJson]]),
      );

      const extractor = createSignalExtractor(mockProvider);
      const block = createTestBlock();
      const result = await extractor.extract(block);

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.error).toContain("JSON");
      }
    });
  });

  describe("conversation formatting", () => {
    it("formats messages into readable conversation text", async () => {
      let capturedPrompt = "";
      const validResult = createValidExtractionResult();

      const mockProvider = {
        async chat(messages: Array<{ role: string; content: string }>) {
          capturedPrompt = messages.map((m) => m.content).join("\n");
          return JSON.stringify(validResult);
        },
      };

      const extractor = createSignalExtractor(mockProvider);
      const block = createTestBlock();
      await extractor.extract(block);

      // Should include timestamps and speaker info
      expect(capturedPrompt).toContain("alice");
      expect(capturedPrompt).toContain("bob");
      expect(capturedPrompt).toContain("JWT");
    });
  });

  describe("confidence levels", () => {
    it("validates all four confidence levels", async () => {
      const result: ExtractionResult = {
        source: {
          platform: "slack",
          channel: "#general",
          timestamp: "2024-01-15T10:00:00Z",
          raw_hash: "hash123",
          quote: "Test quote",
        },
        entities: [
          {
            slug: "person/alice",
            name: "Alice",
            type: "person",
            context: "Direct mention",
            confidence: "direct",
          },
          {
            slug: "person/bob",
            name: "Bob",
            type: "person",
            context: "Paraphrased reference",
            confidence: "paraphrased",
          },
          {
            slug: "person/charlie",
            name: "Charlie",
            type: "person",
            context: "Inferred from context",
            confidence: "inferred",
          },
          {
            slug: "person/dave",
            name: "Dave",
            type: "person",
            context: "Speculative connection",
            confidence: "speculative",
          },
        ],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
      };

      const mockProvider = createMockProvider(
        new Map([["we need to implement the new auth system", JSON.stringify(result)]]),
      );

      const extractor = createSignalExtractor(mockProvider);
      const block = createTestBlock();
      const extractionResult = await extractor.extract(block);

      expect(extractionResult.status).toBe("ok");
      if (extractionResult.status === "ok") {
        expect(extractionResult.data.entities).toHaveLength(4);
        expect(extractionResult.data.entities[0].confidence).toBe("direct");
        expect(extractionResult.data.entities[1].confidence).toBe("paraphrased");
        expect(extractionResult.data.entities[2].confidence).toBe("inferred");
        expect(extractionResult.data.entities[3].confidence).toBe("speculative");
      }
    });
  });
});

describe("SignalExtractor — CanonicalisedBlock input", () => {
  it("email source uses canonical_markdown in prompt", async () => {
    let capturedPrompt = "";
    const validResult = createValidExtractionResult();

    const mockProvider = {
      async chat(messages: Array<{ role: string; content: string }>) {
        capturedPrompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify(validResult);
      },
    };

    const extractor = createSignalExtractor(mockProvider);
    const cb: CanonicalisedBlock = {
      block: {
        block_id: "test-email-1",
        platform: "feishu",
        channel: "mail/INBOX",
        thread_id: undefined,
        messages: [
          {
            platform: "feishu",
            channel: "mail/INBOX",
            contact: "alice",
            timestamp: "2026-05-29T10:00:00Z",
            content: "raw email content",
            direction: "received",
          },
        ],
        start_time: "2026-05-29T10:00:00Z",
        end_time: "2026-05-29T10:00:00Z",
        participants: ["alice"],
        token_count: 50,
      },
      source_type: "email",
      interaction_tags: [],
      canonical_markdown:
        "---\nFrom: bob@example.com\nSubject: Migration Plan\n---\nLet's migrate to PostgreSQL.",
    };

    const result = await extractor.extract(cb);
    expect(result.status).toBe("ok");
    // Verify canonical_markdown was used (should contain the email metadata)
    expect(capturedPrompt).toContain("From: bob@example.com");
    expect(capturedPrompt).toContain("Subject: Migration Plan");
    expect(capturedPrompt).toContain("migrate to PostgreSQL");
    // Should NOT contain formatted message like [timestamp] → contact:
    expect(capturedPrompt).not.toContain("raw email content");
  });

  it("document source uses canonical_markdown in prompt", async () => {
    let capturedPrompt = "";
    const validResult = createValidExtractionResult();

    const mockProvider = {
      async chat(messages: Array<{ role: string; content: string }>) {
        capturedPrompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify(validResult);
      },
    };

    const extractor = createSignalExtractor(mockProvider);
    const cb: CanonicalisedBlock = {
      block: {
        block_id: "test-doc-1",
        platform: "feishu",
        channel: "doc/docx_abc123",
        thread_id: undefined,
        messages: [
          {
            platform: "feishu",
            channel: "doc/docx_abc123",
            contact: "alice",
            timestamp: "2026-05-29T10:00:00Z",
            content: "raw doc content",
            direction: "received",
          },
        ],
        start_time: "2026-05-29T10:00:00Z",
        end_time: "2026-05-29T10:00:00Z",
        participants: ["alice"],
        token_count: 80,
      },
      source_type: "document",
      interaction_tags: [],
      canonical_markdown: "# Architecture Decision\n\n We will use microservices architecture.",
    };

    const result = await extractor.extract(cb);
    expect(result.status).toBe("ok");
    expect(capturedPrompt).toContain("# Architecture Decision");
    expect(capturedPrompt).toContain("microservices architecture");
    expect(capturedPrompt).not.toContain("raw doc content");
  });

  it("structured source uses canonical_markdown in prompt", async () => {
    let capturedPrompt = "";
    const validResult = createValidExtractionResult();

    const mockProvider = {
      async chat(messages: Array<{ role: string; content: string }>) {
        capturedPrompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify(validResult);
      },
    };

    const extractor = createSignalExtractor(mockProvider);
    const cb: CanonicalisedBlock = {
      block: {
        block_id: "test-struct-1",
        platform: "feishu",
        channel: "bitable/tbl_123",
        thread_id: undefined,
        messages: [
          {
            platform: "feishu",
            channel: "bitable/tbl_123",
            contact: "system",
            timestamp: "2026-05-29T10:00:00Z",
            content: "raw structured data",
            direction: "received",
          },
        ],
        start_time: "2026-05-29T10:00:00Z",
        end_time: "2026-05-29T10:00:00Z",
        participants: ["system"],
        token_count: 30,
      },
      source_type: "structured",
      interaction_tags: [],
      canonical_markdown: "| Task | Owner | Status |\n| Deploy | Alice | Done |",
    };

    const result = await extractor.extract(cb);
    expect(result.status).toBe("ok");
    expect(capturedPrompt).toContain("| Task | Owner | Status |");
    expect(capturedPrompt).toContain("Deploy | Alice | Done");
    expect(capturedPrompt).not.toContain("raw structured data");
  });

  it("chat source with CanonicalisedBlock uses formatConversation", async () => {
    let capturedPrompt = "";
    const validResult = createValidExtractionResult();

    const mockProvider = {
      async chat(messages: Array<{ role: string; content: string }>) {
        capturedPrompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify(validResult);
      },
    };

    const extractor = createSignalExtractor(mockProvider);
    const cb: CanonicalisedBlock = {
      block: {
        block_id: "test-chat-1",
        platform: "feishu",
        channel: "group/oc_abc",
        thread_id: undefined,
        messages: [
          {
            platform: "feishu",
            channel: "group/oc_abc",
            contact: "alice",
            timestamp: "2026-05-29T10:00:00Z",
            content: "Let's discuss the plan",
            direction: "received",
          },
          {
            platform: "feishu",
            channel: "group/oc_abc",
            contact: "bob",
            timestamp: "2026-05-29T10:01:00Z",
            content: "Sure, I'm ready",
            direction: "sent",
          },
        ],
        start_time: "2026-05-29T10:00:00Z",
        end_time: "2026-05-29T10:01:00Z",
        participants: ["alice", "bob"],
        token_count: 50,
      },
      source_type: "chat",
      interaction_tags: [],
      canonical_markdown:
        "[2026-05-29T10:00:00Z] alice: Let's discuss the plan\n[2026-05-29T10:01:00Z] bob: Sure, I'm ready",
    };

    const result = await extractor.extract(cb);
    expect(result.status).toBe("ok");
    // For chat source, should use formatConversation with arrows
    expect(capturedPrompt).toMatch(/[←→]/); // Should contain direction arrows
    expect(capturedPrompt).toContain("alice");
    expect(capturedPrompt).toContain("bob");
    expect(capturedPrompt).toContain("discuss the plan");
  });

  it("dm source with CanonicalisedBlock uses formatConversation", async () => {
    let capturedPrompt = "";
    const validResult = createValidExtractionResult();

    const mockProvider = {
      async chat(messages: Array<{ role: string; content: string }>) {
        capturedPrompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify(validResult);
      },
    };

    const extractor = createSignalExtractor(mockProvider);
    const cb: CanonicalisedBlock = {
      block: {
        block_id: "test-dm-1",
        platform: "feishu",
        channel: "dm/ou_alice",
        thread_id: undefined,
        messages: [
          {
            platform: "feishu",
            channel: "dm/ou_alice",
            contact: "alice",
            timestamp: "2026-05-29T10:00:00Z",
            content: "Quick question about the API",
            direction: "received",
          },
        ],
        start_time: "2026-05-29T10:00:00Z",
        end_time: "2026-05-29T10:00:00Z",
        participants: ["alice"],
        token_count: 20,
      },
      source_type: "dm",
      interaction_tags: ["dm"],
      canonical_markdown: "[2026-05-29T10:00:00Z] alice: Quick question about the API",
    };

    const result = await extractor.extract(cb);
    expect(result.status).toBe("ok");
    // DM should also use formatConversation (it's conversational, not document-like)
    expect(capturedPrompt).toMatch(/[←→]/);
    expect(capturedPrompt).toContain("alice");
    expect(capturedPrompt).toContain("Quick question about the API");
  });

  it("raw ConversationBlock still works (backwards compat)", async () => {
    let capturedPrompt = "";
    const validResult = createValidExtractionResult();

    const mockProvider = {
      async chat(messages: Array<{ role: string; content: string }>) {
        capturedPrompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify(validResult);
      },
    };

    const extractor = createSignalExtractor(mockProvider);
    const block: ConversationBlock = {
      block_id: "test-raw-1",
      platform: "feishu",
      channel: "group/oc_abc",
      thread_id: undefined,
      messages: [
        {
          platform: "feishu",
          channel: "group/oc_abc",
          contact: "alice",
          timestamp: "2026-05-29T10:00:00Z",
          content: "Hello world",
          direction: "received",
        },
      ],
      start_time: "2026-05-29T10:00:00Z",
      end_time: "2026-05-29T10:00:00Z",
      participants: ["alice"],
      token_count: 10,
    };

    const result = await extractor.extract(block);
    expect(result.status).toBe("ok");
    // Should use formatConversation for raw block
    expect(capturedPrompt).toMatch(/[←→]/);
    expect(capturedPrompt).toContain("alice");
    expect(capturedPrompt).toContain("Hello world");
  });
});
