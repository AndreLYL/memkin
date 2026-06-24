import { type HookInput, type HookOutput, inject, NO_INJECTION } from "./output.js";

export interface SessionStartDeps {
  /** Returns the session-context digest (e.g. getSessionContext(stores, days)). */
  sessionContext: () => Promise<string>;
}

/** SessionStart: inject the always-on "core" session digest. */
export async function runSessionStart(
  _input: HookInput,
  deps: SessionStartDeps,
): Promise<HookOutput | Record<string, never>> {
  const text = (await deps.sessionContext()).trim();
  return text ? inject("SessionStart", text) : NO_INJECTION;
}
