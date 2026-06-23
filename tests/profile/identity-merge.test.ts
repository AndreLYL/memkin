import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { PersonIdentityStore } from "../../src/core/person-identity.js";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { PersonBehaviorStore } from "../../src/store/person-behavior.js";

function contribution(slug: string, msgCount: number) {
  return {
    person_slug: slug,
    msg_count: msgCount,
    sum_msg_chars: msgCount * 10,
    initiated_count: 1,
    reply_count: 1,
    resp_latency_n: 0,
    resp_latency_sum_s: 0,
    hour_histogram: new Array(24).fill(0),
    at_count: 0,
  };
}

describe("person merge consolidates behavior + invalidates stale profile", () => {
  let db: Database;
  let pages: PageStore;
  let behavior: PersonBehaviorStore;
  let identity: PersonIdentityStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.pg);
    behavior = new PersonBehaviorStore(db.pg);
    identity = new PersonIdentityStore(db.pg, { pages }, { behavior });
  });
  afterEach(async () => {
    await db.close();
  });

  it("adds behavior counters and drops the old profile on merge", async () => {
    await pages.putPage(
      "people/alias",
      "---\ntitle: Alias\ntype: person\nprofile:\n  trait:\n    insufficient: false\n  sample_size: 9\n---\nAlias.",
    );
    await pages.putPage("people/canonical", "---\ntitle: Canonical\ntype: person\n---\nCanonical.");
    await behavior.upsertContribution(contribution("people/alias", 4));
    await behavior.upsertContribution(contribution("people/canonical", 6));

    await identity.merge("people/alias", "people/canonical");

    const into = await behavior.get("people/canonical");
    expect(into?.msg_count).toBe(10);
    expect(await behavior.get("people/alias")).toBeNull();

    // the merged-into page's stale profile must be invalidated
    const page = await pages.getPage("people/canonical");
    expect(page?.frontmatter.profile).toBeUndefined();
  });
});

describe("config.profile defaults", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "memoark-cfg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to disabled with min_sample_size 20 and empty allow/deny", () => {
    const p = join(dir, "memoark.yaml");
    writeFileSync(p, "store:\n  data_dir: ./data\n");
    const cfg = loadConfig(p);
    expect(cfg.profile.enabled).toBe(false);
    expect(cfg.profile.min_sample_size).toBe(20);
    expect(cfg.profile.tz_offset_hours).toBe(8);
    expect(cfg.profile.allow).toEqual([]);
    expect(cfg.profile.deny).toEqual([]);
  });

  it("accepts user-provided profile fields", () => {
    const p = join(dir, "memoark.yaml");
    writeFileSync(
      p,
      "profile:\n  enabled: true\n  min_sample_size: 5\n  allow:\n    - people/alice\n  deny:\n    - people/bob\n",
    );
    const cfg = loadConfig(p);
    expect(cfg.profile.enabled).toBe(true);
    expect(cfg.profile.min_sample_size).toBe(5);
    expect(cfg.profile.allow).toEqual(["people/alice"]);
    expect(cfg.profile.deny).toEqual(["people/bob"]);
  });
});
