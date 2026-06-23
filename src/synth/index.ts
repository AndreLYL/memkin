// Public entry point for the synthesis engine.
// Importing this module registers built-in intents (via engine.ts → intents/index.ts).
import "./intents/index.js";

export type { SynthDeps } from "./engine.js";
export { synthesize } from "./engine.js";
export { getIntent, registerIntent } from "./intent.js";
export type {
  AssembledCandidate,
  AssembledContext,
  Citation,
  ComposeOutput,
  Gap,
  GapRule,
  IntentTemplate,
  SynthesisResult,
  SynthOpts,
  SynthScope,
} from "./types.js";
