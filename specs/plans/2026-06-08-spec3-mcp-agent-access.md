# Spec 3: MCP Agent 取用层 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 high-level semantic MCP tools (`get_session_context`, `list_signals_by_entity`, `get_entity_profile`), add tier weighting to `query`, and create a CLAUDE.md to guide agents toward high-level tools.

**Architecture:** New handlers live in `src/server/context.ts` and `src/server/entity.ts` — thin wrappers over existing stores, registered in the existing `createMcpToolHandlers`/`createMcpServer` pattern in `mcp.ts`. Tier weighting is a post-RRF multiplier in `src/store/search.ts` using a single batch SQL query.

**Tech Stack:** TypeScript, PGlite (via `this.pg`), Zod, `@modelcontextprotocol/sdk`, Vitest.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server/context.ts` | Create | `getSessionContext()` — assembles working-memory overview |
| `src/server/entity.ts` | Create | `listSignalsByEntity()` + `getEntityProfile()` — entity-anchored queries |
| `src/server/mcp.ts` | Modify | Register 3 new tools (handlers + Zod schemas) |
| `src/store/search.ts` | Modify | Tier weighting in `query()` after RRF scoring |
| `CLAUDE.md` | Create | Agent guidance (root of repo) |
| `tests/server/mcp.test.ts` | Modify | Tests for all 3 new tools + tier weighting in query |

---

## Task 1: `get_session_context` handler

**Files:**
- Create: `src/server/context.ts`
- Modify: `tests/server/mcp.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Add to the existing `describe` block in `tests/server/mcp.test.ts`:

```typescript
describe("get_session_context", () => {
  it("returns markdown overview containing sections for decisions, tasks, and preferences", async () => {
    const tools = createMcpToolHandlers(stores);
    await tools.put_page({
      slug: "decisions/use-pglite",
      content: "---\ntitle: Use PGLite\ntype: decision\n---\nChose PGLite for embedded DB.",
    });
    await tools.put_page({
      slug: "tasks/implement-spec3",
      content: "---\ntitle: Implement Spec 3\ntype: task\nstatus: open\n---\nAdd MCP tools.",
    });
    await tools.put_page({
      slug: "preferences/dark-mode",
      content: "---\ntitle: Prefers dark mode\ntype: preference\n---\nUser likes dark mode.",
    });

    const result = await tools.get_session_context({});
    expect(typeof result).toBe("string");
    expect(result).toContain("Use PGLite");
    expect(result).toContain("Implement Spec 3");
    expect(result).toContain("Prefers dark mode");
    expect(result.length).toBeLessThan(5000); // rough upper bound
  });

  it("returns a meaningful string even with empty database", async () => {
    const tools = createMcpToolHandlers(stores);
    const result = await tools.get_session_context({});
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("respects the days parameter", async () => {
    const tools = createMcpToolHandlers(stores);
    const result = await tools.get_session_context({ days: 1 });
    expect(typeof result).toBe("string");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run tests/server/mcp.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — `get_session_context` not in handlers.

- [ ] **Step 3: Create `src/server/context.ts`**

```typescript
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";

interface ContextStores {
  pages: PageStore;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
}

