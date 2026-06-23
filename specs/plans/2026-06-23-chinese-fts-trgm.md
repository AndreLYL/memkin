# Chinese FTS via pg_trgm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `to_tsvector('simple')` lexical search leg with `pg_trgm` GIN + `ILIKE` substring matching so Chinese full-text search actually works.

**Architecture:** Load PGLite's bundled `pg_trgm` extension; add GIN trigram indexes on `pages.title`, `pages.compiled_truth`, `content_chunks.chunk_text`; rewrite the two FTS legs in `src/store/search.ts` (`search()` and `ftsChunkSearch()`) to AND-of-`ILIKE` recall + `similarity()` ranking; drop the old tsvector columns/triggers/indexes via a migration. Vector leg and RRF fusion untouched.

**Tech Stack:** TypeScript, Bun, PGLite (`@electric-sql/pglite` 0.4.6) with `pg_trgm` + `vector`, Vitest.

**Spec:** `specs/2026-06-23-chinese-fts-trgm.md` · **Review:** `specs/reviews/2026-06-23-chinese-fts-trgm-review.md`

## Global Constraints

- **Base on latest `main`** (currently `8311a09`; main is moving — rebase the impl branch onto it before starting). The impl branch is `claude/repo-status-background-agzw08`.
- **Migration version = next free integer.** Current max is **5** (`person_behavior`), so the new migration is **version 6**. If main advanced and added a 6, use 7, and update the test assertion accordingly.
- **No re-extraction / re-embedding.** Trigram indexes build on existing text columns; the `embedding`/vector leg is not touched.
- **Two FTS entry points** in `src/store/search.ts` — `search()` (FTS-only, non-RRF; raw score is user-facing) and `ftsChunkSearch()` (feeds RRF). Both must be rewritten; do not change `vectorSearch()`.
- **`--mode fts` is recall-only.** `similarity()` scores for short Chinese queries are ~0.0–0.2; ranking quality is explicitly out of scope. Use a deterministic tiebreaker so order is stable.
- **Highlight marker is `**…**`** (matches the old `ts_headline` StartSel/StopSel; downstream `highlights` + UI depend on it).
- **Schema lives twice:** `src/store/schema.sql` AND the inlined constant `src/embedded-assets.generated.ts` (note `src/`, not `src/store/`). After editing `schema.sql`, run `bun run gen:assets`.
- **Run after each task:** `bun run typecheck` and `bun run lint` must stay green.

---

### Task 1: Load `pg_trgm` into PGLite (dev + compiled wiring)

**Files:**
- Modify: `src/store/pglite-assets.ts:29-31` (dev branch) and `:39-47` (compiled branch)
- Modify: `scripts/build-sidecar.mjs:20` (Tauri sidecar asset list)
- Test: `tests/store/pglite-assets.test.ts` (create if absent) + a DB-level extension smoke test in `tests/store/migrations.test.ts`

**Interfaces:**
- Produces: `buildPGliteOptions(dataDir, opts)` returns `extensions` that include `pg_trgm` in both branches, so `CREATE EXTENSION pg_trgm` succeeds at DB init.

- [ ] **Step 1: Write the failing test** — `pg_trgm` is loadable in the dev path.

Create `tests/store/pglite-assets.test.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite/vector";
import { describe, expect, it } from "vitest";

describe("pg_trgm availability", () => {
  it("loads pg_trgm and supports ILIKE substring + similarity on Chinese", async () => {
    const pg = new PGlite({ extensions: { vector, pg_trgm } });
    await pg.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
    await pg.exec("CREATE TABLE t (body text); INSERT INTO t VALUES ('讨论了认证中间件的重构');");
    const hit = await pg.query<{ c: number }>("SELECT count(*)::int AS c FROM t WHERE body ILIKE '%' || $1 || '%'", ["中间件"]);
    expect(hit.rows[0].c).toBe(1);
    const sim = await pg.query<{ s: number }>("SELECT similarity($1, body) AS s FROM t", ["认证中间件"]);
    expect(Number(sim.rows[0].s)).toBeGreaterThan(0);
    await pg.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run tests/store/pglite-assets.test.ts`
Expected: FAIL — `Cannot find module '@electric-sql/pglite/contrib/pg_trgm'` is NOT expected (the module exists); if it fails it will be a runtime extension-load error. (If it already passes, that only proves the raw extension works; continue to wire it into `buildPGliteOptions`.)

