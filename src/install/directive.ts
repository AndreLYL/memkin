// Single source of truth for Memoark's agent-facing memory directives.
//
// Progressive disclosure (Spec 12):
//   L1 — minimal, written into each client's rules file (always resident).
//   L2 — medium, passed as the MCP server `instructions` field (injected by
//        clients that support it; covers clients without a rules file).
//   L3 — full detail, lives in tool descriptions / the optional skill (on demand).

export const MEMOARK_BLOCK_START = "<!-- memoark:start -->";
export const MEMOARK_BLOCK_END = "<!-- memoark:end -->";

/** L1: minimal directive block for rules files (CLAUDE.md / AGENTS.md / …). */
export const DIRECTIVE_L1 = `${MEMOARK_BLOCK_START}
## Memoark — 你的个人记忆库
你接入了 Memoark：用户关于「人 / 项目 / 决策 / 任务 / 过往」的本地持久记忆，是这些事的**事实来源**。
- **何时查**：问题涉及具体的人、项目进展、过去的决定、待办，或带「上周 / 之前 / 我们当时…」时——先查 Memoark，别只凭代码或猜测。
- **怎么查（便宜优先）**：先 \`search\`（关键词，零成本）→ 不够再 \`query\` / \`recall\`（语义 + 引用）；会话开始可先 \`get_session_context\` 进入状态。
- **何时不查**：与用户个人世界无关的通用问题（纯语法 / 通用算法），别打扰记忆库。
- 更多用法（写回、图谱、人物画像）按需发现：调用工具时看其说明，或 \`get_health\`。
${MEMOARK_BLOCK_END}`;

/** L2: medium directive used as the MCP server `instructions` field. */
export const DIRECTIVE_L2 = `Memoark is the user's local-first personal memory — the source of truth about the user's people, projects, decisions, tasks, and history.

Brain-first, cheap-first. When a request concerns a specific person, a project's status/history, a past decision, a todo, or contains "last week / earlier / what did we…", consult Memoark BEFORE answering from code or assumptions:
  1) search  (keyword, zero-cost)
  2) query / recall  (semantic + cited) — only if search is thin
  Accept good results; do not over-escalate.
Session start: call get_session_context for a compact digest of active projects, recent decisions, open tasks, and key people.
Project-status questions: combine Memoark (decisions/tasks/timeline) WITH repo reality (git/code); do not answer from code alone.
Do NOT consult Memoark for generic questions unrelated to the user's world (pure syntax, general algorithms).
Write-back (conservative): on a clear decision/discovery, or when the user says "remember this", persist via put_page / add_timeline_entry; if unsure, ask.
More tools (graph traversal, person profile, daily report, troubleshoot) are discoverable via their tool descriptions and get_health.`;
