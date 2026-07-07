import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchedulerConfig } from "../../src/core/config.js";
import type { PipelineResult } from "../../src/core/pipeline.js";
import { Scheduler } from "../../src/daemon/scheduler.js";

function makeSchedulerConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    enabled: true,
    tick_interval_secs: 60,
    defaults: { interval_secs: 1800 },
    sources: {
      "test-source": { interval_secs: 600 },
    },
    ...overrides,
  };
}

const okResult: PipelineResult = {
  fatal: false,
  totalMessages: 10,
  totalBlocks: 2,
  okBlocks: 2,
  skippedBlocks: 0,
  failedBlocks: 0,
  okMessages: [],
  skippedMessages: [],
  failedMessages: [],
  warnings: [],
};

const failedResult: PipelineResult = {
  ...okResult,
  fatal: true,
  error: "LLM timeout",
};

describe("Scheduler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    tmpDir = mkdtempSync(join(tmpdir(), "sched-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes source schedules from config", () => {
    const config = makeSchedulerConfig({
      sources: {
        feishu: { interval_secs: 1800 },
        "claude-code": { interval_secs: 600 },
      },
    });
    const sched = new Scheduler(config, tmpDir);
    expect(sched.getSourceIds()).toEqual(["feishu", "claude-code"]);
  });

  it("uses defaults.interval_secs when source has no override", () => {
    const config = makeSchedulerConfig({
      defaults: { interval_secs: 900 },
      sources: {
        feishu: {},
      },
    });
    const sched = new Scheduler(config, tmpDir);
    const state = sched.getSourceState("feishu");
    expect(state?.interval_secs).toBe(900);
  });

  it("skips disabled sources", () => {
    const config = makeSchedulerConfig({
      sources: {
        feishu: { interval_secs: 1800 },
        codex: { enabled: false },
      },
    });
    const sched = new Scheduler(config, tmpDir);
    expect(sched.getSourceIds()).toEqual(["feishu"]);
  });
});

describe("Scheduler tick", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    tmpDir = mkdtempSync(join(tmpdir(), "sched-tick-"));
  });

  it("runs due sources and records results", async () => {
    const config = makeSchedulerConfig({
      sources: { "test-source": { interval_secs: 600 } },
    });
    const sched = new Scheduler(config, tmpDir);
    const runs: string[] = [];

    sched.setRunSource(async (sourceId) => {
      runs.push(sourceId);
      return okResult;
    });

    await sched.tick();
    expect(runs).toEqual(["test-source"]);
    expect(sched.getSourceState("test-source")?.last_result).toBe("ok");
    expect(sched.getSourceState("test-source")?.consecutive_failures).toBe(0);
  });

  it("does not re-run source before interval elapses", async () => {
    const config = makeSchedulerConfig({
      sources: { "test-source": { interval_secs: 600 } },
    });
    const sched = new Scheduler(config, tmpDir);
    let runCount = 0;

    sched.setRunSource(async () => {
      runCount++;
      return okResult;
    });

    await sched.tick();
    await sched.tick();
    expect(runCount).toBe(1);
  });

  it("records failure and increments consecutive_failures", async () => {
    const config = makeSchedulerConfig({
      sources: { "test-source": { interval_secs: 1 } },
    });
    const sched = new Scheduler(config, tmpDir);

    sched.setRunSource(async () => failedResult);

    await sched.tick();
    expect(sched.getSourceState("test-source")?.consecutive_failures).toBe(1);
    expect(sched.getSourceState("test-source")?.last_error).toBe("LLM timeout");
  });

  it("handles runSource throwing an exception", async () => {
    const config = makeSchedulerConfig({
      sources: { "test-source": { interval_secs: 1 } },
    });
    const sched = new Scheduler(config, tmpDir);

    sched.setRunSource(async () => {
      throw new Error("Connection refused");
    });

    await sched.tick();
    expect(sched.getSourceState("test-source")?.consecutive_failures).toBe(1);
    expect(sched.getSourceState("test-source")?.last_error).toBe("Connection refused");
  });

  it("skips tick if previous tick is still running (reentry guard)", async () => {
    const config = makeSchedulerConfig({
      sources: { "test-source": { interval_secs: 1 } },
    });
    const sched = new Scheduler(config, tmpDir);
    let runCount = 0;

    sched.setRunSource(async () => {
      runCount++;
      await new Promise((r) => setTimeout(r, 100));
      return okResult;
    });

    const tick1 = sched.tick();
    const tick2 = sched.tick();
    await Promise.all([tick1, tick2]);
    expect(runCount).toBe(1);
  });

  it("calls onTick callback with source, result, and duration", async () => {
    const config = makeSchedulerConfig({
      sources: { "test-source": { interval_secs: 1 } },
    });
    const sched = new Scheduler(config, tmpDir);
    const callbacks: Array<{
      sourceId: string;
      result: PipelineResult;
      duration_ms: number;
    }> = [];

    sched.setRunSource(async () => okResult);
    sched.setOnTick((sourceId, result, duration_ms) => {
      callbacks.push({ sourceId, result, duration_ms });
    });

    await sched.tick();
    expect(callbacks).toHaveLength(1);
    expect(callbacks[0].sourceId).toBe("test-source");
    expect(callbacks[0].result).toBe(okResult);
    expect(callbacks[0].duration_ms).toBeGreaterThanOrEqual(0);
  });
});

