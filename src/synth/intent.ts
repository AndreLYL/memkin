import type { IntentTemplate } from "./types.js";

const intentRegistry = new Map<string, IntentTemplate>();

/** Register an intent template. Called explicitly from intents/index.ts (no import side-effect magic). */
export function registerIntent(t: IntentTemplate): void {
  intentRegistry.set(t.id, t);
}

/** Resolve a registered intent by id; throws if unknown. */
export function getIntent(id: string): IntentTemplate {
  const t = intentRegistry.get(id);
  if (!t) throw new Error(`unknown synth intent: ${id}`);
  return t;
}
