import { describe, expect, it } from "vitest";
import { computeStatus, formatManagedStatus } from "./status.js";

const stored = {
  raw_yaml_hash: "oldhash",
  serving_subset_hash: "s1",
  config_path: "/c.yaml",
  url: "http://127.0.0.1:3928/mcp",
};

describe("computeStatus", () => {
  it("running + config drift when raw hash changed (no secret resolution involved)", () => {
    const s = computeStatus({
      stored,
      currentRawHash: "newhash",
      currentServingHash: "s1",
      health: {
        status: 200,
        body: { instance_id: "n", pid: 1, engine: "postgres", loaded_config_hash: "newhash" },
      },
    });
    expect(s.running).toBe(true);
    expect(s.engine).toBe("postgres");
    expect(s.drift.configChanged).toBe(true);
    expect(s.drift.needsReup).toBe(false);
    expect(s.drift.restartedOntoEditedConfig).toBe(true);
  });

  it("serving-subset change → needsReup", () => {
    const s = computeStatus({
      stored,
      currentRawHash: "oldhash",
      currentServingHash: "s2",
      health: { status: 200, body: { loaded_config_hash: "oldhash" } },
    });
    expect(s.drift.needsReup).toBe(true);
    expect(s.drift.configChanged).toBe(false);
  });

  it("no health → not running", () => {
    expect(
      computeStatus({ stored, currentRawHash: "oldhash", currentServingHash: "s1", health: null })
        .running,
    ).toBe(false);
  });
});

describe("formatManagedStatus", () => {
  const managedState = {
    pgdata: "/home/user/.memoark/pgdata",
    fixedPort: 54329,
    socketDir: "/home/user/.memoark/run",
    runtimeRoot: "/home/user/.memoark/runtime/17",
    pgVersion: "17.2",
    pgCtlPath: "/home/user/.memoark/runtime/17/bin/pg_ctl",
    logPath: "/home/user/.memoark/pg.log",
  };

  it("renders all secret-free fields", () => {
    const lines = formatManagedStatus(managedState, null);
    const labels = lines.map((l) => l.label);
    expect(labels).toContain("Managed Postgres pgdata");
    expect(labels).toContain("Managed Postgres port");
    expect(labels).toContain("Managed Postgres socketDir");
    expect(labels).toContain("Managed Postgres version");
  });

  it("shows correct values for pgdata, port, socketDir, pgVersion", () => {
    const lines = formatManagedStatus(managedState, null);
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l.value]));
    expect(byLabel["Managed Postgres pgdata"]).toBe("/home/user/.memoark/pgdata");
    expect(byLabel["Managed Postgres port"]).toBe("54329");
    expect(byLabel["Managed Postgres socketDir"]).toBe("/home/user/.memoark/run");
    expect(byLabel["Managed Postgres version"]).toBe("17.2");
  });

  it("does NOT include process line when clusterRunning is null", () => {
    const lines = formatManagedStatus(managedState, null);
    expect(lines.find((l) => l.label === "Managed Postgres process")).toBeUndefined();
  });

  it("shows running when clusterRunning is true", () => {
    const lines = formatManagedStatus(managedState, true);
    const proc = lines.find((l) => l.label === "Managed Postgres process");
    expect(proc?.value).toContain("running");
  });

  it("shows stopped when clusterRunning is false", () => {
    const lines = formatManagedStatus(managedState, false);
    const proc = lines.find((l) => l.label === "Managed Postgres process");
    expect(proc?.value).toContain("stopped");
  });

  it("never includes secrets (logPath, pgCtlPath, runtimeRoot not rendered)", () => {
    const lines = formatManagedStatus(managedState, null);
    const allValues = lines.map((l) => l.value).join("\n");
    expect(allValues).not.toContain("pg_ctl");
    expect(allValues).not.toContain("runtime");
    expect(allValues).not.toContain("pg.log");
  });
});
