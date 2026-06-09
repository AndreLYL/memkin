import type { QuickEntity } from "./types.js";

const PATTERNS: Array<{ type: QuickEntity["type"]; regex: RegExp }> = [
  { type: "url", regex: /https?:\/\/[^\s<>\]）》]+/g },
  { type: "email", regex: /[\w.+-]+@[\w.-]+\.\w{2,}/g },
  // Negative lookbehind blocks matching the `@domain` tail of an email (e.g. `alice@example.com`
  // would otherwise also yield handle `@example.com`).
  { type: "handle", regex: /(?<![\w.+-])@[\w.-]{2,}/g },
  { type: "hashtag", regex: /#[\w一-鿿]+/g },
  { type: "phone", regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g },
  { type: "ticket_id", regex: /\b\d{12,15}\b/g },
];

export function extractQuickEntities(text: string): QuickEntity[] {
  if (!text) return [];

  const seen = new Set<string>();
  const results: QuickEntity[] = [];

  // Extract URLs first to mask them from email pattern
  const urlRanges: Array<[number, number]> = [];
  const urlRegex = PATTERNS[0].regex;
  let match: RegExpExecArray | null;

  match = urlRegex.exec(text);
  while (match !== null) {
    urlRanges.push([match.index, match.index + match[0].length]);
    const key = `url:${match[0]}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ type: "url", value: match[0] });
    }
    match = urlRegex.exec(text);
  }

  // Helper: check if position is inside a URL
  const isInsideUrl = (pos: number): boolean =>
    urlRanges.some(([start, end]) => pos >= start && pos < end);

  // Extract remaining patterns (skip URLs, already done)
  for (let i = 1; i < PATTERNS.length; i++) {
    const { type, regex } = PATTERNS[i];
    const re = new RegExp(regex.source, regex.flags);
    match = re.exec(text);
    while (match !== null) {
      if (type === "email" && isInsideUrl(match.index)) {
        // /g regex is stateful via lastIndex — any `continue` must re-call re.exec(text)
        // first or this loop will spin forever on the same match.
        match = re.exec(text);
        continue;
      }
      const key = `${type}:${match[0]}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({ type, value: match[0] });
      }
      match = re.exec(text);
    }
  }

  return results;
}
