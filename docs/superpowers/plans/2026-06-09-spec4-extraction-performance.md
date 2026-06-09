# Spec 4 — Extraction Pipeline Performance Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut MailSource fetch time from ~23 min (serial) to ~5 min (concurrent) for 200 emails, make block-processing concurrency configurable, and replace the per-chunk INSERT loop with a single batch INSERT.

**Architecture:** Three independent changes in dependency order: (1) `MailSource.fetchConcurrent()` — batch-parallel CLI subprocess calls controlled by `sources.mail.fetch_concurrency`; (2) `ChunkStore.rechunk()` batch INSERT — drops the serial loop for a single multi-row statement; (3) `PipelineConfig.block_concurrency` — promotes the hardcoded `CONCURRENCY = 5` constant to a YAML-configurable field threaded through `Config → buildPipelineConfig → runPipeline`.

**Tech Stack:** TypeScript, Bun, Vitest, PGlite (PostgreSQL-in-WASM). Tests run with `bun test`. Type-check with `bun run typecheck`.

---

## File Map

| File | Change |
|------|--------|
| `src/collectors/feishu/sources/mail.ts` | Add `fetchConcurrency` to opts; add `fetchConcurrent()` generator; refactor `fetch()` |
| `src/collectors/feishu/types.ts` | Add `fetch_concurrency?: number` to `FeishuMailSourceConfig` |
| `src/core/config.ts` | Add `mail` source type + `pipeline?: { block_concurrency?: number }` to `Config` |
| `src/collectors/feishu/collector.ts` | Pass `fetch_concurrency` when constructing `MailSource` |
| `src/store/chunks.ts` | Replace serial INSERT loop with single batch INSERT in `rechunk()` |
| `src/core/pipeline.ts` | Add `block_concurrency?` to `PipelineConfig`; use `config.block_concurrency ?? 5` |
| `src/core/pipeline-factory.ts` | Forward `config.pipeline?.block_concurrency` into `PipelineConfig` |
| `src/cli.ts` | Add `block_concurrency` to the inline `pipelineConfig` object in the `extract` command |
| `tests/collectors/feishu/sources/mail.test.ts` | Add concurrent-fetch tests |
| `tests/core/pipeline-factory.test.ts` | Add `block_concurrency` passthrough test |

---

## Task 1: MailSource concurrent fetch (Phase 1)

**Files:**
- Modify: `src/collectors/feishu/sources/mail.ts`
- Modify: `src/collectors/feishu/types.ts`
- Modify: `src/core/config.ts`
- Modify: `src/collectors/feishu/collector.ts`
- Test: `tests/collectors/feishu/sources/mail.test.ts`

- [ ] **Step 1: Write failing tests for concurrent fetch**

Add these two tests at the bottom of `tests/collectors/feishu/sources/mail.test.ts`, inside the existing `describe("MailSource", () => { ... })` block (before the closing `}`):

```typescript
  it("fetches all emails when fetch_concurrency > 1", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
      mail_002: messageResponse002,
    });
    const source = new MailSource(client, { lookbackDays: 30, fetchConcurrency: 2 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.metadata?.message_id).sort();
    expect(ids).toEqual(["mail_001", "mail_002"]);
  });

  it("skips failed items but yields successful ones in concurrent batch", async () => {
    const client = createMockClient(triageResponse, {
      mail_001: messageResponse001,
    });
    (client.execShortcut as ReturnType<typeof vi.fn>).mockImplementation(
      async (_domain: string, shortcut: string, flags?: string[]) => {
        if (shortcut === "triage") return triageResponse;
        if (shortcut === "message") {
          const idIdx = flags?.indexOf("--message-id");
          if (idIdx !== undefined && idIdx >= 0 && flags) {
            const id = flags[idIdx + 1];
            if (id === "mail_002") throw new Error("timeout");
            return messageResponse001;
          }
        }
        return "{}";
      },
    );
    const source = new MailSource(client, { lookbackDays: 30, fetchConcurrency: 2 });

    const results = [];
    for await (const msg of source.fetch(null, staging)) {
      results.push(msg);
    }

    expect(results).toHaveLength(1);
    expect(results[0].metadata?.message_id).toBe("mail_001");
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/collectors/feishu/sources/mail.test.ts
```

