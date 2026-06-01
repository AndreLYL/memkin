import type { PipelineResult } from "../core/pipeline.js";

export type RunResult = "ok" | "partial" | "failed";

export function classifyResult(r: PipelineResult): RunResult {
  if (r.fatal) return "failed";
  if (r.failedBlocks > 0 && r.okBlocks > 0) return "partial";
  if (r.failedBlocks > 0 && r.okBlocks === 0) return "failed";
  return "ok";
}

const MAX_BACKOFF_SECS = 21600; // 6 hours

export function computeBackoff(base_interval_secs: number, consecutive_failures: number): number {
  const backoff = base_interval_secs * 2 ** consecutive_failures;
  return Math.min(backoff, MAX_BACKOFF_SECS);
}

export interface SourceState {
  last_run_at: number | null;
  last_result: RunResult | null;
  last_error: string | null;
  consecutive_failures: number;
  consecutive_partials: number;
}

const PARTIAL_LIGHT_BACKOFF_THRESHOLD = 10;
const PARTIAL_LIGHT_BACKOFF_MULTIPLIER = 1.5;
const PARTIAL_ALERT_THRESHOLD = 5;
const FAILURE_ALERT_THRESHOLD = 3;

export class SourceSchedule {
  readonly source_id: string;
  readonly interval_secs: number;
  state: SourceState;

  constructor(source_id: string, interval_secs: number) {
    this.source_id = source_id;
    this.interval_secs = interval_secs;
    this.state = {
      last_run_at: null,
      last_result: null,
      last_error: null,
      consecutive_failures: 0,
      consecutive_partials: 0,
    };
  }

  isDue(now: number): boolean {
    if (this.state.last_run_at === null) return true;
    const effective = this.effectiveIntervalMs();
    return now - this.state.last_run_at >= effective;
  }

  recordResult(result: RunResult, timestamp: number, error?: string): void {
    this.state.last_run_at = timestamp;
    this.state.last_result = result;
    this.state.last_error = result === "failed" ? (error ?? null) : null;

    if (result === "ok") {
      this.state.consecutive_failures = 0;
      this.state.consecutive_partials = 0;
    } else if (result === "partial") {
      this.state.consecutive_partials++;
    } else {
      this.state.consecutive_failures++;
      this.state.consecutive_partials = 0;
    }
  }

  shouldAlert(): boolean {
    return (
      this.state.consecutive_failures >= FAILURE_ALERT_THRESHOLD ||
      this.state.consecutive_partials >= PARTIAL_ALERT_THRESHOLD
    );
  }

  nextRunAt(): number {
    if (this.state.last_run_at === null) return 0;
    return this.state.last_run_at + this.effectiveIntervalMs();
  }

  serialize(): SourceState {
    return { ...this.state };
  }

  static fromSerialized(
    source_id: string,
    interval_secs: number,
    saved: SourceState,
  ): SourceSchedule {
    const s = new SourceSchedule(source_id, interval_secs);
    s.state = { ...saved };
    return s;
  }

  private effectiveIntervalMs(): number {
    let secs: number;
    if (this.state.consecutive_failures > 0) {
      secs = computeBackoff(this.interval_secs, this.state.consecutive_failures);
    } else if (this.state.consecutive_partials >= PARTIAL_LIGHT_BACKOFF_THRESHOLD) {
      secs = Math.min(this.interval_secs * PARTIAL_LIGHT_BACKOFF_MULTIPLIER, MAX_BACKOFF_SECS);
    } else {
      secs = this.interval_secs;
    }
    return secs * 1000;
  }
}
