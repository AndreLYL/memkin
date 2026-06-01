import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SchedulerConfig } from "../../src/core/config.js";
import type { PipelineResult } from "../../src/core/pipeline.js";
import { AlertWriter } from "../../src/daemon/alerts.js";
import { RunHistory } from "../../src/daemon/run-history.js";
import { Scheduler } from "../../src/daemon/scheduler.js";
import { classifyResult, SourceSchedule } from "../../src/daemon/source-schedule.js";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";

function makeOkResult(msgs = 10, blocks = 2): PipelineResult {
  return {
    fatal: false,
    totalMessages: msgs,
    totalBlocks: blocks,
    okBlocks: blocks,
    skippedBlocks: 0,
    failedBlocks: 0,
    okMessages: [],
    skippedMessages: [],
    failedMessages: [],
    warnings: [],
  };
}

function makeFailResult(error: string): PipelineResult {
  return {
    fatal: true,
    error,
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

const schedulerConfig: SchedulerConfig = {
  enabled: true,
  tick_interval_secs: 60,
  defaults: { interval_secs: 1800 },
  sources: {
    feishu: { interval_secs: 1800 },
    "claude-code": { interval_secs: 1800 },
  },
};

describe("Scheduler integration", () => {
  let tmpDir: string;
  let db: Database;
  let pageStore: PageStore;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    tmpDir = mkdtempSync(join(tmpdir(), "sched-integ-"));
    db = await Database.create();
    pageStore = new PageStore(db.pg);
  });

  afterEach(async () => {
    await db?.close?.();
  });

  it("tick runs all due sources, persists state and history", async () => {
    const history = new RunHistory(tmpDir);
    const sched = new Scheduler(schedulerConfig, tmpDir);
    let runCount = 0;

    sched.setRunSource(async () => {
      runCount++;
      return makeOkResult(20, 3);
    });

    sched.setOnTick((sourceId, result, duration_ms) => {
      history.append({
        ts: Date.now(),
        source: sourceId,
        result: classifyResult(result),
        msgs: result.totalMessages,
        blocks: result.totalBlocks,
        ok: result.okBlocks,
        skipped: result.skippedBlocks,
        failed: result.failedBlocks,
        duration_ms,
      });
    });

    // First tick — both sources are due (fresh state)
    await sched.tick();
    expect(runCount).toBe(2);
    sched.stop();

    // Verify state file
    const stateFile = join(tmpDir, "scheduler-state.json");
    expect(existsSync(stateFile)).toBe(true);
    const saved = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(saved.sources.feishu.last_result).toBe("ok");
    expect(saved.sources["claude-code"].last_result).toBe("ok");

    // Verify JSONL history
    const jsonlFile = join(tmpDir, "scheduler-runs.jsonl");
    expect(readFileSync(jsonlFile, "utf-8").trim().split("\n").length).toBe(2);

    // Verify stats
    const stats = history.stats24h();
    expect(stats.total_runs).toBe(2);
    expect(stats.total_msgs).toBe(40);
  });

  it("state restores across scheduler instances", async () => {
    const sched1 = new Scheduler(schedulerConfig, tmpDir);
    sched1.setRunSource(async () => makeFailResult("timeout"));
    await sched1.tick();
    sched1.stop();

    const sched2 = new Scheduler(schedulerConfig, tmpDir);
    expect(sched2.getSourceState("feishu")?.consecutive_failures).toBe(1);
    expect(sched2.getSourceState("feishu")?.last_result).toBe("failed");
    expect(sched2.getSourceState("feishu")?.last_error).toBe("timeout");
  });

  it("alerts trigger at 3 failures and clear on recovery", async () => {
    const alertWriter = new AlertWriter(pageStore);

    // Build up failures via SourceSchedule directly (no sleep needed)
    const schedule = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    schedule.recordResult("failed", now, "API 429");
    schedule.recordResult("failed", now, "API 429");
    expect(schedule.shouldAlert()).toBe(false);
    schedule.recordResult("failed", now, "API 429");
    expect(schedule.shouldAlert()).toBe(true);

    // Write alert
    await alertWriter.update([{ source_id: "feishu", state: schedule.serialize() }]);

    const alertPage = await pageStore.getPage("system/alerts");
    expect(alertPage).not.toBeNull();
    expect(alertPage?.compiled_truth).toContain("feishu");
    expect(alertPage?.compiled_truth).toContain("API 429");
    expect(alertPage?.compiled_truth).toContain("3");

    // Recovery
    schedule.recordResult("ok", now);
    expect(schedule.shouldAlert()).toBe(false);
    await alertWriter.update([]);

    const cleared = await pageStore.getPage("system/alerts");
    expect(cleared).toBeNull();
  });

  it("end-to-end: scheduler tick → alerts via onTick callback", async () => {
    const alertWriter = new AlertWriter(pageStore);

    // Use very short interval for fast test
    const fastConfig: SchedulerConfig = {
      enabled: true,
      tick_interval_secs: 60,
      defaults: { interval_secs: 1 },
      sources: { feishu: { interval_secs: 1 } },
    };

    const sched = new Scheduler(fastConfig, tmpDir);
    sched.setRunSource(async () => makeFailResult("network error"));
    sched.setOnTick(async () => {
      await alertWriter.update(sched.getAlertDetails());
    });

    // Tick 1 (fresh — due immediately)
    await sched.tick();
    expect(sched.getSourceState("feishu")?.consecutive_failures).toBe(1);

    // After 1 failure, backoff = 1*2^1 = 2s. Wait.
    await new Promise((r) => setTimeout(r, 2100));
    await sched.tick(); // failure 2

    // After 2 failures, backoff = 1*2^2 = 4s
    await new Promise((r) => setTimeout(r, 4100));
    await sched.tick(); // failure 3

    expect(sched.getAlertSources()).toContain("feishu");
    const alert = await pageStore.getPage("system/alerts");
    expect(alert).not.toBeNull();
    expect(alert?.compiled_truth).toContain("network error");

    sched.stop();
  }, 15_000);
});