Expected: 2 new tests fail with "MailSource is not a constructor" or "fetchConcurrency is not a recognized option" (the existing 11 tests should still pass).

- [ ] **Step 3: Add `fetch_concurrency` to `FeishuMailSourceConfig` in `src/collectors/feishu/types.ts`**

Find the interface (line ~43) and add the new field:

```typescript
export interface FeishuMailSourceConfig {
  enabled: boolean;
  lookback_days?: number;
  overlap_ms?: number;
  fetch_concurrency?: number;
}
```

- [ ] **Step 4: Add `mail` source type and `pipeline` config in `src/core/config.ts`**

**4a.** In `FeishuSourceConfig.sources` (around line 83), add `mail` after the existing `message_search` entry:

```typescript
  sources: {
    messages?: {
      enabled: boolean;
      chat_ids: string[];
      lookback_days?: number;
      overlap_ms?: number;
    };
    calendar?: { enabled: boolean; calendar_ids: string[] };
    docs?: {
      enabled: boolean;
      doc_folders: string[];
      doc_deep_extract_folders?: string[];
      doc_summary_max_chars?: number;
    };
    tasks?: { enabled: boolean };
    dm?: {
      enabled: boolean;
      dm_chat_ids?: string[];
      self_open_id?: string;
      lookback_days?: number;
      overlap_ms?: number;
    };
    message_search?: {
      enabled: boolean;
      chat_types?: Array<"p2p" | "group">;
      query?: string;
      sender_type?: "user" | "bot";
      exclude_sender_type?: "user" | "bot";
      lookback_days?: number;
      overlap_ms?: number;
      page_size?: number;
    };
    mail?: {
      enabled: boolean;
      lookback_days?: number;
      overlap_ms?: number;
      fetch_concurrency?: number;
    };
  };
```

**4b.** Add a `PipelineOptsConfig` interface and `pipeline` field to `Config` (after the `SchedulerConfig` interface, around line 160):

```typescript
export interface PipelineOptsConfig {
  block_concurrency?: number;
}
```

Then in the `Config` interface (around line 165), add:

```typescript
export interface Config {
  privacy: PrivacyConfig;
  llm: LLMConfig;
  block_builder: BlockBuilderConfig;
  adapters: AdaptersConfig;
  sources: SourcesConfig;
  store: StoreConfig;
  embedding: EmbeddingConfig;
  server: ServerConfig;
  scheduler?: SchedulerConfig;
  pipeline?: PipelineOptsConfig;
}
```

- [ ] **Step 5: Rewrite `src/collectors/feishu/sources/mail.ts`**

Replace the entire file with the concurrent implementation:

