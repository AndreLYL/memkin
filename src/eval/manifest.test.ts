import { describe, expect, it } from "vitest";
import { EvalManifestSchema, loadManifest, splitSessions } from "./manifest.js";

const validManifest = {
  version: 1,
  sessions: [
    { session_ref: "claude-code:sess-1", split: "tune", annotation_hash: "a".repeat(64) },
    { session_ref: "claude-code:sess-2", split: "tune", annotation_hash: "b".repeat(64) },
    { session_ref: "claude-code:sess-3", split: "tune", annotation_hash: "c".repeat(64) },
    { session_ref: "codex:sess-4", split: "tune", annotation_hash: "d".repeat(64) },
    { session_ref: "codex:sess-5", split: "tune", annotation_hash: "e".repeat(64) },
    { session_ref: "codex:sess-6", split: "tune", annotation_hash: "f".repeat(64) },
    { session_ref: "codex:sess-7", split: "tune", annotation_hash: "1".repeat(64) },
    { session_ref: "hermes:sess-8", split: "holdout", annotation_hash: "2".repeat(64) },
    { session_ref: "hermes:sess-9", split: "holdout", annotation_hash: "3".repeat(64) },
    { session_ref: "hermes:sess-10", split: "holdout", annotation_hash: "4".repeat(64) },
  ],
  created_at: "2026-07-06T00:00:00.000Z",
};

describe("EvalManifestSchema", () => {
  it("accepts a well-formed manifest", () => {
    const result = EvalManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown split value", () => {
    const bad = {
      ...validManifest,
      sessions: [{ session_ref: "x:1", split: "bogus", annotation_hash: "a".repeat(64) }],
    };
    const result = EvalManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects a manifest missing required fields", () => {
    const bad = { version: 1, sessions: [{ session_ref: "x:1" }] };
    const result = EvalManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects duplicate session_ref entries", () => {
    const bad = {
      ...validManifest,
      sessions: [
        { session_ref: "dup:1", split: "tune", annotation_hash: "a".repeat(64) },
        { session_ref: "dup:1", split: "holdout", annotation_hash: "b".repeat(64) },
      ],
    };
    const result = EvalManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe("splitSessions", () => {
  it("returns tune and holdout arrays partitioned by the split field", () => {
    const manifest = EvalManifestSchema.parse(validManifest);
    const { tune, holdout } = splitSessions(manifest);
    expect(tune).toHaveLength(7);
    expect(holdout).toHaveLength(3);
    expect(holdout.every((s) => s.split === "holdout")).toBe(true);
    expect(tune.every((s) => s.split === "tune")).toBe(true);
  });

  it("approximates a 70/30 split ratio and warns if far off", () => {
    const manifest = EvalManifestSchema.parse(validManifest);
    const { tune, holdout } = splitSessions(manifest);
    const total = tune.length + holdout.length;
    const holdoutRatio = holdout.length / total;
    expect(holdoutRatio).toBeGreaterThanOrEqual(0.2);
    expect(holdoutRatio).toBeLessThanOrEqual(0.4);
  });
});

describe("loadManifest", () => {
  it("throws a descriptive error for a nonexistent path", async () => {
    await expect(loadManifest("/tmp/does-not-exist-manifest.json")).rejects.toThrow();
  });
});