- [ ] **Step 3: Wire `pg_trgm` into the dev branch of `buildPGliteOptions`**

In `src/store/pglite-assets.ts`, add the import after line 4:

```ts
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
```

Replace the dev branch (lines 29-31):

```ts
  if (!compiled) {
    return { dataDir, extensions: { vector: stockVector, pg_trgm } };
  }
```

- [ ] **Step 4: Wire `pg_trgm` blob into the compiled branch**

In the compiled branch, after the `vector` object (line 46) and before the `return` (line 47), add:

```ts
  const pgTrgmBundleURL = new URL("file://" + asset("pg_trgm.tar.gz"));
  const pg_trgm = {
    name: "pg_trgm",
    setup: async (_pg: unknown, em: unknown) => ({
      emscriptenOpts: em,
      bundlePath: pgTrgmBundleURL,
    }),
  };
  return { dataDir, pgliteWasmModule, initdbWasmModule, fsBundle, extensions: { vector, pg_trgm } };
```

(Delete the old `return { ... extensions: { vector } }` on line 47.)

- [ ] **Step 5: Stage `pg_trgm.tar.gz` for the Tauri sidecar**

In `scripts/build-sidecar.mjs`, line 20, add `"pg_trgm.tar.gz"` to the copy list:

```js
for (const f of ["pglite.wasm", "initdb.wasm", "pglite.data", "vector.tar.gz", "pg_trgm.tar.gz"]) {
```

- [ ] **Step 6: Run test + typecheck**

Run: `bunx vitest run tests/store/pglite-assets.test.ts && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/store/pglite-assets.ts scripts/build-sidecar.mjs tests/store/pglite-assets.test.ts
git commit -m "feat(search): load pg_trgm extension (dev + compiled + sidecar)"
```

---

### Task 2: Trigram query helpers (pure functions)

**Files:**
- Create: `src/store/trgm-search.ts`
- Test: `tests/store/trgm-search.test.ts`

**Interfaces:**
- Produces:
  - `splitTerms(query: string): string[]` — whitespace split, drops empties, keeps intra-term chars.
  - `escapeIlikeTerm(term: string): string` — escapes `\` then `%` then `_`.
  - `buildTrgmConditions(terms: string[], columns: string[], params: unknown[]): string | null` — pushes one `%term%` param per term, returns the AND-of-OR `ILIKE ... ESCAPE '\'` SQL fragment, or `null` if `terms` is empty.
  - `buildSnippet(text: string, terms: string[], window?: number): string` — case-insensitive `**`-wrapped snippet around the first match.

- [ ] **Step 1: Write the failing tests**

Create `tests/store/trgm-search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSnippet, buildTrgmConditions, escapeIlikeTerm, splitTerms } from "../../src/store/trgm-search.js";

describe("splitTerms", () => {
  it("splits on whitespace, keeps intra-term chars", () => {
    expect(splitTerms("  刷新  gpt-4 ")).toEqual(["刷新", "gpt-4"]);
  });
  it("returns [] for empty/whitespace", () => {
    expect(splitTerms("   ")).toEqual([]);
  });
});

describe("escapeIlikeTerm", () => {
  it("escapes backslash first, then % and _", () => {
    expect(escapeIlikeTerm("a\\b%c_d")).toBe("a\\\\b\\%c\\_d");
  });
  it("leaves CJK and hyphen untouched", () => {
    expect(escapeIlikeTerm("中间件-x")).toBe("中间件-x");
  });
});

describe("buildTrgmConditions", () => {
  it("ANDs one OR-group per term and pushes %term% params", () => {
    const params: unknown[] = [];
    const sql = buildTrgmConditions(["刷新", "token"], ["p.title", "p.compiled_truth"], params);
    expect(sql).toBe(
      "(p.title ILIKE $1 ESCAPE '\\' OR p.compiled_truth ILIKE $1 ESCAPE '\\') AND " +
        "(p.title ILIKE $2 ESCAPE '\\' OR p.compiled_truth ILIKE $2 ESCAPE '\\')",
    );
    expect(params).toEqual(["%刷新%", "%token%"]);
  });
  it("returns null for no terms", () => {
    expect(buildTrgmConditions([], ["p.title"], [])).toBeNull();
  });
  it("offsets param indices by existing params", () => {
    const params: unknown[] = ["preexisting"];
    const sql = buildTrgmConditions(["x"], ["cc.chunk_text"], params);
    expect(sql).toBe("(cc.chunk_text ILIKE $2 ESCAPE '\\')");
    expect(params).toEqual(["preexisting", "%x%"]);
  });
});

describe("buildSnippet", () => {
  it("wraps first case-insensitive match in ** and adds ellipses", () => {
    const text = "前面一些上下文，这里讨论了认证中间件的重构决策，后面还有很多内容".repeat(1);
    const s = buildSnippet(text, ["认证中间件"], 6);
    expect(s).toContain("**认证中间件**");
  });
  it("is case-insensitive for ASCII", () => {
    expect(buildSnippet("hello GPT-4 world", ["gpt-4"])).toContain("**GPT-4**");
  });
  it("returns leading slice when no term matches", () => {
    expect(buildSnippet("abcdef", ["zzz"], 2)).toBe("abcd");
  });
  it("returns empty string for empty text", () => {
    expect(buildSnippet("", ["x"])).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run tests/store/trgm-search.test.ts`
