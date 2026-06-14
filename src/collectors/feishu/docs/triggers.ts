import type { DocCandidate, DocDecisionConfig } from "./types.js";

/**
 * Returns the id of the first trigger that fires (T1, T2, T4 order), or null.
 * `nowMs` is injected so the function stays pure/testable.
 */
export function evaluateTriggers(
  candidate: DocCandidate,
  config: DocDecisionConfig,
  selfOpenId: string,
  nowMs: number,
): string | null {
  // T1 — self edit
  if (config.self_edit && selfOpenId && candidate.last_editor_id === selfOpenId) {
    return "T1";
  }

  // T2 — recency (off when recent_window_days is null)
  if (config.recent_window_days != null) {
    const modifiedMs = Date.parse(candidate.modified_at);
    const windowMs = config.recent_window_days * 86_400_000;
    if (!Number.isNaN(modifiedMs) && nowMs - modifiedMs <= windowMs) {
      return "T2";
    }
  }

  // T4 — important folder / wiki space
  const src = candidate.source;
  if (src.kind === "folder" && config.important_folders.includes(src.folder_token)) {
    return "T4";
  }
  if (src.kind === "my_space" && config.important_folders.includes(src.folder_token)) {
    return "T4";
  }
  if (src.kind === "wiki" && config.important_wiki_spaces.includes(src.space_id)) {
    return "T4";
  }

  return null;
}
