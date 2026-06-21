import type { BackfillSourceType } from "../../../api/backfill.js";

export const BACKFILLABLE_SOURCES = new Set(["dm", "messages", "mail", "message_search"] as const);

export function isBackfillable(source: string): boolean {
  return (BACKFILLABLE_SOURCES as Set<string>).has(source);
}
