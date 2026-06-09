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

  it("reset after done returns to idle", async () => {
    const runForSource = vi.fn().mockResolvedValue(makeResult());
    const job = new BackfillJob(runForSource);
    job.start({ since_ms: 0, source_types: ["dm"] });
    await wait(20);
    expect(job.getStatus().state).toBe("done");
    job.reset();
    expect(job.getStatus().state).toBe("idle");
  });
});
