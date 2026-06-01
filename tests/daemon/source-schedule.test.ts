import { describe, expect, it } from "vitest";
import type { PipelineResult } from "../../src/core/pipeline.js";
import {
  classifyResult,
  computeBackoff,
  SourceSchedule,
} from "../../src/daemon/source-schedule.js";

function makePipelineResult(overrides: Partial<PipelineResult> = {}): PipelineResult {
  return {
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
    ...overrides,
  };
}

describe("classifyResult", () => {
  it("returns ok when all blocks succeed", () => {
    expect(classifyResult(makePipelineResult())).toBe("ok");
  });

  it("returns failed when fatal", () => {
    expect(classifyResult(makePipelineResult({ fatal: true }))).toBe("failed");
  });

  it("returns partial when mixed ok + failed blocks", () => {
    expect(classifyResult(makePipelineResult({ okBlocks: 3, failedBlocks: 1 }))).toBe("partial");
  });

  it("returns failed when all blocks fail", () => {
    expect(classifyResult(makePipelineResult({ okBlocks: 0, failedBlocks: 2 }))).toBe("failed");
  });

  it("returns ok when no blocks at all (empty run)", () => {
    expect(
      classifyResult(makePipelineResult({ okBlocks: 0, failedBlocks: 0, totalBlocks: 0 })),
    ).toBe("ok");
  });
});

describe("computeBackoff", () => {
  it("returns base interval on 0 failures", () => {
    expect(computeBackoff(1800, 0)).toBe(1800);
  });

  it("doubles on 1 failure", () => {
    expect(computeBackoff(1800, 1)).toBe(3600);
  });

  it("quadruples on 2 failures", () => {
    expect(computeBackoff(1800, 2)).toBe(7200);
  });

  it("caps at 6 hours (21600s)", () => {
    expect(computeBackoff(1800, 4)).toBe(21600);
    expect(computeBackoff(1800, 10)).toBe(21600);
  });

  it("works with shorter base interval", () => {
    expect(computeBackoff(600, 1)).toBe(1200);
    expect(computeBackoff(600, 2)).toBe(2400);
    expect(computeBackoff(600, 5)).toBe(19200);
    expect(computeBackoff(600, 6)).toBe(21600);
  });
});

describe("SourceSchedule", () => {
  it("is due immediately on fresh state", () => {
    const s = new SourceSchedule("feishu", 1800);
    expect(s.isDue(Date.now())).toBe(true);
  });

  it("is not due before interval elapses", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    s.recordResult("ok", now);
    expect(s.isDue(now + 1000 * 1799)).toBe(false);
  });

  it("is due after interval elapses", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    s.recordResult("ok", now);
    expect(s.isDue(now + 1000 * 1801)).toBe(true);
  });

  it("successful run resets consecutive_failures and consecutive_partials", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    s.recordResult("failed", now);
    s.recordResult("failed", now);
    s.recordResult("ok", now);
    expect(s.state.consecutive_failures).toBe(0);
    expect(s.state.consecutive_partials).toBe(0);
  });

  it("failed run increments consecutive_failures and applies backoff to isDue", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    s.recordResult("failed", now);
    expect(s.state.consecutive_failures).toBe(1);
    expect(s.isDue(now + 1000 * 3599)).toBe(false);
    expect(s.isDue(now + 1000 * 3601)).toBe(true);
  });

  it("partial does not trigger backoff", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    s.recordResult("partial", now);
    expect(s.state.consecutive_failures).toBe(0);
    expect(s.state.consecutive_partials).toBe(1);
    expect(s.isDue(now + 1000 * 1801)).toBe(true);
  });

  it("10 consecutive partials triggers light backoff (1.5x)", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    for (let i = 0; i < 10; i++) s.recordResult("partial", now);
    expect(s.state.consecutive_partials).toBe(10);
    expect(s.isDue(now + 1000 * 2699)).toBe(false);
    expect(s.isDue(now + 1000 * 2701)).toBe(true);
  });

  it("serializes and restores state", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    s.recordResult("failed", now);
    s.recordResult("failed", now + 1000);

    const serialized = s.serialize();
    const restored = SourceSchedule.fromSerialized("feishu", 1800, serialized);
    expect(restored.state.consecutive_failures).toBe(2);
    expect(restored.state.last_result).toBe("failed");
    expect(restored.state.last_run_at).toBe(now + 1000);
  });

  it("shouldAlert returns true at 3+ consecutive failures", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    s.recordResult("failed", now);
    expect(s.shouldAlert()).toBe(false);
    s.recordResult("failed", now);
    expect(s.shouldAlert()).toBe(false);
    s.recordResult("failed", now);
    expect(s.shouldAlert()).toBe(true);
  });

  it("shouldAlert returns true at 5+ consecutive partials", () => {
    const s = new SourceSchedule("feishu", 1800);
    const now = Date.now();
    for (let i = 0; i < 4; i++) s.recordResult("partial", now);
    expect(s.shouldAlert()).toBe(false);
    s.recordResult("partial", now);
    expect(s.shouldAlert()).toBe(true);
  });
});
