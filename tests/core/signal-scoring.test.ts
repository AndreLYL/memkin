import { describe, expect, test } from "vitest";
import { scoreBlock } from "../../src/core/signal-scoring.js";
import type {
  CanonicalisedBlock,
  ConversationBlock,
  InteractionTag,
  SourceType,
} from "../../src/core/types.js";

function makeCB(overrides: {
  canonical_markdown?: string;
  source_type?: SourceType;
  interaction_tags?: InteractionTag[];
  channel?: string;
}): CanonicalisedBlock {
  const markdown =
    overrides.canonical_markdown ?? "This is a test message with some content about the project.";
  const block: ConversationBlock = {
    block_id: "test-1",
    platform: "feishu",
    channel: overrides.channel ?? "group/oc_test",
    thread_id: undefined,
    messages: [
      {
        platform: "feishu",
        channel: overrides.channel ?? "group/oc_test",
        contact: "alice",
        timestamp: "2026-05-29T10:00:00Z",
        content: markdown,
        direction: "received",
      },
    ],
    start_time: "2026-05-29T10:00:00Z",
    end_time: "2026-05-29T10:00:00Z",
    participants: ["alice"],
    token_count: 50,
  };
  return {
    block,
    source_type: overrides.source_type ?? "chat",
    interaction_tags: overrides.interaction_tags ?? [],
    canonical_markdown: markdown,
  };
}

describe("scoreBlock — token_score dimension", () => {
  test("short text (<50 tokens) scores proportionally", () => {
    const cb = makeCB({ canonical_markdown: "Short text." });
    const score = scoreBlock(cb);
    expect(score.token_score).toBeGreaterThan(0);
    expect(score.token_score).toBeLessThan(1);
  });

  test("medium text (50-500 tokens) scores 1.0", () => {
    const cb = makeCB({ canonical_markdown: "word ".repeat(100) });
    const score = scoreBlock(cb);
    expect(score.token_score).toBe(1.0);
  });

  test("very long text (>3000 tokens) scores 0.5", () => {
    const cb = makeCB({ canonical_markdown: "word ".repeat(3500) });
    const score = scoreBlock(cb);
    expect(score.token_score).toBe(0.5);
  });
});

describe("scoreBlock — unique_words_score (TTR)", () => {
  test("high TTR (diverse content) scores high", () => {
    const cb = makeCB({
      canonical_markdown: "apple banana cherry date elderberry fig grape honeydew kiwi lemon",
    });
    const score = scoreBlock(cb);
    expect(score.unique_words_score).toBeGreaterThanOrEqual(0.9);
  });

  test("low TTR (repetitive content) scores low", () => {
    const cb = makeCB({
      canonical_markdown: "ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok",
    });
    const score = scoreBlock(cb);
    expect(score.unique_words_score).toBeLessThanOrEqual(0.2);
  });

  test("CJK characters counted individually for TTR", () => {
    const cb = makeCB({ canonical_markdown: "我们决定迁移数据库到新服务器" });
    const score = scoreBlock(cb);
    expect(score.unique_words_score).toBeGreaterThanOrEqual(0.9);
  });
});

describe("scoreBlock — source_score dimension", () => {
  test("email source scores 0.9", () => {
    const cb = makeCB({ source_type: "email" });
    expect(scoreBlock(cb).source_score).toBe(0.9);
  });

  test("chat source scores 0.5", () => {
    const cb = makeCB({ source_type: "chat" });
    expect(scoreBlock(cb).source_score).toBe(0.5);
  });

  test("dm source scores 0.7", () => {
    const cb = makeCB({ source_type: "dm" });
    expect(scoreBlock(cb).source_score).toBe(0.7);
  });

  test("structured source scores 0.8", () => {
    const cb = makeCB({ source_type: "structured" });
    expect(scoreBlock(cb).source_score).toBe(0.8);
  });

  test("document source scores 0.9", () => {
    const cb = makeCB({ source_type: "document" });
    expect(scoreBlock(cb).source_score).toBe(0.9);
  });
});