```typescript
import type { RawMessage } from "../../../core/types";
import type { CursorStaging } from "../cursor-staging";
import type { LarkCliHttpClient } from "../lark-cli-client";
import type { FeishuMailMessage, SourceCheckpoint } from "../types";
import type { FeishuSource } from "./base";

interface MailSourceOpts {
  lookbackDays: number;
  overlapMs?: number;
  fetchConcurrency?: number;
}

interface TriageItem {
  message_id: string;
  date: string;
  from: string;
  subject: string;
  thread_id?: string;
}

export class MailSource implements FeishuSource {
  readonly name = "mail";
  private readonly overlapMs: number;

  constructor(
    private readonly client: LarkCliHttpClient,
    private readonly opts: MailSourceOpts,
  ) {
    this.overlapMs = opts.overlapMs ?? 2000;
  }

  async *fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    try {
      const startMs = this.resolveStartTime(checkpoint);
      const triageItems = await this.fetchTriage();

      const filteredItems = triageItems.filter(
        (item) => new Date(item.date).getTime() >= startMs - this.overlapMs,
      );

      const concurrency = this.opts.fetchConcurrency ?? 1;
      let maxDateMs = 0;

      for await (const { item, detail } of this.fetchConcurrent(filteredItems, concurrency)) {
        if (!detail) continue;
        const itemDateMs = new Date(item.date).getTime();
        if (itemDateMs > maxDateMs) maxDateMs = itemDateMs;
        yield this.mapMessage(item, detail);
      }

      if (maxDateMs > 0) {
        cursorStaging.stage("mail", "INBOX", { last_sync_at: maxDateMs });
        cursorStaging.commit("mail", "INBOX");
      }
    } catch (err) {
      console.error("[MailSource] Failed to fetch mail:", err);
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private async *fetchConcurrent(
    items: TriageItem[],
    concurrency: number,
  ): AsyncGenerator<{ item: TriageItem; detail: FeishuMailMessage | null }> {
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (item) => ({ item, detail: await this.fetchMessage(item.message_id) })),
      );
      for (const pair of results) {
        yield pair;
      }
    }
  }

  private resolveStartTime(checkpoint: SourceCheckpoint | null): number {
    if (checkpoint?.INBOX?.last_sync_at) {
      return checkpoint.INBOX.last_sync_at as number;
    }
    const lookbackMs = this.opts.lookbackDays * 24 * 60 * 60 * 1000;
    return Date.now() - lookbackMs;
  }

  private async fetchTriage(): Promise<TriageItem[]> {
    const stdout = await this.client.execShortcut("mail", "triage", [
      "--filter",
      '{"folder":"INBOX"}',
    ]);
    try {
      const parsed = JSON.parse(stdout);
      if (parsed && Array.isArray(parsed.messages)) {
        return parsed.messages as TriageItem[];
      }
      if (Array.isArray(parsed)) {
        return parsed as TriageItem[];
      }
      return [];
    } catch {
      const lines = stdout.trim().split("\n").filter(Boolean);
      const items: TriageItem[] = [];
      for (const line of lines) {
        if (line.startsWith("[")) continue;
        try {
          const obj = JSON.parse(line);
          if (obj && Array.isArray(obj.messages)) {
            items.push(...(obj.messages as TriageItem[]));
          } else {
            items.push(obj as TriageItem);
          }
        } catch {}
      }
      return items;
    }
  }

  private async fetchMessage(messageId: string): Promise<FeishuMailMessage | null> {
    try {
      const stdout = await this.client.execShortcut("mail", "message", [
        "--message-id",
        messageId,
        "--html=false",
      ]);
      const parsed = JSON.parse(stdout);
      const raw = parsed?.data ?? parsed;
      if (raw.body_plain_text !== undefined && raw.body === undefined) {
        raw.body = raw.body_plain_text;
      }
      return raw as FeishuMailMessage;
    } catch (err) {
      console.error(`[MailSource] Failed to fetch message ${messageId}:`, err);
      return null;
    }
  }

  private mapMessage(triage: TriageItem, detail: FeishuMailMessage): RawMessage {
    const subject = detail.subject || triage.subject || "";
    const body = detail.body || "";
    const content = subject ? `${subject}\n\n${body}` : body;

    return {
      platform: "feishu",
      channel: "mail/INBOX",
      contact: triage.from || detail.from || "",
      timestamp: new Date(triage.date).toISOString(),
      content,
      direction: "received",
      metadata: {
        message_id: triage.message_id,
        thread_id: triage.thread_id || detail.thread_id || null,
        to: detail.to || [],
        cc: detail.cc || [],
        has_attachments: (detail.attachments?.length ?? 0) > 0,
        sensitivity: "high",
      },
      attachments: detail.attachments?.map((a) => ({
        id: a.file_name,
        type: "file",
        name: a.file_name,
      })),
    };
  }
}
```