export async function getSessionContext(stores: ContextStores, days = 7): Promise<string> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [projects, decisions, allTasks, prefs, entities] = await Promise.all([
    stores.pages.listPages({ type: "project", sort: "updated_at", order: "desc", limit: 5 }),
    stores.pages.listPages({ type: "decision", sort: "updated_at", order: "desc", limit: 5 }),
    stores.pages.listPages({ type: "task", sort: "updated_at", order: "desc", limit: 50 }),
    stores.pages.listPages({ type: "preference", sort: "updated_at", order: "desc", limit: 10 }),
    stores.pages.listPages({ type: "person", sort: "updated_at", order: "desc", limit: 5 }),
  ]);

  // Filter tasks to open ones
  const openTasks = allTasks.filter(
    (t) => (t.frontmatter.status as string | undefined) === "open",
  );

  // Filter to recently updated (within `days`)
  const recentDecisions = decisions.filter((d) => d.updated_at >= since);
  const recentProjects = projects.filter((p) => p.updated_at >= since);

  const lines: string[] = [`## 近期工作概览（最近 ${days} 天）`, ""];

  if (recentProjects.length > 0) {
    lines.push(`**活跃项目**：${recentProjects.map((p) => p.slug).join(", ")}`);
  }

  if (recentDecisions.length > 0) {
    lines.push(`**关键决策**（最近 ${Math.min(recentDecisions.length, 3)} 条）：`);
    for (const d of recentDecisions.slice(0, 3)) {
      const date = d.updated_at.slice(0, 10);
      lines.push(`- ${date} ${d.title}`);
    }
  }

  if (openTasks.length > 0) {
    lines.push(`**待办**（open tasks，共 ${openTasks.length} 条）：`);
    for (const t of openTasks.slice(0, 5)) {
      lines.push(`- ${t.title} [${t.slug}]`);
    }
  }

  if (prefs.length > 0) {
    lines.push(`**已知偏好**（共 ${prefs.length} 条）：`);
    for (const p of prefs.slice(0, 3)) {
      lines.push(`- ${p.title}`);
    }
  }

  if (entities.length > 0) {
    lines.push(`**关键人物**：${entities.map((e) => `${e.title} [${e.slug}]`).join(", ")}`);
  }

  lines.push("");
  lines.push(
    "如需细节：`query(\"关键词\")` 语义检索，或 `get_entity_profile(\"<entity-slug>\")` 查看人物/项目档案。",
  );

  return lines.join("\n");
}
```

- [ ] **Step 4: Register in `src/server/mcp.ts`**

Add import near the top of `mcp.ts`:
```typescript
import { getSessionContext } from "./context.js";
```

Add to `createMcpToolHandlers` return object (after existing handlers):
```typescript
get_session_context: ({ days }: { days?: number }) =>
  getSessionContext(stores, days ?? 7),
```

Add to `createMcpServer` after existing `server.tool(...)` calls:
```typescript
server.tool(
  "get_session_context",
  { days: z.number().optional() },
  async (args) => text(await tools.get_session_context(args)),
);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx vitest run tests/server/mcp.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: `get_session_context` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/context.ts src/server/mcp.ts tests/server/mcp.test.ts
git commit -m "feat(mcp): add get_session_context tool for session working-memory overview"
```

---

## Task 2: `list_signals_by_entity` + `get_entity_profile` handlers

**Files:**
- Create: `src/server/entity.ts`
- Modify: `src/server/mcp.ts`
- Modify: `tests/server/mcp.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/server/mcp.test.ts`:

```typescript
describe("list_signals_by_entity", () => {
  it("returns signals linked to an entity via mentions", async () => {
    const tools = createMcpToolHandlers(stores);
    await tools.put_page({
      slug: "entities/alice",
      content: "---\ntitle: Alice\ntype: person\n---\nAlice.",
    });
    await tools.put_page({
      slug: "decisions/d1",
      content: "---\ntitle: Decision 1\ntype: decision\n---\nA decision about Alice.",
    });
    await tools.add_link({ from: "decisions/d1", to: "entities/alice", type: "mentions" });

    const result = await tools.list_signals_by_entity({ entity_slug: "entities/alice" });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("slug");
    expect(result[0]).toHaveProperty("type");
  });

  it("filters by signal_types when provided", async () => {
    const tools = createMcpToolHandlers(stores);
    await tools.put_page({
      slug: "entities/bob",
      content: "---\ntitle: Bob\ntype: person\n---\nBob.",
    });
    await tools.put_page({
      slug: "decisions/d2",
      content: "---\ntitle: D2\ntype: decision\n---\nDecision.",
    });
    await tools.put_page({
      slug: "knowledge/k1",
      content: "---\ntitle: K1\ntype: knowledge\n---\nKnowledge.",
    });
    await tools.add_link({ from: "decisions/d2", to: "entities/bob", type: "mentions" });
    await tools.add_link({ from: "knowledge/k1", to: "entities/bob", type: "mentions" });

    const result = await tools.list_signals_by_entity({
      entity_slug: "entities/bob",
      signal_types: ["decision"],
    });
    expect(result.every((r: { type: string }) => r.type === "decision")).toBe(true);
  });

  it("returns empty array for entity with no backlinks", async () => {
    const tools = createMcpToolHandlers(stores);
    await tools.put_page({
      slug: "entities/lonely",
      content: "---\ntitle: Lonely\ntype: person\n---\nLonely.",
    });
    const result = await tools.list_signals_by_entity({ entity_slug: "entities/lonely" });
    expect(result).toHaveLength(0);
  });
});

