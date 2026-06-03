import { pinyin } from "pinyin-pro";

/**
 * Convert a person's name to a canonical slug.
 *
 * Chinese names: person/{family}-{given} (pinyin, lowercase)
 * Latin names: person/{kebab-case}
 * Feishu open IDs: person/{ou_<id>} (preserve underscore)
 *
 * Returns null if:
 * - Input is empty or whitespace only
 * - Name contains non-CJK, non-Latin scripts (e.g. Arabic, Cyrillic)
 *
 * @example
 * toPersonCanonicalSlug("王建都") // "person/wang-jiandu"
 * toPersonCanonicalSlug("李明") // "person/li-ming"
 * toPersonCanonicalSlug("Alice Smith") // "person/alice-smith"
 * toPersonCanonicalSlug("Sylar") // "person/sylar"
 * toPersonCanonicalSlug("ou_10d417bea2263b13b0112f8067334323") // "person/ou_10d417..."
 * toPersonCanonicalSlug("أحمد") // null
 */
export function toPersonCanonicalSlug(name: string): string | null {
  // 1. Trim whitespace
  let cleaned = name.trim();
  if (cleaned === "") return null;

  // 2. Generic Feishu user labels often include the only stable identity as an open ID.
  const openIdMatch = cleaned.match(/\bou_[a-zA-Z0-9]+\b/);
  if (openIdMatch) {
    const labelWithoutOpenId = cleaned
      .replace(/[（(][^）)]*ou_[a-zA-Z0-9]+[^）)]*[）)]/gi, "")
      .replace(/\bou_[a-zA-Z0-9]+\b/gi, "")
      .trim();
    const genericLabel = labelWithoutOpenId
      .toLowerCase()
      .replace(/[^a-z]+/g, " ")
      .trim();
    const hasNamedCjkLabel = /[一-鿿]/.test(labelWithoutOpenId);
    if (
      !hasNamedCjkLabel &&
      (genericLabel === "" || genericLabel === "user" || genericLabel === "feishu user")
    ) {
      return `person/${openIdMatch[0].toLowerCase()}`;
    }
  }

  // 3. Remove parenthetical hints: strip (...)
  cleaned = cleaned.replace(/[（(][^）)]*[）)]/g, "").trim();
  if (cleaned === "") return null;

  // 4. Preserve bare Feishu open IDs as stable opaque identifiers.
  if (/^ou_[a-zA-Z0-9]+$/.test(cleaned)) {
    return `person/${cleaned.toLowerCase()}`;
  }

  // 5. Detect script
  const hasCJK = /[一-鿿]/.test(cleaned);
  const isLatinOnly = /^[a-zA-Z\s\-']+$/.test(cleaned);

  if (hasCJK) {
    // Chinese path
    return chinesePath(cleaned);
  }

  if (isLatinOnly) {
    // Latin path
    return latinPath(cleaned);
  }

  // Otherwise: ambiguous or unsupported script
  return null;
}

function chinesePath(name: string): string {
  // Convert to pinyin array (without tones)
  const syllables = pinyin(name, { toneType: "none", type: "array" }) as string[];

  if (syllables.length === 0) return "person/unknown";

  if (syllables.length === 1) {
    // Single character name
    return `person/${syllables[0].toLowerCase()}`;
  }

  // First syllable = family name
  const family = syllables[0].toLowerCase();
  // Remaining syllables = join together (no separator) = given name
  const given = syllables
    .slice(1)
    .map((s) => s.toLowerCase())
    .join("");

  return `person/${family}-${given}`;
}

function latinPath(name: string): string {
  // Lowercase, replace apostrophes with hyphen, split on whitespace/hyphen, join with hyphen
  const kebab = name
    .toLowerCase()
    .replace(/'/g, "-") // Replace apostrophes with hyphens
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join("-");

  return `person/${kebab}`;
}
