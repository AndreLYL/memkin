import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_L1,
  DIRECTIVE_L2,
  MEMOARK_BLOCK_END,
  MEMOARK_BLOCK_START,
} from "../../src/install/directive.js";

describe("directive single source", () => {
  it("L1 is wrapped in markers and carries the cheap-first triggers", () => {
    expect(DIRECTIVE_L1.startsWith(MEMOARK_BLOCK_START)).toBe(true);
    expect(DIRECTIVE_L1.trimEnd().endsWith(MEMOARK_BLOCK_END)).toBe(true);
    expect(DIRECTIVE_L1).toContain("`search`");
    expect(DIRECTIVE_L1).toContain("get_session_context");
    expect(DIRECTIVE_L1).toContain("Memoark");
  });

  it("L2 is non-empty plain text with the key constraints", () => {
    expect(DIRECTIVE_L2.length).toBeGreaterThan(100);
    expect(DIRECTIVE_L2).not.toContain(MEMOARK_BLOCK_START);
    expect(DIRECTIVE_L2).toContain("source of truth");
    expect(DIRECTIVE_L2).toContain("get_session_context");
  });
});
