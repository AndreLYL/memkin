import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProfileConfig } from "../../src/core/config.js";
import type { ConversationBlock, RawMessage } from "../../src/core/types.js";
import { accumulateBehavior } from "../../src/profile/accumulate.js";
import { Database } from "../../src/store/database.js";
import { PersonBehaviorStore } from "../../src/store/person-behavior.js";

function msg(o: Partial<RawMessage>): RawMessage {
  return {
    platform: "feishu",
    channel: "dm/c1",
    contact: "ou_other",
    timestamp: "2026-06-20T09:00:00.000Z",
    content: "hello",
    direction: "received",
    ...o,
  };
}

function dmBlock(): ConversationBlock {
  return {
    block_id: "b1",
    platform: "feishu",
    channel: "dm/c1",
    messages: [msg({ content: "hi there" }), msg({ content: "you around?" })],
    start_time: "2026-06-20T09:00:00.000Z",
    end_time: "2026-06-20T09:00:01.000Z",
    participants: ["ou_other"],
    token_count: 5,
  };
}

const cfg = (over: Partial<ProfileConfig> = {}): ProfileConfig => ({
  enabled: true,
  allow: [],
  deny: [],
  min_sample_size: 20,
  tz_offset_hours: 8,
  ...over,
});

describe("profile pipeline accumulation (gated)", () => {
  let db: Database;
  let store: PersonBehaviorStore;

  beforeEach(async () => {
    db = await Database.create();
    store = new PersonBehaviorStore(db.pg);
  });
  afterEach(async () => {
    await db.close();
  });

  it("writes person_behavior when enabled and not denied", async () => {
    await accumulateBehavior(dmBlock(), {
      store,
      config: cfg(),
      resolveSender: (c) => `people/${c}`,
    });
    const rows = await store.list();
    expect(rows.length).toBe(1);
    expect(rows[0].person_slug).toBe("people/ou_other");
    expect(rows[0].msg_count).toBe(2);
  });

  it("writes nothing when disabled (asserts 0 writes)", async () => {
    await accumulateBehavior(dmBlock(), {
      store,
      config: cfg({ enabled: false }),
      resolveSender: (c) => `people/${c}`,
    });
    const rows = await store.list();
    expect(rows.length).toBe(0);
  });

  it("skips a denied person", async () => {
    await accumulateBehavior(dmBlock(), {
      store,
      config: cfg({ deny: ["people/ou_other"] }),
      resolveSender: (c) => `people/${c}`,
    });
    expect((await store.list()).length).toBe(0);
  });

  it("when allow is non-empty, only allowed persons are written", async () => {
    await accumulateBehavior(dmBlock(), {
      store,
      config: cfg({ allow: ["people/someone-else"] }),
      resolveSender: (c) => `people/${c}`,
    });
    expect((await store.list()).length).toBe(0);
  });
});
