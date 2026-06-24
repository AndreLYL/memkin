import { describe, expect, it } from "vitest";
import { type HookSpec, removeHooks, upsertHooks } from "../../src/hooks/settings-edit.js";

const specs: HookSpec[] = [
  { event: "SessionStart", matcher: "startup|resume", command: "memoark hook session-start" },
  { event: "UserPromptSubmit", command: "memoark hook user-prompt" },
];

function memoarkGroups(obj: Record<string, unknown>, event: string): unknown[] {
  const groups = (obj.hooks as Record<string, unknown>)[event] as unknown[];
  return groups.filter((g) =>
    JSON.stringify(g).includes("memoark hook"),
  );
}

describe("settings.json hooks edit", () => {
  it("builds memoark hook entries from empty settings", () => {
    const out = upsertHooks({}, specs);
    const ss = (out.hooks as Record<string, unknown>).SessionStart as unknown[];
    expect(JSON.stringify(ss)).toContain("memoark hook session-start");
    expect(JSON.stringify(ss)).toContain("startup|resume");
  });

  it("preserves the user's own hooks", () => {
    const existing = {
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "lint" }] }],
      },
    };
    const out = upsertHooks(existing, specs);
    const ss = (out.hooks as Record<string, unknown>).SessionStart as unknown[];
    expect(JSON.stringify(ss)).toContain("echo hi");
    expect(JSON.stringify(ss)).toContain("memoark hook session-start");
    expect((out.hooks as Record<string, unknown>).PreToolUse).toBeDefined();
  });

  it("is idempotent: re-upsert keeps a single memoark group per event", () => {
    const once = upsertHooks({}, specs);
    const twice = upsertHooks(once, specs);
    expect(memoarkGroups(twice, "SessionStart")).toHaveLength(1);
    expect(memoarkGroups(twice, "UserPromptSubmit")).toHaveLength(1);
  });

  it("removeHooks strips only memoark groups, dropping now-empty events", () => {
    const existing = upsertHooks(
      { hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] } },
      specs,
    );
    const out = removeHooks(existing);
    const ss = (out.hooks as Record<string, unknown>).SessionStart as unknown[];
    expect(JSON.stringify(ss)).toContain("echo hi");
    expect(JSON.stringify(ss)).not.toContain("memoark hook");
    // UserPromptSubmit had only memoark → removed entirely
    expect((out.hooks as Record<string, unknown>).UserPromptSubmit).toBeUndefined();
  });
});
