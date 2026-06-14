import { describe, expect, test } from "vitest";
import { computeSourceBodyHash } from "../../../../src/collectors/feishu/docs/hash";

describe("computeSourceBodyHash", () => {
  test("deterministic for identical input", () => {
    const a = computeSourceBodyHash("Hello world");
    const b = computeSourceBodyHash("Hello world");
    expect(a).toBe(b);
  });

  test("returns a 64-char hex sha256", () => {
    expect(computeSourceBodyHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("ignores trailing whitespace and CRLF differences", () => {
    const a = computeSourceBodyHash("line one\nline two");
    const b = computeSourceBodyHash("line one  \r\nline two\n");
    expect(a).toBe(b);
  });

  test("different body text → different hash", () => {
    expect(computeSourceBodyHash("alpha")).not.toBe(computeSourceBodyHash("beta"));
  });
});
