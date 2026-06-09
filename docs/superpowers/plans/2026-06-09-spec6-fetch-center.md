# Spec 6 — Fetch Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/fetch` page to the Web UI with two sections — Auto-fetch (scheduler config editor) and 历史回溯 (feishu historical backfill with per-source progress).

**Architecture:** The backfill mechanism requires modifying `resolveStartTime` in 4 feishu source files to respect an `overrideSinceMs` option that bypasses the cursor (the existing `lookback_days` override is silently ignored when a checkpoint exists). `BackfillJob` is a testable state machine that accepts a `runForSource` function; the route factory injects the real pipeline execution. The `/fetch` page sits inside `Shell` (with sidebar) and reuses the `Section` collapsible component pattern from `/config`.

**Tech Stack:** Bun + TypeScript + Hono (backend), React 19 + TanStack Query + Tailwind CSS (frontend), Vitest (tests)

---

## File Map

### New files
```
src/server/backfill-job.ts          — BackfillJob state machine (testable via injected runForSource)
src/server/backfill-job.test.ts     — BackfillJob unit tests
src/server/backfill-routes.ts       — 4 Hono routes + createBackfillRoutes factory
src/server/backfill-routes.test.ts  — Route integration tests

web/src/api/backfill.ts                          — Frontend API client
web/src/pages/fetch/index.tsx                    — FetchPage root (two Sections)
web/src/pages/fetch/sections/AutoFetchSection.tsx — Scheduler config form
web/src/pages/fetch/sections/BackfillSection.tsx  — Heatmap + control panel
```

### Modified files
```
src/collectors/feishu/types.ts                   — add override_since_ms? to 4 source config types
src/collectors/feishu/collector.ts               — pass overrideSinceMs to source constructors
src/collectors/feishu/sources/messages.ts        — opts + resolveStartTime
src/collectors/feishu/sources/dm.ts              — opts + resolveStartTime
src/collectors/feishu/sources/mail.ts            — opts + resolveStartTime
src/collectors/feishu/sources/message-search.ts  — opts + resolveStartTime
src/server/api.ts                                — mount createBackfillRoutes
web/src/router.tsx                               — add /fetch inside Shell
```

---

## Task 1: `override_since_ms` — types, collector, and resolveStartTime

**Files:**
- Modify: `src/collectors/feishu/types.ts`
- Modify: `src/collectors/feishu/collector.ts`
- Modify: `src/collectors/feishu/sources/messages.ts`
- Modify: `src/collectors/feishu/sources/dm.ts`
- Modify: `src/collectors/feishu/sources/mail.ts`
- Modify: `src/collectors/feishu/sources/message-search.ts`
- Create: `src/collectors/feishu/sources/resolve-start-time.test.ts`

The problem: `resolveStartTime` in all four feishu sources returns `last_sync_at` from the checkpoint when one exists, ignoring `lookback_days`. Adding `overrideSinceMs` fixes this: when it's earlier than the checkpoint cursor, use it as the fetch floor.

- [ ] **Step 1: Add `override_since_ms` to the 4 source config interfaces in `types.ts`**

Current interfaces (lines ~1-50 of `src/collectors/feishu/types.ts`):
```typescript
export interface FeishuMessageSourceConfig {
  enabled: boolean;
  chat_ids?: string[];
  lookback_days?: number;
  overlap_ms?: number;
}
export interface FeishuDMSourceConfig {
  enabled: boolean;
  dm_chat_ids?: string[];
  self_open_id?: string;
  lookback_days?: number;
  overlap_ms?: number;
}
export interface FeishuMailSourceConfig {
  enabled: boolean;
  lookback_days?: number;
  overlap_ms?: number;
  fetch_concurrency?: number;
}
export interface FeishuMessageSearchSourceConfig {
  enabled: boolean;
  chat_types?: Array<"p2p" | "group">;
  query?: string;
  sender_type?: "user" | "bot";
  exclude_sender_type?: "user" | "bot";
  lookback_days?: number;
  overlap_ms?: number;
  page_size?: number;
}
```

Add `override_since_ms?: number` to each. Final state of each interface (show only changed field, add after `lookback_days`):

```typescript
export interface FeishuMessageSourceConfig {
  enabled: boolean;
  chat_ids?: string[];
  lookback_days?: number;
  override_since_ms?: number;
  overlap_ms?: number;
}
export interface FeishuDMSourceConfig {
  enabled: boolean;
  dm_chat_ids?: string[];
  self_open_id?: string;
  lookback_days?: number;
  override_since_ms?: number;
  overlap_ms?: number;
}
export interface FeishuMailSourceConfig {
  enabled: boolean;
  lookback_days?: number;
  override_since_ms?: number;
  overlap_ms?: number;
  fetch_concurrency?: number;
}
export interface FeishuMessageSearchSourceConfig {
  enabled: boolean;
  chat_types?: Array<"p2p" | "group">;
  query?: string;
  sender_type?: "user" | "bot";
  exclude_sender_type?: "user" | "bot";
  lookback_days?: number;
  override_since_ms?: number;
  overlap_ms?: number;
  page_size?: number;
}
```

- [ ] **Step 2: Write failing test for `resolveStartTime` with override**

Create `src/collectors/feishu/sources/resolve-start-time.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../cursor-staging.js";
import { MessageSource } from "./messages.js";
import type { SourceCheckpoint } from "../types.js";

function makeCursorStaging(): CursorStaging {
  return new CursorStaging();
}

function makePaginateMock() {
  return vi.fn().mockReturnValue(
    (async function* () {
      // yields nothing — empty chat
    })(),
  );
}

describe("resolveStartTime with overrideSinceMs", () => {
  it("uses overrideSinceMs when it is earlier than checkpoint last_sync_at", async () => {
    const paginateMock = makePaginateMock();
    const source = new MessageSource(
      { paginate: paginateMock } as never,
      ["chat1"],
      { lookbackDays: 30, overrideSinceMs: 100_000 },
    );
    // checkpoint has last_sync_at = 1_000_000 (much later than override)
    const checkpoint: SourceCheckpoint = { chat1: { last_sync_at: 1_000_000 } };

    for await (const _ of source.fetch(checkpoint, makeCursorStaging())) { /* drain */ }

    expect(paginateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        // start_time = floor((overrideSinceMs - overlapMs) / 1000) = floor((100000 - 2000) / 1000) = 98
        start_time: "98",
      }),
    );
  });

  it("does NOT use overrideSinceMs when checkpoint is earlier", async () => {
    const paginateMock = makePaginateMock();
    const source = new MessageSource(
      { paginate: paginateMock } as never,
      ["chat1"],
      { lookbackDays: 30, overrideSinceMs: 2_000_000 }, // override is LATER than checkpoint
    );
    const checkpoint: SourceCheckpoint = { chat1: { last_sync_at: 500_000 } };

    for await (const _ of source.fetch(checkpoint, makeCursorStaging())) { /* drain */ }

    expect(paginateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        // checkpoint wins: start_time = floor((500000 - 2000) / 1000) = 498
        start_time: "498",
      }),
    );
  });

  it("uses overrideSinceMs when there is no checkpoint", async () => {
    const paginateMock = makePaginateMock();
    const source = new MessageSource(
      { paginate: paginateMock } as never,
      ["chat1"],
      { lookbackDays: 30, overrideSinceMs: 300_000 },
    );

    for await (const _ of source.fetch(null, makeCursorStaging())) { /* drain */ }

    expect(paginateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ start_time: "298" }), // (300000 - 2000) / 1000 = 298
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /home/user/memoark && bun test src/collectors/feishu/sources/resolve-start-time.test.ts
```
Expected: FAIL — `overrideSinceMs` doesn't exist yet, `MessageSource` constructor rejects unknown opts.

