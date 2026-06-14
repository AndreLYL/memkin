import type { DocBlock, TocItem } from "./types.js";

const HEADING_LEVEL: Record<string, 1 | 2 | 3> = {
  heading1: 1,
  heading2: 2,
  heading3: 3,
};

export function extractTocFromBlocks(blocks: DocBlock[]): TocItem[] {
  const toc: TocItem[] = [];
  for (const block of blocks) {
    const level = HEADING_LEVEL[block.type];
    if (!level) continue;
    const title = block.text.trim();
    if (!title) continue;
    toc.push({ level, title });
  }
  return toc;
}