- [ ] **Step 6: Update `FeishuCollector` to pass `fetch_concurrency` to `MailSource`**

In `src/collectors/feishu/collector.ts`, ensure the mail source block reads as follows (add the entire block if not present; update `fetchConcurrency` if the block already exists):

```typescript
    if (config.sources.mail?.enabled) {
      const { LarkCliHttpClient } = await import("./lark-cli-client.js");
      const { MailSource } = await import("./sources/mail.js");
      const larkClient = new LarkCliHttpClient(config.lark_bin);
      this.sources.push(
        new MailSource(larkClient, {
          lookbackDays: config.sources.mail.lookback_days ?? 30,
          overlapMs: config.sources.mail.overlap_ms,
          fetchConcurrency: config.sources.mail.fetch_concurrency,
        }),
      );
    }
```

> **Note:** If `collector.ts` already has a mail block (from a prior fix branch), replace the `MailSource` constructor call to add the `fetchConcurrency` line. If it doesn't exist, add the full block above. Do NOT use dynamic `await import()` — instead, add static imports `import { LarkCliHttpClient } from "./lark-cli-client.js";` and `import { MailSource } from "./sources/mail.js";` at the top with the other imports. The full static-import version of the block is:

```typescript
    if (config.sources.mail?.enabled) {
      const larkClient = new LarkCliHttpClient(config.lark_bin);
      this.sources.push(
        new MailSource(larkClient, {
          lookbackDays: config.sources.mail.lookback_days ?? 30,
          overlapMs: config.sources.mail.overlap_ms,
          fetchConcurrency: config.sources.mail.fetch_concurrency,
        }),
      );
    }
```

And add at the top of the file (alphabetically with existing imports):
```typescript
import { LarkCliHttpClient } from "./lark-cli-client.js";
import { MailSource } from "./sources/mail.js";
```

- [ ] **Step 7: Run all mail tests**

```bash
bun test tests/collectors/feishu/sources/mail.test.ts
```

Expected: **13/13 pass** (11 existing + 2 new).

- [ ] **Step 8: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 9: Run the full test suite to check for regressions**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/collectors/feishu/sources/mail.ts \
        src/collectors/feishu/types.ts \
        src/core/config.ts \
        src/collectors/feishu/collector.ts \
        tests/collectors/feishu/sources/mail.test.ts
git commit -m "feat(mail): add concurrent fetch via fetchConcurrent generator

