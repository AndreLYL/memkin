import { describe, expect, it } from "vitest";
import { GoldenAnnotationSchema, loadGolden } from "./golden.js";

const validAnnotation = {
  session_ref: "claude-code:sess-1",
  should_record: [
    {
      type: "decision",
      authority: "user_confirmed",
      topic: "postgres-migration",
      what: "Adopt self-managed local Postgres instead of SQLite for the store.",
    },
    {
      type: "task",
      authority: "assistant_claimed",
      topic: "fix-flaky-test",
      what: "Fix the flaky recovery-loop test before merging.",
    },
  ],
  should_not_record: [
    {
      what: "User said 'let me check' mid-debugging — a transient utterance, not a decision.",
      reason: "assistant_proposed chatter, no confirmation",
    },
  ],
};

describe("GoldenAnnotationSchema", () => {
  it("accepts a well-formed annotation", () => {
    const result = GoldenAnnotationSchema.safeParse(validAnnotation);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown signal type in should_record", () => {
    const bad = {
      ...validAnnotation,
      should_record: [{ ...validAnnotation.should_record[0], type: "bogus-type" }],
    };
    expect(GoldenAnnotationSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unknown authority value in should_record", () => {
    const bad = {
      ...validAnnotation,
      should_record: [{ ...validAnnotation.should_record[0], authority: "bogus" }],
    };
    expect(GoldenAnnotationSchema.safeParse(bad).success).toBe(false);
  });

  it("requires session_ref", () => {
    const bad = { should_record: [], should_not_record: [] };
    expect(GoldenAnnotationSchema.safeParse(bad).success).toBe(false);
  });

  it("allows empty should_record and should_not_record arrays", () => {
    const minimal = {
      session_ref: "codex:sess-empty",
      should_record: [],
      should_not_record: [],
    };
    expect(GoldenAnnotationSchema.safeParse(minimal).success).toBe(true);
  });
});

describe("loadGolden", () => {
  it("throws a descriptive error for a nonexistent path", async () => {
    await expect(loadGolden("/tmp/does-not-exist-golden.json")).rejects.toThrow();
  });

  it("loads and validates the bundled sanitized example fixture", async () => {
    const url = new URL("../../tests/fixtures/eval/golden-example.json", import.meta.url);
    const golden = await loadGolden(url.pathname);
    expect(golden.session_ref).toBeTruthy();
    expect(Array.isArray(golden.should_record)).toBe(true);
    expect(Array.isArray(golden.should_not_record)).toBe(true);
  });
});
