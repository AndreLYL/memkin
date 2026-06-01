import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { RunHistory } from "../../src/daemon/run-history.js";

describe("RunHistory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    tmpDir = mkdtempSync(join(tmpdir(), "runhist-"));
  });

  it("appends a run record as JSONL", () => {
    const rh = new RunHistory(tmpDir);
    rh.append({
      ts: Date.now(),
      source: "feishu",
      result: "ok",
      msgs: 83,
      blocks: 6,
      ok: 5,
      skipped: 1,
      failed: 0,
      duration_ms: 12300,
    });

    const filePath = join(tmpDir, "scheduler-runs.jsonl");
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.source).toBe("feishu");
    expect(parsed.result).toBe("ok");
  });

  it("computes 24h aggregate stats", () => {
    const rh = new RunHistory(tmpDir);
    const now = Date.now();
    const h12ago = now - 12 * 3600 * 1000;
    const h25ago = now - 25 * 3600 * 1000;

    rh.append({ ts: h25ago, source: "feishu", result: "ok", msgs: 10, blocks: 1, ok: 1, skipped: 0, failed: 0, duration_ms: 100 });
    rh.append({ ts: h12ago, source: "feishu", result: "ok", msgs: 50, blocks: 3, ok: 2, skipped: 1, failed: 0, duration_ms: 5000 });
    rh.append({ ts: now, source: "claude-code", result: "partial", msgs: 20, blocks: 2, ok: 1, skipped: 0, failed: 1, duration_ms: 3000 });

    const stats = rh.stats24h(now);
    expect(stats.total_runs).toBe(2);
    expect(stats.total_msgs).toBe(70);
    expect(stats.total_blocks).toBe(5);
    expect(stats.ok_blocks).toBe(3);
    expect(stats.skipped_blocks).toBe(1);
    expect(stats.failed_blocks).toBe(1);
  });

  it("returns empty stats when no file exists", () => {
    const rh = new RunHistory(tmpDir);
    const stats = rh.stats24h(Date.now());
    expect(stats.total_runs).toBe(0);
  });

  it("rotates file when exceeding max size", () => {
    const rh = new RunHistory(tmpDir, 500);
    for (let i = 0; i < 20; i++) {
      rh.append({ ts: Date.now(), source: "s", result: "ok", msgs: 1, blocks: 1, ok: 1, skipped: 0, failed: 0, duration_ms: 1 });
    }
    const filePath = join(tmpDir, "scheduler-runs.jsonl");
    const size = readFileSync(filePath).length;
    expect(size).toBeLessThan(1000);
  });
});
