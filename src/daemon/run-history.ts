import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RunRecord {
  ts: number;
  source: string;
  result: "ok" | "partial" | "failed";
  msgs: number;
  blocks: number;
  ok: number;
  skipped: number;
  failed: number;
  duration_ms: number;
}

export interface Stats24h {
  total_runs: number;
  total_msgs: number;
  total_blocks: number;
  ok_blocks: number;
  skipped_blocks: number;
  failed_blocks: number;
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const MS_24H = 24 * 3600 * 1000;

export class RunHistory {
  private readonly filePath: string;
  private readonly maxBytes: number;

  constructor(stateDir: string, maxBytes = DEFAULT_MAX_BYTES) {
    this.filePath = join(stateDir, "scheduler-runs.jsonl");
    this.maxBytes = maxBytes;
  }

  append(record: RunRecord): void {
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`);
    this.rotateIfNeeded();
  }

  stats24h(now: number = Date.now()): Stats24h {
    const cutoff = now - MS_24H;
    const records = this.readRecords().filter((r) => r.ts >= cutoff);

    return {
      total_runs: records.length,
      total_msgs: records.reduce((sum, r) => sum + r.msgs, 0),
      total_blocks: records.reduce((sum, r) => sum + r.blocks, 0),
      ok_blocks: records.reduce((sum, r) => sum + r.ok, 0),
      skipped_blocks: records.reduce((sum, r) => sum + r.skipped, 0),
      failed_blocks: records.reduce((sum, r) => sum + r.failed, 0),
    };
  }

  private readRecords(): RunRecord[] {
    if (!existsSync(this.filePath)) return [];
    const lines = readFileSync(this.filePath, "utf-8").trim().split("\n").filter(Boolean);
    const records: RunRecord[] = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return records;
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.filePath)) return;
    const size = statSync(this.filePath).size;
    if (size <= this.maxBytes) return;

    const lines = readFileSync(this.filePath, "utf-8").trim().split("\n");
    const keep = lines.slice(Math.floor(lines.length / 2));
    writeFileSync(this.filePath, `${keep.join("\n")}\n`);
  }
}
