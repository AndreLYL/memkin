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

  reset(): void {
    if (this.status.state === "running") return;
    this.abortController = null;
    this.status = { state: "idle", sources: [], total_messages: 0, total_blocks: 0 };
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
        if (this.abortController?.signal.aborted) break;
        this.status.sources[idx].processed = result.totalMessages;
        this.status.sources[idx].blocks = result.totalBlocks;
        this.status.sources[idx].status = result.fatal ? "error" : "done";
        if (result.fatal) this.status.sources[idx].error = result.error;
        this.status.total_messages += result.totalMessages;
        this.status.total_blocks += result.totalBlocks;
      } catch (err) {
        if (this.abortController?.signal.aborted) break;
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
