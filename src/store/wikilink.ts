import type { LinkType } from "../core/types.js";

export interface ParsedWikiLink {
  to: string;
  type: LinkType;
}

const LINK_TYPES: ReadonlySet<string> = new Set<LinkType>([
  "works_on",
  "works_at",
  "reports_to",
  "collaborates",
  "depends_on",
  "mentions",
  "approves",
  "uses",
  "custom",
]);

// Matches [[ ... ]] capturing the inner text.
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Parse wikilinks out of text (Spec 10 §4). Zero-LLM, rule-based.
 *
 *   [[slug]]          -> { to: slug, type: "mentions" }
 *   [[rel:slug]]      -> { to: slug, type: rel }   (rel must be a LinkType)
 *   [[unknown:slug]]  -> { to: slug, type: "custom" }
 *
 * Whitespace inside the brackets (and around the rel separator) is trimmed.
 * Empty/malformed entries (no slug) are skipped. Results are deduped on to+type.
 */
export function parseWikiLinks(text: string): ParsedWikiLink[] {
  const out: ParsedWikiLink[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(WIKILINK_RE)) {
    const inner = match[1].trim();
    if (!inner) continue;

    let to: string;
    let type: LinkType;

    const colonIdx = inner.indexOf(":");
    if (colonIdx === -1) {
      to = inner;
      type = "mentions";
    } else {
      const rawRel = inner.slice(0, colonIdx).trim();
      to = inner.slice(colonIdx + 1).trim();
      type = LINK_TYPES.has(rawRel) ? (rawRel as LinkType) : "custom";
    }

    if (!to) continue;

    const key = `${to}\u0000${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ to, type });
  }

  return out;
}
