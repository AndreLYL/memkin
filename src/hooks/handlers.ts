import { renderInjection } from "./inject.js";
import { type HookInput, type HookOutput, inject, NO_INJECTION } from "./output.js";
import type { ScoredHit } from "./recall-client.js";

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

export interface UserPromptDeps {
  /** Zero-cost FTS recall for the prompt (e.g. the recall-client). */
  recall: (query: string) => Promise<ScoredHit[]>;
}

/** UserPromptSubmit: gated, budgeted, zero-cost FTS auto-recall. */
export async function runUserPrompt(
  input: HookInput,
  deps: UserPromptDeps,
): Promise<HookOutput | Record<string, never>> {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return NO_INJECTION;
  const hits = await deps.recall(prompt);
  const context = renderInjection(hits);
  return context ? inject("UserPromptSubmit", context) : NO_INJECTION;
}

export interface SessionEndDeps {
  /** Triggers opt-in debounced write-back; returns whether it fired. */
  writeback: () => boolean;
}

/** SessionEnd: fire-and-forget write-back. Injects nothing; returns fast. */
export async function runSessionEnd(
  _input: HookInput,
  deps: SessionEndDeps,
): Promise<Record<string, never>> {
  deps.writeback();
  return NO_INJECTION;
}