- [ ] **Step 4: Update `MessageSource` opts interface and `resolveStartTime`**

In `src/collectors/feishu/sources/messages.ts`, change:

```typescript
interface MessageSourceOpts {
  lookbackDays: number;
  overrideSinceMs?: number;
  overlapMs?: number;
}
```

And replace the `resolveStartTime` method (current lines ~75-80):

```typescript
  private resolveStartTime(checkpoint: SourceCheckpoint | null, chatId: string): number {
    const checkpointMs = checkpoint?.[chatId]?.last_sync_at as number | undefined;
    if (
      this.opts.overrideSinceMs !== undefined &&
      (checkpointMs === undefined || this.opts.overrideSinceMs < checkpointMs)
    ) {
      return this.opts.overrideSinceMs;
    }
    if (checkpointMs !== undefined) return checkpointMs;
    return Date.now() - this.opts.lookbackDays * 24 * 60 * 60 * 1000;
  }
```

- [ ] **Step 5: Apply the same pattern to `DMSource`, `MailSource`, `MessageSearchSource`**

**`src/collectors/feishu/sources/dm.ts`** — change interface and method:

```typescript
interface DMSourceOpts {
  lookbackDays: number;
  overrideSinceMs?: number;
  selfOpenId: string;
  overlapMs?: number;
}
```

Replace `resolveStartTime`:
```typescript
  private resolveStartTime(checkpoint: SourceCheckpoint | null, chatId: string): number {
    const checkpointMs = checkpoint?.[chatId]?.last_sync_at as number | undefined;
    if (
      this.opts.overrideSinceMs !== undefined &&
      (checkpointMs === undefined || this.opts.overrideSinceMs < checkpointMs)
    ) {
      return this.opts.overrideSinceMs;
    }
    if (checkpointMs !== undefined) return checkpointMs;
    return Date.now() - this.opts.lookbackDays * 24 * 60 * 60 * 1000;
  }
```

**`src/collectors/feishu/sources/mail.ts`** — change interface and method:

```typescript
interface MailSourceOpts {
  lookbackDays: number;
  overrideSinceMs?: number;
  overlapMs?: number;
  fetchConcurrency?: number;
}
```

Replace `resolveStartTime` (currently lines ~82-87):
```typescript
  private resolveStartTime(checkpoint: SourceCheckpoint | null): number {
    const checkpointMs = checkpoint?.INBOX?.last_sync_at as number | undefined;
    if (
      this.opts.overrideSinceMs !== undefined &&
      (checkpointMs === undefined || this.opts.overrideSinceMs < checkpointMs)
    ) {
      return this.opts.overrideSinceMs;
    }
    if (checkpointMs !== undefined) return checkpointMs;
    return Date.now() - this.opts.lookbackDays * 24 * 60 * 60 * 1000;
  }
```

**`src/collectors/feishu/sources/message-search.ts`** — change interface and method:

```typescript
interface MessageSearchOpts {
  chatTypes: SearchChatType[];
  lookbackDays: number;
  overrideSinceMs?: number;
  selfOpenId?: string;
  query?: string;
  senderType?: "user" | "bot";
  excludeSenderType?: "user" | "bot";
  pageSize?: number;
  overlapMs?: number;
  maxRetries?: number;
}
```

Replace `resolveStartTime`:
```typescript
  private resolveStartTime(checkpoint: SourceCheckpoint | null, chatType: SearchChatType): number {
    const checkpointMs = checkpoint?.[chatType]?.last_sync_at as number | undefined;
    if (
      this.opts.overrideSinceMs !== undefined &&
      (checkpointMs === undefined || this.opts.overrideSinceMs < checkpointMs)
    ) {
      return this.opts.overrideSinceMs;
    }
    if (checkpointMs !== undefined) return checkpointMs;
    return Date.now() - this.opts.lookbackDays * 24 * 60 * 60 * 1000;
  }
```

- [ ] **Step 6: Update `FeishuCollector` constructor to forward `override_since_ms`**

In `src/collectors/feishu/collector.ts`, update the 4 source constructions:

```typescript
    if (config.sources.messages?.enabled) {
      this.sources.push(
        new MessageSource(this.client, config.sources.messages.chat_ids ?? [], {
          lookbackDays: config.sources.messages.lookback_days ?? 30,
          overrideSinceMs: config.sources.messages.override_since_ms,
          overlapMs: config.sources.messages.overlap_ms,
        }),
      );
    }
```

```typescript
    if (config.sources.dm?.enabled) {
      this.sources.push(
        new DMSource(this.client, config.sources.dm.dm_chat_ids ?? [], {
          lookbackDays: config.sources.dm.lookback_days ?? 30,
          overrideSinceMs: config.sources.dm.override_since_ms,
          selfOpenId: config.sources.dm.self_open_id ?? "",
          overlapMs: config.sources.dm.overlap_ms,
        }),
      );
    }
```

```typescript
    if (config.sources.mail?.enabled) {
      const larkClient = new LarkCliHttpClient(config.lark_bin);
      this.sources.push(
        new MailSource(larkClient, {
          lookbackDays: config.sources.mail.lookback_days ?? 30,
          overrideSinceMs: config.sources.mail.override_since_ms,
          overlapMs: config.sources.mail.overlap_ms,
          fetchConcurrency: config.sources.mail.fetch_concurrency,
        }),
      );
    }
```

For message_search, find the `if (config.sources.message_search?.enabled)` block and add `overrideSinceMs: config.sources.message_search.override_since_ms` to the opts object.

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd /home/user/memoark && bun test src/collectors/feishu/sources/resolve-start-time.test.ts
```
Expected: All 3 tests PASS.

- [ ] **Step 8: Run full test suite to check for regressions**

```bash
cd /home/user/memoark && bun test
```
Expected: All existing tests pass. No type errors from `bun run typecheck` (or `bun tsc --noEmit`).

- [ ] **Step 9: Commit**

```bash
git add src/collectors/feishu/types.ts \
        src/collectors/feishu/collector.ts \
        src/collectors/feishu/sources/messages.ts \
        src/collectors/feishu/sources/dm.ts \
        src/collectors/feishu/sources/mail.ts \
        src/collectors/feishu/sources/message-search.ts \
        src/collectors/feishu/sources/resolve-start-time.test.ts
