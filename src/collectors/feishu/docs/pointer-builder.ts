import type { DocCandidate, PointerCard } from "./types.js";

export function buildPointerCard(
  candidate: DocCandidate,
  nowIso: string,
  extra?: { extract_error?: string; extract_skipped?: string; user_note?: string },
): PointerCard {
  return {
    ...candidate,
    extract_level: "pointer",
    extracted_at: nowIso,
    ...(extra?.extract_error ? { extract_error: extra.extract_error } : {}),
    ...(extra?.extract_skipped ? { extract_skipped: extra.extract_skipped } : {}),
    ...(extra?.user_note ? { user_note: extra.user_note } : {}),
  };
}
