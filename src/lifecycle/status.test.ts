import { describe, expect, it } from "vitest";
import { computeStatus } from "./status.js";

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