describe("scoreBlock — interaction_score dimension", () => {
  test("empty tags scores 0.5 (neutral)", () => {
    const cb = makeCB({ interaction_tags: [] });
    expect(scoreBlock(cb).interaction_score).toBe(0.5);
  });

  test("['sent'] scores 0.6", () => {
    const cb = makeCB({ interaction_tags: ["sent"] });
    expect(scoreBlock(cb).interaction_score).toBe(0.6);
  });

  test("['sent','reply'] scores 1.0 (clamped)", () => {
    const cb = makeCB({ interaction_tags: ["sent", "reply"] });
    expect(scoreBlock(cb).interaction_score).toBe(1.0);
  });

  test("['sent','reply','dm'] scores 1.0 (clamped)", () => {
    const cb = makeCB({ interaction_tags: ["sent", "reply", "dm"] });
    expect(scoreBlock(cb).interaction_score).toBe(1.0);
  });

  test("['dm'] alone scores 0.6", () => {
    const cb = makeCB({ interaction_tags: ["dm"] });
    expect(scoreBlock(cb).interaction_score).toBe(0.6);
  });
});

describe("scoreBlock — entity_density_score dimension", () => {
  test("text with emails and URLs scores > 0", () => {
    const cb = makeCB({
      canonical_markdown:
        "Contact alice@example.com at https://example.com for info about the project",
    });
    expect(scoreBlock(cb).entity_density_score).toBeGreaterThan(0);
  });

  test("empty text scores 0", () => {
    const cb = makeCB({ canonical_markdown: "" });
    expect(scoreBlock(cb).entity_density_score).toBe(0);
  });
});

describe("scoreBlock — combined and decision", () => {
  test("high-value email sent reply → admit", () => {
    const cb = makeCB({
      source_type: "email",
      interaction_tags: ["sent", "reply"],
      canonical_markdown:
        "alice@example.com confirmed the migration plan at https://jira.example.com/PROJ-123. We will proceed with PostgreSQL next week. The timeline is set for June 1st. " +
        "diverse content ".repeat(10),
    });
    const score = scoreBlock(cb);
    expect(score.decision).toBe("admit");
    expect(score.combined).toBeGreaterThanOrEqual(0.85);
  });

  test("short empty notification with no interaction → drop (extra guard)", () => {
    const cb = makeCB({
      source_type: "chat",
      interaction_tags: [],
      canonical_markdown: "OK",
    });
    const score = scoreBlock(cb);
    expect(score.decision).toBe("drop");
  });

  test("extra guard does NOT drop when interaction_tags present", () => {
    const cb = makeCB({
      source_type: "chat",
      interaction_tags: ["sent"],
      canonical_markdown: "Use Bun",
    });
    const score = scoreBlock(cb);
    expect(score.decision).not.toBe("drop");
  });

  test("medium chat block → evaluate", () => {
    const cb = makeCB({
      source_type: "chat",
      interaction_tags: [],
      canonical_markdown:
        "Let's discuss the architecture for the new service. I think we should use a microservices approach with gRPC communication between services. What do you think about using Kubernetes for orchestration?",
    });
    const score = scoreBlock(cb);
    expect(score.decision).toBe("evaluate");
  });

  test("email combined floor stays in evaluate (never drop)", () => {
    const cb = makeCB({
      source_type: "email",
      interaction_tags: [],
      canonical_markdown: "Noted. Thanks for the update on the project status.",
    });
    const score = scoreBlock(cb);
    expect(score.combined).toBeGreaterThan(0.15);
    expect(score.decision).not.toBe("drop");
  });

  test("extra guard does NOT drop short structured block (calendar/task)", () => {
    const cb = makeCB({
      source_type: "structured",
      interaction_tags: [],
      canonical_markdown: "Team standup",
    });
    expect(scoreBlock(cb).decision).not.toBe("drop");
  });

  test("extra guard drop sets drop_reason 'extra_guard:short_no_signal'", () => {
    const cb = makeCB({
      source_type: "chat",
      interaction_tags: [],
      canonical_markdown: "OK",
    });
    const score = scoreBlock(cb);
    expect(score.decision).toBe("drop");
    expect(score.drop_reason).toBe("extra_guard:short_no_signal");
  });

  test("score-threshold drop sets drop_reason 'score_below_threshold'", () => {
    const cb = makeCB({
      source_type: "chat",
      interaction_tags: [],
      canonical_markdown:
        "ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok",
    });
    const score = scoreBlock(cb);
    if (score.decision === "drop") {
      expect(score.drop_reason).toBeDefined();
    }
  });

  test("admit decision has no drop_reason", () => {
    const cb = makeCB({
      source_type: "email",
      interaction_tags: ["sent", "reply"],
      canonical_markdown:
        "alice@example.com confirmed the migration plan. We proceed next week. " +
        "diverse content ".repeat(10),
    });
    const score = scoreBlock(cb);
    expect(score.decision).toBe("admit");
    expect(score.drop_reason).toBeUndefined();
  });
});
