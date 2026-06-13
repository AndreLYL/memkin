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

/**
 * Reconstruct a stored card from its page frontmatter. The decision engine only
 * needs extract_level, modified_at, and (for full cards) source_body_hash, but
 * we cast the whole frontmatter — it was serialized from a DocCard by writeCard.
 */
export async function loadExistingCard(
  stores: { pages: PageStore },
  docToken: string,
): Promise<DocCard | null> {
  const page = await stores.pages.getPage(docSlug(docToken));
  if (!page) return null;
  const fm = page.frontmatter as Record<string, unknown>;
  if (fm.extract_level !== "full" && fm.extract_level !== "pointer") return null;
  return fm as unknown as DocCard;
}
