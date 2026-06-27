/**
 * Concurrency-safety tests for write-hardened store operations (Task 13).
 *
 * PGLite tests (always run): verify single-threaded correctness of the new
 * jsonb patchFrontmatter / setSynthCache implementations.
 *
 * Postgres-only tests (skipped without MEMOARK_TEST_PG_URL): real concurrency
 * via a real connection pool.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BehaviorContribution } from "../../src/profile/types.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { PersonBehaviorStore } from "../../src/store/person-behavior.js";
import { makeIsolatedPgUrl } from "../test-helpers/pg-harness.js";

const BASE = process.env.MEMOARK_TEST_PG_URL;
const pg = BASE ? describe : describe.skip;

// ── PGLite: single-threaded correctness of jsonb frontmatter ops ──────────

describe("patchFrontmatter / setSynthCache — jsonb atomicity (PGLite)", () => {
  let db: Database;
  let pages: PageStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.executor);
  });

  afterEach(async () => {
    await db.close();
  });

  it("patchFrontmatter merges top-level keys without overwriting unrelated keys", async () => {
    await pages.putPage(
      "test/patch",
      "---\ntitle: Patch Test\ntype: note\nstatus: active\n---\nBody.",
    );

    const ok = await pages.patchFrontmatter("test/patch", { owner: "alice", priority: 1 });
    expect(ok).toBe(true);

    const page = await pages.getPage("test/patch");
    expect(page?.frontmatter.status).toBe("active"); // pre-existing key preserved
    expect(page?.frontmatter.owner).toBe("alice"); // new key written
    expect(page?.frontmatter.priority).toBe(1); // new key written
  });

  it("patchFrontmatter returns false for nonexistent page", async () => {
    const ok = await pages.patchFrontmatter("no/such", { x: 1 });
    expect(ok).toBe(false);
  });

  it("setSynthCache sets nested synth[intent] without overwriting other keys", async () => {
    await pages.putPage("test/synth", "---\ntitle: Synth\ntype: note\n---\nBody.");

    const ok = await pages.setSynthCache("test/synth", "recall", { answer: "hello", ts: 1 });
    expect(ok).toBe(true);

    const page = await pages.getPage("test/synth");
    expect((page?.frontmatter.synth as Record<string, unknown>)?.recall).toMatchObject({
      answer: "hello",
    });
  });

  it("setSynthCache preserves other synth intents", async () => {
    await pages.putPage("test/synth2", "---\ntitle: S2\ntype: note\n---\nBody.");
    await pages.setSynthCache("test/synth2", "intent_a", { v: 1 });
    await pages.setSynthCache("test/synth2", "intent_b", { v: 2 });

    const page = await pages.getPage("test/synth2");
    const synth = page?.frontmatter.synth as Record<string, unknown>;
    expect((synth?.intent_a as Record<string, unknown>)?.v).toBe(1);
    expect((synth?.intent_b as Record<string, unknown>)?.v).toBe(2);
  });

  it("setSynthCache returns false for nonexistent page", async () => {
    const ok = await pages.setSynthCache("no/such", "recall", {});
    expect(ok).toBe(false);
  });

  it("patchFrontmatter: concurrent-like sequential patches of different keys → both present", async () => {
    await pages.putPage("test/multi-patch", "---\ntitle: M\ntype: note\n---\nBody.");
    // Simulate two patches that could race (PGLite is single-threaded, so this is sequential).
    await pages.patchFrontmatter("test/multi-patch", { key_a: "value_a" });
    await pages.patchFrontmatter("test/multi-patch", { key_b: "value_b" });

    const page = await pages.getPage("test/multi-patch");
    expect(page?.frontmatter.key_a).toBe("value_a");
    expect(page?.frontmatter.key_b).toBe("value_b");
  });
});

// ── Postgres-only: real concurrency tests ─────────────────────────────────

pg("concurrent put_page (Postgres)", () => {
  let db: Database;
  let pages: PageStore;
  let chunks: ChunkStore;

  beforeEach(async () => {
    const url = await makeIsolatedPgUrl(BASE!, "concurrent_putpage");
    const cfg = { store: { engine: "postgres", database_url: url } } as Record<string, unknown>;
    db = await Database.create(cfg as Parameters<typeof Database.create>[0]);
    pages = new PageStore(db.executor);
    chunks = new ChunkStore(db.executor);
  });

  afterEach(async () => {
    await db.close();
  });

  it("5 concurrent putPageWithChunks on same slug → single page, coherent chunks", async () => {
    const slug = "concurrent/test-page";
    const writes = Array.from({ length: 5 }, (_, i) =>
      pages.putPageWithChunks(
        db.executor,
        slug,
        `---\ntitle: Page Rev ${i}\ntype: note\n---\nContent revision ${i} with some extra words to make a chunk.`,
      ),
    );

    await expect(Promise.all(writes)).resolves.not.toThrow();

    // Exactly one page row.
    const row = await db.executor.query<{ cnt: number }>(
      "SELECT COUNT(*)::int AS cnt FROM pages WHERE slug = $1",
      [slug],
    );
    expect(row.rows[0].cnt).toBe(1);

    // All chunks belong to that one page_id — no mix.
    const page = await pages.getPage(slug);
    expect(page).not.toBeNull();

    const chunkRows = await db.executor.query<{ page_id: number }>(
      "SELECT DISTINCT page_id FROM content_chunks WHERE page_id IN (SELECT id FROM pages WHERE slug = $1)",
      [slug],
    );
    // All chunks must reference the same page_id as the stored page.
    for (const r of chunkRows.rows) {
      expect(r.page_id).toBe(page!.id);
    }

    // At least one chunk exists.
    const allChunks = await chunks.getChunks(slug);
    expect(allChunks.length).toBeGreaterThan(0);
  });
});

pg("concurrent upsertContribution (Postgres)", () => {
  let db: Database;
  let behavior: PersonBehaviorStore;

  beforeEach(async () => {
    const url = await makeIsolatedPgUrl(BASE!, "concurrent_behavior");
    const cfg = { store: { engine: "postgres", database_url: url } } as Record<string, unknown>;
    db = await Database.create(cfg as Parameters<typeof Database.create>[0]);
    behavior = new PersonBehaviorStore(db.executor);
  });

  afterEach(async () => {
    await db.close();
  });

  it("10 concurrent upsertContribution on same slug → no PK crash, correct counts", async () => {
    const slug = "people/concurrent-person";

    function contrib(n: number): BehaviorContribution {
      return {
        person_slug: slug,
        msg_count: n,
        sum_msg_chars: n * 10,
        initiated_count: 0,
        reply_count: 0,
        resp_latency_n: 0,
        resp_latency_sum_s: 0,
        hour_histogram: new Array(24).fill(0),
        at_count: 0,
      };
    }

    // 10 concurrent contributions with msg_count 1..10
    const writes = Array.from({ length: 10 }, (_, i) => behavior.upsertContribution(contrib(i + 1)));
    await expect(Promise.all(writes)).resolves.not.toThrow();

    const row = await behavior.get(slug);
    expect(row).not.toBeNull();

    // Sum of 1+2+...+10 = 55
    expect(row!.msg_count).toBe(55);
    // sum_msg_chars: sum of (1*10 + 2*10 + ... + 10*10) = 10*55 = 550
    expect(row!.sum_msg_chars).toBe(550);
  });
});

pg("concurrent patchFrontmatter (Postgres)", () => {
  let db: Database;
  let pages: PageStore;

  beforeEach(async () => {
    const url = await makeIsolatedPgUrl(BASE!, "concurrent_patch");
    const cfg = { store: { engine: "postgres", database_url: url } } as Record<string, unknown>;
    db = await Database.create(cfg as Parameters<typeof Database.create>[0]);
    pages = new PageStore(db.executor);
    await pages.putPage("test/concurrent-patch", "---\ntitle: CP\ntype: note\n---\nBody.");
  });

  afterEach(async () => {
    await db.close();
  });

  it("concurrent patches of different keys → both keys present (no lost update)", async () => {
    // Patch 10 different keys concurrently.
    const patches = Array.from({ length: 10 }, (_, i) =>
      pages.patchFrontmatter("test/concurrent-patch", { [`key_${i}`]: `value_${i}` }),
    );
    await expect(Promise.all(patches)).resolves.not.toThrow();

    const page = await pages.getPage("test/concurrent-patch");
    expect(page).not.toBeNull();

    // All 10 keys must be present.
    for (let i = 0; i < 10; i++) {
      expect(page!.frontmatter[`key_${i}`]).toBe(`value_${i}`);
    }
  });
});
