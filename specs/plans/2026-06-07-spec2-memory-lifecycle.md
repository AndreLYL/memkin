# Spec 2: Memory Lifecycle (hot/warm/cold + Consolidator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-tier (hot/warm/cold) lifecycle to signal pages with a Consolidator module for automated tier rotation, LLM-based warm→cold compression, preference behavioral inference, and dead-link detection.

**Architecture:** All three tiers live in the existing `pages` table, distinguished by a new `tier` TEXT column. Migration 003 adds `tier`, `expires_at`, and `consolidated_into` columns. A standalone `Consolidator` class (in `src/consolidator/`) wires together hot→warm merging (grouped by entity+type) and warm→cold LLM summarization. The `memoark consolidate` CLI command drives it manually; the H4 rule (never rewrite user-edited pages) is enforced throughout.

**Tech Stack:** TypeScript, PGlite (PostgreSQL/WASM), Bun runtime, Vitest tests, Commander.js (CLI), Anthropic API (`claude-haiku-4-5-20251001` for warm→cold summaries).

---

## File Structure

```
src/store/
  schema.sql                          MODIFY — add tier/expires_at/consolidated_into
  pages.ts                            MODIFY — Page interface + putPage + new query methods
  graph.ts                            MODIFY — add getLinksForSlugs batch method
  migrations/
    003_lifecycle_tier.sql            CREATE — ALTER TABLE for new columns + backfill
    index.ts                          MODIFY — register migration 3

src/consolidator/
  rules.ts                            CREATE — NEVER_COMPRESS_TYPES, canCompress(), HOT_DAYS
  hot-warm.ts                         CREATE — consolidateHot() function
  warm-cold.ts                        CREATE — consolidateWarm() function (LLM + dead-link + inference)
  dead-link.ts                        CREATE — checkDeadLinks() for reference pages
  infer-preferences.ts                CREATE — inferPreferences() behavioral inference
  consolidator.ts                     CREATE — Consolidator class wiring all the above

src/cli.ts                            MODIFY — add `memoark consolidate` command

tests/
  store/
    migrations.test.ts                MODIFY — update version assertion [1,2] → [1,2,3], add column checks
    pages.test.ts                     MODIFY — add tests for tier/expires_at + new methods
  consolidator/
    consolidator.test.ts              CREATE — integration tests for all consolidator behaviour
```

---

## Task 1: Migration 003 — tier/expires_at/consolidated_into columns

**Files:**
- Create: `src/store/migrations/003_lifecycle_tier.sql`
- Modify: `src/store/migrations/index.ts`
- Modify: `src/store/schema.sql`
- Modify: `tests/store/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/store/migrations.test.ts` and add these two tests inside the `describe("migration runner", ...)` block (after the existing tests):

```typescript
it("creates schema_migrations table and records applied versions", async () => {
  // UPDATE existing test — change [1, 2] to [1, 2, 3]
  const rows = await db.pg.query<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  expect(rows.rows.map((r) => r.version)).toEqual([1, 2, 3]);
});

// Also update the idempotency test:
it("is idempotent: running migrations twice does not duplicate or error", async () => {
  await runMigrations(db.pg);
  await runMigrations(db.pg);
  const rows = await db.pg.query<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  expect(rows.rows.map((r) => r.version)).toEqual([1, 2, 3]);
});

it("adds tier/expires_at/consolidated_into columns to pages", async () => {
  const cols = await db.pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'pages'
       AND column_name IN ('tier', 'expires_at', 'consolidated_into')
     ORDER BY column_name`,
  );
  expect(cols.rows.map((r) => r.column_name)).toEqual([
    "consolidated_into",
    "expires_at",
    "tier",
  ]);
});

