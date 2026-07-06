// Idempotent editing of Claude Code ~/.claude/settings.json `hooks`.
// memkin-owned groups are identified by a command containing "memkin hook",
// so user-authored hooks are always preserved.

export interface HookSpec {
  event: string; // e.g. "SessionStart", "UserPromptSubmit", "SessionEnd"
  matcher?: string;
  command: string;
}

type Json = Record<string, unknown>;

function isMemkinGroup(group: unknown): boolean {
  if (!group || typeof group !== "object") return false;
  const hooks = (group as Record<string, unknown>).hooks;
  if (!Array.isArray(hooks)) return false;
  return hooks.some((h) => {
    const command = h && typeof h === "object" ? (h as Record<string, unknown>).command : undefined;
    return typeof command === "string" && command.includes("memkin hook");
  });
}

export function upsertHooks(obj: Json, specs: HookSpec[]): Json {
  const hooks: Record<string, unknown> = { ...((obj.hooks as Record<string, unknown>) ?? {}) };
  for (const spec of specs) {
    const existing = Array.isArray(hooks[spec.event]) ? [...(hooks[spec.event] as unknown[])] : [];
    const kept = existing.filter((g) => !isMemkinGroup(g));
    const group: Record<string, unknown> = {};
    if (spec.matcher) group.matcher = spec.matcher;
    group.hooks = [{ type: "command", command: spec.command }];
    hooks[spec.event] = [...kept, group];
  }
  return { ...obj, hooks };
}

export function removeHooks(obj: Json): Json {
  const cur = obj.hooks;
  if (!cur || typeof cur !== "object") return obj;
  const hooks: Record<string, unknown> = {};
  for (const [event, groups] of Object.entries(cur as Record<string, unknown>)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const kept = (groups as unknown[]).filter((g) => !isMemkinGroup(g));
    if (kept.length > 0) hooks[event] = kept;
  }
  return { ...obj, hooks };
}
