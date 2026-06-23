import { createHash } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";
import type { ChunkStore } from "../../../store/chunks.js";
import type { GraphStore } from "../../../store/graph.js";
import type { PageStore } from "../../../store/pages.js";
import { renderDocCardMarkdown } from "./render.js";
import type { ActionItem, DocCard } from "./types.js";

export const docSlug = (docToken: string): string => `feishu-docs/${docToken}`;

/** First 8 hex chars of sha256(text) — stable per action-item text, not positional. */
function actionItemHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 8);
}

/** tasks/doc-<doc_token>-<hash8(text)> (Spec 9 §3.3). */
export function actionItemTaskSlug(docToken: string, text: string): string {
  return `tasks/doc-${docToken}-${actionItemHash(text)}`;
}

/**
 * Identity/graph dependencies for persisting action_items as task signals.
 * Injected so store-writer stays free of a hard dependency on the identity layer
 * (Spec 9 §3.3 / §4 — owner canonicalization + isMe).
 */
export interface ActionItemDeps {
  graph: GraphStore;
  /** Resolve an owner_raw (name/@mention) to a canonical person slug, or null. */
  resolveOwner: (ownerRaw: string | undefined) => Promise<string | null>;
  /** Whether a canonical slug resolves to `entities/me`. */
  isMe: (slug: string) => Promise<boolean>;
}

function renderTaskMarkdown(docToken: string, item: ActionItem, ownerSlug: string | null): string {
  const fm: Record<string, unknown> = {
    title: item.text,
    type: "task",
    status: item.status,
    source: `doc:${docToken}`,
  };
  if (ownerSlug) fm.owner_slug = ownerSlug;
  if (item.due) fm.due = item.due;
  const yaml = stringifyYaml(fm).trimEnd();
  return `---\n${yaml}\n---\n\n${item.text}\n`;
}

async function writeActionItems(
  stores: { pages: PageStore; chunks: ChunkStore },
  card: DocCard,
  deps: ActionItemDeps,
): Promise<void> {
  if (card.extract_level !== "full") return;
  for (const item of card.action_items) {
    const ownerSlug = item.owner_raw ? await deps.resolveOwner(item.owner_raw) : null;
    const slug = actionItemTaskSlug(card.doc_token, item.text);
    const content = renderTaskMarkdown(card.doc_token, item, ownerSlug);
    const page = await stores.pages.putPage(slug, content, { halflife_days: null });
    if (page.compiled_truth?.trim()) {
      await stores.chunks.rechunk(page.id, page.compiled_truth);
    }
    if (ownerSlug) {
      await deps.graph.addLink(slug, ownerSlug, "mentions");
      if (ownerSlug !== "entities/me" && (await deps.isMe(ownerSlug))) {
        await deps.graph.addLink(slug, "entities/me", "mentions");
      }
    }
  }
}

export async function writeCard(
  stores: { pages: PageStore; chunks: ChunkStore },
  card: DocCard,
  actionItemDeps?: ActionItemDeps,
): Promise<void> {
  const content = renderDocCardMarkdown(card);
  const page = await stores.pages.putPage(docSlug(card.doc_token), content, {
    halflife_days: null,
  });
  await stores.chunks.rechunk(page.id, page.compiled_truth);

  // Spec 9 §3.3: persist each action_item as a task signal anchored to its owner.
  if (actionItemDeps && card.extract_level === "full" && card.action_items.length > 0) {
    await writeActionItems(stores, card, actionItemDeps);
  }
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