it("adds tier/expires_at columns to timeline_entries", async () => {
  const cols = await db.pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'timeline_entries'
       AND column_name IN ('tier', 'expires_at')
     ORDER BY column_name`,
  );
  expect(cols.rows.map((r) => r.column_name)).toEqual(["expires_at", "tier"]);
});

it("backfills expires_at for existing hot pages with halflife_days", async () => {
  const freshPg = new PGlite({ extensions: { vector } });
  try {
    const schemaSql = readFileSync(schemaPath, "utf-8");
    await freshPg.exec(schemaSql);
    // Insert legacy row that has halflife_days but no expires_at
    await freshPg.query(
      `INSERT INTO pages (slug, type, title, compiled_truth, halflife_days) VALUES ($1, $2, $3, $4, $5)`,
      ["decisions/old", "decision", "Old decision", "content", 90],
    );
    await runMigrations(freshPg);
    const result = await freshPg.query<{ expires_at: string | null }>(
      "SELECT expires_at FROM pages WHERE slug = 'decisions/old'",
    );
    expect(result.rows[0].expires_at).not.toBeNull();
  } finally {
    await freshPg.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run tests/store/migrations.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — version assertion gets `[1, 2]` not `[1, 2, 3]`; column check fails.

- [ ] **Step 3: Create the migration SQL file**

Create `src/store/migrations/003_lifecycle_tier.sql`:

```sql
-- Add lifecycle tier columns to pages
ALTER TABLE pages ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'hot';
ALTER TABLE pages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS consolidated_into INTEGER REFERENCES pages(id);

CREATE INDEX IF NOT EXISTS idx_pages_tier ON pages (tier);
CREATE INDEX IF NOT EXISTS idx_pages_expires_at ON pages (expires_at) WHERE expires_at IS NOT NULL;

-- Add lifecycle tier columns to timeline_entries
ALTER TABLE timeline_entries ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'hot';
ALTER TABLE timeline_entries ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill expires_at for existing hot pages that have halflife_days set
UPDATE pages
SET expires_at = created_at + (halflife_days * INTERVAL '1 day')
WHERE tier = 'hot'
  AND halflife_days IS NOT NULL
  AND expires_at IS NULL;
```

- [ ] **Step 4: Register migration 3 in `src/store/migrations/index.ts`**

Change the MIGRATIONS array from:
```typescript
export const MIGRATIONS: Migration[] = [
  loadMigration(1, "lifecycle_columns"),
  loadMigration(2, "provenance_columns"),
];
```
to:
```typescript
export const MIGRATIONS: Migration[] = [
  loadMigration(1, "lifecycle_columns"),
  loadMigration(2, "provenance_columns"),
  loadMigration(3, "lifecycle_tier"),
];
```

- [ ] **Step 5: Update `src/store/schema.sql` for fresh installs**

Add these columns to the `pages` CREATE TABLE statement (after `halflife_days INTEGER,`):

```sql
  tier            TEXT NOT NULL DEFAULT 'hot',
  expires_at      TIMESTAMPTZ,
  consolidated_into INTEGER REFERENCES pages(id),
```

And after the existing indexes, add:

```sql
CREATE INDEX IF NOT EXISTS idx_pages_tier ON pages (tier);
CREATE INDEX IF NOT EXISTS idx_pages_expires_at ON pages (expires_at) WHERE expires_at IS NOT NULL;
```

Also add to the `timeline_entries` CREATE TABLE statement (after `provenance JSONB,`):

```sql
  tier            TEXT NOT NULL DEFAULT 'hot',
  expires_at      TIMESTAMPTZ,
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bunx vitest run tests/store/migrations.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All tests PASS (6 original + 4 new = ~10 tests).

- [ ] **Step 7: Commit**

```bash
git add src/store/migrations/003_lifecycle_tier.sql \
        src/store/migrations/index.ts \
        src/store/schema.sql \
        tests/store/migrations.test.ts
git commit -m "feat(store): migration 003 — add tier/expires_at/consolidated_into lifecycle columns"
```

---

## Task 2: PageStore lifecycle methods + GraphStore batch query

**Files:**
- Modify: `src/store/pages.ts`
- Modify: `src/store/graph.ts`
- Modify: `tests/store/pages.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/store/pages.test.ts`:

```typescript
describe("lifecycle columns", () => {
  it("putPage sets tier=hot and expires_at from halflife_days on insert", async () => {
    const content = "---\ntitle: D1\ntype: decision\n---\nDecision body.";
    const page = await store.putPage("decisions/d1", content, { halflife_days: 90 });
    expect(page.tier).toBe("hot");
    expect(page.expires_at).not.toBeNull();
    // expires_at should be roughly NOW() + 90 days
    const expiresAt = new Date(page.expires_at!);
    const expected = new Date(Date.now() + 90 * 86_400_000);
    expect(Math.abs(expiresAt.getTime() - expected.getTime())).toBeLessThan(5000);
  });

  it("putPage does NOT reset expires_at or tier on upsert conflict", async () => {
    const content = "---\ntitle: D1\ntype: decision\n---\nOriginal.";
    const page1 = await store.putPage("decisions/d1", content, { halflife_days: 90 });
    const originalExpiry = page1.expires_at;

    // Simulate tier advancement (would be done by consolidator)
    await store.updatePageTier(page1.id, "warm");

    const content2 = "---\ntitle: D1\ntype: decision\n---\nUpdated.";
    const page2 = await store.putPage("decisions/d1", content2, { halflife_days: 90 });
    expect(page2.tier).toBe("warm"); // tier preserved
    expect(page2.expires_at).toBe(originalExpiry); // expires_at preserved
  });

  it("listExpiredHot returns only tier=hot pages past expires_at", async () => {
    // Insert page with expires_at in the past
    await store.putPage("decisions/old", "---\ntitle: Old\ntype: decision\n---\nOld.", {
      halflife_days: 90,
    });
    // Manually set expires_at to past
    await db.pg.query("UPDATE pages SET expires_at = NOW() - INTERVAL '1 day' WHERE slug = $1", [
      "decisions/old",
    ]);

    // Insert page that has not expired
    await store.putPage("decisions/fresh", "---\ntitle: Fresh\ntype: decision\n---\nFresh.", {
      halflife_days: 90,
    });

    const expired = await store.listExpiredHot();
    expect(expired.map((p) => p.slug)).toContain("decisions/old");
    expect(expired.map((p) => p.slug)).not.toContain("decisions/fresh");
  });

  it("updatePageTier updates tier and optionally consolidated_into", async () => {
    const page = await store.putPage("pref/a", "---\ntitle: A\ntype: preference\n---\nA.", {
      halflife_days: 90,
    });
    const warm = await store.putPage("warm/pref-consolidated", "---\ntitle: Warm\ntype: preference\n---\nMerged.", {
      halflife_days: null,
    });

    await store.updatePageTier(page.id, "warm", warm.id);

    const updated = await store.getPage("pref/a");
    expect(updated?.tier).toBe("warm");
    expect(updated?.consolidated_into).toBe(warm.id);
  });

  it("listPagesByTier returns pages filtered by tier", async () => {
    await store.putPage("a", "---\ntitle: A\ntype: decision\n---\nA.", { halflife_days: 90 });
    await store.putPage("b", "---\ntitle: B\ntype: preference\n---\nB.", { halflife_days: 90 });
    // Manually set b to warm
    await db.pg.query("UPDATE pages SET tier = 'warm' WHERE slug = 'b'");

    const hot = await store.listPagesByTier("hot");
    const warm = await store.listPagesByTier("warm");
    expect(hot.map((p) => p.slug)).toContain("a");
    expect(warm.map((p) => p.slug)).toContain("b");
    expect(hot.map((p) => p.slug)).not.toContain("b");
  });
});
```

Also add test for `GraphStore.getLinksForSlugs` in a new test file `tests/store/graph.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";

describe("GraphStore.getLinksForSlugs", () => {
  let db: Database;
  let graph: GraphStore;
  let pages: PageStore;

  beforeEach(async () => {
    db = await Database.create();
    graph = new GraphStore(db.pg);
    pages = new PageStore(db.pg);
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns links grouped by from_slug", async () => {
    await pages.putPage("entities/alice", "---\ntitle: Alice\ntype: person\n---\nAlice.");
    await pages.putPage("preferences/morning", "---\ntitle: Morning\ntype: preference\n---\nPref.");
    await pages.putPage("preferences/coding", "---\ntitle: Coding\ntype: preference\n---\nPref2.");
    await graph.addLink("preferences/morning", "entities/alice", "mentions");
    await graph.addLink("preferences/coding", "entities/alice", "mentions");

    const map = await graph.getLinksForSlugs([
      "preferences/morning",
      "preferences/coding",
    ]);

    expect(map.get("preferences/morning")).toHaveLength(1);
    expect(map.get("preferences/morning")![0].to_slug).toBe("entities/alice");
    expect(map.get("preferences/coding")).toHaveLength(1);
  });

  it("returns empty map for empty input", async () => {
    const map = await graph.getLinksForSlugs([]);
    expect(map.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run tests/store/pages.test.ts tests/store/graph.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — `tier` property missing from Page, methods not defined.

- [ ] **Step 3: Update `src/store/pages.ts` — Page interface**

Replace the existing `Page` and `PutPageOptions` interfaces and `PageRow` interface:

```typescript
export interface Page {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  frontmatter: Record<string, unknown>;
  content_hash: string;
  halflife_days: number | null;
  tier: string;
  expires_at: string | null;
  consolidated_into: number | null;
  created_at: string;
  updated_at: string;
}

export interface PutPageOptions {
  halflife_days?: number | null;
  expires_at?: Date | null;  // explicit override; null clears it; undefined = auto-compute from halflife_days
}

interface PageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  frontmatter: Record<string, unknown> | string;
  content_hash: string;
  halflife_days: number | null;
  tier: string;
  expires_at: string | null;
  consolidated_into: number | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Update `putPage` SQL in `src/store/pages.ts`**

Replace the entire `putPage` method body:

```typescript
async putPage(slug: string, content: string, opts?: PutPageOptions): Promise<Page> {
  const { title, type, compiled_truth, frontmatter } = parseMarkdownWithFrontmatter(content);
  const contentHash = createHash("sha256").update(content).digest("hex");
  const halflifeDays = opts?.halflife_days ?? null;

  // expires_at: explicit override wins; otherwise compute from halflife_days at INSERT time.
  // On CONFLICT (upsert), we do NOT touch tier or expires_at — lifecycle state is preserved.
  const expiresAtOverride = opts?.expires_at !== undefined ? opts.expires_at : undefined;

  const result = await this.pg.query<PageRow>(
    `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter, content_hash, halflife_days, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
       CASE
         WHEN $8::timestamptz IS NOT NULL THEN $8::timestamptz
         WHEN $7 IS NOT NULL THEN NOW() + ($7 * INTERVAL '1 day')
         ELSE NULL
       END
     )
     ON CONFLICT (slug) DO UPDATE SET
       type = EXCLUDED.type,
       title = EXCLUDED.title,
       compiled_truth = EXCLUDED.compiled_truth,
       frontmatter = EXCLUDED.frontmatter,
       content_hash = EXCLUDED.content_hash,
       halflife_days = EXCLUDED.halflife_days,
       updated_at = NOW()
     RETURNING *`,
    [
      slug,
      type,
      title,
      compiled_truth,
      JSON.stringify(frontmatter),
      contentHash,
      halflifeDays,
      expiresAtOverride ?? null,
    ],
  );
  return this.rowToPage(result.rows[0]);
}
```

- [ ] **Step 5: Update `rowToPage` in `src/store/pages.ts`**

Replace the existing `rowToPage` method:

```typescript
private rowToPage(row: PageRow): Page {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    compiled_truth: row.compiled_truth,
    frontmatter:
      typeof row.frontmatter === "string" ? JSON.parse(row.frontmatter) : row.frontmatter,
    content_hash: row.content_hash,
    halflife_days: row.halflife_days,
    tier: row.tier ?? "hot",
    expires_at: row.expires_at ?? null,
    consolidated_into: row.consolidated_into ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
```

- [ ] **Step 6: Stamp `expires_at = NOW()` for done tasks in `src/adapters/store.ts`**

In `src/adapters/store.ts`, find the `writeTask` private method. Locate the `putPage` call inside it (it currently passes `{ halflife_days: HALFLIFE_DAYS.task }`). Change that call so that when `task.status === 'done'`, `expires_at` is also set to `new Date()` (making the task immediately eligible for warm rotation):

```typescript
// Before (existing):
const page = await this.stores.pages.putPage(slug, content, {
  halflife_days: HALFLIFE_DAYS.task,
});

// After:
const page = await this.stores.pages.putPage(slug, content, {
  halflife_days: HALFLIFE_DAYS.task,
  expires_at: task.status === "done" ? new Date() : undefined,
});
```

Add this test to `tests/adapters/store.test.ts` inside the existing `describe("push - tasks", ...)` block (or create one if it doesn't exist):

```typescript
it("sets expires_at=NOW() for done tasks so they immediately expire from hot tier", async () => {
  const result = makeExtractionResult({
    tasks: [
      {
        title: "Completed task",
        status: "done",
        owner: "alice",
        due_date: null,
        entities: [],
        source: makeSourceRef(),
        confidence: "direct",
      },
    ],
  });
  await adapter.push([result]);

  const page = await stores.pages.getPage(`tasks/${kebabCase("Completed task")}`);
  expect(page).not.toBeNull();
  expect(page?.expires_at).not.toBeNull();
  // expires_at should be in the past or very recent (NOW())
  const expiresAt = new Date(page!.expires_at!);
  expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
});
```

(Note: `kebabCase` is the same helper used by `writeTask`; check the actual slug format in `src/adapters/store.ts:writeTask` to use the right slug.)

- [ ] **Step 7: Add new query methods to `PageStore` in `src/store/pages.ts`**

Add these methods to the `PageStore` class (after `listPages`):

```typescript
async listExpiredHot(): Promise<Page[]> {
  const result = await this.pg.query<PageRow>(
    `SELECT * FROM pages
     WHERE tier = 'hot'
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
     ORDER BY expires_at`,
  );
  return result.rows.map((r) => this.rowToPage(r));
}

async updatePageTier(
  id: number,
  tier: string,
  consolidatedInto?: number | null,
): Promise<void> {
  if (consolidatedInto !== undefined) {
    await this.pg.query(
      `UPDATE pages SET tier = $1, consolidated_into = $2, updated_at = NOW() WHERE id = $3`,
      [tier, consolidatedInto, id],
    );
  } else {
    await this.pg.query(
      `UPDATE pages SET tier = $1, updated_at = NOW() WHERE id = $2`,
      [tier, id],
    );
  }
}

async listPagesByTier(tier: string): Promise<Page[]> {
  const result = await this.pg.query<PageRow>(
    `SELECT * FROM pages WHERE tier = $1 ORDER BY created_at`,
    [tier],
  );
  return result.rows.map((r) => this.rowToPage(r));
}
```

- [ ] **Step 7: Add `getLinksForSlugs` to `GraphStore` in `src/store/graph.ts`**

Add this method to the `GraphStore` class (after `getBacklinksEnriched`):

```typescript
async getLinksForSlugs(slugs: string[]): Promise<Map<string, LinkRow[]>> {
  if (slugs.length === 0) return new Map();
  const result = await this.pg.query(
    `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance
     FROM links l
     JOIN pages pf ON pf.id = l.from_page_id
     JOIN pages pt ON pt.id = l.to_page_id
     WHERE pf.slug = ANY($1::text[])`,
    [slugs],
  );
  const map = new Map<string, LinkRow[]>();
  for (const row of result.rows as LinkRow[]) {
    const existing = map.get(row.from_slug) ?? [];
    existing.push(row);
    map.set(row.from_slug, existing);
  }
  return map;
}
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
bunx vitest run tests/store/pages.test.ts tests/store/graph.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All PASS.

- [ ] **Step 9: Commit**

```bash
git add src/store/pages.ts src/store/graph.ts src/adapters/store.ts \
        tests/store/pages.test.ts tests/store/graph.test.ts tests/adapters/store.test.ts
git commit -m "feat(store): add tier/expires_at lifecycle methods to PageStore; stamp expires_at for done tasks"
```

---

## Task 3: Consolidator rules + core module skeleton

**Files:**
- Create: `src/consolidator/rules.ts`
- Create: `src/consolidator/consolidator.ts`
- Create: `tests/consolidator/consolidator.test.ts` (test harness + first tests)

- [ ] **Step 1: Write the failing test**

Create `tests/consolidator/consolidator.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { GraphStore } from "../../src/store/graph.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";
import { Consolidator, type ConsolidatorStores } from "../../src/consolidator/consolidator.js";
import { canCompress, NEVER_COMPRESS_TYPES } from "../../src/consolidator/rules.js";

// Helper: create a page and backdate its expires_at to simulate expiry
async function makeExpiredHotPage(
  pages: PageStore,
  pg: Database["pg"],
  slug: string,
  type: string,
  entitySlug?: string,
  graph?: GraphStore,
): Promise<void> {
  await pages.putPage(slug, `---\ntitle: ${slug}\ntype: ${type}\n---\n${type} content.`, {
    halflife_days: 90,
  });
  await pg.query("UPDATE pages SET expires_at = NOW() - INTERVAL '1 day' WHERE slug = $1", [slug]);
  if (entitySlug && graph) {
    await graph.addLink(slug, entitySlug, "mentions");
  }
}

describe("consolidator rules", () => {
  it("NEVER_COMPRESS_TYPES contains decision, reference, and entity types", () => {
    expect(NEVER_COMPRESS_TYPES.has("decision")).toBe(true);
    expect(NEVER_COMPRESS_TYPES.has("reference")).toBe(true);
    expect(NEVER_COMPRESS_TYPES.has("person")).toBe(true);
    expect(NEVER_COMPRESS_TYPES.has("project")).toBe(true);
  });

  it("canCompress returns false for never-compress types", () => {
    expect(canCompress("decision")).toBe(false);
    expect(canCompress("reference")).toBe(false);
    expect(canCompress("person")).toBe(false);
  });

  it("canCompress returns true for compressible types", () => {
    expect(canCompress("preference")).toBe(true);
    expect(canCompress("knowledge")).toBe(true);
    expect(canCompress("discovery")).toBe(true);
    expect(canCompress("task")).toBe(true);
  });
});

describe("Consolidator", () => {
  let db: Database;
  let stores: ConsolidatorStores;

  beforeEach(async () => {
    db = await Database.create();
    stores = {
      pages: new PageStore(db.pg),
      graph: new GraphStore(db.pg),
      tags: new TagStore(db.pg),
      timeline: new TimelineStore(db.pg),
    };
  });

  afterEach(async () => {
    await db.close();
  });

  it("Consolidator can be instantiated and has runOnce method", () => {
    const consolidator = new Consolidator(stores);
    expect(typeof consolidator.runOnce).toBe("function");
    expect(typeof consolidator.start).toBe("function");
    expect(typeof consolidator.stop).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Create `src/consolidator/rules.ts`**

```typescript
// Types whose content must never be merged or rewritten by the Consolidator.
// Decisions preserve their "why"; references are permanent bookmarks; entity pages are anchors.
export const NEVER_COMPRESS_TYPES = new Set([
  "decision",
  "reference",
  "entity",
  "person",
  "project",
  "organization",
  "tool",
  "concept",
]);

export function canCompress(type: string): boolean {
  return !NEVER_COMPRESS_TYPES.has(type);
}

// Age (in days) after which a hot page transitions to warm.
// Matches halflife_days from Spec 1: the half-life point is the right moment to archive.
// NULL = never automatically expires (open tasks, references, entity pages).
export const HOT_DAYS: Record<string, number | null> = {
  decision: 90,
  task: 90,        // done tasks get expires_at=NOW() immediately; open tasks: null
  knowledge: 365,
  discovery: 90,
  "discovery-pattern": 90,
  "discovery-insight": 90,
  "discovery-preference": 90,
  preference: 90,
  reference: null,
  entity: null,
  person: null,
  project: null,
  organization: null,
  tool: null,
  concept: null,
};

// Minimum age (days from created_at) for a warm page to be eligible for cold compression.
export const WARM_TO_COLD_DAYS: Record<string, number | null> = {
  decision: null,
  reference: null,
  entity: null,
  person: null,
  project: null,
  organization: null,
  tool: null,
  concept: null,
  task: 365,
  knowledge: 730,
  discovery: 365,
  "discovery-pattern": 365,
  "discovery-insight": 365,
  preference: 365,
};
```

- [ ] **Step 4: Create `src/consolidator/consolidator.ts`**

```typescript
import type { LLMProvider } from "../extractors/providers/types.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";

export interface ConsolidatorStores {
  pages: PageStore;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
}

export interface ConsolidateResult {
  hotToWarm: number;
  warmToCold: number;
  deadLinksChecked: number;
  preferencesInferred: number;
}

export type ConsolidateMode = "hot" | "warm" | "all";

export class Consolidator {
  private hotTimer: ReturnType<typeof setInterval> | null = null;
  private warmTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private stores: ConsolidatorStores,
    private llm?: LLMProvider,
  ) {}

  start(): void {
    this.hotTimer = setInterval(() => void this.consolidateHot(), 86_400_000);
    this.warmTimer = setInterval(() => void this.consolidateWarm(), 7 * 86_400_000);
  }

  stop(): void {
    if (this.hotTimer) clearInterval(this.hotTimer);
    if (this.warmTimer) clearInterval(this.warmTimer);
    this.hotTimer = null;
    this.warmTimer = null;
  }

  async runOnce(mode: ConsolidateMode = "all", dryRun = false): Promise<ConsolidateResult> {
    const result: ConsolidateResult = {
      hotToWarm: 0,
      warmToCold: 0,
      deadLinksChecked: 0,
      preferencesInferred: 0,
    };
    if (mode === "hot" || mode === "all") {
      result.hotToWarm = await this.consolidateHot(dryRun);
    }
    if (mode === "warm" || mode === "all") {
      const warmResult = await this.consolidateWarm(dryRun);
      result.warmToCold = warmResult.warmToCold;
      result.deadLinksChecked = warmResult.deadLinksChecked;
      result.preferencesInferred = warmResult.preferencesInferred;
    }
    return result;
  }

  async consolidateHot(dryRun = false): Promise<number> {
    // Implemented in Task 4
    void dryRun;
    return 0;
  }

  async consolidateWarm(dryRun = false): Promise<Omit<ConsolidateResult, "hotToWarm">> {
    // Implemented in Task 5
    void dryRun;
    return { warmToCold: 0, deadLinksChecked: 0, preferencesInferred: 0 };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/consolidator/rules.ts src/consolidator/consolidator.ts tests/consolidator/consolidator.test.ts
git commit -m "feat(consolidator): add rules module and Consolidator class skeleton"
```

---

## Task 4: Hot→Warm consolidation

**Files:**
- Create: `src/consolidator/hot-warm.ts`
- Modify: `src/consolidator/consolidator.ts` (wire in the function)
- Modify: `tests/consolidator/consolidator.test.ts` (add hot→warm tests)

- [ ] **Step 1: Write the failing tests**

Add to the `describe("Consolidator", ...)` block in `tests/consolidator/consolidator.test.ts`:

```typescript
describe("consolidateHot", () => {
  it("moves expired hot pages for never-compress types to warm without merging", async () => {
    await stores.pages.putPage(
      "entities/alice",
      "---\ntitle: Alice\ntype: person\n---\nAlice entity.",
    );
    await makeExpiredHotPage(stores.pages, db.pg, "decisions/d1", "decision");

    const consolidator = new Consolidator(stores);
    const moved = await consolidator.consolidateHot();
    expect(moved).toBe(1);

    const d1 = await stores.pages.getPage("decisions/d1");
    expect(d1?.tier).toBe("warm");
    expect(d1?.compiled_truth).toBe("decision content."); // content unchanged
  });

  it("merges expired hot pages for compressible types by entity+type into one warm page", async () => {
    await stores.pages.putPage(
      "entities/alice",
      "---\ntitle: Alice\ntype: person\n---\nAlice entity.",
    );
    await makeExpiredHotPage(
      stores.pages, db.pg, "preferences/pref1", "preference",
      "entities/alice", stores.graph,
    );
    await makeExpiredHotPage(
      stores.pages, db.pg, "preferences/pref2", "preference",
      "entities/alice", stores.graph,
    );

    const consolidator = new Consolidator(stores);
    const moved = await consolidator.consolidateHot();
    expect(moved).toBe(2);

    const pref1 = await stores.pages.getPage("preferences/pref1");
    const pref2 = await stores.pages.getPage("preferences/pref2");
    expect(pref1?.tier).toBe("warm");
    expect(pref2?.tier).toBe("warm");
    // Both should point to the same consolidated warm page
    expect(pref1?.consolidated_into).toBe(pref2?.consolidated_into);
    expect(pref1?.consolidated_into).not.toBeNull();
  });

  it("does NOT merge or rewrite pages where frontmatter.user_edited === true (H4 rule)", async () => {
    // Create a page with user_edited = true
    await stores.pages.putPage(
      "preferences/user-edited",
      "---\ntitle: User-edited pref\ntype: preference\nuser_edited: true\n---\nHand-written content.",
      { halflife_days: 90 },
    );
    // Backdate it so it appears expired
    await db.pg.query(
      "UPDATE pages SET expires_at = NOW() - INTERVAL '1 day' WHERE slug = $1",
      ["preferences/user-edited"],
    );

    const consolidator = new Consolidator(stores);
    await consolidator.consolidateHot();

    const page = await stores.pages.getPage("preferences/user-edited");
    // Tier can advance to warm (that's allowed — only content is protected)
    expect(page?.tier).toBe("warm");
    // Content is unchanged
    expect(page?.compiled_truth).toBe("Hand-written content.");
    // consolidated_into is null: NOT merged into a group warm page
    expect(page?.consolidated_into).toBeNull();
  });

  it("is idempotent: running consolidateHot twice does not create duplicate warm pages", async () => {
    await stores.pages.putPage(
      "entities/bob",
      "---\ntitle: Bob\ntype: person\n---\nBob entity.",
    );
    await makeExpiredHotPage(
      stores.pages, db.pg, "preferences/p1", "preference",
      "entities/bob", stores.graph,
    );
    await makeExpiredHotPage(
      stores.pages, db.pg, "preferences/p2", "preference",
      "entities/bob", stores.graph,
    );

    const consolidator = new Consolidator(stores);
    await consolidator.consolidateHot();
    const beforeCount = (await stores.pages.listPagesByTier("warm")).length;

    await consolidator.consolidateHot();
    const afterCount = (await stores.pages.listPagesByTier("warm")).length;

    expect(afterCount).toBe(beforeCount); // no duplicates
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — `consolidateHot` is a stub returning 0.

- [ ] **Step 3: Create `src/consolidator/hot-warm.ts`**

```typescript
import { stringify as yamlStringify } from "yaml";
import type { GraphStore } from "../store/graph.js";
import type { PageStore, Page } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import { canCompress } from "./rules.js";

interface HotWarmStores {
  pages: PageStore;
  graph: GraphStore;
  tags: TagStore;
}

export async function consolidateHotToWarm(
  stores: HotWarmStores,
  dryRun = false,
): Promise<number> {
  const expired = await stores.pages.listExpiredHot();
  if (expired.length === 0) return 0;

  // Separate: pages whose content can be merged vs. those that only advance tier
  const compressible = expired.filter(
    (p) => canCompress(p.type) && p.frontmatter.user_edited !== true,
  );
  const nonCompressible = expired.filter(
    (p) => !canCompress(p.type) || p.frontmatter.user_edited === true,
  );

  if (dryRun) {
    return expired.length;
  }

  // Non-compressible: just advance tier to 'warm', content untouched
  for (const page of nonCompressible) {
    await stores.pages.updatePageTier(page.id, "warm");
  }

  // Compressible: batch-load their outgoing links, then group by (entitySlug, type)
  const slugs = compressible.map((p) => p.slug);
  const linksMap = await stores.graph.getLinksForSlugs(slugs);

  // Group pages: key = "entitySlug::type" | "none::type" (for pages with no entity link)
  type GroupKey = string;
  const groups = new Map<GroupKey, Page[]>();

  for (const page of compressible) {
    const links = linksMap.get(page.slug) ?? [];
    const entityLink = links.find((l) => l.link_type === "mentions");
    const entitySlug = entityLink?.to_slug ?? "__none__";
    const key: GroupKey = `${entitySlug}::${page.type}`;
    const existing = groups.get(key) ?? [];
    existing.push(page);
    groups.set(key, existing);
  }

  // For each group: create one warm aggregate page, point originals to it
  for (const [key, pages] of groups) {
    const [entitySlug, type] = key.split("::");

    // Build merged content: concatenate compiled_truth of all pages
    const mergedContent = pages
      .map((p) => `### ${p.title}\n\n${p.compiled_truth}`)
      .join("\n\n---\n\n");

    // Determine a stable slug for this warm aggregate
    const entityPart =
      entitySlug === "__none__"
        ? "unanchored"
        : entitySlug.replace(/\//g, "-");
    const warmSlug = `warm/${entityPart}/${type}-consolidated`;

    // Write the warm aggregate page (upsert — idempotency: if it already exists, append)
    const existingWarm = await stores.pages.getPage(warmSlug);
    const existingContent = existingWarm
      ? `${existingWarm.compiled_truth}\n\n---\n\n`
      : "";
    const combinedContent = existingContent + mergedContent;

    const frontmatter: Record<string, unknown> = {
      title: `Consolidated ${type} (${entitySlug === "__none__" ? "unanchored" : entitySlug})`,
      type,
      consolidated: true,
      source_slugs: [
        ...(existingWarm?.frontmatter.source_slugs as string[] ?? []),
        ...pages.map((p) => p.slug),
      ],
      created_at:
        existingWarm?.frontmatter.created_at ??
        pages.reduce(
          (min, p) => (p.created_at < min ? p.created_at : min),
          pages[0].created_at,
        ),
    };

    const warmPageContent = `---\n${yamlStringify(frontmatter).trim()}\n---\n\n${combinedContent}`;
    const warmPage = await stores.pages.putPage(warmSlug, warmPageContent, {
      halflife_days: null,
    });

    // Override tier to 'warm' (putPage defaults to 'hot')
    await stores.pages.updatePageTier(warmPage.id, "warm");

    // If entity exists, link the warm page to it
    if (entitySlug !== "__none__") {
      const entityPage = await stores.pages.getPage(entitySlug);
      if (entityPage) {
        await stores.graph.addLink(warmSlug, entitySlug, "mentions");
      }
    }

    // Point originals to the warm aggregate
    for (const page of pages) {
      await stores.pages.updatePageTier(page.id, "warm", warmPage.id);
    }
  }

  return expired.length;
}
```

- [ ] **Step 4: Wire into `Consolidator.consolidateHot` in `src/consolidator/consolidator.ts`**

Add the import at the top:
```typescript
import { consolidateHotToWarm } from "./hot-warm.js";
```

Replace the `consolidateHot` stub:
```typescript
async consolidateHot(dryRun = false): Promise<number> {
  return consolidateHotToWarm(this.stores, dryRun);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All `consolidateHot` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/consolidator/hot-warm.ts src/consolidator/consolidator.ts tests/consolidator/consolidator.test.ts
git commit -m "feat(consolidator): implement hot→warm tier rotation with entity grouping and H4 rule"
```

---

## Task 5: Warm→Cold consolidation (LLM summarization)

**Files:**
- Create: `src/consolidator/warm-cold.ts`
- Modify: `src/consolidator/consolidator.ts` (wire in)
- Modify: `tests/consolidator/consolidator.test.ts` (add warm→cold tests)

- [ ] **Step 1: Write the failing tests**

Add to the `describe("Consolidator", ...)` block (no new imports needed — `LLMProvider` type is already imported from types.ts via the consolidator import chain; if the test file needs it explicitly, add: `import type { LLMProvider } from "../../src/extractors/providers/types.js";`):

```typescript
describe("consolidateWarm", () => {
  it("creates a cold summary page for a warm entity group via LLM", async () => {
    const mockLlm: LLMProvider = {
      async chat() {
        return "Alice prefers morning meetings and tends to complete work on Tuesdays.";
      },
    };

    await stores.pages.putPage(
      "entities/alice",
      "---\ntitle: Alice\ntype: person\n---\nAlice entity.",
    );

    // Create a warm preference page linked to alice (simulating result of consolidateHot)
    await stores.pages.putPage(
      "warm/entities-alice/preference-consolidated",
      "---\ntitle: Consolidated preference (entities/alice)\ntype: preference\nconsolidated: true\n---\nAlice likes morning standups.",
      { halflife_days: null },
    );
    await db.pg.query(
      "UPDATE pages SET tier = 'warm', created_at = NOW() - INTERVAL '400 days' WHERE slug = $1",
      ["warm/entities-alice/preference-consolidated"],
    );
    await stores.graph.addLink(
      "warm/entities-alice/preference-consolidated",
      "entities/alice",
      "mentions",
    );

    const consolidator = new Consolidator(stores, mockLlm);
    const result = await consolidator.consolidateWarm();
    expect(result.warmToCold).toBeGreaterThan(0);

    const coldPage = await stores.pages.getPage("cold/entities-alice");
    expect(coldPage).not.toBeNull();
    expect(coldPage?.tier).toBe("cold");
    expect(coldPage?.compiled_truth).toContain("Alice prefers morning meetings");
  });

  it("does NOT compress pages that are too young for warm→cold threshold", async () => {
    const mockLlm: LLMProvider = {
      async chat() {
        return "Summary.";
      },
    };

    await stores.pages.putPage(
      "entities/bob",
      "---\ntitle: Bob\ntype: person\n---\nBob entity.",
    );
    // Fresh warm page (created recently, not yet past WARM_TO_COLD_DAYS threshold)
    await stores.pages.putPage(
      "warm/entities-bob/preference-consolidated",
      "---\ntitle: Consolidated preference\ntype: preference\nconsolidated: true\n---\nBob likes evening calls.",
      { halflife_days: null },
    );
    await db.pg.query(
      "UPDATE pages SET tier = 'warm' WHERE slug = $1",
      ["warm/entities-bob/preference-consolidated"],
    );
    await stores.graph.addLink(
      "warm/entities-bob/preference-consolidated",
      "entities/bob",
      "mentions",
    );

    const consolidator = new Consolidator(stores, mockLlm);
    const result = await consolidator.consolidateWarm();
    expect(result.warmToCold).toBe(0);

    const coldPage = await stores.pages.getPage("cold/entities-bob");
    expect(coldPage).toBeNull(); // too young
  });

  it("throws if consolidateWarm is called without an LLM provider", async () => {
    const consolidator = new Consolidator(stores);
    await expect(consolidator.consolidateWarm()).rejects.toThrow(
      "LLM provider required for warm→cold consolidation",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — consolidateWarm stub returns empty result.

- [ ] **Step 3: Create `src/consolidator/warm-cold.ts`**

```typescript
import { stringify as yamlStringify } from "yaml";
import type { LLMProvider } from "../extractors/providers/types.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore, Page } from "../store/pages.js";
import { canCompress, WARM_TO_COLD_DAYS } from "./rules.js";

interface WarmColdStores {
  pages: PageStore;
  graph: GraphStore;
}

export interface WarmColdResult {
  warmToCold: number;
}

export async function consolidateWarmToCold(
  stores: WarmColdStores,
  llm: LLMProvider,
  dryRun = false,
): Promise<WarmColdResult> {
  // Find all entity pages to use as grouping anchors
  const entityTypes = ["person", "project", "organization", "tool", "concept", "entity"];
  let entityPages: Page[] = [];
  for (const type of entityTypes) {
    const pages = await stores.pages.listPages({ type });
    entityPages = entityPages.concat(pages);
  }

  let warmToCold = 0;

  for (const entity of entityPages) {
    // Get warm pages linked to this entity
    const backlinks = await stores.graph.getBacklinksEnriched(entity.slug);
    const warmCandidates = backlinks
      .filter((b) => b.page.type !== undefined)
      .filter((b) => {
        // Must be warm tier, compressible, and not user-edited
        return (
          canCompress(b.page.type) &&
          b.page.frontmatter.user_edited !== true
        );
      });

    // Filter to warm pages that exist
    const warmPages: Page[] = [];
    for (const candidate of warmCandidates) {
      const page = await stores.pages.getPage(candidate.from_slug);
      if (!page || page.tier !== "warm") continue;

      // Check age threshold
      const type = page.type;
      const thresholdDays = WARM_TO_COLD_DAYS[type] ?? null;
      if (thresholdDays === null) continue;

      const ageMs = Date.now() - new Date(page.created_at).getTime();
      const ageDays = ageMs / 86_400_000;
      if (ageDays < thresholdDays) continue;

      warmPages.push(page);
    }

    if (warmPages.length === 0) continue;

    if (dryRun) {
      warmToCold += warmPages.length;
      continue;
    }

    // LLM: generate entity summary from warm page content
    const candidateText = warmPages
      .map((p) => `## ${p.title}\n\n${p.compiled_truth}`)
      .join("\n\n---\n\n");

    const summary = await llm.chat([
      {
        role: "system",
        content:
          "You are summarizing memory signals about a person, project, or concept. " +
          "Write a concise narrative (under 400 words) capturing: key decisions, " +
          "current state, important preferences and patterns, and key knowledge. " +
          "Plain prose, no headers, no bullet points.",
      },
      {
        role: "user",
        content: `Entity: ${entity.title} (${entity.slug})\n\nSource signals:\n\n${candidateText}`,
      },
    ]);

    // Create or update cold page
    const coldSlug = `cold/${entity.slug}`;
    const frontmatter: Record<string, unknown> = {
      title: `${entity.title} — cold summary`,
      type: "knowledge",
      consolidated: true,
      consolidated_from: warmPages.map((p) => p.slug),
      entity: entity.slug,
      created_at: new Date().toISOString(),
    };
    const coldContent = `---\n${yamlStringify(frontmatter).trim()}\n---\n\n${summary}`;
    const coldPage = await stores.pages.putPage(coldSlug, coldContent, { halflife_days: null });
    await stores.pages.updatePageTier(coldPage.id, "cold");

    // Link cold page to entity
    await stores.graph.addLink(coldSlug, entity.slug, "mentions");

    // Mark warm pages as consolidated
    for (const page of warmPages) {
      await stores.pages.updatePageTier(page.id, "cold", coldPage.id);
    }

    warmToCold += warmPages.length;
  }

  return { warmToCold };
}
```

- [ ] **Step 4: Wire into `Consolidator.consolidateWarm` in `src/consolidator/consolidator.ts`**

Add the import:
```typescript
import { consolidateWarmToCold } from "./warm-cold.js";
```

Replace the `consolidateWarm` stub:
```typescript
async consolidateWarm(dryRun = false): Promise<Omit<ConsolidateResult, "hotToWarm">> {
  if (!this.llm) {
    throw new Error("LLM provider required for warm→cold consolidation");
  }
  const { warmToCold } = await consolidateWarmToCold(this.stores, this.llm, dryRun);
  return { warmToCold, deadLinksChecked: 0, preferencesInferred: 0 };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All consolidateWarm tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/consolidator/warm-cold.ts src/consolidator/consolidator.ts tests/consolidator/consolidator.test.ts
git commit -m "feat(consolidator): implement warm→cold LLM summarization"
```

---

## Task 6: Dead-link checker for reference pages

**Files:**
- Create: `src/consolidator/dead-link.ts`
- Modify: `src/consolidator/consolidator.ts` (wire in)
- Modify: `tests/consolidator/consolidator.test.ts` (add dead-link tests)

- [ ] **Step 1: Write the failing tests**

Add to `tests/consolidator/consolidator.test.ts`:

```typescript
import { checkDeadLinks, type FetchFn } from "../../src/consolidator/dead-link.js";
```

And add to the `describe("Consolidator", ...)` block:

```typescript
describe("dead-link checker", () => {
  it("marks reference page as dead_link=true when URL returns non-200", async () => {
    const mockFetch: FetchFn = async (url) => {
      if (url === "https://dead.example.com") return { ok: false, status: 404 };
      return { ok: true, status: 200 };
    };

    await stores.pages.putPage(
      "references/dead-ref",
      [
        "---",
        "title: Dead Reference",
        "type: reference",
        "url: https://dead.example.com",
        "dead_link: false",
        "---",
        "",
        "This link is dead.",
      ].join("\n"),
      { halflife_days: null },
    );

    const checked = await checkDeadLinks(stores.pages, mockFetch);
    expect(checked).toBe(1);

    const page = await stores.pages.getPage("references/dead-ref");
    expect(page?.frontmatter.dead_link).toBe(true);
    expect(page?.frontmatter.last_checked_at).toBeDefined();
  });

  it("marks reference page as dead_link=false when URL returns 200", async () => {
    const mockFetch: FetchFn = async () => ({ ok: true, status: 200 });

    await stores.pages.putPage(
      "references/live-ref",
      [
        "---",
        "title: Live Reference",
        "type: reference",
        "url: https://live.example.com",
        "dead_link: false",
        "---",
        "",
        "This link works.",
      ].join("\n"),
      { halflife_days: null },
    );

    const checked = await checkDeadLinks(stores.pages, mockFetch);
    expect(checked).toBe(1);

    const page = await stores.pages.getPage("references/live-ref");
    expect(page?.frontmatter.dead_link).toBe(false);
  });

  it("skips reference pages checked within the last 30 days", async () => {
    const mockFetch: FetchFn = async () => ({ ok: true, status: 200 });
    const recentCheck = new Date(Date.now() - 5 * 86_400_000).toISOString(); // 5 days ago

    await stores.pages.putPage(
      "references/recent-ref",
      [
        "---",
        "title: Recently Checked",
        "type: reference",
        `url: https://example.com`,
        `last_checked_at: "${recentCheck}"`,
        "---",
        "",
        "Recent.",
      ].join("\n"),
      { halflife_days: null },
    );

    const checked = await checkDeadLinks(stores.pages, mockFetch);
    expect(checked).toBe(0); // skipped
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — `checkDeadLinks` not found.

- [ ] **Step 3: Create `src/consolidator/dead-link.ts`**

```typescript
import { stringify as yamlStringify } from "yaml";
import type { PageStore } from "../store/pages.js";

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number }>;

const RECHECK_DAYS = 30;

export async function checkDeadLinks(
  pages: PageStore,
  fetchFn: FetchFn = defaultFetch,
): Promise<number> {
  const references = await pages.listPages({ type: "reference" });
  let checked = 0;

  for (const page of references) {
    const url = page.frontmatter.url as string | undefined;
    if (!url) continue;

    // Skip if checked within RECHECK_DAYS
    const lastChecked = page.frontmatter.last_checked_at as string | undefined;
    if (lastChecked) {
      const daysSince = (Date.now() - new Date(lastChecked).getTime()) / 86_400_000;
      if (daysSince < RECHECK_DAYS) continue;
    }

    let isDeadLink = false;
    try {
      const result = await fetchFn(url);
      isDeadLink = !result.ok;
    } catch {
      isDeadLink = true;
    }

    // Update frontmatter with dead_link status and last_checked_at
    const updatedFrontmatter: Record<string, unknown> = {
      ...page.frontmatter,
      dead_link: isDeadLink,
      last_checked_at: new Date().toISOString(),
    };
    const { title: _t, type: _ty, ...rest } = updatedFrontmatter;
    const newContent =
      `---\ntitle: ${page.title}\ntype: ${page.type}\n${yamlStringify(rest).trim()}\n---\n\n${page.compiled_truth}`;

    await pages.putPage(page.slug, newContent, {
      halflife_days: page.halflife_days,
    });

    checked++;
  }

  return checked;
}

async function defaultFetch(url: string): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Wire dead-link check into `Consolidator.consolidateWarm` in `src/consolidator/consolidator.ts`**

Add the import:
```typescript
import { checkDeadLinks } from "./dead-link.js";
```

Replace `consolidateWarm`:
```typescript
async consolidateWarm(dryRun = false): Promise<Omit<ConsolidateResult, "hotToWarm">> {
  if (!this.llm) {
    throw new Error("LLM provider required for warm→cold consolidation");
  }
  const { warmToCold } = await consolidateWarmToCold(this.stores, this.llm, dryRun);
  const deadLinksChecked = dryRun ? 0 : await checkDeadLinks(this.stores.pages);
  return { warmToCold, deadLinksChecked, preferencesInferred: 0 };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All dead-link tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/consolidator/dead-link.ts src/consolidator/consolidator.ts tests/consolidator/consolidator.test.ts
git commit -m "feat(consolidator): add dead-link checker for reference pages"
```

---

## Task 7: Preference behavioral inference

**Files:**
- Create: `src/consolidator/infer-preferences.ts`
- Modify: `src/consolidator/consolidator.ts` (wire in)
- Modify: `tests/consolidator/consolidator.test.ts` (add inference tests)

- [ ] **Step 1: Write the failing tests**

Add to `tests/consolidator/consolidator.test.ts`:

```typescript
import { inferPreferences } from "../../src/consolidator/infer-preferences.js";
```

Add to the `describe("Consolidator", ...)` block:

```typescript
describe("preference inference", () => {
  it("infers scheduling preference from timeline patterns via LLM", async () => {
    const mockLlm: LLMProvider = {
      async chat() {
        return JSON.stringify([
          {
            summary: "偏好下午开会",
            category: "scheduling",
            confidence: "inferred",
          },
        ]);
      },
    };

    await stores.pages.putPage(
      "entities/alice",
      "---\ntitle: Alice\ntype: person\n---\nAlice.",
    );
    // Create timeline entries for the entity — all in the afternoon
    for (let i = 0; i < 6; i++) {
      await stores.timeline.addEntry("entities/alice", {
        date: `2026-05-${10 + i}`,
        summary: `Meeting at 14:0${i}`,
        detail: `Alice's meeting at 14:0${i}`,
      });
    }

    const inferred = await inferPreferences(stores, mockLlm);
    expect(inferred).toBeGreaterThan(0);

    const prefPage = await stores.pages.listPages({ type: "preference" });
    const inferredPrefs = prefPage.filter((p) => p.frontmatter.inferred === true);
    expect(inferredPrefs.length).toBeGreaterThan(0);
  });

  it("returns 0 when LLM returns empty array (no clear patterns)", async () => {
    const mockLlm: LLMProvider = {
      async chat() {
        return "[]";
      },
    };

    await stores.pages.putPage(
      "entities/charlie",
      "---\ntitle: Charlie\ntype: person\n---\nCharlie.",
    );
    await stores.timeline.addEntry("entities/charlie", {
      date: "2026-05-10",
      summary: "Random meeting",
    });

    const inferred = await inferPreferences(stores, mockLlm);
    expect(inferred).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — `inferPreferences` not found.

- [ ] **Step 3: Create `src/consolidator/infer-preferences.ts`**

```typescript
import { stringify as yamlStringify } from "yaml";
import type { LLMProvider } from "../extractors/providers/types.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";

interface InferStores {
  pages: PageStore;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
}

interface InferredPreference {
  summary: string;
  category: string;
  confidence: string;
}

function kebabCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function inferPreferences(
  stores: InferStores,
  llm: LLMProvider,
): Promise<number> {
  // Only infer for person entities (the subject of behavioral patterns)
  const personPages = await stores.pages.listPages({ type: "person" });
  let totalInferred = 0;

  for (const entity of personPages) {
    const timeline = await stores.timeline.getTimeline(entity.slug);
    if (timeline.length < 3) continue; // not enough data for inference

    const timelineSummary = timeline
      .slice(0, 50) // cap to 50 recent entries
      .map((e) => `[${e.date}] ${e.summary}`)
      .join("\n");

    // Ask LLM whether any strong patterns exist
    let rawResponse: string;
    try {
      rawResponse = await llm.chat([
        {
          role: "system",
          content:
            "You infer behavioral preferences from timeline and task patterns. " +
            "If there are clear patterns (80%+ consistency across at least 3 data points), " +
            "output a JSON array of inferred preferences. Otherwise output [].\n" +
            "Each preference: {\"summary\": \"...\", \"category\": \"scheduling|workflow|communication\", \"confidence\": \"inferred\"}\n" +
            "Output ONLY valid JSON, no explanation.",
        },
        {
          role: "user",
          content: `Entity: ${entity.title} (${entity.slug})\n\nTimeline entries:\n${timelineSummary}`,
        },
      ]);
    } catch {
      continue;
    }

    let preferences: InferredPreference[];
    try {
      preferences = JSON.parse(rawResponse.trim()) as InferredPreference[];
      if (!Array.isArray(preferences)) continue;
    } catch {
      continue; // LLM returned non-JSON
    }

    for (const pref of preferences) {
      if (!pref.summary || !pref.category) continue;

      const slug = `preferences/inferred-${entity.slug.replace(/\//g, "-")}-${kebabCase(pref.summary)}`;

      const frontmatter: Record<string, unknown> = {
        title: pref.summary,
        type: "preference",
        category: pref.category,
        confidence: "inferred",
        inferred: true,
        entity: entity.slug,
        created_at: new Date().toISOString(),
      };
      const content = `---\n${yamlStringify(frontmatter).trim()}\n---\n\nInferred from timeline patterns for ${entity.title}.`;

      const page = await stores.pages.putPage(slug, content, { halflife_days: 90 });
      await stores.graph.addLink(slug, entity.slug, "mentions");
      await stores.tags.addTag(slug, "preference");
      await stores.tags.addTag(slug, pref.category);

      void page;
      totalInferred++;
    }
  }

  return totalInferred;
}
```

- [ ] **Step 4: Wire into `Consolidator.consolidateWarm` in `src/consolidator/consolidator.ts`**

Add the import:
```typescript
import { inferPreferences } from "./infer-preferences.js";
```

Replace `consolidateWarm`:
```typescript
async consolidateWarm(dryRun = false): Promise<Omit<ConsolidateResult, "hotToWarm">> {
  if (!this.llm) {
    throw new Error("LLM provider required for warm→cold consolidation");
  }
  const { warmToCold } = await consolidateWarmToCold(this.stores, this.llm, dryRun);
  const deadLinksChecked = dryRun ? 0 : await checkDeadLinks(this.stores.pages);
  const preferencesInferred = dryRun ? 0 : await inferPreferences(this.stores, this.llm);
  return { warmToCold, deadLinksChecked, preferencesInferred };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx vitest run tests/consolidator/consolidator.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/consolidator/infer-preferences.ts src/consolidator/consolidator.ts tests/consolidator/consolidator.test.ts
git commit -m "feat(consolidator): add behavioral preference inference from timeline patterns"
```

---

## Task 8: CLI command `memoark consolidate`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Verify the test (dry-run check)**

The CLI command doesn't need a separate test file — its correctness is verified by the acceptance criteria manual test in Task 9. We'll verify it compiles and responds to `--help`.

- [ ] **Step 2: Add the `consolidate` command to `src/cli.ts`**

Add this import near the top of `src/cli.ts` (alongside other store imports):

```typescript
import { Consolidator } from "./consolidator/consolidator.js";
```

Add this command block anywhere before `program.parse()` (after the `search` command is a good place):

```typescript
program
  .command("consolidate")
  .description("Run memory lifecycle tier rotation (hot→warm and/or warm→cold)")
  .option("-c, --config <path>", "Path to config file (default: memoark.yaml)")
  .option("--hot", "Run hot→warm rotation only")
  .option("--warm", "Run warm→cold rotation only (requires LLM API key)")
  .option("--dry-run", "Report what would be consolidated without writing")
  .action(async (options) => {
    try {
      const config = loadConfig(options.config);
      const stores = await createStores(config);

      let llmProvider: ReturnType<typeof createLLMProvider> | undefined;
      if (options.warm || (!options.hot && !options.warm)) {
        // warm→cold needs LLM; only require it when --warm or full (both) run
        const llmConfig = config.llm;
        const envKey =
          llmConfig.provider === "anthropic"
            ? process.env.ANTHROPIC_API_KEY
            : process.env.OPENAI_API_KEY;
        if (llmConfig.api_key || envKey) {
          if (!llmConfig.api_key) llmConfig.api_key = envKey;
          llmProvider = createLLMProvider(llmConfig);
        } else if (!options.hot) {
          console.warn(
            "Warning: no LLM API key found. warm→cold consolidation will be skipped. " +
            "Use --hot to run hot→warm only, or set ANTHROPIC_API_KEY.",
          );
        }
      }

      const consolidator = new Consolidator(
        {
          pages: stores.pages,
          graph: stores.graph,
          tags: stores.tags,
          timeline: stores.timeline,
        },
        llmProvider,
      );

      const mode = options.hot ? "hot" : options.warm ? "warm" : "all";
      const dryRun = options.dryRun ?? false;

      if (dryRun) console.log("DRY-RUN mode — no writes will occur\n");

      const result = await consolidator.runOnce(mode, dryRun);

      console.log("Consolidation complete:");
      console.log(`  hot→warm pages moved:    ${result.hotToWarm}`);
      console.log(`  warm→cold pages archived: ${result.warmToCold}`);
      console.log(`  dead links checked:       ${result.deadLinksChecked}`);
      console.log(`  preferences inferred:     ${result.preferencesInferred}`);

      await stores.db.close();
    } catch (error) {
      console.error(
        "Consolidate failed:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Verify it compiles**

```bash
bun run typecheck 2>&1
```

Expected: No errors.

- [ ] **Step 4: Verify the help text**

```bash
bun run src/cli.ts consolidate --help 2>&1
```

Expected: Shows consolidate command description and options (`--hot`, `--warm`, `--dry-run`).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add 'memoark consolidate' command with --hot/--warm/--dry-run flags"
```

---

## Task 9: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck 2>&1
```

Expected: No errors.

- [ ] **Step 2: Run lint**

```bash
bun run lint 2>&1
```

If there are auto-fixable issues:
```bash
bun run lint:fix 2>&1
```

Expected: Clean.

- [ ] **Step 3: Run all new Spec 2 tests**

```bash
bunx vitest run \
  tests/store/migrations.test.ts \
  tests/store/pages.test.ts \
  tests/store/graph.test.ts \
  tests/consolidator/consolidator.test.ts \
  --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2 2>&1
```

Expected: All pass (pre-existing failures in other files are not regressions).

- [ ] **Step 4: Run adapters and schemas tests to confirm no Spec 1 regressions**

```bash
bunx vitest run \
  tests/adapters/store.test.ts \
  tests/core/schemas.test.ts \
  --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2 2>&1
```

Expected: Same pass/fail ratio as before Spec 2 (no new failures).

- [ ] **Step 5: Verify acceptance criteria manually**

**AC1** — typecheck and tests pass: confirmed above.

**AC2** — Migration 003 adds columns: verified by `tests/store/migrations.test.ts`.

**AC3** — After `consolidate --hot`, expired pages move to warm:
```bash
# In a test script or REPL with a populated DB:
# Insert hot pages with backdated expires_at, then run:
bun run src/cli.ts consolidate --hot --dry-run
# Confirm: reports pages that would be moved
```

**AC4** — `type='decision'` never enters cold tier: verified by test "does NOT create cold page for decision" (decision is in NEVER_COMPRESS_TYPES with no cold threshold).

**AC5** — `type='reference'` stays at hot (expires_at=NULL so never expires); dead_link marked on failures: verified by dead-link tests.

**AC6** — After `consolidate --warm`, cold summary page appears at `cold/<entity>`: verified by consolidateWarm test.

**AC7** — Idempotency: verified by "is idempotent: running consolidateHot twice" test.

**AC8** — H4 rule: user_edited pages not merged: verified by "does NOT merge user_edited page" test.

- [ ] **Step 6: Commit any lint/typecheck fixes**

```bash
git add -p  # stage only the changed files
git commit -m "chore: lint and typecheck fixes from Spec 2 verification pass"
```

- [ ] **Step 7: Push branch**

```bash
git push -u origin claude/repository-issues-review-TZG4j
```

Expected: Push succeeds.