Expected: FAIL — `Cannot find module '.../trgm-search.js'`.

- [ ] **Step 3: Implement the helpers**

Create `src/store/trgm-search.ts`:

```ts
/** Split a query into terms on whitespace; drop empties. Intra-term chars (e.g. "gpt-4") are kept. */
export function splitTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

/** Escape ILIKE wildcards for use with `ESCAPE '\'`. Order matters: backslash first. */
export function escapeIlikeTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Build an AND-of-OR `ILIKE` fragment for trigram substring recall across `columns`.
 * Pushes one `%term%` param per term into `params` (continuing from its current length)
 * and returns the SQL fragment, or null if there are no terms.
 */
export function buildTrgmConditions(
  terms: string[],
  columns: string[],
  params: unknown[],
): string | null {
  if (terms.length === 0) return null;
  const groups: string[] = [];
  for (const term of terms) {
    params.push(`%${escapeIlikeTerm(term)}%`);
    const idx = params.length;
    const ors = columns.map((c) => `${c} ILIKE $${idx} ESCAPE '\\'`);
    groups.push(`(${ors.join(" OR ")})`);
  }
  return groups.join(" AND ");
}

/** Case-insensitive snippet around the first matching term, wrapping the match in `**…**`. */
export function buildSnippet(text: string, terms: string[], window = 40): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  let pos = -1;
  let matchLen = 0;
  for (const term of terms) {
    if (!term) continue;
    const i = lower.indexOf(term.toLowerCase());
    if (i !== -1 && (pos === -1 || i < pos)) {
      pos = i;
      matchLen = term.length;
    }
  }
  if (pos === -1) return text.slice(0, window * 2);
  const start = Math.max(0, pos - window);
  const end = Math.min(text.length, pos + matchLen + window);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const before = text.slice(start, pos);
  const match = text.slice(pos, pos + matchLen);
  const after = text.slice(pos + matchLen, end);
  return `${prefix}${before}**${match}**${after}${suffix}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bunx vitest run tests/store/trgm-search.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/trgm-search.ts tests/store/trgm-search.test.ts
git commit -m "feat(search): add trigram query/snippet helpers"
```

---

### Task 3: Migration 006 + schema.sql + regen assets

**Files:**
- Modify: `src/store/migrations/index.ts` (add M006, append to `MIGRATIONS`)
- Modify: `src/store/schema.sql` (lines 1, 15, 20, 35, 41-42, 83-118)
- Regenerate: `src/embedded-assets.generated.ts` via `bun run gen:assets`
- Test: `tests/store/migrations.test.ts` (update version assertions + add drop/index assertions)

**Interfaces:**
- Produces: after `Database.create()`, `pg_trgm` is installed; GIN indexes `idx_pages_title_trgm`, `idx_pages_compiled_truth_trgm`, `idx_chunks_chunk_text_trgm` exist; `pages.search_vector` / `content_chunks.search_vector` columns, their triggers, functions, and GIN tsvector indexes are gone.

- [ ] **Step 1: Update the failing test** — version list + structural assertions.

In `tests/store/migrations.test.ts`, change both assertions (lines ~22 and ~49):

```ts
    expect(rows.rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6]);
```

Add a new test in the same file:

