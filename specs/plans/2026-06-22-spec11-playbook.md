# Spec 11: Playbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD, task-by-task.

> **分支须知**：plan 在 `docs/specs-and-research`；实现分支 **`claude/spec11-playbook`**，**从 `claude/spec10-retrieval-quality` 切出**（堆叠；依赖 Spec 7 引擎 + Spec 10 的 `parseWikiLinks` 自布线）。

**Goal:** playbook 程序记忆——`playbook`/`problem-class`/`category` 页类型 + `part_of`/`precedes`/`next`/`escalates_to` 边；markdown 分支约定；分层树遍历（getSubtree/getOrderedSequence）；`troubleshoot(query)` 一次性排查（沿 precedes 预排序，经 Spec 7 `sortCandidates` 钩子）；手动 + 自动（playbook-aware extractor）双来源。

**Architecture:** 扩 `src/core/types.ts`（类型 union，**page type/link_type 都是自由 TEXT，无需 DB migration**）；`src/store/graph.ts` 加遍历；`src/synth/intents/troubleshoot.ts`（用 sortCandidates 钩子）；pipeline 加 playbook pre-classify。

> 规格依据：`specs/2026-06-22-spec11-playbook.md`（§三类型/工作量、§四 markdown 约定、§6 troubleshoot 含钩子）。

### 实测 API（已核 spec10 分支）
- `LinkType`（`core/types.ts:109`）：当前 works_on/…/custom。本 spec 增 `part_of`/`precedes`/`next`/`escalates_to`。
- 自布线：Spec 10 的 `parseWikiLinks`（`src/store/wikilink.ts`）按 `LinkType` 解析 `[[rel:slug]]`——**扩 union 后这些 rel 自动可用**，playbook 写 `[[part_of:...]]` 即自动建边。
- graph：已有 `getLinks`/`getBacklinks`/`getLinksEnriched`/`traverse`（`src/store/graph.ts:127+`）。本 spec 加 `getSubtree(slug,rel,depth?)`、`getOrderedSequence(startSlug)`。
- 引擎：`synthesize(id,scope,deps,opts?)`；`IntentTemplate.sortCandidates?(cands,stores)` 钩子（Spec 7）；`scope.ts` query 模式 + `types` 过滤（`search.ts:133`）；gap：`missingFieldRule`。
- MCP：加 `troubleshoot({query})`，**务必同步 `tests/server/mcp-contract.test.ts` 工具清单**。
- pipeline：`src/core/pipeline.ts` SignalExtractor 阶段加 pre-classify；page frontmatter 自由 JSONB（`confidence:"inferred"` 无需改 schema）。
- 测试：`createMockProvider`；`bunx vitest run <path> --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2`。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/core/types.ts` | Modify | LinkType 增 4 个 rel；（页类型自由 TEXT，slug 约定 playbook/…） |
| `src/store/graph.ts` | Modify | `getSubtree` / `getOrderedSequence` |
| `src/synth/intents/troubleshoot.ts` | Create | troubleshoot 意图 + sortCandidates 钩子 |
| `src/synth/intents/index.ts` | Modify | `registerIntent(troubleshootIntent)` |
| `src/server/mcp.ts` | Modify | 注册 `troubleshoot({query})` |
| `tests/server/mcp-contract.test.ts` | Modify | 工具清单加 `troubleshoot` |
| `src/extractors/` (+ pipeline) | Modify | playbook-aware pre-classify + 草稿抽取 |
| `README.md`/`README.en.md` | Modify | troubleshoot + playbook |
| `tests/...` | Create | 各任务测试 |

---

## Task 1: LinkType 扩展 + 图遍历

- [ ] **Step 1: 写失败测试** `tests/store/graph-traverse.test.ts`：写 category←part_of←problem-class←part_of←playbook + playbook 间 precedes 链；`getSubtree(category, "part_of")` 返回全部后代；`getOrderedSequence(firstPlaybook)` 沿 precedes 返回有序链。LinkType 增的 rel 可用（写 `[[part_of:...]]` 自动建边——复用 Spec 10）。
- [ ] **Step 2-3: 跑失败 → 实现** `core/types.ts` LinkType 加 `part_of`/`precedes`/`next`/`escalates_to`；`graph.ts` 加 `getSubtree`/`getOrderedSequence`（基于 getLinks 递归/迭代）。**确认无需 DB migration**（link_type 自由 TEXT）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(graph): playbook link types + getSubtree/getOrderedSequence`

