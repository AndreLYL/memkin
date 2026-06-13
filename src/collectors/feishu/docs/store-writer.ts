import type { ChunkStore } from "../../../store/chunks.js";
import type { PageStore } from "../../../store/pages.js";
import { renderDocCardMarkdown } from "./render.js";
import type { DocCard } from "./types.js";

export const docSlug = (docToken: string): string => `feishu-docs/${docToken}`;

export async function writeCard(
  stores: { pages: PageStore; chunks: ChunkStore },
  card: DocCard,
): Promise<void> {
  const content = renderDocCardMarkdown(card);
  const page = await stores.pages.putPage(docSlug(card.doc_token), content, { halflife_days: null });
  await stores.chunks.rechunk(page.id, page.compiled_truth);
}
