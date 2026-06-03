import { describe, expect, it } from "vitest";
import { freshnessMultiplier } from "./search.js";

describe("freshnessMultiplier", () => {
  it("returns 1.0 for null updated_at", () => {
    expect(freshnessMultiplier(null)).toBe(1.0);
  });

  it("returns max boost (~1.30) for very recent date", () => {
    const now = new Date().toISOString();
    const result = freshnessMultiplier(now);
    expect(result).toBeCloseTo(1.3, 1);
  });

  it("returns ~1.11 for a 90-day-old date (half-life)", () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const result = freshnessMultiplier(ninetyDaysAgo);
    // At half-life: 1 + 0.3 * exp(-1) ≈ 1 + 0.3 * 0.368 ≈ 1.110
    expect(result).toBeCloseTo(1.11, 1);
  });

  it("returns near 1.0 for a very old date (1000 days)", () => {
    const old = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000).toISOString();
    const result = freshnessMultiplier(old);
    expect(result).toBeCloseTo(1.0, 1);
  });
});
