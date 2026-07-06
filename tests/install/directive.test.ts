import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_L1,
  DIRECTIVE_L2,
  MEMKIN_BLOCK_END,
  MEMKIN_BLOCK_START,
} from "../../src/install/directive.js";

describe("directive single source", () => {
  it("L1 is wrapped in markers and carries the cheap-first triggers", () => {
    expect(DIRECTIVE_L1.startsWith(MEMKIN_BLOCK_START)).toBe(true);
    expect(DIRECTIVE_L1.trimEnd().endsWith(MEMKIN_BLOCK_END)).toBe(true);
    expect(DIRECTIVE_L1).toContain("`search`");
    expect(DIRECTIVE_L1).toContain("get_session_context");
    expect(DIRECTIVE_L1).toContain("Memkin");
  });

  it("L2 is non-empty plain text with the key constraints", () => {
    expect(DIRECTIVE_L2.length).toBeGreaterThan(100);
    expect(DIRECTIVE_L2).not.toContain(MEMKIN_BLOCK_START);
    expect(DIRECTIVE_L2).toContain("source of truth");
    expect(DIRECTIVE_L2).toContain("get_session_context");
  });
});