git commit -m "feat: add overrideSinceMs to feishu sources to bypass cursor for backfill"
```

---

## Task 2: BackfillJob state machine

**Files:**
- Create: `src/server/backfill-job.ts`
- Create: `src/server/backfill-job.test.ts`

`BackfillJob` manages state (idle/running/done/error) and runs `runForSource` once per source type sequentially. It accepts `runForSource` at construction for testability — the route factory injects the real pipeline runner.

- [ ] **Step 1: Write failing tests for BackfillJob**

Create `src/server/backfill-job.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { BackfillJob } from "./backfill-job.js";
import type { PipelineResult } from "../core/pipeline.js";

function makeResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
    fatal: false,
    totalMessages: 5,
    totalBlocks: 2,
    okBlocks: 2,
    skippedBlocks: 0,
    failedBlocks: 0,
    okMessages: [],
    skippedMessages: [],
    failedMessages: [],
    warnings: [],
    ...overrides,
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("BackfillJob", () => {
  it("initial state is idle", () => {
    const job = new BackfillJob(vi.fn());
    const s = job.getStatus();
    expect(s.state).toBe("idle");
    expect(s.sources).toHaveLength(0);
    expect(s.total_messages).toBe(0);
  });

  it("start transitions to running immediately", () => {
    const runForSource = vi.fn().mockResolvedValue(makeResult());
    const job = new BackfillJob(runForSource);
    job.start({ since_ms: 0, source_types: ["dm"] });
    expect(job.getStatus().state).toBe("running");
    expect(job.getStatus().sources).toHaveLength(1);
    expect(job.getStatus().sources[0].source).toBe("dm");
  });

  it("transitions to done after all sources complete", async () => {
    const runForSource = vi.fn().mockResolvedValue(makeResult({ totalMessages: 10, totalBlocks: 3 }));
    const job = new BackfillJob(runForSource);
    job.start({ since_ms: 0, source_types: ["dm", "mail"] });
    await wait(20);
    const s = job.getStatus();
    expect(s.state).toBe("done");
    expect(s.total_messages).toBe(20); // 10 × 2 sources
    expect(s.total_blocks).toBe(6);
    expect(s.finished_at).toBeGreaterThan(0);
  });

  it("marks source as error when runForSource returns fatal", async () => {
    const runForSource = vi.fn().mockResolvedValue(makeResult({ fatal: true, error: "auth failed" }));
    const job = new BackfillJob(runForSource);
    job.start({ since_ms: 0, source_types: ["mail"] });
    await wait(20);
    const s = job.getStatus();
    expect(s.state).toBe("done"); // job itself still done
    expect(s.sources[0].status).toBe("error");
    expect(s.sources[0].error).toBe("auth failed");
  });

  it("marks source as error when runForSource throws", async () => {
    const runForSource = vi.fn().mockRejectedValue(new Error("network error"));
    const job = new BackfillJob(runForSource);
    job.start({ since_ms: 0, source_types: ["messages"] });
    await wait(20);
    const s = job.getStatus();
    expect(s.sources[0].status).toBe("error");
    expect(s.sources[0].error).toBe("network error");
  });

  it("start while running is a no-op (second call ignored)", () => {
    const runForSource = vi.fn().mockImplementation(() => new Promise(() => {}));
    const job = new BackfillJob(runForSource);
    job.start({ since_ms: 0, source_types: ["dm"] });
    job.start({ since_ms: 0, source_types: ["messages"] }); // ignored
    expect(runForSource).toHaveBeenCalledTimes(1);
    expect(job.getStatus().sources).toHaveLength(1);
  });

  it("cancel sets state to error with 'cancelled'", () => {
    const runForSource = vi.fn().mockImplementation(() => new Promise(() => {}));
    const job = new BackfillJob(runForSource);
    job.start({ since_ms: 0, source_types: ["dm"] });
    job.cancel();
    const s = job.getStatus();
    expect(s.state).toBe("error");
    expect(s.error).toBe("cancelled");
    expect(s.finished_at).toBeGreaterThan(0);
  });

  it("cancel on idle is a no-op", () => {
    const job = new BackfillJob(vi.fn());
    job.cancel(); // should not throw
    expect(job.getStatus().state).toBe("idle");
  });

  it("getStatus returns a snapshot — mutations don't affect internal state", () => {
    const runForSource = vi.fn().mockImplementation(() => new Promise(() => {}));
    const job = new BackfillJob(runForSource);
    job.start({ since_ms: 0, source_types: ["dm"] });
    const snapshot = job.getStatus();
    snapshot.sources[0].status = "done"; // mutate snapshot
    expect(job.getStatus().sources[0].status).toBe("running"); // internal unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/user/memoark && bun test src/server/backfill-job.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BackfillJob`**

Create `src/server/backfill-job.ts`:

```typescript
import type { PipelineResult } from "../core/pipeline.js";

export type BackfillSourceType = "dm" | "messages" | "mail" | "message_search";
export type BackfillState = "idle" | "running" | "done" | "error";

export interface SourceProgress {
  source: BackfillSourceType;
  processed: number;
  blocks: number;
  status: "pending" | "running" | "done" | "error" | "skipped";
  error?: string;
}

export interface BackfillStatus {
  state: BackfillState;
  sources: SourceProgress[];
  started_at?: number;
  finished_at?: number;
  error?: string;
  total_messages: number;
  total_blocks: number;
}

export interface BackfillStartOpts {
  since_ms: number;
  source_types: BackfillSourceType[];
}

export type RunForSourceFn = (
  sourceType: BackfillSourceType,
  sinceMs: number,
) => Promise<PipelineResult>;

export class BackfillJob {
  private status: BackfillStatus = {
    state: "idle",
    sources: [],
    total_messages: 0,
    total_blocks: 0,
  };
  private abortController: AbortController | null = null;

  constructor(private readonly runForSource: RunForSourceFn) {}

  start(opts: BackfillStartOpts): void {
    if (this.status.state === "running") return;

    this.abortController = new AbortController();
    this.status = {
      state: "running",
      started_at: Date.now(),
      total_messages: 0,
      total_blocks: 0,
      sources: opts.source_types.map((s) => ({
        source: s,
        processed: 0,
        blocks: 0,
        status: "pending" as const,
      })),
    };

    this.runAll(opts).catch((err) => {
      this.status.state = "error";
      this.status.error = err instanceof Error ? err.message : String(err);
      this.status.finished_at = Date.now();
    });
  }

  cancel(): void {
    if (this.status.state !== "running") return;
    this.abortController?.abort();
    this.status.state = "error";
    this.status.error = "cancelled";
    this.status.finished_at = Date.now();
  }

  getStatus(): BackfillStatus {
    return {
      ...this.status,
      sources: this.status.sources.map((s) => ({ ...s })),
    };
  }

  private async runAll(opts: BackfillStartOpts): Promise<void> {
    for (const srcType of opts.source_types) {
      if (this.abortController?.signal.aborted) break;

      const idx = this.status.sources.findIndex((s) => s.source === srcType);
      if (idx < 0) continue;
      this.status.sources[idx].status = "running";

      try {
        const result = await this.runForSource(srcType, opts.since_ms);
        this.status.sources[idx].processed = result.totalMessages;
        this.status.sources[idx].blocks = result.totalBlocks;
        this.status.sources[idx].status = result.fatal ? "error" : "done";
        if (result.fatal) this.status.sources[idx].error = result.error;
        this.status.total_messages += result.totalMessages;
        this.status.total_blocks += result.totalBlocks;
      } catch (err) {
        this.status.sources[idx].status = "error";
        this.status.sources[idx].error = err instanceof Error ? err.message : String(err);
      }
    }

    if (!this.abortController?.signal.aborted) {
      this.status.state = "done";
      this.status.finished_at = Date.now();
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/user/memoark && bun test src/server/backfill-job.test.ts
```
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/backfill-job.ts src/server/backfill-job.test.ts
git commit -m "feat: add BackfillJob state machine with injectable runForSource"
```

---

## Task 3: Backfill API routes + mount in `api.ts`

**Files:**
- Create: `src/server/backfill-routes.ts`
- Create: `src/server/backfill-routes.test.ts`
- Modify: `src/server/api.ts`

Routes:
- `POST /api/backfill/start` — body `{ since_ms, source_types }`, starts job, 409 if running
- `POST /api/backfill/cancel` — idempotent cancel
- `GET /api/backfill/status` — returns `BackfillStatus`
- `GET /api/backfill/coverage` — timeline entry density (7-day buckets, last 2 years)

`createBackfillRoutes` is the factory; it also contains the real `runForSource` implementation (builds temp feishu config, runs pipeline).

- [ ] **Step 1: Write failing route tests**

Create `src/server/backfill-routes.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createBackfillRoutes } from "./backfill-routes.js";
import { BackfillJob } from "./backfill-job.js";
import type { BackfillStatus } from "./backfill-job.js";

function makeJob(overrides: Partial<BackfillStatus> = {}): BackfillJob {
  const status: BackfillStatus = {
    state: "idle",
    sources: [],
    total_messages: 0,
    total_blocks: 0,
    ...overrides,
  };
  const job = new BackfillJob(vi.fn());
  vi.spyOn(job, "getStatus").mockReturnValue(status);
  return job;
}

function makeStores() {
  return {
    db: {
      pg: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      },
    },
  } as never;
}

describe("backfill routes", () => {
  describe("GET /api/backfill/status", () => {
    it("returns current job status", async () => {
      const job = makeJob({ state: "idle", total_messages: 0, total_blocks: 0 });
      const app = createBackfillRoutes(job, makeStores(), "/fake/config.yaml");
      const res = await app.request("/api/backfill/status");
      expect(res.status).toBe(200);
      const body = (await res.json()) as BackfillStatus;
      expect(body.state).toBe("idle");
    });
  });

  describe("POST /api/backfill/start", () => {
    it("returns 400 when since_ms is missing", async () => {
      const job = makeJob();
      const app = createBackfillRoutes(job, makeStores(), "/fake/config.yaml");
      const res = await app.request("/api/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_types: ["dm"] }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when source_types is missing or empty", async () => {
      const job = makeJob();
      const app = createBackfillRoutes(job, makeStores(), "/fake/config.yaml");
      const res = await app.request("/api/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since_ms: 1000 }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 409 when job is already running", async () => {
      const job = makeJob({ state: "running" });
      vi.spyOn(job, "start"); // so we can verify it was NOT called
      const app = createBackfillRoutes(job, makeStores(), "/fake/config.yaml");
      const res = await app.request("/api/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since_ms: 1000, source_types: ["dm"] }),
      });
      expect(res.status).toBe(409);
      expect(job.start).not.toHaveBeenCalled();
    });

    it("calls job.start and returns 202 when idle", async () => {
      const job = makeJob({ state: "idle" });
      vi.spyOn(job, "start");
      const app = createBackfillRoutes(job, makeStores(), "/fake/config.yaml");
      const res = await app.request("/api/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since_ms: 500_000, source_types: ["dm", "mail"] }),
      });
      expect(res.status).toBe(202);
      expect(job.start).toHaveBeenCalledWith(
        expect.objectContaining({ since_ms: 500_000, source_types: ["dm", "mail"] }),
      );
    });
  });

  describe("POST /api/backfill/cancel", () => {
    it("calls job.cancel and returns 200", async () => {
      const job = makeJob();
      vi.spyOn(job, "cancel");
      const app = createBackfillRoutes(job, makeStores(), "/fake/config.yaml");
      const res = await app.request("/api/backfill/cancel", { method: "POST" });
      expect(res.status).toBe(200);
      expect(job.cancel).toHaveBeenCalled();
    });
  });

  describe("GET /api/backfill/coverage", () => {
    it("returns buckets array from DB query", async () => {
      const stores = {
        db: {
          pg: {
            query: vi.fn().mockResolvedValue({
              rows: [
                { week_start_ms: "1000000000000", count: 3 },
                { week_start_ms: "1000604800000", count: 7 },
              ],
            }),
          },
        },
      } as never;
      const app = createBackfillRoutes(makeJob(), stores, "/fake/config.yaml");
      const res = await app.request("/api/backfill/coverage");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { buckets: Array<{ week_start: number; count: number }> };
      expect(body.buckets).toHaveLength(2);
      expect(body.buckets[0]).toEqual({ week_start: 1_000_000_000_000, count: 3 });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/user/memoark && bun test src/server/backfill-routes.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createBackfillRoutes`**

Create `src/server/backfill-routes.ts`:

```typescript
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { loadConfig } from "../core/config.js";
import { type PipelineConfig, runPipeline } from "../core/pipeline.js";
import { createFeishuCollector } from "../collectors/feishu/collector.js";
import { createLLMProvider } from "../extractors/providers/index.js";
import {
  BackfillJob,
  type BackfillSourceType,
  type RunForSourceFn,
} from "./backfill-job.js";
import type { StoreContext } from "./api.js";

function expandDataDir(dir: string): string {
  if (dir.startsWith("~/")) return resolve(homedir(), dir.slice(2));
  if (dir === "~") return homedir();
  return dir;
}

function buildRunForSource(stores: StoreContext, configPath: string): RunForSourceFn {
  return async (sourceType: BackfillSourceType, sinceMs: number) => {
    const config = loadConfig(configPath);

    if (!config.sources.feishu?.app_id) {
      return {
        fatal: true,
        error: "Feishu not configured",
        totalMessages: 0,
        totalBlocks: 0,
        okBlocks: 0,
        skippedBlocks: 0,
        failedBlocks: 0,
        okMessages: [],
        skippedMessages: [],
        failedMessages: [],
        warnings: [],
      };
    }

    // Build temp feishu config: only the target sub-source enabled, with override_since_ms
    const feishuBase = config.sources.feishu;
    const subSource = feishuBase.sources[sourceType];
    if (!subSource) {
      return {
        fatal: true,
        error: `Source ${sourceType} not configured`,
        totalMessages: 0,
        totalBlocks: 0,
        okBlocks: 0,
        skippedBlocks: 0,
        failedBlocks: 0,
        okMessages: [],
        skippedMessages: [],
        failedMessages: [],
        warnings: [],
      };
    }

    const feishuConfig = {
      ...feishuBase,
      sources: {
        messages: { enabled: false, chat_ids: [] as string[] },
        dm: { enabled: false, dm_chat_ids: [] as string[] },
        mail: { enabled: false },
        message_search: { enabled: false },
        // keep docs/tasks/calendar from original config (won't be enabled for backfill)
        docs: feishuBase.sources.docs,
        tasks: feishuBase.sources.tasks,
        calendar: feishuBase.sources.calendar,
        [sourceType]: { ...subSource, enabled: true, override_since_ms: sinceMs },
      },
    };

    const collector = createFeishuCollector(feishuConfig as never);

    const dataDir = expandDataDir(config.store.data_dir);
    mkdirSync(dataDir, { recursive: true });
    const stateDir = resolve(process.cwd(), ".memoark");
    mkdirSync(stateDir, { recursive: true });

    const pipelineConfig: PipelineConfig = {
      dedup_checkpoint: resolve(stateDir, "dedup.jsonl"),
      cursor_checkpoint: resolve(stateDir, "cursors.yaml"),
      block_gap_minutes: config.block_builder.block_gap_minutes,
      max_block_tokens: config.block_builder.max_block_tokens,
      max_block_messages: config.block_builder.max_block_messages,
      privacy: config.privacy,
      output_dir: dataDir,
      block_concurrency: config.pipeline?.block_concurrency,
    };

    const llmConfig = { ...config.llm };
    if (!llmConfig.api_key) {
      llmConfig.api_key =
        llmConfig.provider === "anthropic"
          ? process.env.ANTHROPIC_API_KEY
          : process.env.OPENAI_API_KEY;
    }
    const provider = createLLMProvider(llmConfig);

    return runPipeline(pipelineConfig, {
      source: collector,
      provider,
      format: "json",
      adapter: "store",
      stores: stores as never,
    });
  };
}

const VALID_SOURCE_TYPES: BackfillSourceType[] = ["dm", "messages", "mail", "message_search"];

export function createBackfillRoutes(
  job: BackfillJob,
  stores: StoreContext,
  configPath: string,
): Hono {
  const app = new Hono();

  app.get("/api/backfill/status", (c) => c.json(job.getStatus()));

  app.post("/api/backfill/start", async (c) => {
    const body = await c.req.json<{ since_ms?: unknown; source_types?: unknown }>();
    if (typeof body.since_ms !== "number") {
      return c.json({ error: "since_ms (number) required" }, 400);
    }
    if (!Array.isArray(body.source_types) || body.source_types.length === 0) {
      return c.json({ error: "source_types (non-empty array) required" }, 400);
    }

    const status = job.getStatus();
    if (status.state === "running") {
      return c.json({ error: "A backfill job is already running" }, 409);
    }

    const sourceTypes = (body.source_types as string[]).filter((t): t is BackfillSourceType =>
      VALID_SOURCE_TYPES.includes(t as BackfillSourceType),
    );
    if (sourceTypes.length === 0) {
      return c.json({ error: "No valid source_types provided" }, 400);
    }

    job.start({ since_ms: body.since_ms, source_types: sourceTypes });
    return c.json({ started: true }, 202);
  });

  app.post("/api/backfill/cancel", (c) => {
    job.cancel();
    return c.json({ ok: true });
  });

  app.get("/api/backfill/coverage", async (c) => {
    const result = await (stores as StoreContext & { db: { pg: { query: (sql: string) => Promise<{ rows: unknown[] }> } } }).db.pg.query(`
      SELECT
        (floor(extract(epoch from to_date(left(date, 10), 'YYYY-MM-DD')) / (7 * 86400))
         * 7 * 86400 * 1000)::bigint AS week_start_ms,
        count(*)::int AS count
      FROM timeline_entries
      WHERE source = 'feishu'
        AND date ~ '^\\d{4}-\\d{2}-\\d{2}'
        AND date >= to_char(now() - interval '104 weeks', 'YYYY-MM-DD')
      GROUP BY week_start_ms
      ORDER BY week_start_ms
    `);
    const buckets = (result.rows as Array<{ week_start_ms: string; count: number }>).map((row) => ({
      week_start: Number(row.week_start_ms),
      count: row.count,
    }));
    return c.json({ buckets });
  });

  return app;
}

export function createDefaultBackfillRoutes(stores: StoreContext, configPath: string): Hono {
  const runForSource = buildRunForSource(stores, configPath);
  const job = new BackfillJob(runForSource);
  return createBackfillRoutes(job, stores, configPath);
}
```

- [ ] **Step 4: Mount routes in `api.ts`**

In `src/server/api.ts`, add import at the top:
```typescript
import { createDefaultBackfillRoutes } from "./backfill-routes.js";
```

Add mount immediately after the `configRoutes` mount (around line 40):
```typescript
  const backfillRoutes = createDefaultBackfillRoutes(stores, resolve(process.cwd(), "memoark.yaml"));
  app.route("/", backfillRoutes);
```

- [ ] **Step 5: Run route tests to verify they pass**

```bash
cd /home/user/memoark && bun test src/server/backfill-routes.test.ts
```
Expected: All 7 tests PASS.

- [ ] **Step 6: Run full test suite**

```bash
cd /home/user/memoark && bun test
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/backfill-routes.ts src/server/backfill-routes.test.ts src/server/api.ts
git commit -m "feat: add backfill API routes (start/cancel/status/coverage)"
```

---

## Task 4: Frontend API client

**Files:**
- Create: `web/src/api/backfill.ts`

Follows the same pattern as `web/src/api/config.ts` — a `fetchJSON` helper and a named export object with typed methods.

- [ ] **Step 1: Implement `web/src/api/backfill.ts`**

```typescript
import type { BackfillSourceType, BackfillStatus } from "../../../src/server/backfill-job.js";

// Re-export types for frontend use (avoids importing from src/server at runtime)
export type { BackfillSourceType, BackfillStatus };
export type { SourceProgress } from "../../../src/server/backfill-job.js";

export interface CoverageBucket {
  week_start: number;
  count: number;
}

const BASE = "/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const backfillApi = {
  getStatus(): Promise<BackfillStatus> {
    return fetchJSON("/backfill/status");
  },

  start(sinceMs: number, sourceTypes: BackfillSourceType[]): Promise<{ started: boolean }> {
    return fetchJSON("/backfill/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ since_ms: sinceMs, source_types: sourceTypes }),
    });
  },

  cancel(): Promise<{ ok: boolean }> {
    return fetchJSON("/backfill/cancel", { method: "POST" });
  },

  getCoverage(): Promise<{ buckets: CoverageBucket[] }> {
    return fetchJSON("/backfill/coverage");
  },
};
```

Note: The type imports cross the `src/server` boundary for convenience. At build time these are type-only imports and don't affect the bundle. Alternatively, copy the type definitions inline — either approach is fine.

- [ ] **Step 2: Check for TypeScript errors**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | head -30
```
Expected: Build succeeds (or only shows unrelated pre-existing warnings, not errors from `backfill.ts`).

- [ ] **Step 3: Commit**

```bash
git add web/src/api/backfill.ts
git commit -m "feat: add frontend backfill API client"
```

---

## Task 5: AutoFetchSection + FetchPage root

**Files:**
- Create: `web/src/pages/fetch/index.tsx`
- Create: `web/src/pages/fetch/sections/AutoFetchSection.tsx`

`FetchPage` reuses the `Section` collapsible component pattern from `ConfigPage`. `AutoFetchSection` reads/writes `GET /api/config` → `scheduler` field.

- [ ] **Step 1: Create `AutoFetchSection.tsx`**

Create `web/src/pages/fetch/sections/AutoFetchSection.tsx`:

```typescript
import { useState } from "react";
import type { WizardConfig } from "../../../api/config";

interface Props {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

interface SchedulerSourceRow {
  id: string;
  label: string;
}

const KNOWN_SOURCES: SchedulerSourceRow[] = [
  { id: "feishu", label: "Feishu" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "hermes", label: "Hermes" },
];

export function AutoFetchSection({ config, onSave }: Props) {
  const scheduler = config.scheduler as {
    enabled?: boolean;
    tick_interval_secs?: number;
    defaults?: { interval_secs?: number };
    sources?: Record<string, { enabled?: boolean; interval_secs?: number }>;
  } | undefined;

  const [enabled, setEnabled] = useState(scheduler?.enabled ?? false);
  const [defaultInterval, setDefaultInterval] = useState(
    String(scheduler?.defaults?.interval_secs ?? 3600),
  );
  const [sourceIntervals, setSourceIntervals] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const { id } of KNOWN_SOURCES) {
      const val = scheduler?.sources?.[id]?.interval_secs;
      out[id] = val !== undefined ? String(val) : "";
    }
    return out;
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const sources: Record<string, { interval_secs?: number }> = {};
      for (const { id } of KNOWN_SOURCES) {
        const raw = sourceIntervals[id];
        if (raw !== "") {
          const n = Number(raw);
          if (Number.isFinite(n) && n > 0) sources[id] = { interval_secs: n };
        }
      }
      await onSave({
        scheduler: {
          enabled,
          tick_interval_secs: scheduler?.tick_interval_secs ?? 60,
          defaults: { interval_secs: Number(defaultInterval) || 3600 },
          sources,
        },
      } as Partial<WizardConfig>);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm font-medium text-fg-default">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border-default"
          />
          启用定时抓取
        </label>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">
          默认抓取间隔（秒）
        </label>
        <input
          type="number"
          min="60"
          value={defaultInterval}
          onChange={(e) => setDefaultInterval(e.target.value)}
          className="w-40 rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default"
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-fg-muted">各数据源独立间隔（留空 = 用全局默认值）</p>
        {KNOWN_SOURCES.map(({ id, label }) => (
          <div key={id} className="flex items-center gap-3">
            <span className="w-28 text-sm text-fg-default">{label}</span>
            <input
              type="number"
              min="60"
              placeholder={defaultInterval}
              value={sourceIntervals[id]}
              onChange={(e) =>
                setSourceIntervals((prev) => ({ ...prev, [id]: e.target.value }))
              }
              className="w-32 rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default"
            />
            <span className="text-xs text-fg-muted">秒</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `FetchPage` root (`web/src/pages/fetch/index.tsx`)**

```typescript
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConfigDiagnostic, WizardConfig } from "../../api/config";
import { configApi } from "../../api/config";
import { AutoFetchSection } from "./sections/AutoFetchSection";
import { BackfillSection } from "./sections/BackfillSection";

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border-default bg-bg-default">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold text-fg-default">{title}</span>
        <span className="text-fg-muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="border-t border-border-default px-5 py-4">{children}</div>}
    </div>
  );
}

export function FetchPage() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: configApi.getConfig,
  });

  const saveMutation = useMutation({
    mutationFn: (next: WizardConfig) => configApi.saveConfig(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async (patch: Partial<WizardConfig>) => {
    setSaveError(null);
    const merged: WizardConfig = { ...config, ...patch };
    const result = await saveMutation.mutateAsync(merged);
    if (!result.ok) {
      setSaveError(
        result.diagnostics
          .filter((d: ConfigDiagnostic) => d.severity === "error")
          .map((d: ConfigDiagnostic) => d.message)
          .join(", "),
      );
    }
  };

  if (isLoading || !config) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-fg-muted">
        Loading...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-fg-default">数据抓取</h1>

      {saveError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <div className="flex flex-col gap-4">
        <Section title="定时抓取（Auto-fetch）">
          <AutoFetchSection config={config} onSave={handleSave} />
        </Section>
        <Section title="历史回溯">
          <BackfillSection />
        </Section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Check for build errors**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | head -30
```
Expected: Build succeeds (BackfillSection not yet created — it will fail here, that's expected; continue to Task 6).

Actually to avoid a build failure, add a stub for BackfillSection first:

In the same import line change:
```typescript
// Temporarily stub BackfillSection for build validation
function BackfillSection() {
  return <div className="text-fg-muted text-sm">Coming soon…</div>;
}
```

Remove this stub after Task 6 adds the real file.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/fetch/index.tsx web/src/pages/fetch/sections/AutoFetchSection.tsx
git commit -m "feat: add FetchPage and AutoFetchSection components"
```

---

## Task 6: BackfillSection — coverage heatmap + control panel

**Files:**
- Create: `web/src/pages/fetch/sections/BackfillSection.tsx`
- Modify: `web/src/pages/fetch/index.tsx` — remove stub, add real import

This is the most complex UI component. It has three sub-parts:
1. **Coverage heatmap**: 104 cells, blue intensity by count, rendered as a grid of `<div>` cells
2. **Range slider**: `<input type="range">` overlaid below the heatmap, maps to a date
3. **Task control panel**: conditional rendering based on `state` (idle/running/done/error)

- [ ] **Step 1: Implement `BackfillSection.tsx`**

Create `web/src/pages/fetch/sections/BackfillSection.tsx`:

```typescript
import { useEffect, useRef, useState } from "react";
import { backfillApi } from "../../../api/backfill";
import type { BackfillSourceType, BackfillStatus, CoverageBucket } from "../../../api/backfill";

const WEEKS = 104;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const SOURCE_LABELS: Record<BackfillSourceType, string> = {
  messages: "群聊消息",
  dm: "DM",
  mail: "邮件",
  message_search: "消息搜索",
};

const ALL_SOURCES: BackfillSourceType[] = ["messages", "dm", "mail", "message_search"];

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function monthsAgo(ms: number): string {
  const months = Math.round((Date.now() - ms) / (30 * 24 * 60 * 60 * 1000));
  if (months < 1) return "不到 1 个月前";
  if (months === 1) return "约 1 个月前";
  return `约 ${months} 个月前`;
}

// ── Heatmap ───────────────────────────────────────────────────────────────────

function CoverageHeatmap({
  buckets,
  sliderValue,
  onSliderChange,
}: {
  buckets: CoverageBucket[];
  sliderValue: number; // 0 = oldest (2y ago), WEEKS = today
  onSliderChange: (v: number) => void;
}) {
  const now = Date.now();
  // Build lookup: week index → count
  const countByIdx = new Map<number, number>();
  let maxCount = 0;
  for (const b of buckets) {
    const weeksAgo = Math.floor((now - b.week_start) / MS_PER_WEEK);
    if (weeksAgo >= 0 && weeksAgo < WEEKS) {
      const idx = WEEKS - 1 - weeksAgo; // idx 0 = oldest, idx 103 = newest
      countByIdx.set(idx, b.count);
      if (b.count > maxCount) maxCount = b.count;
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-fg-muted">时间线条目密度（飞书）— 空白格表示该周无时间线事件，非未抓取</p>
      <div className="relative">
        {/* Heatmap grid */}
        <div className="flex gap-[2px]">
          {Array.from({ length: WEEKS }, (_, i) => {
            const count = countByIdx.get(i) ?? 0;
            const intensity = maxCount > 0 ? count / maxCount : 0;
            const bg =
              count === 0
                ? "bg-gray-100 dark:bg-gray-800"
                : `rgba(37,99,235,${0.15 + intensity * 0.85})`;
            return (
              <div
                key={i}
                title={`${count} 条`}
                className="h-4 flex-1 rounded-sm"
                style={count > 0 ? { backgroundColor: bg } : undefined}
              />
            );
          })}
        </div>

        {/* Slider overlay */}
        <input
          type="range"
          min={0}
          max={WEEKS}
          value={sliderValue}
          onChange={(e) => onSliderChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          style={{ WebkitAppearance: "none" }}
        />

        {/* Slider thumb indicator */}
        <div
          className="pointer-events-none absolute top-0 h-full w-[2px] bg-blue-500"
          style={{ left: `${(sliderValue / WEEKS) * 100}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-fg-muted">
        <span>2 年前</span>
        <span>今天</span>
      </div>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <div
        className="h-full rounded-full bg-blue-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function BackfillSection() {
  const [buckets, setBuckets] = useState<CoverageBucket[]>([]);
  const [sliderValue, setSliderValue] = useState(52); // default: 1 year ago
  const [selectedSources, setSelectedSources] = useState<Set<BackfillSourceType>>(
    new Set(ALL_SOURCES),
  );
  const [status, setStatus] = useState<BackfillStatus>({
    state: "idle",
    sources: [],
    total_messages: 0,
    total_blocks: 0,
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStateRef = useRef<string>("idle");

  // Load coverage on mount
  useEffect(() => {
    backfillApi.getCoverage().then((res) => setBuckets(res.buckets)).catch(() => {});
  }, []);

  // Reload coverage once when state transitions to done
  useEffect(() => {
    if (prevStateRef.current !== "done" && status.state === "done") {
      backfillApi.getCoverage().then((res) => setBuckets(res.buckets)).catch(() => {});
    }
    prevStateRef.current = status.state;
  }, [status.state]);

  // Poll status while running
  useEffect(() => {
    if (status.state === "running") {
      pollRef.current = setInterval(() => {
        backfillApi.getStatus().then(setStatus).catch(() => {});
      }, 2000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [status.state]);

  // Compute since_ms from slider position
  const now = Date.now();
  const sinceMs = now - (WEEKS - sliderValue) * MS_PER_WEEK;

  const maxProcessed = Math.max(1, ...status.sources.map((s) => s.processed));
  const elapsedMs =
    status.started_at
      ? (status.finished_at ?? Date.now()) - status.started_at
      : 0;

  const handleStart = async () => {
    const types = ALL_SOURCES.filter((t) => selectedSources.has(t));
    if (types.length === 0) return;
    await backfillApi.start(sinceMs, types);
    const s = await backfillApi.getStatus();
    setStatus(s);
  };

  const handleCancel = async () => {
    await backfillApi.cancel();
    const s = await backfillApi.getStatus();
    setStatus(s);
  };

  const handleReset = async () => {
    // After done/error, re-fetch status which should be idle after cancel/done
    const s = await backfillApi.getStatus();
    setStatus(s);
  };

  const toggleSource = (src: BackfillSourceType) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <CoverageHeatmap
        buckets={buckets}
        sliderValue={sliderValue}
        onSliderChange={setSliderValue}
      />

      {/* Control panel */}
      {status.state === "idle" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-default">
            回溯起始：<strong>{formatDate(sinceMs)}</strong>（{monthsAgo(sinceMs)}）
          </p>
          <div className="flex flex-wrap gap-3">
            {ALL_SOURCES.map((src) => (
              <label key={src} className="flex items-center gap-1.5 text-sm text-fg-default">
                <input
                  type="checkbox"
                  checked={selectedSources.has(src)}
                  onChange={() => toggleSource(src)}
                  className="h-4 w-4 rounded border-border-default"
                />
                {SOURCE_LABELS[src]}
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button
              onClick={handleStart}
              disabled={selectedSources.size === 0}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              开始回溯
            </button>
          </div>
        </div>
      )}

      {status.state === "running" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-fg-default">
              ■ 正在回溯… 已用时 {formatDuration(elapsedMs)}
            </span>
            <button
              onClick={handleCancel}
              className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              取消
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {status.sources.map((src) => (
              <div key={src.source} className="flex items-center gap-3">
                <span className="w-24 text-sm text-fg-default">{SOURCE_LABELS[src.source]}</span>
                <div className="flex-1">
                  {src.status === "pending" ? (
                    <div className="h-2 w-full rounded-full bg-gray-100" />
                  ) : (
                    <ProgressBar value={src.processed} max={maxProcessed} />
                  )}
                </div>
                <span className="w-16 text-right text-xs text-fg-muted">
                  {src.status !== "pending" ? `${src.processed} 条` : ""}
                </span>
                <span
                  className={`w-16 text-right text-xs ${
                    src.status === "error"
                      ? "text-red-500"
                      : src.status === "done"
                        ? "text-green-600"
                        : "text-fg-muted"
                  }`}
                >
                  {src.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {status.state === "done" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-green-600">
            ✓ 回溯完成（{formatDuration(elapsedMs)}）
          </p>
          <p className="text-sm text-fg-muted">
            共抓取 {status.total_messages} 条消息 → 生成 {status.total_blocks} 个 block
          </p>
          <div className="flex justify-end">
            <button
              onClick={handleReset}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              再次回溯
            </button>
          </div>
        </div>
      )}

      {status.state === "error" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-red-600">
            ✗ {status.error === "cancelled" ? "任务已取消" : `出错：${status.error}`}
          </p>
          <div className="flex justify-end">
            <button
              onClick={handleReset}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              重新开始
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Remove stub from `index.tsx`, add real import**

In `web/src/pages/fetch/index.tsx`, replace the stub `BackfillSection` function (added in Task 5 step 3) with:

```typescript
import { BackfillSection } from "./sections/BackfillSection";
```

- [ ] **Step 3: Build and check for errors**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | head -40
```
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/fetch/sections/BackfillSection.tsx web/src/pages/fetch/index.tsx
git commit -m "feat: add BackfillSection with coverage heatmap and task control panel"
```

---

## Task 7: Router wiring

**Files:**
- Modify: `web/src/router.tsx`

Add `/fetch` inside the `Shell` children, after `timeline`.

- [ ] **Step 1: Update `router.tsx`**

In `web/src/router.tsx`, add the import:
```typescript
import { FetchPage } from "./pages/fetch/index";
```

Add the route inside `Shell` children after `{ path: "timeline", element: <TimelinePage /> }`:
```typescript
{ path: "fetch", element: <FetchPage /> },
```

The full children array becomes:
```typescript
children: [
  { index: true, element: <Dashboard /> },
  { path: "timeline", element: <TimelinePage /> },
  { path: "fetch", element: <FetchPage /> },
  { path: "graph", element: <GraphPage /> },
  { path: "entity/*", element: <EntityDetail /> },
  { path: "entities", element: <Navigate to="/pages" replace /> },
  { path: "pages", element: <PageList /> },
  { path: "pages/*", element: <PageDetail /> },
  { path: "search", element: <SearchPage /> },
],
```

- [ ] **Step 2: Add "数据抓取" link to sidebar navigation**

Find the sidebar nav component (`web/src/components/layout/shell.tsx` or similar):

```bash
grep -rn "timeline\|sidebar\|nav" /home/user/memoark/web/src/components/layout/ --include="*.tsx" -l
```

Open the shell/sidebar file and add a nav item for Fetch. It will follow the existing nav item pattern. Find where the "timeline" nav item is defined and add `fetch` after it. The exact code depends on the shell file — look for a pattern like:

```typescript
{ path: "/timeline", label: "Timeline" }
```

And add:
```typescript
{ path: "/fetch", label: "数据抓取" }
```

- [ ] **Step 3: Final build check**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | head -40
```
Expected: Build succeeds.

- [ ] **Step 4: Run full test suite**

```bash
cd /home/user/memoark && bun test
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/router.tsx web/src/components/
git commit -m "feat: wire /fetch route and sidebar nav link"
```

- [ ] **Step 6: Push**

```bash
git push -u origin claude/repository-issues-review-TZG4j
```

---

## Self-Review Notes

After writing the plan, I checked spec coverage and type consistency:

- ✅ `override_since_ms` added to all 4 source types in `types.ts`; `resolveStartTime` logic correct (priority: `overrideSinceMs` < `last_sync_at` → use override; else use checkpoint; else use lookbackDays fallback)
- ✅ Only `messages/dm/mail/message_search` in backfill scope; `docs/tasks/calendar` excluded
- ✅ Sub-source isolation: each `runForSource` call sets all other feishu sub-sources disabled
- ✅ Scheduler sourceId is `"feishu"` (not `feishu_dm` etc.) — AutoFetchSection uses `KNOWN_SOURCES` array with `"feishu"` as the feishu key
- ✅ Coverage query uses `timeline_entries WHERE source = 'feishu'` (verified against schema.sql)
- ✅ `/fetch` inside `Shell` (with sidebar), not outside like `/config`
- ✅ `WizardConfig` type extended with `scheduler` field — checked: `configApi.saveConfig` accepts `WizardConfig`, which may need a `scheduler` field added. The cast `as Partial<WizardConfig>` handles TypeScript, but ideally add `scheduler?: SchedulerConfig` to `WizardConfig` in `web/src/api/config.ts`. This is a minor extension — add it during Task 5 if TypeScript complains.
- ✅ `BackfillJob.start()` passes `configPath` — wait, the refactored design injects `runForSource` rather than `configPath`. The `start()` method only takes `{ since_ms, source_types }`, which is correct — `configPath` is closed over in `buildRunForSource` inside the factory.
- ⚠️ `handleReset` in BackfillSection just re-fetches status (which may still show `done/error`). After a backfill is done, the user clicking "再次回溯" should ideally reset the job state to `idle`. Currently there's no reset endpoint. Solution: either add a `POST /api/backfill/reset` route, or re-use `cancel()` which only affects running state. **Fix:** In BackfillJob, add a `reset()` method that sets state back to `idle` when done/error. Add a `POST /api/backfill/reset` route. Add this to Task 3's backfill-routes. Then `handleReset` calls `backfillApi.reset()` and refreshes status.

**Post-review fix for `handleReset` / reset flow:**

Add to `BackfillJob` in `backfill-job.ts`:
```typescript
reset(): void {
  if (this.status.state === "running") return; // can't reset while running
  this.abortController = null;
  this.status = { state: "idle", sources: [], total_messages: 0, total_blocks: 0 };
}
```

Add test:
```typescript
it("reset after done returns to idle", async () => {
  const runForSource = vi.fn().mockResolvedValue(makeResult());
  const job = new BackfillJob(runForSource);
  job.start({ since_ms: 0, source_types: ["dm"] });
  await wait(20);
  expect(job.getStatus().state).toBe("done");
  job.reset();
  expect(job.getStatus().state).toBe("idle");
});
```

Add route in `backfill-routes.ts`:
```typescript
app.post("/api/backfill/reset", (c) => {
  job.reset();
  return c.json({ ok: true });
});
```

Add to frontend API:
```typescript
reset(): Promise<{ ok: boolean }> {
  return fetchJSON("/backfill/reset", { method: "POST" });
}
```

Update `handleReset` in BackfillSection:
```typescript
const handleReset = async () => {
  await backfillApi.reset();
  setStatus(await backfillApi.getStatus());
};
```

Include these additions in their respective tasks.
