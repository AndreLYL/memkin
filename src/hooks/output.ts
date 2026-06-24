// Claude Code hook stdout protocol.
//
// SessionStart and UserPromptSubmit hooks inject text into the agent's context
// via `hookSpecificOutput.additionalContext` (see Claude Code Hooks docs). The
// additionalContext is appended after the user message, preserving prompt cache.
// Emitting `{}` (or empty stdout) injects nothing.

export interface HookInput {
  prompt?: string;
  cwd?: string;
  source?: string; // SessionStart: startup | resume | clear | compact
  reason?: string; // SessionEnd
  hook_event_name?: string;
  [k: string]: unknown;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

/** Build a context-injection payload for a read hook. */
export function inject(event: string, additionalContext: string): HookOutput {
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

/** No-op result: inject nothing. */
export const NO_INJECTION: Record<string, never> = {};
