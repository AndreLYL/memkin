import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonLogger } from "../../src/daemon/logger.js";

describe("DaemonLogger", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    tmpDir = mkdtempSync(join(tmpdir(), "logger-"));
  });

  it("writes log lines to file", () => {
    const logger = new DaemonLogger(tmpDir);
    logger.log("info", "scheduler", "tick #1 — 2 sources due");

    const logPath = join(tmpDir, "daemon.log");
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("[info]");
    expect(content).toContain("[scheduler]");
    expect(content).toContain("tick #1 — 2 sources due");
  });

  it("also writes to console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = new DaemonLogger(tmpDir);
    logger.log("warn", "feishu", "rate limited");

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("[warn]");
    expect(spy.mock.calls[0][0]).toContain("[feishu]");
    spy.mockRestore();
  });

  it("rotates log file when exceeding max size", () => {
    const logger = new DaemonLogger(tmpDir, 200);
    for (let i = 0; i < 20; i++) {
      logger.log("info", "test", `line ${i} with some padding text here`);
    }

    const logPath = join(tmpDir, "daemon.log");
    const backupPath = join(tmpDir, "daemon.log.1");
    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(backupPath)).toBe(true);
  });

  it("keeps at most 3 backup files", () => {
    const logger = new DaemonLogger(tmpDir, 100);
    for (let i = 0; i < 100; i++) {
      logger.log("info", "test", `line ${i} padding text to trigger multiple rotations`);
    }

    expect(existsSync(join(tmpDir, "daemon.log"))).toBe(true);
    expect(existsSync(join(tmpDir, "daemon.log.4"))).toBe(false);
  });
});