sources.mail.fetch_concurrency (default 1, safe off) controls batch
width. fetchConcurrent processes items in Promise.all batches of N,
per-item errors log+skip without aborting the batch. Cursor advances
only for successfully fetched messages."
```

---

## Task 2: Batch INSERT in rechunk() (Phase 2)

**Files:**
- Modify: `src/store/chunks.ts`
- Test: `tests/store/chunks.test.ts` (existing tests verify correctness — no new tests needed)

- [ ] **Step 1: Run existing chunk tests (baseline)**

```bash
bun test tests/store/chunks.test.ts
```

Expected: **8/8 pass**. Note this number so you can confirm the same count after the refactor.

- [ ] **Step 2: Rewrite `rechunk()` in `src/store/chunks.ts`**

Replace the `rechunk` method (lines 36–62) with the batch INSERT version:

```typescript
  async rechunk(pageId: number, content: string): Promise<void> {
    const textChunks = splitIntoChunks(content);

    const placeholders: string[] = [];
    const params: (number | string)[] = [];
    for (let i = 0; i < textChunks.length; i++) {
      const base = i * 4;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, 'compiled_truth', $${base + 4})`);
      params.push(pageId, i, textChunks[i], textChunks[i].split(/\s+/).length);
    }

    await this.pg.query(
      `INSERT INTO content_chunks (page_id, chunk_index, chunk_text, chunk_source, token_count)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (page_id, chunk_index) DO UPDATE SET
         chunk_text = EXCLUDED.chunk_text,
         chunk_source = EXCLUDED.chunk_source,
         token_count = EXCLUDED.token_count,
         embedding = CASE
           WHEN EXCLUDED.chunk_text != content_chunks.chunk_text THEN NULL
           ELSE content_chunks.embedding
         END,
         embedded_at = CASE
           WHEN EXCLUDED.chunk_text != content_chunks.chunk_text THEN NULL
           ELSE content_chunks.embedded_at
         END`,
      params,
    );

    await this.pg.query(
      "DELETE FROM content_chunks WHERE page_id = $1 AND chunk_index >= $2",
      [pageId, textChunks.length],
    );
  }
```

The key invariant: `splitIntoChunks` always returns at least one element (even for empty string it returns `[""]`), so `placeholders` is never empty and the INSERT is always valid.

- [ ] **Step 3: Run chunk tests to confirm identical behavior**

```bash
bun test tests/store/chunks.test.ts
```

Expected: **8/8 pass** — same count as Step 1.

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/chunks.ts
git commit -m "perf(store): batch INSERT in rechunk() replaces serial per-chunk loop

Single INSERT...VALUES(...),(...) per rechunk call. No behavior change —
ON CONFLICT semantics and DELETE for shrunk chunks are preserved.
For CJK email content (1 chunk each) this eliminates a loop iteration;
for English long documents it reduces N round-trips to 1."
```

---

## Task 3: Configurable block concurrency (Phase 3)

**Files:**
- Modify: `src/core/pipeline.ts`
- Modify: `src/core/pipeline-factory.ts`
- Modify: `src/cli.ts`
- Test: `tests/core/pipeline-factory.test.ts`

(Note: `src/core/config.ts` was already updated in Task 1 Step 4 with `PipelineOptsConfig` and `Config.pipeline`.)

- [ ] **Step 1: Write failing tests for block_concurrency**

Add to `tests/core/pipeline-factory.test.ts`, inside the existing `describe("buildPipelineConfig", ...)` block:

```typescript
  it("passes block_concurrency from config.pipeline to PipelineConfig", () => {
    const config = loadConfig();
    (config as unknown as Record<string, unknown>).pipeline = { block_concurrency: 10 };
    const result = buildPipelineConfig(config, "/tmp/test");
    expect(result.block_concurrency).toBe(10);
  });

  it("block_concurrency is undefined when pipeline section absent", () => {
    const config = loadConfig();
    const result = buildPipelineConfig(config, "/tmp/test");
    expect(result.block_concurrency).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
bun test tests/core/pipeline-factory.test.ts
```

Expected: 2 new tests fail (`block_concurrency` does not exist on `PipelineConfig`).

- [ ] **Step 3: Add `block_concurrency` to `PipelineConfig` in `src/core/pipeline.ts`**

Find the `PipelineConfig` interface (lines 37–45) and add the new field:

```typescript
export interface PipelineConfig {
  dedup_checkpoint: string;
  cursor_checkpoint: string;
  block_gap_minutes: number;
  max_block_tokens: number;
  max_block_messages: number;
  privacy: PrivacyConfig;
  output_dir: string;
  block_concurrency?: number;
}
```

Then find line 229 (`const CONCURRENCY = 5;`) and replace it with:

```typescript
    const CONCURRENCY = config.block_concurrency ?? 5;
```

- [ ] **Step 4: Forward `block_concurrency` in `src/core/pipeline-factory.ts`**

Find `buildPipelineConfig` (lines 15–25) and add the new field:

```typescript
export function buildPipelineConfig(config: Config, output_dir: string): PipelineConfig {
  return {
    dedup_checkpoint: statePath("dedup.jsonl"),
    cursor_checkpoint: statePath("cursors.yaml"),
    block_gap_minutes: config.block_builder.block_gap_minutes,
    max_block_tokens: config.block_builder.max_block_tokens,
    max_block_messages: config.block_builder.max_block_messages,
    privacy: config.privacy,
    output_dir,
    block_concurrency: config.pipeline?.block_concurrency,
  };
}
```

- [ ] **Step 5: Add `block_concurrency` to every inline `pipelineConfig` in `src/cli.ts`**

The `extract` command builds an inline `PipelineConfig` (around line 181). The `serve` command may also build one if it wires the Scheduler. Search for all `PipelineConfig` object literals in `cli.ts` (`grep -n "PipelineConfig" src/cli.ts`) and add `block_concurrency` to each one.

The extract command's object looks like:

```typescript
      const pipelineConfig: PipelineConfig = {
        dedup_checkpoint: statePath("dedup.jsonl"),
        cursor_checkpoint: statePath("cursors.yaml"),
        block_gap_minutes: config.block_builder.block_gap_minutes,
        max_block_tokens: config.block_builder.max_block_tokens,
        max_block_messages: config.block_builder.max_block_messages,
        privacy: config.privacy,
        output_dir: options.output || process.cwd(),
        block_concurrency: config.pipeline?.block_concurrency,
      };
```

If the serve command also has an inline `pipelineConfig` (e.g., for Scheduler), apply the same `block_concurrency: config.pipeline?.block_concurrency` addition. The serve command uses `buildPipelineConfig` from `pipeline-factory.ts` if it went through the factory — in that case Step 4 already covers it and no manual edit is needed.

- [ ] **Step 6: Run pipeline-factory tests**

```bash
bun test tests/core/pipeline-factory.test.ts
```

Expected: **4/4 pass** (2 existing + 2 new).

- [ ] **Step 7: Run full test suite**

```bash
bun test
```

Expected: all tests pass.

- [ ] **Step 8: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/core/pipeline.ts \
        src/core/pipeline-factory.ts \
        src/cli.ts \
        tests/core/pipeline-factory.test.ts
git commit -m "feat(pipeline): make block_concurrency configurable via memoark.yaml

pipeline.block_concurrency (default 5) replaces the hardcoded CONCURRENCY
constant in runPipeline. Threaded through Config → buildPipelineConfig →
PipelineConfig so both the extract command and serve command pick it up."
```

---

## Final verification

- [ ] **Run the full test suite one last time**

```bash
bun test
```

Expected: all tests pass, no regressions.

- [ ] **Confirm the feature is usable in memoark.yaml**

The following memoark.yaml snippet now activates concurrent mail fetch (concurrency=5) and 8-block parallel extraction:

```yaml
sources:
  feishu:
    sources:
      mail:
        enabled: true
        lookback_days: 30
        fetch_concurrency: 5

pipeline:
  block_concurrency: 8
```

---

## Notes for the implementer

**Branch**: develop on `claude/repository-issues-review-TZG4j`. This branch may or may not already include the `MailSource` integration from `fix/feishu-mail-scheduler`. Check `collector.ts` before doing Task 1 Step 6 — if the mail block already exists, only add `fetchConcurrency: config.sources.mail.fetch_concurrency` to it; do not duplicate the block.

**Default concurrency = 1 for MailSource**: The spec leaves the default at 1 (serial) until the user's local `scripts/test-lark-concurrency.ts` confirms lark-cli subprocess safety. The user will then change their `memoark.yaml` to `fetch_concurrency: 5`. Do NOT default to 5 in the code.

**Phase 2 edge case**: `splitIntoChunks("")` returns `[""]` (one empty-string chunk), so the batch INSERT always has at least one VALUES row. No guard needed. Verify with the existing "rechunk short content produces a single chunk" test.

**Biome lint**: This project uses Biome for linting. After each commit, if CI runs `biome check`, it will catch import order violations. Keep imports sorted alphabetically. `LarkCliHttpClient` sorts before `MailSource` alphabetically.
