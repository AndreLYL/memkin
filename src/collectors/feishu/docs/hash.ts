import { createHash } from "node:crypto";

/**
 * sha256 of raw_content, whitespace-normalized so that cosmetic edits
 * (trailing spaces, CRLF vs LF) do not flip the hash and trigger a needless
 * LLM refresh. This is FullCard.source_body_hash — distinct from the store's
 * pages.content_hash column (which hashes the whole rendered page).
 */
export function computeSourceBodyHash(rawContent: string): string {
  const normalized = rawContent
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
