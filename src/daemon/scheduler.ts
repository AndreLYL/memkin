import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SchedulerConfig } from "../core/config.js";
import type { PipelineResult } from "../core/pipeline.js";
import { classifyResult, SourceSchedule, type SourceState } from "./source-schedule.js";

interface SchedulerPersistence {
  daemon_started_at: number;
  last_heartbeat_at: number;
  sources: Record<string, SourceState>;
}

export type RunSourceFn = (sourceId: string) => Promise<PipelineResult>;

export class Scheduler {
  private schedules: Map<string, SourceSchedule> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private daemon_started_at: number;
  private last_heartbeat_at: number;
  private readonly tick_interval_ms: number;
  private readonly state_path: string;
  private onTick?: (sourceId: string, result: PipelineResult, duration_ms: number) => void;
  private runSource?: RunSourceFn;

  constructor(config: SchedulerConfig, stateDir: string) {
    this.tick_interval_ms = config.tick_interval_secs * 1000;
    this.state_path = join(stateDir, "scheduler-state.json");
    this.daemon_started_at = Date.now();
    this.last_heartbeat_at = Date.now();

    const saved = this.loadState();

    for (const [sourceId, sourceConfig] of Object.entries(config.sources)) {
      if (sourceConfig.enabled === false) continue;
      const interval = sourceConfig.interval_secs ?? config.defaults.interval_secs;
      if (saved?.sources[sourceId]) {
        this.schedules.set(
          sourceId,
          SourceSchedule.fromSerialized(sourceId, interval, saved.sources[sourceId]),
        );
      } else {
        this.schedules.set(sourceId, new SourceSchedule(sourceId, interval));
      }
    }

    if (saved) {
      this.daemon_started_at = saved.daemon_started_at;
    }
  }

  getSourceIds(): string[] {
    return Array.from(this.schedules.keys());
  }

  getSourceState(sourceId: string): (SourceState & { interval_secs: number }) | undefined {
    const s = this.schedules.get(sourceId);
    if (!s) return undefined;
    return { ...s.state, interval_secs: s.interval_secs };
  }

  setRunSource(fn: RunSourceFn): void {
    this.runSource = fn;
  }

  setOnTick(fn: (sourceId: string, result: PipelineResult, duration_ms: number) => void): void {
    this.onTick = fn;
  }

  async start(): Promise<void> {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.tick_interval_ms);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.persistState();
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.last_heartbeat_at = Date.now();
    try {
      const now = Date.now();
      for (const [sourceId, schedule] of this.schedules) {
        if (!schedule.isDue(now)) continue;
        this.last_heartbeat_at = Date.now();

        if (!this.runSource) continue;

        const start = Date.now();
        try {
          const result = await this.runSource(sourceId);
          const duration_ms = Date.now() - start;
          const classified = classifyResult(result);
          schedule.recordResult(classified, Date.now(), result.error);
          this.onTick?.(sourceId, result, duration_ms);
        } catch (err) {
          const duration_ms = Date.now() - start;
          schedule.recordResult(
            "failed",
            Date.now(),
            err instanceof Error ? err.message : String(err),
          );
          const fakeResult: PipelineResult = {
            fatal: true,
            error: err instanceof Error ? err.message : String(err),
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
          this.onTick?.(sourceId, fakeResult, duration_ms);
        }
      }
    } finally {
      this.running = false;
      this.last_heartbeat_at = Date.now();
      this.persistState();
    }
  }

  getHeartbeat(): { daemon_started_at: number; last_heartbeat_at: number } {
    return { daemon_started_at: this.daemon_started_at, last_heartbeat_at: this.last_heartbeat_at };
  }

  getAlertSources(): string[] {
    return Array.from(this.schedules.entries())
      .filter(([_, s]) => s.shouldAlert())
      .map(([id]) => id);
  }

  getAlertDetails(): Array<{ source_id: string; state: SourceState }> {
    return Array.from(this.schedules.entries())
      .filter(([_, s]) => s.shouldAlert())
      .map(([id, s]) => ({ source_id: id, state: s.serialize() }));
  }

  private persistState(): void {
    const data: SchedulerPersistence = {
      daemon_started_at: this.daemon_started_at,
      last_heartbeat_at: this.last_heartbeat_at,
      sources: {},
    };
    for (const [id, s] of this.schedules) {
      data.sources[id] = s.serialize();
    }
    writeFileSync(this.state_path, `${JSON.stringify(data, null, 2)}\n`);
  }

  private loadState(): SchedulerPersistence | null {
    if (!existsSync(this.state_path)) return null;
    try {
      return JSON.parse(readFileSync(this.state_path, "utf-8"));
    } catch {
      return null;
    }
  }
}