describe("Scheduler per-source timeout", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    tmpDir = mkdtempSync(join(tmpdir(), "sched-timeout-"));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records a wedged source as failed and continues with the next source", async () => {
    const config = makeSchedulerConfig({
      source_timeout_ms: 5000,
      sources: {
        wedged: { interval_secs: 600 },
        healthy: { interval_secs: 600 },
      },
    });
    const sched = new Scheduler(config, tmpDir);
    const runs: string[] = [];

    sched.setRunSource((sourceId) => {
      runs.push(sourceId);
      if (sourceId === "wedged") return new Promise<PipelineResult>(() => {}); // never settles
      return Promise.resolve(okResult);
    });

    const tick = sched.tick();
    await vi.advanceTimersByTimeAsync(5000);
    await tick;

    expect(runs).toEqual(["wedged", "healthy"]);
    expect(sched.getSourceState("wedged")?.last_result).toBe("failed");
    expect(sched.getSourceState("wedged")?.consecutive_failures).toBe(1);
    expect(sched.getSourceState("wedged")?.last_error).toMatch(/timed out/i);
    expect(sched.getSourceState("healthy")?.last_result).toBe("ok");
  });

  it("defaults the timeout to 10 minutes when not configured", async () => {
    const config = makeSchedulerConfig({
      sources: { wedged: { interval_secs: 600 } },
    });
    const sched = new Scheduler(config, tmpDir);
    sched.setRunSource(() => new Promise<PipelineResult>(() => {}));

    const tick = sched.tick();
    await vi.advanceTimersByTimeAsync(600_000 - 1);
    expect(sched.getSourceState("wedged")?.last_result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await tick;

    expect(sched.getSourceState("wedged")?.last_result).toBe("failed");
    expect(sched.getSourceState("wedged")?.last_error).toMatch(/timed out/i);
  });

  it("does not fail a source that finishes before the timeout", async () => {
    const config = makeSchedulerConfig({
      source_timeout_ms: 5000,
      sources: { slowish: { interval_secs: 600 } },
    });
    const sched = new Scheduler(config, tmpDir);
    sched.setRunSource(async () => {
      await new Promise((r) => setTimeout(r, 4000));
      return okResult;
    });

    const tick = sched.tick();
    await vi.advanceTimersByTimeAsync(4000);
    await tick;

    expect(sched.getSourceState("slowish")?.last_result).toBe("ok");
    expect(sched.getSourceState("slowish")?.consecutive_failures).toBe(0);

    // Advancing past the (cleared) timeout must not flip the result to failed.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sched.getSourceState("slowish")?.last_result).toBe("ok");
  });
});

describe("Scheduler persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    tmpDir = mkdtempSync(join(tmpdir(), "sched-persist-"));
  });

  it("persists state to scheduler-state.json after tick", async () => {
    const config = makeSchedulerConfig({
      sources: { feishu: { interval_secs: 1800 } },
    });
    const sched = new Scheduler(config, tmpDir);
    sched.setRunSource(async () => okResult);

    await sched.tick();

    const stateFile = join(tmpDir, "scheduler-state.json");
    const saved = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(saved.sources.feishu.last_result).toBe("ok");
    expect(saved.sources.feishu.consecutive_failures).toBe(0);
    expect(saved.daemon_started_at).toBeGreaterThan(0);
    expect(saved.last_heartbeat_at).toBeGreaterThan(0);
  });

  it("restores state from previous run", async () => {
    const config = makeSchedulerConfig({
      sources: { feishu: { interval_secs: 1800 } },
    });

    const sched1 = new Scheduler(config, tmpDir);
    sched1.setRunSource(async () => failedResult);
    await sched1.tick();
    sched1.stop();

    const sched2 = new Scheduler(config, tmpDir);
    expect(sched2.getSourceState("feishu")?.consecutive_failures).toBe(1);
    expect(sched2.getSourceState("feishu")?.last_result).toBe("failed");
  });

  it("getAlertSources returns sources with 3+ failures", async () => {
    const config = makeSchedulerConfig({
      sources: { feishu: { interval_secs: 1 } },
    });
    const sched = new Scheduler(config, tmpDir);
    sched.setRunSource(async () => failedResult);

    await sched.tick();
    expect(sched.getAlertSources()).toEqual([]);
  });
});