```ts
it("migration 006 installs pg_trgm + trgm indexes and drops tsvector machinery", async () => {
  const db = await Database.create({ dataDir: undefined });
  const pg = db.pg;
  // tsvector columns dropped
  const cols = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name IN ('pages','content_chunks') AND column_name = 'search_vector'`,
  );
  expect(cols.rows).toHaveLength(0);
  // triggers + functions dropped
  const trg = await pg.query<{ tgname: string }>(
    `SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_pages_search_vector','chunk_search_vector_trigger')`,
  );
  expect(trg.rows).toHaveLength(0);
  // trgm indexes present
  const idx = await pg.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE indexname IN ('idx_pages_title_trgm','idx_pages_compiled_truth_trgm','idx_chunks_chunk_text_trgm')`,
  );
  expect(idx.rows.map((r) => r.indexname).sort()).toEqual(
    ["idx_chunks_chunk_text_trgm", "idx_pages_compiled_truth_trgm", "idx_pages_title_trgm"],
  );
  await db.close();
});
```

(Match the file's existing import of `Database` / setup style; if the file constructs the DB differently, mirror that.)

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run tests/store/migrations.test.ts`
Expected: FAIL — version arrays `[1,2,3,4,5]` ≠ `[1,2,3,4,5,6]` and the new structural assertions error.

- [ ] **Step 3: Add Migration 006**

In `src/store/migrations/index.ts`, after the `M005_PERSON_BEHAVIOR` constant (line 87) add:

```ts
// Migration 006: Chinese FTS fix. Replace the tsvector('simple') lexical machinery with
// pg_trgm. Chinese has no whitespace, so to_tsvector('simple') collapsed each run into one
// giant lexeme and to_tsquery matched only exact whole-run strings — Chinese FTS was broken.
// pg_trgm GIN + ILIKE substring gives correct CJK recall with no re-extraction. CREATE
// EXTENSION must precede any gin_trgm_ops index.
const M006_TRGM_FTS = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_pages_title_trgm ON pages USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pages_compiled_truth_trgm ON pages USING gin (compiled_truth gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_text_trgm ON content_chunks USING gin (chunk_text gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_pages_search_vector ON pages;
DROP TRIGGER IF EXISTS chunk_search_vector_trigger ON content_chunks;
DROP FUNCTION IF EXISTS update_page_search_vector();
DROP FUNCTION IF EXISTS update_chunk_search_vector();
DROP INDEX IF EXISTS idx_pages_search_vector;
DROP INDEX IF EXISTS idx_chunks_search_vector;
ALTER TABLE pages DROP COLUMN IF EXISTS search_vector;
ALTER TABLE content_chunks DROP COLUMN IF EXISTS search_vector;
`;
```

Append to the `MIGRATIONS` array (after the version-5 entry, line 94):

```ts
  { version: 6, name: "trgm_fts", sql: M006_TRGM_FTS },
```

- [ ] **Step 4: Update `schema.sql` (fresh-DB path)**

In `src/store/schema.sql`:
- Line 1: after `CREATE EXTENSION IF NOT EXISTS vector;` add a new line `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- Delete line 15 (`  search_vector   TSVECTOR,`) from the `pages` table.
- Replace line 20 (`CREATE INDEX IF NOT EXISTS idx_pages_search_vector ON pages USING GIN (search_vector);`) with:

```sql
CREATE INDEX IF NOT EXISTS idx_pages_title_trgm ON pages USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pages_compiled_truth_trgm ON pages USING gin (compiled_truth gin_trgm_ops);
```

- Delete line 35 (`  search_vector   TSVECTOR,`) from `content_chunks`.
- Replace lines 41-42 (the `idx_chunks_search_vector` index) with:

```sql
CREATE INDEX IF NOT EXISTS idx_chunks_chunk_text_trgm ON content_chunks USING gin (chunk_text gin_trgm_ops);
```

- Delete the entire FTS trigger block (lines 83-118: both `CREATE OR REPLACE FUNCTION update_page_search_vector` / `update_chunk_search_vector` and their `DO $$ ... CREATE TRIGGER ... $$` blocks).

- [ ] **Step 5: Regenerate the inlined schema constant**

Run: `bun run gen:assets`
Then confirm the generated file no longer contains `search_vector`:

Run: `bunx vitest run --silent false -t "nothing" 2>/dev/null; grep -c search_vector src/embedded-assets.generated.ts`
Expected: `0`.

- [ ] **Step 6: Run the migration tests + typecheck**

Run: `bunx vitest run tests/store/migrations.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/store/migrations/index.ts src/store/schema.sql src/embedded-assets.generated.ts tests/store/migrations.test.ts
git commit -m "feat(search): migration 006 — pg_trgm indexes, drop tsvector machinery"
```

---

### Task 4: Rewrite `ftsChunkSearch()` (hybrid/RRF path)

**Files:**
- Modify: `src/store/search.ts:409-451` (the `ftsChunkSearch` method) + add import
- Test: `tests/store/hybrid-search.test.ts`

**Interfaces:**
- Consumes: `splitTerms`, `buildTrgmConditions`, `buildSnippet` (Task 2); `addMemoryFilterConditions`, `sourceJson` (existing in `search.ts`).
- Produces: `ftsChunkSearch` returns the same row shape `{ slug, title, type, snippet, chunk_source, updated_at, provenance }` consumed by `addRanked`. Must keep returning `chunk_source` and `updated_at` (RRF boost + freshness depend on them).

- [ ] **Step 1: Write the failing test** — Chinese recall via the hybrid `query()` path (no embeddings → FTS leg only).

Add to `tests/store/hybrid-search.test.ts` (mirror the file's existing DB setup helper):

```ts
it("query() recalls Chinese pages via trigram FTS leg (no embeddings)", async () => {
  const db = await Database.create({ dataDir: undefined });
  const engine = new SearchEngine(db.pg); // no embedText -> vector leg empty
  await db.pages.put("knowledge/auth-mw", "认证中间件重构与上线回滚决策", { type: "knowledge" });
  const res = await engine.query("中间件");
  expect(res.map((r) => r.slug)).toContain("knowledge/auth-mw");
  await db.close();
});
```

(Adjust `db.pages.put(...)` to the actual page-creation API used elsewhere in this test file.)

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run tests/store/hybrid-search.test.ts -t "trigram FTS leg"`
Expected: FAIL — current code uses `to_tsquery('simple')`, returns no rows for `中间件` (and after Task 3 the `search_vector` column is gone, so the old query errors).

- [ ] **Step 3: Add the import** at the top of `src/store/search.ts` (with the other local imports):

```ts
import { buildSnippet, buildTrgmConditions, splitTerms } from "./trgm-search.js";
```

- [ ] **Step 4: Replace the body of `ftsChunkSearch`** (lines 424-450, from `const tsquery = query` through `return result.rows;`) with:

```ts
    const terms = splitTerms(query);
    if (terms.length === 0) return [];

    const params: unknown[] = [query.trim()]; // $1: similarity() ranking input
    const trgm = buildTrgmConditions(terms, ["cc.chunk_text"], params);
    if (!trgm) return [];
    const conditions = [trgm];
    addMemoryFilterConditions(conditions, params, opts, "p");
    params.push(limit);

    const result = await this.pg.query<{
      slug: string;
      title: string;
      type: string;
      chunk_source: string;
      updated_at: string | null;
      chunk_text: string;
      provenance: SourceRef | string | null;
    }>(
      `SELECT p.slug, p.title, p.type, cc.chunk_source, p.updated_at,
         similarity(cc.chunk_text, $1) AS chunk_rank,
         cc.chunk_text AS chunk_text,
         ${sourceJson("p")} AS provenance
       FROM content_chunks cc JOIN pages p ON p.id = cc.page_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY chunk_rank DESC, p.updated_at DESC NULLS LAST, p.slug ASC
       LIMIT $${params.length}`,
      params,
    );
    return result.rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      type: r.type,
      snippet: buildSnippet(r.chunk_text, terms),
      chunk_source: r.chunk_source,
      updated_at: r.updated_at,
      provenance: r.provenance,
    }));
```

- [ ] **Step 5: Run the test + typecheck**

Run: `bunx vitest run tests/store/hybrid-search.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/search.ts tests/store/hybrid-search.test.ts
git commit -m "feat(search): trgm-ILIKE for ftsChunkSearch (Chinese recall in hybrid query)"
```

---

### Task 5: Rewrite `search()` (FTS-only path)

**Files:**
- Modify: `src/store/search.ts:232-282` (the `search` method)
- Test: `tests/store/search.test.ts`

**Interfaces:**
- Consumes: `splitTerms`, `buildTrgmConditions`, `buildSnippet`, `addMemoryFilterConditions`, `sourceJson`, `clampLimit`, `parseProvenance`.
- Produces: `search()` returns `SearchResult[]` with `score = GREATEST(similarity(title,q), similarity(compiled_truth,q))`, stable order via `(page_rank DESC, updated_at DESC, slug ASC)`.

- [ ] **Step 1: Write the failing tests** — Chinese recall + deterministic order + empty query.

Add to `tests/store/search.test.ts` (mirror existing DB setup):

```ts
it("search() recalls Chinese exact-substring queries", async () => {
  const db = await Database.create({ dataDir: undefined });
  const engine = new SearchEngine(db.pg);
  await db.pages.put("decisions/rollback", "上线回滚开关的设计决策", { type: "decision" });
  await db.pages.put("knowledge/mw", "认证中间件链路梳理", { type: "knowledge" });
  expect((await engine.search("回滚")).map((r) => r.slug)).toContain("decisions/rollback");
  expect((await engine.search("中间件")).map((r) => r.slug)).toContain("knowledge/mw");
  await db.close();
});

it("search() returns [] for empty/whitespace query", async () => {
  const db = await Database.create({ dataDir: undefined });
  const engine = new SearchEngine(db.pg);
  expect(await engine.search("   ")).toEqual([]);
  await db.close();
});
```

(Adapt `db.pages.put(...)` to the real page API used in the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run tests/store/search.test.ts -t "Chinese exact-substring"`
Expected: FAIL — old `to_tsquery('simple')` recalls nothing for `回滚`/`中间件` (and errors after the column drop).

- [ ] **Step 3: Replace the `search` method body** (lines 233-281, from `const limit = clampLimit` through the closing `}` of the `return ...map(...)`) with:

```ts
    const limit = clampLimit(opts?.limit);
    const terms = splitTerms(query);
    if (terms.length === 0) return [];

    const params: unknown[] = [query.trim()]; // $1: similarity() ranking input
    const trgm = buildTrgmConditions(terms, ["p.title", "p.compiled_truth"], params);
    if (!trgm) return [];
    const conditions: string[] = [trgm];
    addMemoryFilterConditions(conditions, params, opts, "p");
    params.push(limit);

    const result = await this.pg.query<{
      slug: string;
      title: string;
      type: string;
      page_rank: number | string;
      body: string;
      provenance: SourceRef | string | null;
    }>(
      `SELECT
         p.slug,
         p.title,
         p.type,
         GREATEST(similarity(p.title, $1), similarity(p.compiled_truth, $1)) AS page_rank,
         p.compiled_truth AS body,
         ${sourceJson("p")} AS provenance
       FROM pages p
       WHERE ${conditions.join(" AND ")}
       ORDER BY page_rank DESC, p.updated_at DESC, p.slug ASC
       LIMIT $${params.length}`,
      params,
    );

    return result.rows.map((row) => {
      const snippet = buildSnippet(row.body, terms);
      return {
        slug: row.slug,
        title: row.title,
        type: row.type,
        snippet,
        score: Number(row.page_rank),
        highlights: snippet ? [snippet] : [],
        provenance: parseProvenance(row.provenance),
      };
    });
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `bunx vitest run tests/store/search.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/search.ts tests/store/search.test.ts
git commit -m "feat(search): trgm-ILIKE for FTS-only search() (Chinese recall, stable order)"
```

---

### Task 6: Index-usage guard, English regression, cleanup & full suite

**Files:**
- Test: `tests/store/trgm-index.test.ts` (create)
- Verify: whole repo — grep for stragglers, run all gates

**Interfaces:**
- Consumes: everything above. No production code changes expected unless a straggler reference to `search_vector`/`to_tsquery`/`ts_rank`/`ts_headline` is found.

- [ ] **Step 1: Write the index-usage guard test**

Create `tests/store/trgm-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";

async function seed(db: Awaited<ReturnType<typeof Database.create>>) {
  const phrases = ["认证中间件重构", "上线回滚开关", "数据库选型讨论", "飞书文档摘要"];
  for (let i = 0; i < 800; i++) {
    await db.pages.put(`k/p${i}`, `第${i}条：${phrases[i % phrases.length]}与噪声${i}`, { type: "knowledge" });
  }
}

describe("trgm index usage", () => {
  it("single-term Chinese ILIKE uses a Bitmap Index Scan", async () => {
    const db = await Database.create({ dataDir: undefined });
    await seed(db);
    await db.pg.exec("ANALYZE pages;");
    const ex = await db.pg.query<{ "QUERY PLAN": string }>(
      "EXPLAIN SELECT slug FROM pages WHERE compiled_truth ILIKE '%中间件%'",
    );
    const plan = ex.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Bitmap Index Scan/);
    await db.close();
  });

  it("multi-term AND still uses the trgm index (BitmapAnd or per-term bitmap)", async () => {
    const db = await Database.create({ dataDir: undefined });
    await seed(db);
    await db.pg.exec("ANALYZE pages;");
    const ex = await db.pg.query<{ "QUERY PLAN": string }>(
      "EXPLAIN SELECT slug FROM pages WHERE compiled_truth ILIKE '%认证%' AND compiled_truth ILIKE '%中间件%'",
    );
    const plan = ex.rows.map((r) => r["QUERY PLAN"]).join("\n");
    expect(plan).toMatch(/Bitmap Index Scan|BitmapAnd/);
    await db.close();
  });
});
```

(Adapt `db.pages.put(...)` to the real API.)

- [ ] **Step 2: Run to verify it passes** (this validates the index, not a red→green cycle)

Run: `bunx vitest run tests/store/trgm-index.test.ts`
Expected: PASS. If a plan shows `Seq Scan`, increase the seed row count or confirm `ANALYZE` ran — the index must be cost-competitive.

- [ ] **Step 3: Grep for stragglers** — nothing outside tests should still reference the removed machinery.

Run: `grep -rnE "search_vector|to_tsquery|ts_rank|ts_headline|page_rank|chunk_rank" src/ | grep -v embedded-assets.generated`
Expected: no matches in `src/store/search.ts` or elsewhere in `src/` (the generated file is rewritten by `gen:assets`; if it still matches, re-run `bun run gen:assets`). Fix any straggler.

- [ ] **Step 4: English non-regression + full suite**

Run: `bun run test`
Expected: all pass. In particular `search.test.ts`/`hybrid-search.test.ts` cases for `JWT token`, `gpt-4` still recall as before. If any pre-existing test asserted `ts_headline`-specific snippet text or `ts_rank` score magnitudes, update it to the `**…**` substring-snippet / `similarity()` behavior (recall preserved; document score change).

- [ ] **Step 5: Final gates**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add tests/store/trgm-index.test.ts
git commit -m "test(search): trgm index-usage guard + Chinese/English regression"
```

---

## Self-Review (author checklist)

- **Spec coverage:** §4.2 wiring → Task 1; §4.2.2/.3 migration + schema + regen → Task 3; §4.3 query builder + both legs (`query`/`search`) → Tasks 2/4/5; §4.4 snippet → Task 2 (`buildSnippet`) used in 4/5; §4.5 short-query/escape → Task 2 + Task 6 guard; §5 tests 1-7 → distributed across Tasks 2-6 (T1 helpers, T2 recall both paths, T3 English+stable order, T4 保列 via `chunk_source`/`updated_at` returned in Task 4, T5 migration idempotency+version count in Task 3, T6 single+multi index guard, T7 extension load in Task 1). All covered.
- **Placeholder scan:** no TBD/“handle errors”/“similar to”; every code step shows full code. The only adaptation notes are "match the file's existing `db.pages.put` API" — the implementer must use the real page-creation call; this is a deliberate, bounded instruction, not a hidden code gap.
- **Type consistency:** helper names (`splitTerms`/`escapeIlikeTerm`/`buildTrgmConditions`/`buildSnippet`) identical across Tasks 2/4/5; `ftsChunkSearch` return shape preserves `chunk_source`/`updated_at`/`snippet`/`provenance` as `addRanked` (search.ts:310-344) consumes; migration version `6` consistent with the `[1,2,3,4,5,6]` assertion.

## Open Adaptation Notes (resolve at execution, not placeholders)

- **Page-creation API:** tests above call `db.pages.put(slug, body, { type })`. Confirm the actual method/signature in the existing `tests/store/*.test.ts` and use it verbatim — the store API, not the literal call, is authoritative.
- **`npm run compile` (dist-bin) asset staging:** `build-sidecar.mjs` covers the Tauri sidecar. If a separate step stages assets for `dist-bin/memoark`, add `pg_trgm.tar.gz` there too. The primary `npx`/dev path needs no tar (dev branch loads from `node_modules`).
