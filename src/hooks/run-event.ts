import { runSessionEnd, runSessionStart, runUserPrompt } from "./handlers.js";
import type { HookInput, HookOutput } from "./output.js";
import { recall } from "./recall-client.js";
import { runWriteback } from "./writeback.js";

export interface RunEventDeps {
  /** Session-context digest (opens/closes the store internally). */
  sessionContext: () => Promise<string>;
  /** Direct FTS search fallback (opens/closes the store internally). */
  ftsSearch: (query: string, opts: { limit: number }) => Promise<unknown[]>;
  port?: number;
}

/** Dispatch a `memoark hook <event>` invocation. Returns the stdout payload object. */
export async function runHookEvent(
  event: string,
  input: HookInput,
  deps: RunEventDeps,
): Promise<HookOutput | Record<string, never>> {
  switch (event) {
    case "session-start":
      return runSessionStart(input, { sessionContext: deps.sessionContext });
    case "user-prompt":
      return runUserPrompt(input, {
        recall: (q) => recall(q, { port: deps.port, store: { search: deps.ftsSearch } }),
      });
    case "session-end":
      // Opt-in is encoded by whether the SessionEnd hook was installed at all.
      return runSessionEnd(input, { writeback: () => runWriteback({ enabled: true }) });
    default:
      return {};
  }
}
