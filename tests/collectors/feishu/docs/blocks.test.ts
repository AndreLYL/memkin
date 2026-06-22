import { describe, expect, test } from "vitest";
import {
  type FeishuBlock,
  feishuBlocksToDocBlocks,
  feishuBlocksToRawText,
} from "../../../../src/collectors/feishu/docs/blocks";
import { extractTocFromBlocks } from "../../../../src/collectors/feishu/docs/toc";

const heading: FeishuBlock = {
  block_type: 3,
  heading1: { elements: [{ text_run: { content: "Introduction" } }] },
};
const text: FeishuBlock = {
  block_type: 2,
  text: { elements: [{ text_run: { content: "Hello " } }, { text_run: { content: "world" } }] },
};
const heading2: FeishuBlock = {
  block_type: 4,
  heading2: { elements: [{ text_run: { content: "Details" } }] },
};

describe("feishuBlocksToDocBlocks", () => {
  test("maps heading and text block types", () => {
    expect(feishuBlocksToDocBlocks([heading, text, heading2])).toEqual([
      { type: "heading1", text: "Introduction" },
      { type: "text", text: "Hello world" },
      { type: "heading2", text: "Details" },
    ]);
  });

  test("unknown block types become type 'other' with empty text", () => {
    expect(feishuBlocksToDocBlocks([{ block_type: 999 }])).toEqual([{ type: "other", text: "" }]);
  });

  test("captures ordered (13) and bullet (12) list text as type 'text'", () => {
    const ordered: FeishuBlock = {
      block_type: 13,
      ordered: { elements: [{ text_run: { content: "First step" } }] },
    };
    const bullet: FeishuBlock = {
      block_type: 12,
      bullet: { elements: [{ text_run: { content: "A point" } }] },
    };
    expect(feishuBlocksToDocBlocks([ordered, bullet])).toEqual([
      { type: "text", text: "First step" },
      { type: "text", text: "A point" },
    ]);
  });
});

describe("feishuBlocksToRawText", () => {
  test("joins block text with newlines", () => {
    expect(feishuBlocksToRawText([heading, text])).toBe("Introduction\nHello world");
  });

  test("empty input → empty string", () => {
    expect(feishuBlocksToRawText([])).toBe("");
  });

  test("includes ordered/bullet list text in raw text", () => {
    const ordered: FeishuBlock = {
      block_type: 13,
      ordered: { elements: [{ text_run: { content: "First step" } }] },
    };
    const bullet: FeishuBlock = {
      block_type: 12,
      bullet: { elements: [{ text_run: { content: "A point" } }] },
    };
    expect(feishuBlocksToRawText([ordered, bullet])).toBe("First step\nA point");
  });
});

describe("TOC extraction stays heading-only", () => {
  test("ordered list blocks do not appear in extractTocFromBlocks output", () => {
    const ordered: FeishuBlock = {
      block_type: 13,
      ordered: { elements: [{ text_run: { content: "First step" } }] },
    };
    const docBlocks = feishuBlocksToDocBlocks([heading, ordered]);
    const toc = extractTocFromBlocks(docBlocks);
    expect(toc).toEqual([{ level: 1, title: "Introduction" }]);
  });
});
