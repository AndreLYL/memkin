# Spec 1: 信号类型重构 + Entity 锚定强化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `preference` to a first-class signal type, add a new `reference` signal type, give every signal page a `halflife_days` lifecycle column, and introduce a minimal migration runner so future schema changes (Spec 2's `tier`/`expires_at`/`consolidated_into`) have somewhere to land.

**Architecture:** All signals remain `pages` rows distinguished by `type` + slug prefix (no new tables). A numbered SQL migration runner adds `halflife_days INTEGER` to `pages`, remaps legacy `discovery-preference` rows to `type='preference'`, and backfills halflife values by type. `PageStore.putPage` gains an options parameter so callers can set lifecycle columns atomically with content. `StoreAdapter` gains `writePreference`/`writeReference` and has its four existing signal-write methods retrofitted to stamp `halflife_days` going forward.

**Tech Stack:** TypeScript, Bun, PGLite (embedded Postgres + pgvector), Vitest, Zod

---

## Before You Start

Read these for context (don't re-derive what's already decided):
- `docs/superpowers/specs/2026-06-04-spec1-signal-types-entity-architecture.md` — the spec this plan implements (sections referenced below as "§N")
- `src/adapters/store.ts` — the file most heavily modified (StoreAdapter)
- `src/store/pages.ts` — `PageStore.putPage` (the upsert this plan extends)

Two structural decisions this plan makes explicit (the spec left them implicit):

1. **How `halflife_days` actually gets written**: `putPage(slug, content)` only writes a fixed column set — it has no path for extra real columns. Task 2 extends it to `putPage(slug, content, { halflife_days })`. This is the pattern Spec 2 will reuse for `tier`/`expires_at`/`consolidated_into` — get the shape right here.
2. **`halflife_days` isn't only for the two new types**: the migration backfills *existing* rows, but every *future* decision/task/discovery/knowledge page also needs `halflife_days` stamped at creation (90/90/90/365 respectively per §4.3), or it silently stays `NULL`. Task 3 retrofits the four existing write methods.

---

## Task 1: Migration runner infrastructure

**Files:**
- Create: `src/store/migrations/001_lifecycle_columns.sql`
- Create: `src/store/migrations/index.ts`
- Create: `tests/store/migrations.test.ts`
- Modify: `src/store/database.ts`
- Modify: `src/store/schema.sql:3-15` (add `halflife_days` to the `pages` table definition so fresh DBs get it directly)

- [ ] **Step 1: Write the failing test for the migration runner**

Create `tests/store/migrations.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { runMigrations } from "../../src/store/migrations/index.js";

describe("migration runner", () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.create();
  });

  afterEach(async () => {
    await db.close();
  });

  it("creates schema_migrations table and records applied versions", async () => {
    const rows = await db.pg.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((r) => r.version)).toEqual([1]);
  });

  it("adds halflife_days column to pages", async () => {
    const cols = await db.pg.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'pages' AND column_name = 'halflife_days'`,
    );
    expect(cols.rows).toHaveLength(1);
  });

  it("is idempotent: running migrations twice does not duplicate or error", async () => {
    await runMigrations(db.pg);
    await runMigrations(db.pg);
    const rows = await db.pg.query<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows.rows.map((r) => r.version)).toEqual([1]);
  });

  it("remaps discovery-preference pages to preference type", async () => {
    // Insert a legacy-shaped row directly (bypassing putPage, which would normalize the type)
    await db.pg.query(
      `INSERT INTO pages (slug, type, title, compiled_truth) VALUES ($1, $2, $3, $4)`,
      ["discoveries/old-pref", "discovery-preference", "Old preference", "legacy content"],
    );
    await runMigrations(db.pg);

    const result = await db.pg.query<{ type: string; halflife_days: number | null }>(
      "SELECT type, halflife_days FROM pages WHERE slug = $1",
      ["discoveries/old-pref"],
    );
    expect(result.rows[0].type).toBe("preference");
    expect(result.rows[0].halflife_days).toBe(90);
  });

  it("backfills halflife_days by type for pre-existing signal pages", async () => {
    await db.pg.query(
      `INSERT INTO pages (slug, type, title, compiled_truth) VALUES
         ('decisions/d1', 'decision', 'D1', 'x'),
         ('tasks/t1', 'task', 'T1', 'x'),
         ('knowledge/k1/abc', 'knowledge', 'K1', 'x'),
         ('discoveries/dy1', 'discovery-pattern', 'DY1', 'x'),
         ('person/alice', 'person', 'Alice', 'x')`,
    );
    await runMigrations(db.pg);

    const rows = await db.pg.query<{ slug: string; halflife_days: number | null }>(
      "SELECT slug, halflife_days FROM pages WHERE slug != 'discoveries/old-pref' ORDER BY slug",
    );
    const bySlug = Object.fromEntries(rows.rows.map((r) => [r.slug, r.halflife_days]));
    expect(bySlug["decisions/d1"]).toBe(90);
    expect(bySlug["tasks/t1"]).toBe(90);
    expect(bySlug["knowledge/k1/abc"]).toBe(365);
    expect(bySlug["discoveries/dy1"]).toBe(90);
    expect(bySlug["person/alice"]).toBeNull(); // entity types: never expire
  });
});
```

Note: `Database.create()` already runs migrations as part of setup (you'll wire that in Step 5), so the first two tests pass against a freshly created DB. The remaining tests call `runMigrations` directly to test idempotency and backfill against rows inserted *after* initial creation — simulating an existing database being upgraded.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- tests/store/migrations.test.ts`
Expected: FAIL — `Cannot find module '../../src/store/migrations/index.js'`

- [ ] **Step 3: Write the migration SQL file**

Create `src/store/migrations/001_lifecycle_columns.sql`:

```sql
-- Migration 001: lifecycle metadata + preference type promotion
--
-- Adds halflife_days to pages (drives Spec 2's hot/warm/cold rotation —
-- a page past its halflife has "decayed" past the importance-halving point,
-- the natural moment to demote it from hot to warm).
--
-- Also remaps the legacy discovery-preference subtype to a first-class
-- `preference` page type (Spec 1 promotes preferences out of Discovery.type).

ALTER TABLE pages ADD COLUMN IF NOT EXISTS halflife_days INTEGER;

-- Promote discovery-preference pages to first-class preference type.
-- Must run BEFORE the backfill below so these rows pick up the
-- preference halflife (90), not the discovery-* halflife (also 90 here,
-- but keeping the order correct matters if the values ever diverge).
UPDATE pages SET type = 'preference' WHERE type = 'discovery-preference';

-- Backfill halflife_days for existing signal pages, by type.
-- Types not listed here (entity pages: person/project/organization/tool/concept,
-- and the not-yet-existing reference type) keep halflife_days = NULL,
-- meaning "never auto-expires" — see spec §4.3.
UPDATE pages SET halflife_days = 90
  WHERE type IN ('decision', 'task', 'preference') OR type LIKE 'discovery-%';
UPDATE pages SET halflife_days = 365
  WHERE type = 'knowledge';
```

