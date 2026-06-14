import type { DocBlock } from "./types.js";

interface TextElement {
  text_run?: { content?: string };
}
interface BlockTextHolder {
  elements?: TextElement[];
}
export interface FeishuBlock {
  block_type: number;
  text?: BlockTextHolder;
  heading1?: BlockTextHolder;
  heading2?: BlockTextHolder;
  heading3?: BlockTextHolder;
  bullet?: BlockTextHolder;
  ordered?: BlockTextHolder;
  code?: BlockTextHolder;
  quote?: BlockTextHolder;
  todo?: BlockTextHolder;
}

// block_type integer → (DocBlock.type, holder key).
// block_type 3 (heading1) and 2 (text) confirmed live 2026-06-14;
// 4/5/12/13/14/15/17 are standard Feishu values.
const BLOCK_MAP: Record<number, { type: DocBlock["type"]; key: keyof FeishuBlock }> = {
  2: { type: "text", key: "text" },
  3: { type: "heading1", key: "heading1" },
  4: { type: "heading2", key: "heading2" },
  5: { type: "heading3", key: "heading3" },
  12: { type: "text", key: "bullet" },
  13: { type: "text", key: "ordered" },
  14: { type: "text", key: "code" },
  15: { type: "text", key: "quote" },
  17: { type: "text", key: "todo" },
};

function holderText(holder: BlockTextHolder | undefined): string {
  if (!holder?.elements) return "";
  return holder.elements.map((e) => e.text_run?.content ?? "").join("");
}

export function feishuBlocksToDocBlocks(blocks: FeishuBlock[]): DocBlock[] {
  return blocks.map((b) => {
    const mapped = BLOCK_MAP[b.block_type];
    if (!mapped) return { type: "other", text: "" };
    return { type: mapped.type, text: holderText(b[mapped.key] as BlockTextHolder | undefined) };
  });
}

export function feishuBlocksToRawText(blocks: FeishuBlock[]): string {
  return feishuBlocksToDocBlocks(blocks)
    .map((b) => b.text)
    .filter((t) => t.length > 0)
    .join("\n");
}
