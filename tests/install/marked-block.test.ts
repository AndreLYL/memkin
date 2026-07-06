import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_L1,
  MEMKIN_BLOCK_END,
  MEMKIN_BLOCK_START,
} from "../../src/install/directive.js";
import { hasBlock, removeBlock, upsertBlock } from "../../src/install/marked-block.js";

function countBlocks(text: string): number {
  return text.split(MEMKIN_BLOCK_START).length - 1;
}

describe("marked-block upsert/remove", () => {
  it("inserts the block into empty/absent content", () => {
    const out = upsertBlock("", DIRECTIVE_L1);
    expect(out).toContain(MEMKIN_BLOCK_START);
    expect(out).toContain(MEMKIN_BLOCK_END);
    expect(countBlocks(out)).toBe(1);
  });

  it("appends to existing content without touching the original text", () => {
    const original = "# My Notes\n\nsome existing rules\n";
    const out = upsertBlock(original, DIRECTIVE_L1);
    expect(out.startsWith("# My Notes\n\nsome existing rules")).toBe(true);
    expect(countBlocks(out)).toBe(1);
    expect(out).toContain(MEMKIN_BLOCK_START);
  });

  it("is idempotent: re-upsert with changed content replaces in place (no duplicate)", () => {
    const original = "# Notes\n\nkeep me\n";
    const once = upsertBlock(original, DIRECTIVE_L1);
    const changedBlock = `${MEMKIN_BLOCK_START}\nnew body\n${MEMKIN_BLOCK_END}`;
    const twice = upsertBlock(once, changedBlock);
    expect(countBlocks(twice)).toBe(1);
    expect(twice).toContain("new body");
    expect(twice).not.toContain("何时查"); // old L1 body gone
    expect(twice).toContain("keep me"); // surrounding text preserved
  });

  it("removes the block precisely and tidies whitespace", () => {
    const original = "# Notes\n\nkeep me\n";
    const withBlock = upsertBlock(original, DIRECTIVE_L1);
    const removed = removeBlock(withBlock);
    expect(hasBlock(removed)).toBe(false);
    expect(removed).toContain("keep me");
    expect(removed).not.toMatch(/\n{3,}/);
  });

  it("removeBlock is a no-op when no block present", () => {
    expect(removeBlock("# Notes\n")).toBe("# Notes\n");
  });
});
