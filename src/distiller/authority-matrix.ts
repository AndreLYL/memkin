/**
 * Authority admissibility matrix (spec §5).
 *
 * Decides, per signal type + authority, how far a signal may travel in the
 * write protocol:
 *   - "canonical"        → may upsert a canonical memory page (PR-4 apply)
 *   - "session_log_only" → only recorded in the session log, never its own page
 *
 * Semantics (spec §5):
 *   - decision / preference are "conclusive" signals: without user confirmation
 *     they must NOT create an independent canonical page.
 *   - task / reference / knowledge / discovery may be assistant-claimed (the
 *     page is tagged with its `authority` for later review).
 *   - assistant_proposed is always session-log-only.
 *
 * PR-2 does not apply anything; this matrix is a pure decision function the
 * distiller carries on each signal so PR-4 can honour it without recomputing.
 */

import type { Authority, SignalType } from "./contract.js";

export type Admissibility = "canonical" | "session_log_only";

// Types that require user_confirmed to reach a canonical page.
const CONCLUSIVE_TYPES = new Set<SignalType>(["decision", "preference"]);

export function admissibility(type: SignalType, authority: Authority): Admissibility {
  if (authority === "assistant_proposed") return "session_log_only";
  if (authority === "user_confirmed") return "canonical";
  // authority === "assistant_claimed"
  return CONCLUSIVE_TYPES.has(type) ? "session_log_only" : "canonical";
}
