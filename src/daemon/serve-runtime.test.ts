import { describe, expect, it } from "vitest";
import { ServeRuntimeHolder, type ServeRuntime } from "./serve-runtime.js";

const fakeRuntime = (tag: string): ServeRuntime =>
  ({
    tag,
    scheduler: undefined as never,
    chatNameRefreshJob: undefined,
    getDaemonStatus: () => ({ running: true, uptime_seconds: 0, last_run: null, next_scheduled: null, tag }),
    dispose: async () => {},
  }) as unknown as ServeRuntime & { tag: string };

describe("ServeRuntimeHolder", () => {
  it("returns the current runtime through indirection", () => {
    const holder = new ServeRuntimeHolder(fakeRuntime("a"));
    expect((holder.current as { tag: string }).tag).toBe("a");
  });

  it("swap replaces the current runtime", () => {
    const holder = new ServeRuntimeHolder(fakeRuntime("a"));
    holder.swap(fakeRuntime("b"));
    expect((holder.current as { tag: string }).tag).toBe("b");
  });
});
