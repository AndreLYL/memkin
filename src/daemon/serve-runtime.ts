import type { DaemonStatus } from "../server/api.js";
import type { ChatNameRefreshJob } from "../server/chat-name-refresh-job.js";
import type { Scheduler } from "./scheduler.js";

/** A serve session's config-derived runtime, rebuilt/replaced as a whole on reload. */
export interface ServeRuntime {
  scheduler: Scheduler | undefined;
  chatNameRefreshJob: ChatNameRefreshJob | undefined;
  getDaemonStatus: () => DaemonStatus | undefined;
  /** Stop timers, release docsClient/docsCursor/chatNameRefreshJob and other resources. */
  dispose: () => Promise<void>;
}

/** Mutable holder: route handlers read `.current` (indirection) — never capture the runtime by value. */
export class ServeRuntimeHolder {
  current: ServeRuntime;
  constructor(initial: ServeRuntime) {
    this.current = initial;
  }
  swap(next: ServeRuntime): void {
    this.current = next;
  }
}
