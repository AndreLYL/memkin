import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BehaviorContribution } from "../../src/profile/types.js";
import { Database } from "../../src/store/database.js";
import { PersonBehaviorStore } from "../../src/store/person-behavior.js";

function contribution(overrides: Partial<BehaviorContribution> = {}): BehaviorContribution {
  return {
    person_slug: "people/alice",
    msg_count: 0,
    sum_msg_chars: 0,
    initiated_count: 0,
    reply_count: 0,
    resp_latency_n: 0,
    resp_latency_sum_s: 0,
    hour_histogram: new Array(24).fill(0),
    at_count: 0,
    ...overrides,
  };
}

describe("store/person-behavior", () => {
  let db: Database;
  let store: PersonBehaviorStore;

  beforeEach(async () => {
    db = await Database.create();
    store = new PersonBehaviorStore(db.pg);
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates the person_behavior table via migration", async () => {
    const r = await db.pg.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM person_behavior",
    );
    expect(r.rows[0].count).toBe(0);
  });

  it("inserts on first upsert (sets window_start) then additively merges", async () => {
    const hist1 = new Array(24).fill(0);
    hist1[9] = 2;
    await store.upsertContribution(
      contribution({ msg_count: 3, sum_msg_chars: 30, initiated_count: 1, hour_histogram: hist1 }),
    );

    const first = await store.get("people/alice");
    expect(first).not.toBeNull();
    expect(first?.msg_count).toBe(3);
    expect(first?.sum_msg_chars).toBe(30);
    expect(first?.window_start).toBeTruthy();
    const windowStart = String(first?.window_start);

    const hist2 = new Array(24).fill(0);
    hist2[9] = 1;
    hist2[10] = 4;
    await store.upsertContribution(
      contribution({
        msg_count: 2,
        sum_msg_chars: 20,
        reply_count: 5,
        resp_latency_n: 2,
        resp_latency_sum_s: 100,
        hour_histogram: hist2,
        at_count: 3,
      }),
    );

    const merged = await store.get("people/alice");
    expect(merged?.msg_count).toBe(5);
    expect(merged?.sum_msg_chars).toBe(50);
    expect(merged?.initiated_count).toBe(1);
    expect(merged?.reply_count).toBe(5);
    expect(merged?.resp_latency_n).toBe(2);
    expect(merged?.resp_latency_sum_s).toBe(100);
    expect(merged?.at_count).toBe(3);
    expect(merged?.hour_histogram[9]).toBe(3);
    expect(merged?.hour_histogram[10]).toBe(4);
    // window_start must not change on UPDATE
    expect(String(merged?.window_start)).toBe(windowStart);
  });

  it("merge(from, into) adds counters and drops the source row", async () => {
    await store.upsertContribution(contribution({ person_slug: "people/a", msg_count: 4 }));
    await store.upsertContribution(contribution({ person_slug: "people/b", msg_count: 6 }));

    await store.merge("people/a", "people/b");

    const into = await store.get("people/b");
    expect(into?.msg_count).toBe(10);
    expect(await store.get("people/a")).toBeNull();
  });
});
