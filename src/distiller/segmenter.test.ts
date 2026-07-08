import { describe, expect, it } from "vitest";
import { assignMsgIds } from "./msg-id.js";
import { estimateTokens, type Segment, segmentMessages } from "./segmenter.js";

describe("estimateTokens", () => {
  it("estimates roughly proportional to length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBeGreaterThan(0);
    expect(estimateTokens("a".repeat(400))).toBeGreaterThan(estimateTokens("a".repeat(40)));
  });
});

describe("segmentMessages — token budget + message boundaries", () => {
  it("keeps all messages in one segment when under budget", () => {
    const parsed = assignMsgIds([
      { role: "user", content: "short one" },
      { role: "assistant", content: "short two" },
    ]);
    const segs = segmentMessages(parsed, { maxSegmentTokens: 1000 });
    expect(segs).toHaveLength(1);
    expect(segs[0].messages.map((m) => m.msgId)).toEqual(["msg-1", "msg-2"]);
    expect(segs[0].segNo).toBe(1);
  });

  it("splits on message boundaries when the budget is exceeded", () => {
    // Each message ~ 25 tokens (100 chars). Budget 30 → one message per segment.
    const parsed = assignMsgIds([
      { role: "user", content: "x".repeat(100) },
      { role: "assistant", content: "y".repeat(100) },
      { role: "user", content: "z".repeat(100) },
    ]);
    const segs = segmentMessages(parsed, { maxSegmentTokens: 30 });
    expect(segs.length).toBe(3);
    expect(segs.map((s) => s.segNo)).toEqual([1, 2, 3]);
    // No message is split — each stays whole.
    for (const seg of segs) {
      expect(seg.messages).toHaveLength(1);
      expect(seg.messages[0].msgId).toMatch(/^msg-\d+$/);
    }
  });

  it("packs multiple small messages up to the budget per segment", () => {
    const parsed = assignMsgIds(
      Array.from({ length: 6 }, () => ({ role: "user" as const, content: "a".repeat(40) })),
    );
    // ~10 tokens each; budget 25 → 2 messages per segment → 3 segments.
    const segs = segmentMessages(parsed, { maxSegmentTokens: 25 });
    expect(segs.length).toBe(3);
    expect(segs[0].messages).toHaveLength(2);
  });
});

describe("segmentMessages — oversized single message sub-splitting (spec §5.1)", () => {
  it("sub-splits a single oversized message into msg-N.k sub-segments with continuation markers", () => {
    const parsed = assignMsgIds([
      { role: "user", content: "head" },
      { role: "assistant", content: "B".repeat(400) }, // ~100 tokens, way over budget
      { role: "user", content: "tail" },
    ]);
    const segs: Segment[] = segmentMessages(parsed, { maxSegmentTokens: 30 });
    // Find the sub-segment ids produced from msg-2.
    const allIds = segs.flatMap((s) => s.messages.map((m) => m.msgId));
    const subIds = allIds.filter((id) => id.startsWith("msg-2."));
    expect(subIds.length).toBeGreaterThanOrEqual(2);
    expect(subIds).toContain("msg-2.1");
    expect(subIds).toContain("msg-2.2");
    // Continuation marker present on non-first sub-segments.
    const subMsgs = segs.flatMap((s) => s.messages).filter((m) => m.msgId.startsWith("msg-2."));
    const continued = subMsgs.filter((m) => m.continued === true);
    expect(continued.length).toBeGreaterThanOrEqual(1);
    expect(subMsgs[0].continued).toBeFalsy();
    // Reassembling sub-segment content reproduces the original text.
    const reassembled = subMsgs
      .sort((a, b) => a.msgId.localeCompare(b.msgId, undefined, { numeric: true }))
      .map((m) => m.content)
      .join("");
    expect(reassembled).toBe("B".repeat(400));
    // head (msg-1) and tail (msg-3) survive with their plain ids.
    expect(allIds).toContain("msg-1");
    expect(allIds).toContain("msg-3");
  });

  it("records the parent msg id on each sub-segment for reduce-time regrouping", () => {
    const parsed = assignMsgIds([{ role: "user", content: "C".repeat(400) }]);
    const segs = segmentMessages(parsed, { maxSegmentTokens: 30 });
    const subs = segs.flatMap((s) => s.messages).filter((m) => m.msgId.startsWith("msg-1."));
    expect(subs.length).toBeGreaterThanOrEqual(2);
    for (const s of subs) {
      expect(s.parentMsgId).toBe("msg-1");
    }
  });
});