- [ ] **Step 4: Write the migration runner**

Create `src/store/migrations/index.ts`:

```typescript
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

function loadMigration(version: number, name: string): Migration {
  const filename = `${String(version).padStart(3, "0")}_${name}.sql`;
  const sql = readFileSync(join(__dirname, filename), "utf-8");
  return { version, name, sql };
}

// Add new migrations here, in ascending version order.
export const MIGRATIONS: Migration[] = [loadMigration(1, "lifecycle_columns")];

export async function runMigrations(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const applied = await pg.query<{ version: number }>("SELECT version FROM schema_migrations");
  const appliedVersions = new Set(applied.rows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    await pg.exec(migration.sql);
    await pg.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
  }
}
```

- [ ] **Step 5: Wire the runner into `Database.create()`**

Modify `src/store/database.ts`. Add the import and call `runMigrations` after the schema is loaded:

```typescript
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { runMigrations } from "./migrations/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class Database {
  private constructor(private _pg: PGlite) {}

  get pg(): PGlite {
    return this._pg;
  }

  static async create(dataDir?: string): Promise<Database> {
    const pg = new PGlite({
      dataDir,
      extensions: { vector },
    });

    const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
    await pg.exec(schema);
    await runMigrations(pg);

    return new Database(pg);
  }

  async close(): Promise<void> {
    await this._pg.close();
  }
}
```

- [ ] **Step 6: Add `halflife_days` to `schema.sql` so fresh databases get it in one shot**

