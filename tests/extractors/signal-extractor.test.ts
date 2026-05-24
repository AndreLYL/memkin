/**
 * Tests for SignalExtractor
 */

import { describe, expect, it } from "vitest";
import type { ConversationBlock, ExtractionResult } from "../../src/core/types";
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
      const invalidJson = '{ "entities": [] }'; // missing required fields
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
      const invalidJson = '{ "entities": [] }'; // missing required fields

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
