import { describe, expect, it } from "vitest";
import type { DistilledSignal } from "./contract.js";
import {
  assignMsgIds,
  collectEvidenceText,
  type ParsedMessage,
  validateEvidence,
} from "./msg-id.js";

const messages = [
  { role: "user" as const, content: "Let's use Bun. See https://bun.sh/docs for details." },
  { role: "assistant" as const, content: "Sure, Bun it is." },
  { role: "user" as const, content: "Also file a task to migrate CI." },
];

describe("assignMsgIds", () => {
  it("assigns sequential msg_ids in order", () => {
    const parsed = assignMsgIds(messages);
    expect(parsed.map((m) => m.msgId)).toEqual(["msg-1", "msg-2", "msg-3"]);
    expect(parsed[0].role).toBe("user");
    expect(parsed[0].content).toContain("Bun");
  });
});

describe("collectEvidenceText", () => {
  it("concatenates the text of all messages in a range (inclusive)", () => {
    const parsed = assignMsgIds(messages);
    const text = collectEvidenceText(parsed, { start: "msg-1", end: "msg-2" });
    expect(text).toContain("Let's use Bun");
    expect(text).toContain("Bun it is");
    expect(text).not.toContain("migrate CI");
  });

  it("handles a single-message range", () => {
    const parsed = assignMsgIds(messages);
    const text = collectEvidenceText(parsed, { start: "msg-3", end: "msg-3" });
    expect(text).toContain("migrate CI");
  });
});

describe("validateEvidence — bounds + reference.url locatability", () => {
  const parsed: ParsedMessage[] = assignMsgIds(messages);

  function sig(overrides: Partial<DistilledSignal> & { type: DistilledSignal["type"] }) {
    return {
      topic: "t",
      what: "w",
      entities: [],
      authority: "user_confirmed",
      persistence_reason: "r",
      evidence: [{ start: "msg-1", end: "msg-1" }],
      ...overrides,
    } as DistilledSignal;
  }

  it("accepts in-bounds evidence", () => {
    const res = validateEvidence([sig({ type: "decision" })], parsed);
    expect(res.ok).toBe(true);
  });

  it("rejects a start id that does not exist", () => {
    const res = validateEvidence(
      [sig({ type: "decision", evidence: [{ start: "msg-99", end: "msg-99" }] })],
      parsed,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects an end id beyond the last message", () => {
    const res = validateEvidence(
      [sig({ type: "decision", evidence: [{ start: "msg-1", end: "msg-9" }] })],
      parsed,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects an inverted range (start after end)", () => {
    const res = validateEvidence(
      [sig({ type: "decision", evidence: [{ start: "msg-3", end: "msg-1" }] })],
      parsed,
    );
    expect(res.ok).toBe(false);
  });

  it("accepts a reference.url that appears in its evidence text", () => {
    const res = validateEvidence(
      [
        sig({
          type: "reference",
          url: "https://bun.sh/docs",
          evidence: [{ start: "msg-1", end: "msg-1" }],
        }) as DistilledSignal,
      ],
      parsed,
    );
    expect(res.ok).toBe(true);
  });

  it("rejects a reference.url that is NOT present in its evidence text (hallucinated)", () => {
    const res = validateEvidence(
      [
        sig({
          type: "reference",
          url: "https://evil.example.com/made-up",
          evidence: [{ start: "msg-1", end: "msg-1" }],
        }) as DistilledSignal,
      ],
      parsed,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/url/i);
  });

  it("supports sub-segment msg_ids (msg-42.1) in ranges", () => {
    const sub = assignMsgIds([{ role: "user", content: "x" }]);
    // Simulate a sub-segmented message id set.
    const subParsed: ParsedMessage[] = [
      { msgId: "msg-1.1", role: "user", content: "part one https://a.com" },
      { msgId: "msg-1.2", role: "user", content: "part two" },
    ];
    void sub;
    const res = validateEvidence(
      [
        sig({
          type: "reference",
          url: "https://a.com",
          evidence: [{ start: "msg-1.1", end: "msg-1.2" }],
        }) as DistilledSignal,
      ],
      subParsed,
    );
    expect(res.ok).toBe(true);
  });
});