Modify `src/store/schema.sql:3-15` — add the column to the `pages` table definition (the migration's `ADD COLUMN IF NOT EXISTS` becomes a no-op on fresh DBs, which is correct and safe):

```sql
CREATE TABLE IF NOT EXISTS pages (
  id              SERIAL PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  compiled_truth  TEXT NOT NULL DEFAULT '',
  frontmatter     JSONB NOT NULL DEFAULT '{}',
  content_hash    TEXT,
  halflife_days   INTEGER,
  search_vector   TSVECTOR,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run test -- tests/store/migrations.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 8: Run the existing database test suite to check for regressions**

Run: `bun run test -- tests/store/database.test.ts`
Expected: PASS — existing table-presence assertions still hold (migrations only add a column, they don't remove anything)

- [ ] **Step 9: Commit**

```bash
git add src/store/migrations/ src/store/database.ts src/store/schema.sql tests/store/migrations.test.ts
git commit -m "feat(store): add minimal migration runner + halflife_days column

Introduces a numbered-SQL migration runner (schema_migrations table +
ADD COLUMN IF NOT EXISTS pattern) so schema changes can land on existing
databases, not just fresh ones. Migration 001 adds pages.halflife_days
(drives Spec 2's hot/warm/cold rotation) and remaps legacy
discovery-preference pages to the new first-class preference type."
```

---

## Task 2: Extend `PageStore.putPage` to accept lifecycle metadata

This resolves **structural gap 1**: `putPage` currently has no way to write `halflife_days` (or any other real column beyond the fixed set). Extending it here establishes the pattern Spec 2 will reuse for `tier`/`expires_at`.

**Files:**
- Modify: `src/store/pages.ts:5-35` (interfaces), `:54-72` (`putPage`), `:135-149` (`rowToPage`)
- Modify: `tests/store/pages.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/store/pages.test.ts` (inside the existing `describe("PageStore", ...)`):

```typescript
  it("putPage accepts halflife_days and persists it as a real column", async () => {
    const content = "---\ntitle: Decision\ntype: decision\n---\nBody.";
    const page = await store.putPage("decisions/test-decision", content, { halflife_days: 90 });

    expect(page.halflife_days).toBe(90);

    const row = await db.pg.query<{ halflife_days: number | null }>(
      "SELECT halflife_days FROM pages WHERE slug = $1",
      ["decisions/test-decision"],
    );
    expect(row.rows[0].halflife_days).toBe(90);
  });

  it("putPage defaults halflife_days to NULL when not provided", async () => {
    const content = "---\ntitle: Entity\ntype: person\n---\nBody.";
    const page = await store.putPage("person/someone", content);

    expect(page.halflife_days).toBeNull();
  });

  it("putPage overwrites halflife_days on conflict with the newly provided value", async () => {
    const content = "---\ntitle: Decision\ntype: decision\n---\nBody.";
    await store.putPage("decisions/test-decision", content, { halflife_days: 90 });
    const updated = await store.putPage("decisions/test-decision", content, { halflife_days: 30 });

    expect(updated.halflife_days).toBe(30);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- tests/store/pages.test.ts`
Expected: FAIL — `page.halflife_days` is `undefined`, and the third test fails because `putPage` doesn't accept a third argument (TypeScript would also flag this at typecheck time)

- [ ] **Step 3: Extend the `Page`/`PageRow` interfaces and `putPage` signature**

Modify `src/store/pages.ts`. Add `halflife_days: number | null` to both `Page` and `PageRow` (after `content_hash`):

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
  created_at: string;
  updated_at: string;
}
```

```typescript
interface PageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  frontmatter: Record<string, unknown> | string;
  content_hash: string;
  halflife_days: number | null;
  created_at: string;
  updated_at: string;
}
```

Add a `PutPageOptions` interface above the class:

```typescript
export interface PutPageOptions {
  halflife_days?: number | null;
}
```

- [ ] **Step 4: Update `putPage` to accept and persist the option**

Replace the `putPage` method body (`src/store/pages.ts:54-72`):

```typescript
  async putPage(slug: string, content: string, opts?: PutPageOptions): Promise<Page> {
    const { title, type, compiled_truth, frontmatter } = parseMarkdownWithFrontmatter(content);
    const contentHash = createHash("sha256").update(content).digest("hex");
    const halflifeDays = opts?.halflife_days ?? null;

    const result = await this.pg.query<PageRow>(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter, content_hash, halflife_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (slug) DO UPDATE SET
         type = EXCLUDED.type,
         title = EXCLUDED.title,
         compiled_truth = EXCLUDED.compiled_truth,
         frontmatter = EXCLUDED.frontmatter,
         content_hash = EXCLUDED.content_hash,
         halflife_days = EXCLUDED.halflife_days,
         updated_at = NOW()
       RETURNING *`,
      [slug, type, title, compiled_truth, JSON.stringify(frontmatter), contentHash, halflifeDays],
    );
    return this.rowToPage(result.rows[0]);
  }
```

Note: callers that don't pass `halflife_days` get `NULL` written (and overwrite any existing value with `NULL` on conflict). This is intentional and safe — every write path for a *known signal type* will pass an explicit value (Task 3), so omitting it only happens for non-lifecycle pages (tests, `type='unknown'`, etc.) where `NULL` is correct.

- [ ] **Step 5: Update `rowToPage` to map the new column**

Modify `src/store/pages.ts:135-149`:

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
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun run test -- tests/store/pages.test.ts`
Expected: PASS — all `putPage` tests green, including the three new ones

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS — no type errors (this surfaces any other code that destructures `Page`/`PageRow` and might need updating; there shouldn't be any since `halflife_days` is additive)

- [ ] **Step 8: Commit**

```bash
git add src/store/pages.ts tests/store/pages.test.ts
git commit -m "feat(store): extend putPage to write lifecycle columns

putPage(slug, content) could only write a fixed column set, with no path
for the new halflife_days column. Adds an options parameter —
putPage(slug, content, { halflife_days }) — that includes lifecycle
metadata in the same upsert. This is the pattern Spec 2 will extend for
tier/expires_at/consolidated_into."
```

---

## Task 3: Stamp `halflife_days` in the four existing signal-write methods

This resolves **structural gap 2**: going forward, every newly-written decision/task/discovery/knowledge page needs `halflife_days` set per the spec's table (§4.3: decision=90, task=90, discovery-*=90, knowledge=365), or it silently stays `NULL` and Spec 2's rotation can never pick it up.

**Files:**
- Modify: `src/adapters/store.ts` (add a constant near the top of the class; modify 5 `putPage` call sites: `writeEntity`, `writeDecision`, `writeTask`, `writeDiscovery`, `writeKnowledge`)
- Modify: `tests/adapters/store.test.ts`

> **Note on the upcoming `user_edited` guard:** `origin/main` has merged an "H4" rule (not yet in this branch) where these same write methods early-return with `result.skipped += 1` if `existingPage?.frontmatter.user_edited === true`, to avoid clobbering pages a user hand-edited via Obsidian sync. That guard sits *before* the `putPage` call in each method. The `halflife_days` option you're adding here is passed *into* `putPage` at the same call site — when the H4 guard merges into this branch, it will naturally also skip the halflife stamping (the whole write is skipped), which is the correct behavior. No extra wiring needed; just don't reorder these methods so that halflife-stamping code runs before the existing `existingPage`/`source_hash` duplicate check.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `tests/adapters/store.test.ts` (alongside the existing `describe("push - decisions", ...)` etc.):

```typescript
  describe("halflife_days stamping", () => {
    it("stamps halflife_days=90 on newly written decision pages", async () => {
      const decision: Decision = {
        summary: "Adopt trunk-based development",
        entities: [],
        date: "2024-01-15",
        confidence: "direct",
        source: createSourceRef(),
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [],
          timeline: [],
          links: [],
          decisions: [decision],
          tasks: [],
          discoveries: [],
          knowledge: [],
          preferences: [],
          references: [],
        },
      ]);

      const page = await pages.getPage("decisions/adopt-trunk-based-development");
      expect(page?.halflife_days).toBe(90);
    });

    it("stamps halflife_days=90 on newly written task pages", async () => {
      const task: TaskSignal = {
        title: "Write onboarding doc",
        status: "open",
        source: createSourceRef(),
        confidence: "direct",
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [],
          timeline: [],
          links: [],
          decisions: [],
          tasks: [task],
          discoveries: [],
          knowledge: [],
          preferences: [],
          references: [],
        },
      ]);

      const page = await pages.getPage("tasks/write-onboarding-doc");
      expect(page?.halflife_days).toBe(90);
    });

    it("stamps halflife_days=90 on newly written discovery pages", async () => {
      const discovery: Discovery = {
        summary: "Local Docker DNS resolution is broken",
        type: "pattern",
        entities: [],
        source: createSourceRef(),
        confidence: "direct",
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [],
          timeline: [],
          links: [],
          decisions: [],
          tasks: [],
          discoveries: [discovery],
          knowledge: [],
          preferences: [],
          references: [],
        },
      ]);

      const page = await pages.getPage("discoveries/local-docker-dns-resolution-is-broken");
      expect(page?.halflife_days).toBe(90);
    });

    it("stamps halflife_days=365 on newly written knowledge pages", async () => {
      const knowledge: Knowledge = {
        topic: "feishu-api",
        content: "Feishu API global rate limit is 50 QPS",
        source_type: "document",
        related_entities: [],
        source: createSourceRef(),
        confidence: "direct",
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [],
          timeline: [],
          links: [],
          decisions: [],
          tasks: [],
          discoveries: [],
          knowledge: [knowledge],
          preferences: [],
          references: [],
        },
      ]);

      const all = await pages.listPages({ type: "knowledge" });
      expect(all).toHaveLength(1);
      expect(all[0].halflife_days).toBe(365);
    });

    it("stamps halflife_days=NULL (permanent) on newly written entity pages", async () => {
      const entity: Entity = {
        slug: "person/carol",
        name: "Carol",
        type: "person",
        context: "New team member",
        confidence: "direct",
      };
      await adapter.push([
        {
          source: createSourceRef(),
          entities: [entity],
          timeline: [],
          links: [],
          decisions: [],
          tasks: [],
          discoveries: [],
          knowledge: [],
          preferences: [],
          references: [],
        },
      ]);

      const page = await pages.getPage("person/carol");
      expect(page?.halflife_days).toBeNull();
    });
  });
```

> These tests reference `preferences: []` and `references: []` on `ExtractionResult` — they'll only typecheck once Task 4 adds those fields. That's fine: write this test now (it documents the target shape), but don't expect it to *compile* until Task 4 lands. If you're executing tasks strictly in order and the test file fails to typecheck here, that's the expected, temporary state — Step 2 below will show a type error rather than a runtime failure, which is still "fails for the right reason." Proceed to Step 3.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- tests/adapters/store.test.ts`
Expected: FAIL — either a TypeScript error (`Object literal may only specify known properties, and 'preferences' does not exist in type 'ExtractionResult'`) or, if your test runner is lenient about extra/missing fields, an assertion failure showing `halflife_days` is `null`/`undefined` instead of `90`/`365`. Either failure mode confirms the gap exists.

- [ ] **Step 3: Add the `HALFLIFE_DAYS` constant**

Modify `src/adapters/store.ts`. Add this near the top of the file, after the imports and before `export interface StoreAdapterContext`:

```typescript
// Per-type lifecycle defaults (Spec 1 §4.3). NULL = never auto-expires.
// Spec 2's Consolidator reads halflife_days to decide hot→warm timing.
const HALFLIFE_DAYS = {
  decision: 90,
  task: 90,
  discovery: 90,
  knowledge: 365,
  preference: 90,
  reference: null,
  entity: null,
} as const satisfies Record<string, number | null>;
```

- [ ] **Step 4: Pass `halflife_days` at each `putPage` call site**

In `writeEntity` (`src/adapters/store.ts`, the `putPage` call inside the `try` block — currently `const page = await this.stores.pages.putPage(entity.slug, content);`):

```typescript
      const page = await this.stores.pages.putPage(entity.slug, content, {
        halflife_days: HALFLIFE_DAYS.entity,
      });
```

In `writeDecision` (currently `const page = await this.stores.pages.putPage(slug, content);`):

```typescript
      const page = await this.stores.pages.putPage(slug, content, {
        halflife_days: HALFLIFE_DAYS.decision,
      });
```

In `writeTask`:

```typescript
      const page = await this.stores.pages.putPage(slug, content, {
        halflife_days: HALFLIFE_DAYS.task,
      });
```

In `writeDiscovery` (note: the page `type` is `discovery-${discovery.type}`, but halflife is uniform across all discovery subtypes per §4.3):

```typescript
      const page = await this.stores.pages.putPage(slug, content, {
        halflife_days: HALFLIFE_DAYS.discovery,
      });
```

In `writeKnowledge`:

```typescript
      const page = await this.stores.pages.putPage(slug, content, {
        halflife_days: HALFLIFE_DAYS.knowledge,
      });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test -- tests/adapters/store.test.ts`

This will likely still fail at this point — the new tests construct `ExtractionResult` objects with `preferences: []` and `references: []`, which don't exist on the type until Task 4. **This is expected.** Confirm the failure is specifically a type/shape error about `preferences`/`references`, not about `halflife_days` (the halflife assertions should already be correct in the implementation — you're just blocked from compiling the test file). Move on to Task 4, then return here.

- [ ] **Step 6: Commit (the implementation half; tests will go green after Task 4)**

```bash
git add src/adapters/store.ts tests/adapters/store.test.ts
git commit -m "feat(adapter): stamp halflife_days on signal pages at write time

The lifecycle migration backfills existing rows, but newly-created
decision/task/discovery/knowledge/entity pages also need halflife_days
set per spec §4.3 (90/90/90/365/NULL), or Spec 2's rotation can never
see them. Adds a HALFLIFE_DAYS lookup and threads it through putPage at
each write site.

Test assertions reference ExtractionResult.preferences/references which
land in the next commit (Spec 1 type system change) — expected to be
red until then."
```

---

## Task 4: Add `Preference` and `Reference` types + Zod schemas

**Files:**
- Modify: `src/core/types.ts` (Discovery, ExtractionResult, two new interfaces)
- Modify: `src/core/schemas.ts` (DiscoverySchema, ExtractionResultSchema, two new schemas)
- Modify: `tests/core/schemas.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/core/schemas.test.ts`:

```typescript
import { PreferenceSchema, ReferenceSchema } from "../../src/core/schemas.js";
```

(add this to the existing import block from `"../../src/core/schemas.js"` rather than as a separate statement)

Then add new `describe` blocks:

```typescript
describe("PreferenceSchema", () => {
  it("parses a valid preference", () => {
    const result = PreferenceSchema.parse({
      summary: "Prefers async communication over meetings",
      category: "communication",
      entities: ["person/alice"],
      source: {
        platform: "slack",
        channel: "#general",
        timestamp: "2026-06-01T10:00:00Z",
        raw_hash: "hash1",
        quote: "I'd rather we just write things down than meet",
      },
      confidence: "direct",
    });
    expect(result.category).toBe("communication");
    expect(result.entities).toEqual(["person/alice"]);
  });

  it("rejects an invalid category", () => {
    expect(() =>
      PreferenceSchema.parse({
        summary: "Likes pizza",
        category: "food", // not in the enum
        entities: [],
        source: {
          platform: "slack",
          channel: "#general",
          timestamp: "2026-06-01T10:00:00Z",
          raw_hash: "hash1",
          quote: "q",
        },
        confidence: "direct",
      }),
    ).toThrow();
  });
});

describe("ReferenceSchema", () => {
  it("parses a valid reference", () => {
    const result = ReferenceSchema.parse({
      title: "JWT Best Practices Guide",
      url: "https://example.com/jwt-guide",
      summary: "Covers token expiration and signing algorithm choices",
      trigger: "When implementing JWT-based auth",
      entities: ["tool/jwt"],
      source: {
        platform: "slack",
        channel: "#engineering",
        timestamp: "2026-06-01T10:00:00Z",
        raw_hash: "hash2",
        quote: "Check this out: https://example.com/jwt-guide",
      },
      confidence: "direct",
    });
    expect(result.url).toBe("https://example.com/jwt-guide");
    expect(result.trigger).toBe("When implementing JWT-based auth");
  });

  it("requires url and title", () => {
    expect(() =>
      ReferenceSchema.parse({
        summary: "A guide",
        entities: [],
        source: {
          platform: "slack",
          channel: "#general",
          timestamp: "2026-06-01T10:00:00Z",
          raw_hash: "hash2",
          quote: "q",
        },
        confidence: "direct",
      }),
    ).toThrow();
  });
});

describe("ExtractionResult schema with preferences and references", () => {
  it("accepts preferences and references arrays, defaulting to empty when absent", () => {
    const minimal = parseExtractionResult({
      source: {
        platform: "slack",
        channel: "#general",
        timestamp: "2026-06-01T10:00:00Z",
        raw_hash: "hash3",
        quote: "q",
      },
      entities: [],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
      knowledge: [],
    });
    expect(minimal.preferences).toEqual([]);
    expect(minimal.references).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- tests/core/schemas.test.ts`
Expected: FAIL — `PreferenceSchema`/`ReferenceSchema` are not exported from `schemas.js`

- [ ] **Step 3: Add `Preference` and `Reference` to `types.ts`, update `Discovery` and `ExtractionResult`**

Modify `src/core/types.ts`. First, narrow `Discovery.type` (remove `"preference"` — it's now a first-class type):

```typescript
export interface Discovery {
  summary: string;
  detail?: string;
  type: "procedure" | "pattern" | "insight" | "risk";
  entities: string[]; // slugs
  source: SourceRef;
  confidence: SignalConfidence;
}
```

Add two new interfaces directly after `Discovery`:

```typescript
export interface Preference {
  summary: string; // "偏好异步沟通，不喜欢临时会议"
  detail?: string;
  category: "communication" | "tooling" | "scheduling" | "workflow" | "other";
  entities: string[]; // slugs, usually a person
  source: SourceRef;
  confidence: SignalConfidence;
}

export interface Reference {
  title: string; // 文档标题
  url: string; // 核心字段
  summary: string; // ≤100 字摘要
  trigger?: string; // "遇到 Claude 安装问题时查阅"
  entities: string[]; // slugs
  source: SourceRef;
  confidence: SignalConfidence;
}
```

Update `ExtractionResult` to include the two new arrays:

```typescript
export interface ExtractionResult {
  source: SourceRef;
  entities: Entity[];
  timeline: TimelineEntry[];
  links: Link[];
  decisions: Decision[];
  tasks: TaskSignal[];
  discoveries: Discovery[];
  knowledge: Knowledge[];
  preferences: Preference[];
  references: Reference[];
  personAliases?: Record<string, string[]>;
}
```

- [ ] **Step 4: Add `PreferenceSchema` and `ReferenceSchema`, update `DiscoverySchema` and `ExtractionResultSchema`**

Modify `src/core/schemas.ts`. First, update `DiscoverySchema` — remove `"preference"` from the enum. While here, also add `"risk"`: it's already part of the `Discovery.type` TypeScript union (`types.ts`) but was missing from this Zod enum — a pre-existing mismatch that would silently reject any LLM output classified as `type: "risk"`. Fixing it now since we're touching this exact line:

```typescript
export const DiscoverySchema = z.object({
  summary: z.string(),
  detail: z.string().optional(),
  type: z.enum(["procedure", "pattern", "insight", "risk"]),
  entities: z.array(z.string()), // slugs
  source: SourceRefSchema,
  confidence: SignalConfidenceSchema,
});
```

Add `PreferenceSchema` and `ReferenceSchema` directly after `DiscoverySchema`:

```typescript
export const PreferenceSchema = z.object({
  summary: z.string(),
  detail: optionalString,
  category: z.enum(["communication", "tooling", "scheduling", "workflow", "other"]),
  entities: z.array(z.string()),
  source: SourceRefSchema,
  confidence: SignalConfidenceSchema,
});

export const ReferenceSchema = z.object({
  title: z.string(),
  url: z.string(),
  summary: z.string(),
  trigger: optionalString,
  entities: z.array(z.string()),
  source: SourceRefSchema,
  confidence: SignalConfidenceSchema,
});
```

Update `ExtractionResultSchema` to include the two new arrays, defaulting to `[]` so older LLM outputs (or hand-written test fixtures) that omit them still validate — matching the existing `knowledge: z.array(KnowledgeSchema).default([])` pattern:

```typescript
export const ExtractionResultSchema = z.object({
  source: SourceRefSchema,
  entities: z.array(EntitySchema),
  timeline: z.array(TimelineEntrySchema),
  links: z.array(LinkSchema),
  decisions: z.array(DecisionSchema),
  tasks: z.array(TaskSignalSchema),
  discoveries: z.array(DiscoverySchema),
  knowledge: z.array(KnowledgeSchema).default([]),
  preferences: z.array(PreferenceSchema).default([]),
  references: z.array(ReferenceSchema).default([]),
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun run test -- tests/core/schemas.test.ts`
Expected: PASS — all new `describe` blocks green

- [ ] **Step 6: Run the Task 3 store-adapter tests — they should now compile and pass**

Run: `bun run test -- tests/adapters/store.test.ts`
Expected: PASS — the `halflife_days stamping` tests from Task 3 now typecheck (since `ExtractionResult` has `preferences`/`references`) and assert correctly

- [ ] **Step 7: Typecheck the whole project**

Run: `bun run typecheck`
Expected: PASS. If it fails, the error will point at other code constructing `ExtractionResult` or `Discovery` literals that need updating for the new/changed shape (e.g., test fixtures elsewhere, golden-test loaders). Fix any such call sites by adding `preferences: []`/`references: []` and removing any `type: "preference"` discovery literals.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/core/schemas.ts tests/core/schemas.test.ts
git commit -m "feat(types): promote preference to first-class type, add reference type

Discovery.type drops 'preference' (promoted to its own Preference
interface/page type) and gains the previously-missing 'risk' value in
its Zod schema (types.ts already declared it; schemas.ts didn't accept
it — pre-existing mismatch fixed while touching this enum).

Adds Preference and Reference to ExtractionResult, with Zod schemas
defaulting to empty arrays so existing fixtures/LLM outputs that omit
them remain valid."
```

---

## Task 5: Update extractor prompts to emit `preferences[]` and `references[]`

**Files:**
- Modify: `src/extractors/prompts/signal-extract.md`
- Modify: `src/extractors/prompts/examples/agent-session.md`

There's no separate "prompt test" — these are LLM-facing markdown files validated by the golden example staying internally consistent and by extraction quality in practice. The check here is: does the schema block match `types.ts`/`schemas.ts`, and does the worked example reflect correct (non-fabricated) output for its input?

- [ ] **Step 1: Update the `ExtractionResult` interface block in the prompt**

Modify `src/extractors/prompts/signal-extract.md:8-17` — add the two new array fields:

```typescript
interface ExtractionResult {
  source: SourceRef;
  entities: Entity[];
  timeline: TimelineEntry[];
  links: Link[];
  decisions: Decision[];
  tasks: TaskSignal[];
  discoveries: Discovery[];
  knowledge: Knowledge[];
  preferences: Preference[];
  references: Reference[];
}
```

- [ ] **Step 2: Update the `Discovery` interface block and add `Preference`/`Reference` interface blocks**

Modify `src/extractors/prompts/signal-extract.md:82-89` — remove `'preference'` from `Discovery.type`:

```typescript
interface Discovery {
  summary: string;           // Brief insight
  detail?: string;           // Extended explanation
  type: 'procedure' | 'pattern' | 'insight' | 'risk';
  entities: string[];        // Slugs of related entities
  source: SourceRef;
  confidence: 'direct' | 'paraphrased' | 'inferred' | 'speculative';
}
```

Add two new interface blocks directly after the existing `Knowledge` interface (after line 99, before the closing ` ``` `):

```typescript
interface Preference {
  summary: string;            // "Prefers async communication over meetings"
  detail?: string;            // Extended explanation
  category: 'communication' | 'tooling' | 'scheduling' | 'workflow' | 'other';
  entities: string[];         // Slugs, usually a person
  source: SourceRef;
  confidence: 'direct' | 'paraphrased' | 'inferred' | 'speculative';
}

interface Reference {
  title: string;              // Document/resource title
  url: string;                // The resource URL — must appear in source text
  summary: string;            // ≤100 chars: what the resource is about
  trigger?: string;           // When this would be useful to recall later
  entities: string[];         // Slugs of related entities
  source: SourceRef;
  confidence: 'direct' | 'paraphrased' | 'inferred' | 'speculative';
}
```

- [ ] **Step 3: Add extraction guidance for Preference vs Discovery, and for References**

Modify `src/extractors/prompts/signal-extract.md` — insert these two new sections directly after the existing "### Knowledge vs Decision" section (after line ~157, before "### Knowledge source_type"):

```markdown
### Preference vs Discovery

Preference (偏好): An explicit personal/team statement about how someone likes to work
  ✓ "I prefer async communication over meetings"
  ✓ "We always write tests before implementation" (framed as standing practice)
  ✓ "I don't like being pinged after 6pm"

Discovery-procedure (发现-流程): A how-to insight observed or recommended in the moment,
not framed as someone's standing preference
  ✓ "Document architectural decisions before implementation" (a recommendation, not "I always do X")

Rules:
  1. Explicitly framed as "I/we prefer/like/always do X" with a clear subject? → Preference
  2. A one-off recommendation or observed practice without standing-preference framing? → Discovery
  3. If uncertain, prefer Discovery (conservative — Preference requires explicit personal framing)

### Preference category

- `communication`: sync/async style, channels, tone, responsiveness expectations
- `tooling`: preferred editors, libraries, tools, tool-related workflows
- `scheduling`: time-of-day habits, meeting patterns, availability
- `workflow`: process/practice preferences not covered above (review style, docs habits)
- `other`: doesn't fit the above

### References

A reference is a bookmark **with context** — a shared resource plus enough information
for an Agent to know when it would be useful to recall later.

Extract a Reference when:
  ✓ A message shares a URL/doc/named resource AND gives enough context to fill in `summary`
  ✓ "Check this out: https://example.com/jwt-guide — covers token rotation" → Reference

Do NOT extract a Reference when:
  ✗ A bare URL with no surrounding context (nothing to put in `summary`/`trigger`)
  ✗ The shared content IS the substance of the conversation — extract that as
    Knowledge/Decision/Discovery instead; References are for bookmarks, not the discussion itself

Reference field rules:
  - `url`: must appear verbatim in the source text — never fabricate or guess a URL
  - `summary`: ≤100 chars, what the resource covers
  - `trigger`: when recalling this would help (e.g., "当排查 JWT 过期问题时")
```

- [ ] **Step 4: Add `preferences: []` and `references: []` to the golden example output**

Modify `src/extractors/prompts/examples/agent-session.md`. The example conversation contains no shared links and no explicit personal-preference statements (the closest candidate — "I'll document the decision in the wiki before implementing" — is correctly classified as a `discovery.type=procedure` recommendation, not a standing preference; don't duplicate it as a Preference). The **correct** extraction is therefore empty arrays for both — add them as the last two keys of the output JSON object, right after the `knowledge` array (which currently closes the object):

```json
  "knowledge": [
    {
      "topic": "jwt-token-expiration",
      "content": "Access tokens should be short-lived (minutes to hours) while refresh tokens can be longer-lived (days to weeks) to balance security with user experience",
      "source_type": "teaching",
      "related_entities": ["tool/jwt", "concept/refresh-tokens"],
      "source": {
        "platform": "slack",
        "channel": "#engineering",
        "timestamp": "2024-01-15T10:03:45Z",
        "thread_id": "thread-auth-migration",
        "raw_hash": "abc123def456",
        "quote": "Yes, 7-day access tokens and 30-day refresh tokens."
      },
      "confidence": "paraphrased"
    }
  ],
  "preferences": [],
  "references": []
}
```

- [ ] **Step 5: Add a Key Takeaway noting the new fields**

Modify `src/extractors/prompts/examples/agent-session.md` — append to the "Key Takeaways from This Example" list:

```markdown
11. **Preferences and references**: Always include both arrays even when empty — this conversation has no shared links and no explicit standing-preference statements (the wiki-documentation comment is a one-off recommendation, correctly classified as `discovery.type=procedure`, not duplicated as a preference)
```

- [ ] **Step 6: Verify no test depends on prompt file content directly**

Run: `bun run test -- tests/extractors/`
Expected: PASS — these markdown files are loaded as prompt text at runtime, not parsed/validated by tests. This step confirms nothing breaks from the edits (e.g., a test that loads and string-matches the prompt).

- [ ] **Step 7: Commit**

```bash
git add src/extractors/prompts/
git commit -m "docs(extractor): teach the prompt to emit preferences[] and references[]

Adds Preference/Reference interfaces and extraction guidance (when to
classify something as a standing preference vs. a one-off discovery,
when a shared link qualifies as a reference vs. is the substance of the
conversation). Updates the golden example to include both new arrays
(correctly empty for this conversation — no fabricated signals)."
```

---

## Task 6: StoreAdapter — `writePreference`/`writeReference` + wire into `push()`

**Files:**
- Modify: `src/adapters/store.ts` (two new private methods, `push()` dispatcher, imports)
- Modify: `tests/adapters/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add new `describe` blocks to `tests/adapters/store.test.ts`:

```typescript
  describe("push - preferences", () => {
    it("should write preference page with category tag, entity link, and halflife", async () => {
      await pages.putPage(
        "person/dave",
        "---\ntitle: Dave\ntype: person\n---\n## Context\nDave context",
      );

      const preference: Preference = {
        summary: "Prefers async communication over meetings",
        detail: "Said this explicitly when scheduling was discussed",
        category: "communication",
        entities: ["person/dave"],
        source: createSourceRef(),
        confidence: "direct",
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
        preferences: [preference],
        references: [],
      };

      const pushResult = await adapter.push([result]);
      expect(pushResult.written).toBe(1);

      const slug = "preferences/prefers-async-communication-over-meetings";
      const page = await pages.getPage(slug);
      expect(page).not.toBeNull();
      expect(page?.type).toBe("preference");
      expect(page?.halflife_days).toBe(90);
      expect(page?.frontmatter.category).toBe("communication");

      const pageTags = await tagsStore.getTags(slug);
      expect(pageTags).toContain("preference");
      expect(pageTags).toContain("communication");

      const links = await graph.getLinks(slug);
      expect(links.some((l) => l.to_slug === "person/dave" && l.link_type === "mentions")).toBe(
        true,
      );
    });

    it("should skip duplicate preference with same source_hash", async () => {
      const sourceRef = createSourceRef();
      const preference: Preference = {
        summary: "Likes written specs over verbal handoffs",
        category: "workflow",
        entities: [],
        source: sourceRef,
        confidence: "direct",
      };
      const result: ExtractionResult = {
        source: sourceRef,
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
        preferences: [preference],
        references: [],
      };

      const first = await adapter.push([result]);
      expect(first.written).toBe(1);

      const second = await adapter.push([result]);
      expect(second.skipped).toBe(1);
      expect(second.written).toBe(0);
    });
  });

  describe("push - references", () => {
    it("should write reference page with url in frontmatter, entity link, and permanent halflife", async () => {
      await pages.putPage(
        "tool/jwt",
        "---\ntitle: JWT\ntype: tool\n---\n## Context\nJWT context",
      );

      const reference: Reference = {
        title: "JWT Best Practices Guide",
        url: "https://example.com/jwt-guide",
        summary: "Covers token expiration and signing algorithm choices",
        trigger: "When implementing JWT-based auth",
        entities: ["tool/jwt"],
        source: createSourceRef(),
        confidence: "direct",
      };

      const result: ExtractionResult = {
        source: createSourceRef(),
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [],
        knowledge: [],
        preferences: [],
        references: [reference],
      };

      const pushResult = await adapter.push([result]);
      expect(pushResult.written).toBe(1);

      const slug = "references/jwt-best-practices-guide";
      const page = await pages.getPage(slug);
      expect(page).not.toBeNull();
      expect(page?.type).toBe("reference");
      expect(page?.halflife_days).toBeNull(); // permanent
      expect(page?.frontmatter.url).toBe("https://example.com/jwt-guide");
      expect(page?.frontmatter.trigger).toBe("When implementing JWT-based auth");

      const pageTags = await tagsStore.getTags(slug);
      expect(pageTags).toContain("reference");

      const links = await graph.getLinks(slug);
      expect(links.some((l) => l.to_slug === "tool/jwt" && l.link_type === "mentions")).toBe(true);
    });
  });
```

> Adjust `tagsStore`/`graph` references to whatever the existing test file's local variable names are — check the `beforeEach` block (it declares `tags`, `graph`, etc., so use `tags.getTags(slug)` not `tagsStore.getTags(slug)`). Match the existing test file's variable names exactly; the snippet above uses `tagsStore` as a placeholder — replace with `tags`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test -- tests/adapters/store.test.ts`
Expected: FAIL — `pushResult.written` is `0` (preferences/references arrays are iterated by nothing in `push()`, and `writePreference`/`writeReference` don't exist)

- [ ] **Step 3: Add `Preference`/`Reference` to the imports**

Modify `src/adapters/store.ts` — add `Preference` and `Reference` to the type-only import block from `"../core/types.js"`:

```typescript
import type {
  Adapter,
  AdapterPushResult,
  Decision,
  Discovery,
  Entity,
  ExtractionResult,
  Knowledge,
  Link,
  Preference,
  Reference,
  SourceRef,
  TaskSignal,
  TimelineEntry,
} from "../core/types.js";
```

- [ ] **Step 4: Implement `writePreference`**

Add this private method to `StoreAdapter`, near `writeDiscovery` (they're structurally similar):

```typescript
  private async writePreference(preference: Preference): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const slug = `preferences/${this.kebabCase(preference.summary)}`;
      const sourceHash = preference.source.raw_hash;

      const existingPage = await this.stores.pages.getPage(slug);
      if (existingPage && existingPage.frontmatter.source_hash === sourceHash) {
        result.skipped += 1;
        return result;
      }

      const frontmatter = {
        title: preference.summary,
        type: "preference",
        category: preference.category,
        entities: preference.entities,
        confidence: preference.confidence,
        source_hash: sourceHash,
        source: preference.source,
        created_at: new Date().toISOString(),
      };

      const parts: string[] = [`# ${preference.summary}`, ""];
      if (preference.detail) {
        parts.push("## Detail", "", preference.detail, "");
      }

      const content = `---
${yamlStringify(frontmatter).trimEnd()}
---

${parts.join("\n")}`;

      const page = await this.stores.pages.putPage(slug, content, {
        halflife_days: HALFLIFE_DAYS.preference,
      });

      this.notifyPageWritten(page);
      await this.stores.chunks.rechunk(page.id, page.compiled_truth);
      await this.stores.tags.addTag(slug, "preference");
      await this.stores.tags.addTag(slug, preference.category);

      for (const entitySlug of preference.entities) {
        await this.stores.graph.addLink(
          slug,
          entitySlug,
          "mentions",
          "Referenced in preference",
          preference.source,
          sourceHash,
        );
      }

      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `preference:${preference.summary}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }
```

- [ ] **Step 5: Implement `writeReference`**

Add this private method directly after `writePreference`:

```typescript
  private async writeReference(reference: Reference): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const slug = `references/${this.kebabCase(reference.title)}`;
      const sourceHash = reference.source.raw_hash;

      const existingPage = await this.stores.pages.getPage(slug);
      if (existingPage && existingPage.frontmatter.source_hash === sourceHash) {
        result.skipped += 1;
        return result;
      }

      const frontmatter: Record<string, unknown> = {
        title: reference.title,
        type: "reference",
        url: reference.url,
        entities: reference.entities,
        confidence: reference.confidence,
        source_hash: sourceHash,
        source: reference.source,
        created_at: new Date().toISOString(),
      };
      if (reference.trigger) frontmatter.trigger = reference.trigger;

      const parts = [
        `# ${reference.title}`,
        "",
        `URL: ${reference.url}`,
        "",
        "## Summary",
        "",
        reference.summary,
        "",
      ];

      const content = `---
${yamlStringify(frontmatter).trimEnd()}
---

${parts.join("\n")}`;

      const page = await this.stores.pages.putPage(slug, content, {
        halflife_days: HALFLIFE_DAYS.reference,
      });

      this.notifyPageWritten(page);
      await this.stores.chunks.rechunk(page.id, page.compiled_truth);
      await this.stores.tags.addTag(slug, "reference");

      for (const entitySlug of reference.entities) {
        await this.stores.graph.addLink(
          slug,
          entitySlug,
          "mentions",
          "Referenced in reference",
          reference.source,
          sourceHash,
        );
      }

      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `reference:${reference.title}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }
```

- [ ] **Step 6: Wire both into the `push()` dispatcher**

Modify `src/adapters/store.ts` — in `push()`, add two new loops directly after the existing "Process Knowledge" block and before "Process Timeline Entries":

```typescript
      // Process Preferences
      for (const preference of result.preferences) {
        const writeResult = await this.writePreference(preference);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process References
      for (const reference of result.references) {
        const writeResult = await this.writeReference(reference);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun run test -- tests/adapters/store.test.ts`
Expected: PASS — all `push - preferences` and `push - references` tests green, plus everything from Tasks 3/4 still green

- [ ] **Step 8: Run the full test suite**

Run: `bun run test`
Expected: PASS — no regressions anywhere (existing decision/task/discovery/knowledge/entity tests untouched in behavior, only gaining a `halflife_days` value)

- [ ] **Step 9: Typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/adapters/store.ts tests/adapters/store.test.ts
git commit -m "feat(adapter): write preference and reference pages

Adds writePreference/writeReference following the existing
writeDiscovery/writeDecision pattern: page + chunks + tags + entity
anchoring via graph.addLink. Preferences get a category tag and
halflife=90; references store the URL in frontmatter and get
halflife=NULL (permanent — dead-link detection lands in Spec 2).
Wires both into the push() dispatcher."
```

---

## Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `bun run test`
Expected: PASS — every test file green, including all new ones from Tasks 1–6

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS — zero type errors

- [ ] **Step 3: Run lint**

Run: `bun run lint`
Expected: PASS, or only pre-existing warnings unrelated to your changes. Fix anything flagged in files you touched.

- [ ] **Step 4: Manually verify migration idempotency on a real on-disk database**

This simulates upgrading an existing user's database — the scenario the migration runner exists for.

Write the check scripts to temp files first (avoids fighting bash/SQL/JS quoting all at once with inline `-e`):

```bash
rm -rf /tmp/memoark-migration-check

cat > /tmp/migration-check-1.mjs <<'EOF'
import { Database } from "/home/user/memoark/src/store/database.js";
const db = await Database.create("/tmp/memoark-migration-check");
await db.pg.query(
  "INSERT INTO pages (slug, type, title, compiled_truth) VALUES ($1, $2, $3, $4)",
  ["discoveries/old-pref-manual", "discovery-preference", "Manual test", "x"],
);
await db.close();
EOF

cat > /tmp/migration-check-2.mjs <<'EOF'
import { Database } from "/home/user/memoark/src/store/database.js";
const db = await Database.create("/tmp/memoark-migration-check");
const r = await db.pg.query("SELECT version FROM schema_migrations");
console.log("schema_migrations:", r.rows);
const p = await db.pg.query(
  "SELECT slug, type, halflife_days FROM pages WHERE slug LIKE $1",
  ["%old-pref%"],
);
console.log("remapped page:", p.rows);
await db.close();
EOF

bun /tmp/migration-check-1.mjs
# Re-open the same on-disk database — migrations must detect "already applied" and skip,
# while still being able to act on rows that existed before the FIRST run picked them up
bun /tmp/migration-check-2.mjs

rm -rf /tmp/memoark-migration-check /tmp/migration-check-1.mjs /tmp/migration-check-2.mjs
```

Expected: `schema_migrations` shows exactly one row with `version: 1` (not duplicated across the two `Database.create()` calls), and the manually-inserted `discovery-preference` row... 

**Note:** the second invocation won't re-remap that row, because migration 1 already ran (and recorded) on the first invocation, before the row was inserted via raw SQL outside the migration's `UPDATE`. This is expected and correct idempotent behavior — re-running migrations must NOT re-apply already-applied versions, even if doing so would "fix" data inserted out-of-band afterward. To verify the *remapping* behavior specifically (as opposed to idempotency), rely on the `migrations.test.ts` tests from Task 1, which insert the legacy row *before* calling `runMigrations`. This manual step is purely to confirm that **re-opening an existing on-disk database doesn't error, hang, or duplicate migration records** — print the `schema_migrations` row count and confirm it's `1`.

- [ ] **Step 5: Manually smoke-test extraction with the new types** (optional — requires a configured LLM provider; skip if running in an environment without one)

```bash
bun src/cli.ts extract --dry-run --input "Hey, I prefer we just write decisions down instead of having a sync meeting about them. Also check this out: https://example.com/some-guide — it's got a good rundown of the deploy process."
```

Expected: the dry-run output's `preferences` array contains one entry (category likely `workflow` or `communication`) and `references` contains one entry with `url: "https://example.com/some-guide"`. If your environment has no LLM provider configured, skip this step — Tasks 1–6's automated tests already cover the storage/validation path end-to-end with hand-built `ExtractionResult` fixtures.

- [ ] **Step 6: Confirm acceptance criteria from the spec (§十)**

Walk through spec `docs/superpowers/specs/2026-06-04-spec1-signal-types-entity-architecture.md` §十 line by line and confirm each is satisfied by the work in Tasks 1–6:

1. `bun run typecheck` passes ✓ (Step 2 above)
2. `bun test` passes ✓ (Step 1 above)
3. Migration runner ran on an existing DB, `pages.halflife_days` exists, `schema_migrations` has version 1 ✓ (Task 1 tests + Step 4 above)
4. Idempotent re-run ✓ (Task 1 `migrations.test.ts`, "is idempotent" test)
5. New extraction can produce `type='preference'`/`type='reference'` pages anchored via links ✓ (Task 6 tests)
6. `graph.getBacklinks('project/memoark')` returns decision/preference/reference pages ✓ (covered structurally by Task 6's `graph.getLinks` assertions — anchoring goes through the same `addLink` mechanism as decisions/knowledge, which is already tested elsewhere)
7. Existing `discovery-preference` pages migrated to `preference` type ✓ (Task 1 `migrations.test.ts`, "remaps discovery-preference" test)

- [ ] **Step 7: Final commit (if any cleanup was needed in Steps 3 or 6)**

Only commit if you made changes during verification (e.g., lint fixes). If everything passed cleanly, there's nothing to commit here — Task 6's commit is the final substantive change.

```bash
git add -A
git commit -m "chore: lint fixes from Spec 1 verification pass"
```

(Skip this commit entirely if there's nothing to add.)

---

## Summary of what this plan does NOT do (intentionally — see spec §九 Out of Scope)

- No `tier`/`expires_at`/`consolidated_into` columns or hot/warm/cold rotation → Spec 2
- No Consolidator, dead-link detection, or raw-content TTL → Spec 2
- No cross-message preference inference (e.g., "80% of meetings at 2pm") → Spec 2 Consolidator
- No `get_session_context`/`list_signals_by_entity`/`get_entity_profile` MCP tools → Spec 3
- No merge of `discovery` and `knowledge` types → explicitly deferred (YAGNI, spec §九)
- No new entity types beyond the existing 5 → explicitly deferred (spec §九)
