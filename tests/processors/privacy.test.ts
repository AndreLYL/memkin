/**
 * Tests for PrivacyProcessor
 * Tests redaction of sensitive data in ExtractionResult
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrivacyConfig } from "../../src/core/config.js";
import { ensureStateDir, statePath } from "../../src/core/state.js";
import type { ExtractionResult } from "../../src/core/types.js";
import { PrivacyProcessor } from "../../src/processors/privacy.js";

const baseResult: ExtractionResult = {
  source: {
    platform: "slack",
    channel: "#engineering",
    timestamp: "2026-05-19T12:00:00Z",
    message_id: "msg-123",
    raw_hash: "abc123def456",
    quote: "Call me at 13812345678 for details",
  },
  entities: [
    {
      slug: "john-doe",
      name: "John Doe",
      type: "person",
      context: "Developer from Beijing, ID: 110101199001011234, email john@example.com",
      confidence: "direct",
    },
  ],
  timeline: [],
  links: [
    {
      from: "john-doe",
      to: "project-x",
      type: "works_on",
      context: "Works on Project X at IP 192.168.1.1",
      confidence: "direct",
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-05-19T12:00:00Z",
        raw_hash: "abc123",
        quote: "Works on Project X",
      },
    },
  ],
  decisions: [
    {
      summary: "Approved user 13912345678 for access",
      reasoning: "User with ID 310101200001011234 meets requirements",
      entities: ["john-doe"],
      date: "2026-05-19T12:00:00Z",
      confidence: "direct",
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-05-19T12:00:00Z",
        raw_hash: "abc123",
        quote: "Approved access",
      },
    },
  ],
  tasks: [
    {
      title: "Contact person at 13712345678 about credentials",
      status: "open",
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-05-19T12:00:00Z",
        raw_hash: "abc123",
        quote: "Contact about credentials",
      },
      confidence: "direct",
    },
  ],
  discoveries: [
    {
      summary: "Discovered pattern: users from 6225123456789012 payment method",
      detail: "IP address 10.0.0.1 used for multiple transactions",
      type: "pattern",
      entities: ["john-doe"],
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-05-19T12:00:00Z",
        raw_hash: "abc123",
        quote: "Pattern discovered",
      },
      confidence: "inferred",
    },
  ],
  knowledge: [],
};

describe("PrivacyProcessor", () => {
  let processor: PrivacyProcessor;
  const redactionMapPath = statePath("redaction_map.jsonl");

  beforeEach(() => {
    ensureStateDir();
    // Clean up any existing redaction map
    if (existsSync(redactionMapPath)) {
      unlinkSync(redactionMapPath);
    }
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(redactionMapPath)) {
      unlinkSync(redactionMapPath);
    }
  });

  describe("L1 Patterns - Phone, ID, Card", () => {
    it("should redact phone numbers matching L1 pattern", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: true,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED_PHONE]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      expect(result.source.quote).not.toContain("13812345678");
      expect(result.source.quote).toContain("[REDACTED_PHONE]");
      expect(result.tasks[0].title).not.toContain("13712345678");
      expect(result.tasks[0].title).toContain("[REDACTED_PHONE]");
    });

    it("should redact ID cards matching L1 pattern", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: false,
        redact_id_card: true,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED_ID]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      expect(result.entities[0].context).not.toContain("110101199001011234");
      expect(result.entities[0].context).toContain("[REDACTED_ID]");
      expect(result.decisions[0].reasoning).not.toContain("310101200001011234");
      expect(result.decisions[0].reasoning).toContain("[REDACTED_ID]");
    });

    it("should redact bank cards matching L1 pattern", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: true,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED_CARD]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      expect(result.discoveries[0].summary).not.toContain("6225123456789012");
      expect(result.discoveries[0].summary).toContain("[REDACTED_CARD]");
    });

    it("should not redact phone numbers when redact_phone is false", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      expect(result.source.quote).toContain("13812345678");
    });
  });

  it("writes reversible redaction map under custom state base", () => {
    const customBase = mkdtempSync(join(tmpdir(), "memoark-privacy-state-"));
    const customMapPath = statePath("redaction_map.jsonl", customBase);
    const config: PrivacyConfig = {
      enabled: true,
      mode: "reversible",
      redact_phone: true,
      redact_id_card: false,
      redact_bank_card: false,
      redact_email: false,
      redact_url: false,
      blocked_words: [],
      replacement: "[REDACTED]",
    };

    try {
      const customProcessor = new PrivacyProcessor(config, { stateBase: customBase });
      customProcessor.process(baseResult);

      expect(existsSync(customMapPath)).toBe(true);
      expect(readFileSync(customMapPath, "utf-8")).toContain("13812345678");
    } finally {
      rmSync(customBase, { recursive: true, force: true });
    }
  });

  describe("L2 Patterns - IP Address", () => {
    it("should redact IP addresses in all fields", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED_IP]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      expect(result.links[0].context).not.toContain("192.168.1.1");
      expect(result.links[0].context).toContain("[REDACTED_IP]");
      expect(result.discoveries[0].detail).not.toContain("10.0.0.1");
      expect(result.discoveries[0].detail).toContain("[REDACTED_IP]");
    });
  });

  describe("L3 Patterns - Blocked Words", () => {
    it("should redact blocked words from config", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: ["credential", "credentials"],
        replacement: "[REDACTED]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      expect(result.tasks[0].title).not.toContain("credentials");
      expect(result.tasks[0].title).toContain("[REDACTED]");
    });

    it("should handle multiple blocked words", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: false,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: ["sensitive", "secret"],
        replacement: "[REDACTED]",
      };

      const testResult: ExtractionResult = {
        ...baseResult,
        decisions: [
          {
            ...baseResult.decisions[0],
            summary: "This is sensitive and secret information",
          },
        ],
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(testResult);

      expect(result.decisions[0].summary).not.toContain("sensitive");
      expect(result.decisions[0].summary).not.toContain("secret");
    });
  });

  describe("Protected Fields", () => {
    it("should NOT redact Entity.name", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: true,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      // Entity.name should remain unchanged
      expect(result.entities[0].name).toBe("John Doe");
    });

    it("should NOT redact SourceRef.raw_hash", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: true,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      // raw_hash should remain unchanged
      expect(result.source.raw_hash).toBe("abc123def456");
    });
  });

  describe("Reversible Mode", () => {
    it("should generate redaction_map.jsonl in reversible mode", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "reversible",
        redact_phone: true,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED_PHONE]",
      };

      processor = new PrivacyProcessor(config);
      processor.process(baseResult);

      // Check that redaction_map.jsonl was created
      expect(existsSync(redactionMapPath)).toBe(true);

      // Read and verify content
      const content = readFileSync(redactionMapPath, "utf-8");
      const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.length > 0);

      expect(lines.length).toBeGreaterThan(0);

      // Each line should be valid JSON with required fields
      const firstEntry = JSON.parse(lines[0]);
      expect(firstEntry).toHaveProperty("field");
      expect(firstEntry).toHaveProperty("original");
      expect(firstEntry).toHaveProperty("replacement");
      expect(firstEntry).toHaveProperty("position");

      // Verify actual redacted value is tracked
      expect(firstEntry.original).toMatch(/1[3-9]\d{9}/);
    });

    it("should not generate redaction_map.jsonl in irreversible mode", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: true,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED_PHONE]",
      };

      processor = new PrivacyProcessor(config);
      processor.process(baseResult);

      // Check that redaction_map.jsonl was NOT created
      expect(existsSync(redactionMapPath)).toBe(false);
    });
  });

  describe("Disabled Privacy", () => {
    it("should not redact when privacy is disabled", () => {
      const config: PrivacyConfig = {
        enabled: false,
        mode: "irreversible",
        redact_phone: true,
        redact_id_card: true,
        redact_bank_card: true,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      // Nothing should be redacted
      expect(result.source.quote).toBe(baseResult.source.quote);
      expect(result.entities[0].context).toBe(baseResult.entities[0].context);
      expect(result.links[0].context).toBe(baseResult.links[0].context);
    });
  });

  describe("All Redactable Fields", () => {
    it("should redact all specified fields when all options enabled", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: true,
        redact_id_card: true,
        redact_bank_card: true,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED]",
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(baseResult);

      // SourceRef.quote - has phone number
      expect(result.source.quote).not.toBe(baseResult.source.quote);

      // Entity.context - has ID card
      expect(result.entities[0].context).not.toBe(baseResult.entities[0].context);

      // Decision.summary - has phone number
      expect(result.decisions[0].summary).not.toBe(baseResult.decisions[0].summary);

      // Decision.reasoning - has ID card
      expect(result.decisions[0].reasoning).not.toBe(baseResult.decisions[0].reasoning);

      // Task.title - has phone number
      expect(result.tasks[0].title).not.toBe(baseResult.tasks[0].title);

      // Link.context - has IP address
      expect(result.links[0].context).not.toBe(baseResult.links[0].context);

      // Discovery.summary - has bank card
      expect(result.discoveries[0].summary).not.toBe(baseResult.discoveries[0].summary);

      // Discovery.detail - has IP address
      expect(result.discoveries[0].detail).not.toBe(baseResult.discoveries[0].detail);
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle multiple redactions in same field", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: true,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED_PHONE]",
      };

      const complexResult: ExtractionResult = {
        ...baseResult,
        decisions: [
          {
            ...baseResult.decisions[0],
            summary: "Call 13812345678 or 13912345679 for info",
          },
        ],
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(complexResult);

      const matches = result.decisions[0].summary.match(/\[REDACTED_PHONE\]/g);
      expect(matches).toHaveLength(2);
    });

    it("should handle empty and null optional fields", () => {
      const config: PrivacyConfig = {
        enabled: true,
        mode: "irreversible",
        redact_phone: true,
        redact_id_card: false,
        redact_bank_card: false,
        redact_email: false,
        redact_url: false,
        blocked_words: [],
        replacement: "[REDACTED]",
      };

      const sparseResult: ExtractionResult = {
        ...baseResult,
        decisions: [
          {
            summary: "Call 13812345678",
            entities: [],
            date: "2026-05-19T12:00:00Z",
            confidence: "direct",
            source: {
              platform: "slack",
              channel: "#engineering",
              timestamp: "2026-05-19T12:00:00Z",
              raw_hash: "abc123",
              quote: "Call 13912345679",
            },
            // reasoning is undefined
          },
        ],
        tasks: [],
        discoveries: [],
      };

      processor = new PrivacyProcessor(config);
      const result = processor.process(sparseResult);

      expect(result.decisions[0].summary).toContain("[REDACTED_PHONE]");
    });
  });

  describe("PrivacyProcessor - Knowledge", () => {
    const baseConfig: PrivacyConfig = {
      enabled: true,
      mode: "irreversible",
      redact_phone: true,
      redact_id_card: true,
      redact_bank_card: true,
      redact_email: false,
      redact_url: false,
      blocked_words: ["acme-corp", "project-x"],
      replacement: "[REDACTED]",
    };

    const createBaseResult = (): ExtractionResult => ({
      source: {
        platform: "test",
        channel: "test",
        timestamp: "2026-01-01T00:00:00Z",
        raw_hash: "hash123",
        quote: "test quote",
      },
      entities: [],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
      knowledge: [
        {
          topic: "feishu-api",
          content: "Feishu API rate limit is 50 QPS, call 13912345678 for support",
          source_type: "document" as const,
          related_entities: ["tool/feishu"],
          source: {
            platform: "feishu",
            channel: "docs",
            timestamp: "2026-05-20T10:00:00Z",
            raw_hash: "khash123",
            quote: "Rate limit is 50 QPS, contact 13912345678",
          },
          confidence: "direct" as const,
        },
      ],
    });

    it("redacts phone numbers in knowledge content", () => {
      const processor = new PrivacyProcessor(baseConfig);
      const result = processor.process(createBaseResult());
      expect(result.knowledge[0].content).toContain("[REDACTED_PHONE]");
      expect(result.knowledge[0].content).not.toContain("13912345678");
    });

    it("redacts phone numbers in knowledge source.quote", () => {
      const processor = new PrivacyProcessor(baseConfig);
      const result = processor.process(createBaseResult());
      expect(result.knowledge[0].source.quote).toContain("[REDACTED_PHONE]");
    });

    it("applies blocked words check to topic", () => {
      const processor = new PrivacyProcessor(baseConfig);
      const input = createBaseResult();
      input.knowledge[0].topic = "acme-corp-api";
      const result = processor.process(input);
      expect(result.knowledge[0].topic).toContain("[REDACTED]");
      expect(result.knowledge[0].topic).not.toContain("acme-corp");
    });

    it("does NOT apply L1/L2 regex to topic", () => {
      const processor = new PrivacyProcessor(baseConfig);
      const input = createBaseResult();
      input.knowledge[0].topic = "api-v2-13912345678";
      const result = processor.process(input);
      expect(result.knowledge[0].topic).toBe("api-v2-13912345678");
    });

    it("does NOT redact related_entities", () => {
      const processor = new PrivacyProcessor(baseConfig);
      const input = createBaseResult();
      input.knowledge[0].related_entities = ["project/acme-corp"];
      const result = processor.process(input);
      expect(result.knowledge[0].related_entities).toEqual(["project/acme-corp"]);
    });

    it("preserves knowledge when privacy is disabled", () => {
      const processor = new PrivacyProcessor({ ...baseConfig, enabled: false });
      const input = createBaseResult();
      const result = processor.process(input);
      expect(result.knowledge[0].content).toContain("13912345678");
    });
  });
});
