import { describe, expect, test } from "vitest";
import { extractTocFromBlocks } from "../../../../src/collectors/feishu/docs/toc";
import type { DocBlock } from "../../../../src/collectors/feishu/docs/types";

describe("extractTocFromBlocks", () => {
  test("nested headings → flat TOC with levels", () => {
    const blocks: DocBlock[] = [
      { type: "heading1", text: "Intro" },
      { type: "text", text: "some paragraph" },
      { type: "heading2", text: "Background" },
      { type: "heading3", text: "Prior work" },
    ];
    expect(extractTocFromBlocks(blocks)).toEqual([
      { level: 1, title: "Intro" },
      { level: 2, title: "Background" },
      { level: 3, title: "Prior work" },
    ]);
  });

  test("non-heading blocks are ignored", () => {
    const blocks: DocBlock[] = [
      { type: "text", text: "nope" },
      { type: "other", text: "nope" },
    ];
    expect(extractTocFromBlocks(blocks)).toEqual([]);
  });

  test("empty / whitespace-only heading titles are skipped", () => {
    const blocks: DocBlock[] = [
      { type: "heading1", text: "   " },
      { type: "heading2", text: "Real" },
    ];
    expect(extractTocFromBlocks(blocks)).toEqual([{ level: 2, title: "Real" }]);
  });

  test("empty input → empty TOC", () => {
    expect(extractTocFromBlocks([])).toEqual([]);
  });

  test("heading titles are trimmed", () => {
    expect(extractTocFromBlocks([{ type: "heading1", text: "  Padded  " }])).toEqual([
      { level: 1, title: "Padded" },
    ]);
  });
});