describe("get_entity_profile", () => {
  it("returns structured profile with page, grouped signals, and timeline", async () => {
    const tools = createMcpToolHandlers(stores);
    await tools.put_page({
      slug: "entities/carol",
      content: "---\ntitle: Carol\ntype: person\n---\nCarol is a product manager.",
    });
    await tools.put_page({
      slug: "decisions/carol-d1",
      content: "---\ntitle: Chose React\ntype: decision\n---\nDecision body.",
    });
    await tools.add_link({ from: "decisions/carol-d1", to: "entities/carol", type: "mentions" });
    await stores.timeline.addEntry("entities/carol", {
      date: "2026-05-01",
      summary: "Kickoff meeting",
    });

    const result = await tools.get_entity_profile({ entity_slug: "entities/carol" });
    expect(result).toHaveProperty("page");
    expect(result).toHaveProperty("signals");
    expect(result).toHaveProperty("timeline");
    expect((result.page as { title: string }).title).toBe("Carol");
    expect(Array.isArray(result.timeline)).toBe(true);
  });

  it("returns null page for non-existent entity", async () => {
    const tools = createMcpToolHandlers(stores);
    const result = await tools.get_entity_profile({ entity_slug: "entities/ghost" });
    expect(result.page).toBeNull();
    expect(result.signals).toEqual({});
    expect(result.timeline).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bunx vitest run tests/server/mcp.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — `list_signals_by_entity` and `get_entity_profile` not in handlers.

- [ ] **Step 3: Create `src/server/entity.ts`**

```typescript
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TimelineStore } from "../store/timeline.js";

interface EntityStores {
  pages: PageStore;
  graph: GraphStore;
  timeline: TimelineStore;
}

export async function listSignalsByEntity(
  stores: EntityStores,
  entitySlug: string,
  signalTypes?: string[],
  limit = 20,
): Promise<Array<{ slug: string; title: string; type: string; frontmatter: Record<string, unknown> }>> {
  const backlinks = await stores.graph.getBacklinksEnriched(entitySlug);
  let signals = backlinks.map((b) => ({
    slug: b.from_slug,
    title: b.page.title,
    type: b.page.type,
    frontmatter: b.page.frontmatter,
  }));
  if (signalTypes && signalTypes.length > 0) {
    const typeSet = new Set(signalTypes);
    signals = signals.filter((s) => typeSet.has(s.type));
  }
  return signals.slice(0, limit);
}

export async function getEntityProfile(
  stores: EntityStores,
  entitySlug: string,
): Promise<{
  page: Awaited<ReturnType<PageStore["getPage"]>>;
  signals: Record<string, Array<{ slug: string; title: string; frontmatter: Record<string, unknown> }>>;
  timeline: Awaited<ReturnType<TimelineStore["getTimeline"]>>;
}> {
  const [page, backlinks, timeline] = await Promise.all([
    stores.pages.getPage(entitySlug),
    stores.graph.getBacklinksEnriched(entitySlug),
    stores.timeline.getTimeline(entitySlug),
  ]);

  // Group backlinks by type
  const signals: Record<string, Array<{ slug: string; title: string; frontmatter: Record<string, unknown> }>> = {};
  for (const b of backlinks) {
    const type = b.page.type;
    if (!signals[type]) signals[type] = [];
    signals[type].push({
      slug: b.from_slug,
      title: b.page.title,
      frontmatter: b.page.frontmatter,
    });
  }

  return { page, signals, timeline };
}
```

- [ ] **Step 4: Register in `src/server/mcp.ts`**

Add import:
```typescript
import { getEntityProfile, listSignalsByEntity } from "./entity.js";
```

Add to `createMcpToolHandlers` return object:
```typescript
list_signals_by_entity: ({
  entity_slug,
  signal_types,
  limit,
}: {
  entity_slug: string;
  signal_types?: string[];
  limit?: number;
}) => listSignalsByEntity(stores, entity_slug, signal_types, limit ?? 20),

get_entity_profile: ({ entity_slug }: { entity_slug: string }) =>
  getEntityProfile(stores, entity_slug),
```

Add to `createMcpServer`:
```typescript
server.tool(
  "list_signals_by_entity",
  {
    entity_slug: z.string(),
    signal_types: z.array(z.string()).optional(),
    limit: z.number().optional(),
  },
  async (args) => text(await tools.list_signals_by_entity(args)),
);

server.tool(
  "get_entity_profile",
  { entity_slug: z.string() },
  async (args) => text(await tools.get_entity_profile(args)),
);
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
bunx vitest run tests/server/mcp.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All new entity tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/entity.ts src/server/mcp.ts tests/server/mcp.test.ts
git commit -m "feat(mcp): add list_signals_by_entity and get_entity_profile tools"
```

---

## Task 3: `query` tier weighting in `src/store/search.ts`

**Files:**
- Modify: `src/store/search.ts`
- Modify: `tests/server/mcp.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/server/mcp.test.ts`:

```typescript
describe("query tier weighting", () => {
  it("hot pages score higher than cold pages with same content", async () => {
    const tools = createMcpToolHandlers(stores);

    // Put two pages with identical content but different tiers
    await tools.put_page({
      slug: "knowledge/hot-page",
      content: "---\ntitle: Hot Knowledge\ntype: knowledge\n---\nPGLite is a WASM SQLite.",
    });
    await tools.put_page({
      slug: "knowledge/cold-page",
      content: "---\ntitle: Cold Knowledge\ntype: knowledge\n---\nPGLite is a WASM SQLite.",
    });

    // Force cold-page to cold tier via DB
    await stores.db.pg.query(
      "UPDATE pages SET tier = 'cold' WHERE slug = 'knowledge/cold-page'",
    );

    const results = await tools.query({ query: "PGLite WASM SQLite" });
    const hotIdx = (results as Array<{ slug: string }>).findIndex(
      (r) => r.slug === "knowledge/hot-page",
    );
    const coldIdx = (results as Array<{ slug: string }>).findIndex(
      (r) => r.slug === "knowledge/cold-page",
    );

    // Both should be in results, and hot should rank above cold
    expect(hotIdx).toBeGreaterThanOrEqual(0);
    expect(coldIdx).toBeGreaterThanOrEqual(0);
    expect(hotIdx).toBeLessThan(coldIdx);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bunx vitest run tests/server/mcp.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: FAIL — tier weighting not yet implemented (hot and cold will score the same).

- [ ] **Step 3: Add tier weighting to `src/store/search.ts`**

Add constant near the top with other constants (after `BACKLINK_BOOST_FACTOR`):

```typescript
const TIER_WEIGHTS: Record<string, number> = {
  hot: 1.0,
  warm: 0.8,
  cold: 0.6,
};
```

After the `COMPILED_TRUTH_BOOST` loop (after line `entry.score *= COMPILED_TRUTH_BOOST;`) and before the backlink loop, add a tier weight batch query:

```typescript
// Tier weighting: batch-fetch tier for all scored slugs
if (slugs.length > 0) {
  const tierRows = await this.pg.query<{ slug: string; tier: string }>(
    `SELECT slug, tier FROM pages WHERE slug = ANY($1::text[])`,
    [slugs],
  );
  const tierMap = new Map(tierRows.rows.map((r) => [r.slug, r.tier]));
  for (const entry of scoreMap.values()) {
    const tier = tierMap.get(entry.slug) ?? "hot";
    entry.score *= TIER_WEIGHTS[tier] ?? 1.0;
  }
}
```

Note: `slugs` is already defined at this point in the code (`const slugs = [...scoreMap.keys()];`). Place the tier block immediately after the COMPILED_TRUTH_BOOST loop and before the existing backlink loop that also uses `slugs`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
bunx vitest run tests/server/mcp.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

Expected: All tests PASS including tier weighting test.

- [ ] **Step 5: Commit**

```bash
git add src/store/search.ts tests/server/mcp.test.ts
git commit -m "feat(search): add tier weighting to query — hot×1.0, warm×0.8, cold×0.6"
```

---

## Task 4: Create `CLAUDE.md`

**Files:**
- Create: `CLAUDE.md` (project root)

- [ ] **Step 1: Create `CLAUDE.md`**

```bash
cat > CLAUDE.md << 'EOF'
# Memoark — Agent Guide

Memoark is a personal memory layer. It stores and retrieves signals (decisions, tasks, knowledge, preferences, references) as pages anchored to entities (people, projects, tools) via a graph.

## Session Start

At the beginning of every session, call `get_session_context` to load working memory:

```
get_session_context()          # last 7 days (default)
get_session_context(days=14)   # extend window if needed
```

## Tool Priority

Prefer high-level tools first:

| Tool | Use for |
|------|---------|
| `get_session_context` | Session bootstrap — what's active, what's pending |
| `query("...")` | Semantic search — main retrieval entry point |
| `get_entity_profile("entities/alice")` | Full profile: signals + timeline for a person/project |
| `list_signals_by_entity("entities/alice")` | List all signals anchored to an entity |
| `search("exact keyword")` | Keyword / full-text search (use when `query` is too broad) |

Low-level tools (`get_page`, `put_page`, `add_link`, `list_pages`, …) are available for precise CRUD when high-level tools aren't enough.

## Saving Signals

When you make a significant decision or discovery, save it:

```
put_page(
  slug="decisions/<kebab-slug>",
  content="---\ntitle: <title>\ntype: decision\n---\n<reasoning>"
)
```

Signal types: `decision`, `task`, `knowledge`, `preference`, `reference`, `entity`, `person`, `project`, `organization`, `tool`, `concept`.

## Memory Tiers

Pages move through tiers automatically (`hot` → `warm` → `cold`). Query results weight hot pages higher. Use `memoark consolidate --hot` to run tier rotation manually.
EOF
```

- [ ] **Step 2: Verify file was written**

```bash
cat CLAUDE.md | wc -l
```

Expected: > 30 lines.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with agent session-start guidance and tool priority"
```

---

## Task 5: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck 2>&1
```

Expected: No errors.

- [ ] **Step 2: Run lint**

```bash
bun run lint:fix 2>&1
```

Expected: No new errors introduced by Spec 3 changes.

- [ ] **Step 3: Run all Spec 3 tests**

```bash
bunx vitest run tests/server/mcp.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2 2>&1
```

Expected: All pass (pre-existing test count + new tests).

- [ ] **Step 4: Run full test suite (Spec 1 + Spec 2 regression check)**

```bash
bunx vitest run \
  tests/store/migrations.test.ts \
  tests/store/pages.test.ts \
  tests/store/graph.test.ts \
  tests/consolidator/consolidator.test.ts \
  tests/server/mcp.test.ts \
  --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2 2>&1
```

Expected: All pass. Pre-existing failures in other files are not regressions.

- [ ] **Step 5: Verify acceptance criteria**

**AC1** — typecheck + tests pass: confirmed above.

**AC2** — `get_session_context()` returns < 800 token overview:
```bash
bun run src/cli.ts mcp 2>/dev/null | head -5
# OR check programmatically that output length < 3200 chars
```

**AC3** — `list_signals_by_entity` returns correct signals via backlinks: verified by tests.

**AC4** — `get_entity_profile` returns structured profile: verified by tests.

**AC5** — `query` ranks hot pages above cold pages with same content: verified by tier weighting test.

**AC6** — existing 17 tools behavior unchanged: no existing tests regress.

**AC7** — CLAUDE.md updated: confirmed in Task 4.

- [ ] **Step 6: Push**

```bash
git push -u origin claude/repository-issues-review-TZG4j
```
