import { describe, expect, test } from "vitest";
import {
  type FeishuBlock,
  feishuBlocksToDocBlocks,
  feishuBlocksToRawText,
} from "../../../../src/collectors/feishu/docs/blocks";

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
});

describe("feishuBlocksToRawText", () => {
  test("joins block text with newlines", () => {
    expect(feishuBlocksToRawText([heading, text])).toBe("Introduction\nHello world");
  });

  test("empty input → empty string", () => {
    expect(feishuBlocksToRawText([])).toBe("");
  });
});
