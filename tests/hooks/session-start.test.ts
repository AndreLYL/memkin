import { describe, expect, it } from "vitest";
import { runSessionStart } from "../../src/hooks/handlers.js";
import type { HookOutput } from "../../src/hooks/output.js";

describe("runSessionStart", () => {
  it("injects the session-context digest as SessionStart additionalContext", async () => {
    const out = (await runSessionStart(
      { source: "startup" },
      { sessionContext: async () => "## 近期工作概览\n**活跃项目**：memkin" },
    )) as HookOutput;
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("活跃项目");
  });

  it("injects nothing when the digest is empty", async () => {
    const out = await runSessionStart({}, { sessionContext: async () => "   " });
    expect(out).toEqual({});
  });
});
