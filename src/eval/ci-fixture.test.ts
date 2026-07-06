/**
 * CI mechanical-correctness tests for the eval harness (spec §10):
 * the real golden dataset is private and gitignored; the repo ships 4 hand-built,
 * fully sanitized synthetic sessions so CI can verify the eval pipeline is
 * mechanically sound (loaders parse, hashes reconcile, judge+metrics run
 * end-to-end). This is NOT the quality gate — that runs locally on the real
 * golden dataset (see CONTRIBUTING.md).
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeCodeParser } from "../collectors/agent/claude-code.js";
import { loadGolden } from "./golden.js";
import type { JudgeClient, PipelineSignal } from "./judge.js";
import { judge } from "./judge.js";
import { loadManifest, splitSessions } from "./manifest.js";
import { evaluate, report } from "./metrics.js";

const FIXTURE_DIR = new URL("../../tests/fixtures/eval", import.meta.url).pathname;
const SESSIONS_DIR = path.join(FIXTURE_DIR, "ci-sessions");
const GOLDEN_DIR = path.join(FIXTURE_DIR, "ci-golden");
const MANIFEST_PATH = path.join(FIXTURE_DIR, "ci-manifest.json");
const REPO_ROOT = new URL("../../", import.meta.url).pathname;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Deterministic offline judge: equivalence = case-insensitive exact text match.
 * Good enough for mechanical-correctness runs in CI; the real judge wraps an LLM. */
const exactMatchClient: JudgeClient = {
  async isEquivalent(a: string, b: string): Promise<boolean> {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  },
};

describe("CI fixture: manifest", () => {
  it("loads and validates the CI manifest", async () => {
    const manifest = await loadManifest(MANIFEST_PATH);
    expect(manifest.version).toBe(1);
    expect(manifest.sessions.length).toBeGreaterThanOrEqual(3);
    expect(manifest.sessions.length).toBeLessThanOrEqual(5);
  });

  it("splits into non-empty tune and holdout sets", async () => {
    const manifest = await loadManifest(MANIFEST_PATH);
    const { tune, holdout } = splitSessions(manifest);
    expect(tune.length).toBeGreaterThan(0);
    expect(holdout.length).toBeGreaterThan(0);
  });

  it("has an annotation_hash matching the sha256 of each golden fixture file", async () => {
    const manifest = await loadManifest(MANIFEST_PATH);
    for (const session of manifest.sessions) {
      const goldenFile = path.join(GOLDEN_DIR, `${session.session_ref.split(":")[1]}.json`);
      const content = await readFile(goldenFile, "utf-8");
      expect(session.annotation_hash, `hash mismatch for ${session.session_ref}`).toBe(
        sha256(content),
      );
    }
  });
});

describe("CI fixture: golden annotations", () => {
  it("every golden fixture validates against the GoldenAnnotation schema", async () => {
    const files = (await readdir(GOLDEN_DIR)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const file of files) {
      const golden = await loadGolden(path.join(GOLDEN_DIR, file));
      expect(golden.session_ref).toContain("ci-fixture:");
    }
  });

  it("includes at least one noise-only session (empty should_record)", async () => {
    const files = (await readdir(GOLDEN_DIR)).filter((f) => f.endsWith(".json"));
    const goldens = await Promise.all(files.map((f) => loadGolden(path.join(GOLDEN_DIR, f))));
    expect(goldens.some((g) => g.should_record.length === 0)).toBe(true);
  });
});

