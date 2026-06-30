import { describe, it, expect } from "vitest";
import { legacyToEntityPath } from "./legacy-redirect";

describe("legacyToEntityPath", () => {
  it("maps slug", () => {
    expect(legacyToEntityPath("entities/alice", "", "")).toBe("/entity/entities/alice");
  });
  it("preserves query and hash", () => {
    expect(legacyToEntityPath("p/x", "?tab=links", "#sec")).toBe("/entity/p/x?tab=links#sec");
  });
  it("handles empty slug", () => {
    expect(legacyToEntityPath("", "", "")).toBe("/entity/");
  });
});
