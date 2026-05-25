import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GBrainAdapter } from "../../src/adapters/gbrain.js";
import type { PrivacyConfig } from "../../src/core/config.js";
import { parseExtractionResult } from "../../src/core/schemas.js";
import { MarkdownFormatter } from "../../src/formatters/markdown.js";
import { PrivacyProcessor } from "../../src/processors/privacy.js";

describe("Knowledge Pipeline E2E", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), "tests", "temp", `e2e-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("full pipeline: parse → privacy → format → push", async () => {
    // 1. Raw LLM output with Knowledge, Discovery, and Decision
    const rawLlmOutput = {
      source: {
        platform: "feishu",
        channel: "#engineering",
        timestamp: "2026-05-24T10:00:00Z",
        raw_hash: "golden-hash-001",
        quote: "飞书 API 全局限流是 50 QPS",
      },
      entities: [
        {
          slug: "tool/feishu",
          name: "Feishu",
          type: "tool",
          context: "Lark/Feishu collaboration platform",
          confidence: "direct",
        },
      ],
      timeline: [],
      links: [],
      decisions: [
        {
          summary: "Use rate limiter middleware for Feishu API calls",
          reasoning: "Feishu enforces 50 QPS globally",
          entities: ["tool/feishu"],
          date: "2026-05-24",
          confidence: "direct",
          source: {
            platform: "feishu",
            channel: "#engineering",
            timestamp: "2026-05-24T10:05:00Z",
            raw_hash: "golden-hash-002",
            quote: "我们决定加限流中间件",
          },
        },
      ],
      tasks: [],
      discoveries: [
        {
          summary: "Feishu API returns 429 without retry-after header",
          type: "insight",
          entities: ["tool/feishu"],
          source: {
            platform: "feishu",
            channel: "#engineering",
            timestamp: "2026-05-24T10:10:00Z",
            raw_hash: "golden-hash-003",
            quote: "429 没有 retry-after header",
          },
          confidence: "direct",
        },
      ],
      knowledge: [
        {
          topic: "feishu-api",
          content:
            "Feishu API global rate limit is 50 QPS per app, call 13900001111 for enterprise support",
          source_type: "document",
          related_entities: ["tool/feishu"],
          source: {
            platform: "feishu",
            channel: "docs",
            timestamp: "2026-05-24T10:00:00Z",
            raw_hash: "golden-hash-004",
            quote: "全局限流 50 QPS，企业支持 13900001111",
          },
          confidence: "direct",
        },
        {
          topic: "React.StrictMode",
          content: "React useEffect runs twice in StrictMode during development",
          source_type: "teaching",
          related_entities: [],
          source: {
            platform: "claude-code",
            channel: "session-123",
            timestamp: "2026-05-24T11:00:00Z",
            raw_hash: "golden-hash-005",
            quote: "useEffect 会在 StrictMode 下跑两次",
          },
          confidence: "paraphrased",
        },
        {
          topic: "speculative-fact",
          content: "This might be true but is uncertain",
          source_type: "conversation",
          related_entities: [],
          source: {
            platform: "slack",
            channel: "#random",
            timestamp: "2026-05-24T12:00:00Z",
            raw_hash: "golden-hash-006",
            quote: "Maybe this is the case?",
          },
          confidence: "speculative",
        },
      ],
    };

    // 2. Schema parse (with topic normalization)
    const parsed = parseExtractionResult(rawLlmOutput);

    expect(parsed.knowledge).toHaveLength(3);
    expect(parsed.knowledge[0].topic).toBe("feishu-api");
    expect(parsed.knowledge[1].topic).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(parsed.knowledge[2].confidence).toBe("speculative");

    // 3. Privacy processing
    const privacyConfig: PrivacyConfig = {
      enabled: true,
      mode: "irreversible",
      redact_phone: true,
      redact_id_card: false,
      redact_bank_card: false,
      blocked_words: [],
      replacement: "[REDACTED]",
    };

    const privacy = new PrivacyProcessor(privacyConfig);
    const redacted = privacy.process(parsed);

    expect(redacted.knowledge[0].content).not.toContain("13900001111");
    expect(redacted.knowledge[0].content).toContain("[REDACTED_PHONE]");
    expect(redacted.knowledge[0].source.quote).not.toContain("13900001111");

    // 4. Markdown formatting
    const formatter = new MarkdownFormatter();
    const markdown = formatter.format(redacted);

    expect(markdown).toContain("## Knowledge");
    expect(markdown).toContain("feishu-api");
    expect(markdown).toContain("[REDACTED_PHONE]");
    expect(markdown).toContain("## Decisions");
    expect(markdown).toContain("## Discoveries");

    // 5. GBrain adapter push
    const adapter = new GBrainAdapter({ output_dir: tempDir });
    const pushResult = await adapter.push([redacted]);

    expect(pushResult.written).toBeGreaterThanOrEqual(4);
    expect(pushResult.skipped).toBeGreaterThanOrEqual(1);
    expect(pushResult.errors).toHaveLength(0);

    const feishuDir = join(tempDir, "knowledge", "feishu-api");
    expect(existsSync(feishuDir)).toBe(true);
    const feishuFiles = readdirSync(feishuDir);
    expect(feishuFiles).toHaveLength(1);

    const feishuContent = readFileSync(join(feishuDir, feishuFiles[0]), "utf-8");
    expect(feishuContent).toContain("type: knowledge");
    expect(feishuContent).toContain("## Provenance");
    expect(feishuContent).toContain("## Related Entities");
    expect(feishuContent).toContain("tool/feishu");

    const specDir = join(tempDir, "knowledge", "speculative-fact");
    expect(existsSync(specDir)).toBe(false);
  });
});