describe("CI fixture: synthetic session transcripts", () => {
  it("every ci-session JSONL line is valid JSON and conversation lines parse via ClaudeCodeParser", async () => {
    const files = (await readdir(SESSIONS_DIR)).filter((f) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.length).toBeLessThanOrEqual(5);

    const parser = new ClaudeCodeParser();
    for (const file of files) {
      const content = await readFile(path.join(SESSIONS_DIR, file), "utf-8");
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);

      let parsedMessages = 0;
      for (const [i, line] of lines.entries()) {
        const record = JSON.parse(line) as Record<string, unknown>;
        if (!parser.isConversationRecord(record)) continue;
        const message = parser.parseRecord(record, {
          sessionId: path.basename(file, ".jsonl"),
          filePath: path.join(SESSIONS_DIR, file),
          channel: path.basename(file, ".jsonl"),
          lineIndex: i,
          sessionMeta: null,
        });
        if (message) parsedMessages++;
      }
      expect(parsedMessages, `${file} should contain parseable conversation turns`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("CI fixture: end-to-end judge + metrics (mechanical correctness)", () => {
  it("runs judge -> evaluate -> report over the fixtures without error", async () => {
    const manifest = await loadManifest(MANIFEST_PATH);
    const { tune, holdout } = splitSessions(manifest);

    // Simulated pipeline output: echo each golden signal back (a perfect pipeline),
    // plus one noise signal, so matched/missed/extra buckets are all exercised.
    const runSplit = async (refs: typeof tune) => {
      let matchedTotal = 0;
      let missedTotal = 0;
      let extraTotal = 0;
      let outputTotal = 0;
      for (const s of refs) {
        const goldenFile = path.join(GOLDEN_DIR, `${s.session_ref.split(":")[1]}.json`);
        const golden = await loadGolden(goldenFile);
        const output: PipelineSignal[] = [
          ...golden.should_record.map((g) => ({ type: g.type, topic: g.topic, what: g.what })),
          { type: "discovery" as const, topic: "noise", what: "synthetic noise signal" },
        ];
        const result = await judge(output, golden, exactMatchClient);
        matchedTotal += result.matched.length;
        missedTotal += result.missed.length;
        extraTotal += result.extra.length;
        outputTotal += output.length;
      }
      return {
        result: {
          matched: Array.from({ length: matchedTotal }, () => ({
            pipeline: { type: "decision" as const, topic: "x", what: "x" },
            golden: {
              type: "decision" as const,
              authority: "user_confirmed" as const,
              topic: "x",
              what: "x",
            },
          })),
          missed: Array.from({ length: missedTotal }, () => ({
            type: "decision" as const,
            authority: "user_confirmed" as const,
            topic: "m",
            what: "m",
          })),
          extra: Array.from({ length: extraTotal }, () => ({
            type: "discovery" as const,
            topic: "e",
            what: "e",
          })),
        },
        pipelineOutputTotal: outputTotal,
      };
    };

    const tuneEval = await evaluate(() => runSplit(tune), { runs: 3 });
    const holdoutEval = await evaluate(() => runSplit(holdout), { runs: 3 });

    // Perfect echo pipeline: zero missed. One noise signal per session: nonzero noise.
    expect(tuneEval.missRate.mean).toBe(0);
    expect(tuneEval.noiseRate.mean).toBeGreaterThan(0);

    const acceptance = report(
      { missRate: tuneEval.missRate, noiseRate: tuneEval.noiseRate },
      { missRate: holdoutEval.missRate, noiseRate: holdoutEval.noiseRate },
      { missRate: 0.5, noiseRate: 0.9 },
    );
    expect(acceptance.tune.descriptiveOnly).toBe(true);
    expect(typeof acceptance.holdout.passed).toBe("boolean");
  });
});

describe("repo hygiene: private golden data stays local", () => {
  it(".gitignore covers the local golden dataset directory", async () => {
    const gitignore = await readFile(path.join(REPO_ROOT, ".gitignore"), "utf-8");
    expect(gitignore).toContain("eval-data/");
  });

  it("CONTRIBUTING.md documents the local quality gate", async () => {
    const contributing = await readFile(path.join(REPO_ROOT, "CONTRIBUTING.md"), "utf-8");
    expect(contributing).toContain("quality gate");
    expect(contributing).toContain("eval-data/");
  });

  it("the annotation guide for human annotators exists", async () => {
    const guide = await readFile(path.join(REPO_ROOT, "docs", "eval-annotation-guide.md"), "utf-8");
    expect(guide).toContain("should_record");
    expect(guide).toContain("holdout");
  });
});
