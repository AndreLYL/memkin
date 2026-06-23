import { describe, expect, it } from "vitest";
import type { ConversationBlock, RawMessage } from "../../src/core/types.js";
import { computeContribution, deriveProfile } from "../../src/profile/behavior.js";
import type { PersonBehaviorRow } from "../../src/profile/types.js";

function msg(overrides: Partial<RawMessage>): RawMessage {
  return {
    platform: "feishu",
    channel: "dm/c1",
    contact: "ou_other",
    timestamp: "2026-06-20T09:00:00.000Z",
    content: "hi",
    direction: "received",
    ...overrides,
  };
}

function block(messages: RawMessage[], over: Partial<ConversationBlock> = {}): ConversationBlock {
  return {
    block_id: "b1",
    platform: "feishu",
    channel: "dm/c1",
    messages,
    start_time: messages[0]?.timestamp ?? "2026-06-20T09:00:00.000Z",
    end_time: messages[messages.length - 1]?.timestamp ?? "2026-06-20T09:00:00.000Z",
    participants: ["ou_other"],
    token_count: 10,
    ...over,
  };
}

const resolve = (contact: string) => `people/${contact}`;

describe("profile/behavior computeContribution (DM, direction-based)", () => {
  it("counts the other person's messages, chars, hours, @, and response latency", () => {
    // received(09:00:00) → sent(09:00:30): a measurable 30s response by us to them.
    // received again at 09:05:00 with an @ mention.
    const b = block([
      msg({
        contact: "ou_other",
        direction: "received",
        content: "hello there",
        timestamp: "2026-06-20T09:00:00.000Z",
      }),
      msg({
        contact: "ou_self",
        direction: "sent",
        content: "hi back",
        timestamp: "2026-06-20T09:00:30.000Z",
      }),
      msg({
        contact: "ou_other",
        direction: "received",
        content: "@you can you check this",
        timestamp: "2026-06-20T09:05:00.000Z",
      }),
    ]);

    const map = computeContribution(b, { resolveSender: resolve });
    const c = map.get("people/ou_other");
    expect(c).toBeDefined();
    if (!c) return;
    // only the OTHER person's (received) messages are counted toward their profile
    expect(c.msg_count).toBe(2);
    expect(c.sum_msg_chars).toBe("hello there".length + "@you can you check this".length);
    // response latency measured for received → sent adjacency (their msg → our reply)
    expect(c.resp_latency_n).toBe(1);
    expect(c.resp_latency_sum_s).toBe(30);
    // active hour 09 has both their messages
    expect(c.hour_histogram[9]).toBe(2);
    expect(c.at_count).toBe(1);
  });

  it("places messages in local-hour buckets using tzOffsetHours (+8)", () => {
    // 23:00 UTC + 8 = 07:00 next-day local hour bucket.
    const b = block([
      msg({
        contact: "ou_other",
        direction: "received",
        content: "morning",
        timestamp: "2026-06-20T23:00:00.000Z",
      }),
    ]);
    const map = computeContribution(b, { resolveSender: resolve, tzOffsetHours: 8 });
    const c = map.get("people/ou_other");
    expect(c?.hour_histogram[7]).toBe(1);
    expect(c?.hour_histogram[23]).toBe(0);
  });

  it("self (sent) messages do not create a contribution for self", () => {
    const b = block([
      msg({
        contact: "ou_self",
        direction: "sent",
        content: "yo",
        timestamp: "2026-06-20T08:00:00.000Z",
      }),
    ]);
    const map = computeContribution(b, { resolveSender: resolve });
    expect(map.has("people/ou_self")).toBe(false);
  });
});

describe("profile/behavior computeContribution (group, first-sender = initiator)", () => {
  it("attributes initiation to the first sender, replies to later distinct senders", () => {
    const b = block(
      [
        // no direction field → group semantics
        { ...msg({ contact: "ou_a", content: "kick off" }), direction: undefined as never },
        { ...msg({ contact: "ou_b", content: "ok sounds good" }), direction: undefined as never },
        { ...msg({ contact: "ou_a", content: "more" }), direction: undefined as never },
      ],
      { channel: "group/g1", participants: ["ou_a", "ou_b"] },
    );

    const map = computeContribution(b, { resolveSender: resolve, isGroup: true });
    const a = map.get("people/ou_a");
    const bb = map.get("people/ou_b");
    expect(a?.initiated_count).toBe(1);
    // A's later (third) message counts as a reply, only the block's first msg initiates
    expect(a?.reply_count).toBe(1);
    expect(a?.msg_count).toBe(2);
    expect(bb?.initiated_count).toBe(0);
    expect(bb?.reply_count).toBe(1);
    expect(bb?.msg_count).toBe(1);
  });
});

describe("profile/behavior deriveProfile", () => {
  function row(over: Partial<PersonBehaviorRow>): PersonBehaviorRow {
    const hist = new Array(24).fill(0);
    return {
      person_slug: "people/x",
      msg_count: 0,
      sum_msg_chars: 0,
      initiated_count: 0,
      reply_count: 0,
      resp_latency_n: 0,
      resp_latency_sum_s: 0,
      hour_histogram: hist,
      at_count: 0,
      window_start: null,
      updated_at: "2026-06-20T00:00:00.000Z",
      ...over,
    };
  }

  it("derives avg chars, initiation ratio, peak hours and sample size", () => {
    const hist = new Array(24).fill(0);
    hist[9] = 5;
    hist[14] = 8;
    hist[20] = 3;
    hist[2] = 1;
    const p = deriveProfile(
      row({
        msg_count: 10,
        sum_msg_chars: 200,
        initiated_count: 3,
        reply_count: 1,
        resp_latency_n: 2,
        resp_latency_sum_s: 120,
        hour_histogram: hist,
        at_count: 5,
      }),
    );
    expect(p.avg_msg_chars).toBe(20);
    expect(p.initiation_ratio).toBeCloseTo(0.75);
    expect(p.avg_response_sec).toBe(60);
    expect(p.peak_hours).toEqual([14, 9, 20]); // top-3 by count, desc
    expect(p.at_per_msg).toBeCloseTo(0.5);
    expect(p.sample_size).toBe(10);
  });

  it("avg_response_sec is null when no latency samples", () => {
    const p = deriveProfile(row({ msg_count: 4, resp_latency_n: 0 }));
    expect(p.avg_response_sec).toBeNull();
    expect(p.initiation_ratio).toBe(0);
  });
});
