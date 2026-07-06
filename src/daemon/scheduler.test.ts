import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SchedulerConfig } from "../core/config.js";
import { Scheduler } from "./scheduler.js";

const baseConfig = (sources: SchedulerConfig["sources"]): SchedulerConfig => ({
  enabled: true,
  tick_interval_secs: 60,
  defaults: { interval_secs: 3600 },
  sources,
});

describe("Scheduler.reconcile", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "memkin-sched-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("adds a newly enabled source", () => {
    const s = new Scheduler(baseConfig({ feishu: { enabled: true } }), dir);
    s.reconcile(baseConfig({ feishu: { enabled: true }, codex: { enabled: true } }));
    expect(s.getSourceIds().sort()).toEqual(["codex", "feishu"]);
  });

  it("removes a disabled source", () => {
    const s = new Scheduler(
      baseConfig({ feishu: { enabled: true }, codex: { enabled: true } }),
      dir,
    );
    s.reconcile(baseConfig({ feishu: { enabled: true }, codex: { enabled: false } }));
    expect(s.getSourceIds()).toEqual(["feishu"]);
  });

  it("changes interval while preserving runtime state", () => {
    const s = new Scheduler(baseConfig({ feishu: { enabled: true, interval_secs: 900 } }), dir);
    const before = s.getSourceState("feishu");
    expect(before?.interval_secs).toBe(900);
    s.reconcile(baseConfig({ feishu: { enabled: true, interval_secs: 300 } }));
    const after = s.getSourceState("feishu");
    expect(after?.interval_secs).toBe(300);
    expect(after?.last_run_at).toBe(before?.last_run_at ?? null);
  });
});

describe("Scheduler.drain + in-flight", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "memkin-sched2-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("applies pending config at the start of the next tick", async () => {
    const s = new Scheduler(baseConfig({ feishu: { enabled: true } }), dir);
    let release: () => void = () => {};
    s.setRunSource(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              fatal: false,
              error: undefined,
              totalMessages: 0,
              totalBlocks: 0,
              okBlocks: 0,
              skippedBlocks: 0,
              failedBlocks: 0,
              okMessages: [],
              skippedMessages: [],
              failedMessages: [],
              warnings: [],
            });
        }),
    );
    const tick = s.tick();
    s.reconcile(baseConfig({ feishu: { enabled: true }, codex: { enabled: true } }));
    expect(s.getSourceIds()).toEqual(["feishu"]); // staged, not applied yet
    release();
    await tick;
    await s.tick();
    expect(s.getSourceIds().sort()).toEqual(["codex", "feishu"]);
  });

  it("drain awaits the in-flight tick and stops the timer", async () => {
    const s = new Scheduler(baseConfig({ feishu: { enabled: true } }), dir);
    let release: () => void = () => {};
    let finished = false;
    s.setRunSource(
      () =>
        new Promise((resolve) => {
          release = () => {
            finished = true;
            resolve({
              fatal: false,
              error: undefined,
              totalMessages: 0,
              totalBlocks: 0,
              okBlocks: 0,
              skippedBlocks: 0,
              failedBlocks: 0,
              okMessages: [],
              skippedMessages: [],
              failedMessages: [],
              warnings: [],
            });
          };
        }),
    );
    const tick = s.tick();
    const drain = s.drain();
    release();
    await drain;
    await tick;
    expect(finished).toBe(true);
  });
});