## Task 2: troubleshoot 意图 + 工具

- [ ] **Step 1: 写失败测试** `tests/synth/troubleshoot.test.ts`（mock provider）：`getIntent("troubleshoot")` 可得；`buildScope({query})` 返回 `{query, types:["playbook"], limit:10}`；`sortCandidates` 钩子按 precedes 预排序候选（构造 precedes 链，断言喂 LLM 顺序）；端到端 `synthesize("troubleshoot", scope, deps)` 返回带 `[n]` 的步骤。`troubleshoot` 工具存在可调。
- [ ] **Step 2-3: 跑失败 → 实现**
  - `intents/troubleshoot.ts`：照搬 spec §6.1（`format:"single"`, buildScope, systemPrompt "按给定编号顺序组织" 真字符串, `gapRules:[missingFieldRule]`, `sortCandidates` 调 `stores.graph.getOrderedSequence`）；`intents/index.ts` 注册。
  - `mcp.ts`：注册 `troubleshoot({query})` → `synthesize("troubleshoot", troubleshootIntent.buildScope({query}), deps)`；同步 `mcp-contract.test.ts` 工具清单加 `troubleshoot`。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(synth): add troubleshoot intent + tool (precedes-ordered)`

## Task 3: playbook-aware extractor（自动来源）

- [ ] **Step 1: 写失败测试** `tests/extractors/playbook-classify.test.ts`：对构造的"排查类"对话（含"排查/步骤/grep/日志/如果…则"），pre-classify 命中 → 走 playbook 抽取，产出 `type=playbook` 草稿页（compiled_truth 为 §四 markdown 结构）、`frontmatter.confidence="inferred"` + tag `draft`；非排查内容 → 走常规抽取（不产 playbook）。
- [ ] **Step 2-3: 跑失败 → 实现** pipeline SignalExtractor 阶段加 pre-classify（规则关键词 + 可选 LLM 二判）；命中走 playbook-aware extractor（LLM 产 markdown，`responseFormat` 文本）；写草稿页。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(extractor): playbook-aware extraction (pre-classify → draft)`

> 手动来源（语音→Agent→put_page）已天然可用（playbook 类型成立即可），无需额外代码。

## Task 4: README / 文档同步

- [ ] 更新 README：工具表加 `troubleshoot`（排查 playbook）；功能清单加"程序记忆/分支 runbook/分层树"；路线图场景3 移"已实现(基础)"。工具计数 +1（读当前 30 → 31，核实再写）。
- [ ] **Commit** `docs(readme): add troubleshoot + playbook to tools/roadmap`

## Task 5: 全量验证

- [ ] typecheck / lint:fix
- [ ] `bunx vitest run tests/synth tests/store tests/extractors tests/server/mcp.test.ts tests/server/mcp-contract.test.ts`（全绿）
- [ ] 回归：`tests/profile tests/consolidator tests/collectors`（无回归）
- [ ] 对照 spec §九 验收逐条
- [ ] **Push（实现分支）** `git push -u origin claude/spec11-playbook`

> 注：`tests/adapters/adapters.test.ts` "push reports errors when write fails" 在 root 环境预期失败，忽略。
> 注：加了 `troubleshoot` 工具，**必须**同步 `mcp-contract.test.ts` 工具清单。

---

## 依赖与后续
- 依赖 Spec 7（引擎/sortCandidates 钩子）+ Spec 10（parseWikiLinks 自布线）。
- 这是五份 spec 的最后一份；交互式逐步排查、结构化 JSON 分支留作后续迭代。
