import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// L3 of the progressive-disclosure stack: the full capability doc, loaded on
// demand as a skill. Single source of truth for `memkin skill scaffold` and
// the Hermes adapter.
export const MEMKIN_SKILL = `---
name: memkin
description: The user's local-first personal memory (people, projects, decisions, tasks, history). Use it to recall who/what/why before answering, and to write durable decisions back.
---

# Memkin — your personal memory

Memkin is the user's **local-first** personal memory and the source of truth about their
people, projects, decisions, tasks, and history. It is exposed over MCP.

## When to use it
Consult Memkin **before answering** whenever a request concerns:
- a specific person or colleague ("what did X tell me last week?", "who is X?")
- a project's status / progress / history ("where is this project at?", "what did we decide?")
- the user's todos, preferences, or habits
- anything phrased as recall: "last week / earlier / last time / what did we…"

Do **not** consult Memkin for generic questions unrelated to the user's world
(pure syntax, general algorithms).

## How to query (cheap-first)
1. \`search\` — keyword FTS, zero cost. Start here.
2. \`query\` / \`recall\` — semantic + cited; only if \`search\` is thin.
3. Accept good results; don't over-escalate.

At the start of a session, call \`get_session_context\` for a compact digest of active
projects, recent decisions, open tasks, and key people.

For **project-status** questions, combine Memkin (decisions / tasks / timeline) **with**
repo reality (git / code) — don't answer from code alone.

## Tool catalogue
- **Retrieval**: \`query\`, \`search\`, \`get_session_context\`, \`get_entity_profile\`, \`list_signals_by_entity\`
- **Synthesis**: \`recall\`, \`synthesize\`, \`prep_for_person\`, \`daily_report\`, \`troubleshoot\`
- **Write**: \`put_page\`, \`add_timeline_entry\`, \`manage_links\`, \`manage_tags\`
- **Graph / health**: \`explore_graph\`, \`get_health\`

## Writing back (conservative)
On a clear **decision** or **discovery**, or when the user says "remember this", persist it:
- \`put_page(slug="decisions/<kebab>", content="---\\ntitle: …\\ntype: decision\\n---\\n<reasoning>")\`
- \`add_timeline_entry\` for dated project events.
Slugs follow stable conventions: \`decisions/…\`, \`entities/…\`, \`projects/…\`. If unsure, ask.

## Examples
- *"Where is the memkin project at?"* → \`get_session_context\` + \`query("memkin 进展")\`, then merge with the repo's git/code reality.
- *"What did Xu Lizi talk to me about last week?"* → \`recall(entity="entities/xu-lizi")\` or \`query("许力子 上周")\`.
`;

/** Write the memkin skill into `<dir>/memkin/SKILL.md`. Idempotent. Returns the path. */
export function scaffoldSkill(dir: string): string {
  const skillDir = join(dir, "memkin");
  mkdirSync(skillDir, { recursive: true });
  const path = join(skillDir, "SKILL.md");
  writeFileSync(path, MEMKIN_SKILL);
  return path;
}
