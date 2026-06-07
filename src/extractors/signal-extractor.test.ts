import { describe, expect, it } from "vitest";
import { buildEntityHintsSection } from "./signal-extractor.js";

describe("buildEntityHintsSection", () => {
  it("returns empty string when no entities found", () => {
    expect(buildEntityHintsSection("hello world no entities here")).toBe("");
  });

  it("includes URL section when URL present", () => {
    const result = buildEntityHintsSection("check https://example.com for details");
    expect(result).toContain("## Detected Structural Signals");
    expect(result).toContain("urls: https://example.com");
  });

  it("includes handle section", () => {
    const result = buildEntityHintsSection("ping @alice and @bob about this");
    expect(result).toContain("handles: @alice, @bob");
  });

  it("truncates long entity lists to 5 with overflow note", () => {
    const text = "@ab @bc @cd @de @ef @fg @gh";
    const result = buildEntityHintsSection(text);
    expect(result).toContain("(+2 more)");
  });

  it("groups entities by type", () => {
    const text = "https://foo.com @bar #baz ticket 123456789012345";
    const result = buildEntityHintsSection(text);
    expect(result).toContain("urls:");
    expect(result).toContain("handles:");
    expect(result).toContain("hashtags:");
    expect(result).toContain("ticket_ids:");
  });
});
