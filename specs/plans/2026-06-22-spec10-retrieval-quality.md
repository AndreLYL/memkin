# Spec 10: 检索质量 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD, task-by-task.

> **分支须知**：plan 在 `docs/specs-and-research`；实现分支 **`claude/spec10-retrieval-quality`**，**从 `claude/spec9-daily-report-and-doc-extraction` 切出**（堆叠；poolByPage 参数由 Spec 7 引入，本 spec 翻转默认）。

**Goal:** ① 把 `query()` 的 best-chunk 池化默认从 off 翻为 on（sum→max），并审查/更新受影响的排序断言；② 写入时零-LLM 图边（`[[slug]]`/`[[rel:slug]]` → addLink）；③ query 意图改写（规则式、零依赖；可选 LLM 默认关）。reranker 不做。

**Architecture:** 改 `src/store/search.ts`（默认翻转）、新增 `src/store/wikilink.ts`（集成在 `PageStore.putPage`）、新增 `src/store/query-rewrite.ts`。

> 规格依据：`specs/2026-06-22-spec10-retrieval-quality.md`。

### 实测 API（已核 spec9 分支）
- `SearchEngine.query(query, opts)`：`opts.poolByPage` 已存在（`search.ts:21,246,282`），当前默认 `false`；`addRanked` 合并按 `poolByPage` 选 sum 或 max。本 spec 把默认改 true。
- 写入入口：`PageStore.putPage(slug, content, opts?)`（`src/store/pages.ts:67`）——**唯一写入路径**，wikilink 扫描集成于此（写完后扫 `compiled_truth`）。
- 建边：`graph.addLink(...)`（`src/store/graph.ts:85`）；`links.provenance` 是 **JSONB**（可存对象）；`LinkType`（`core/types.ts:109`）**已含 `custom`**。
- config 是接口 + deep-merge（非 Zod）：在 `src/core/config.ts` 加 `search?: { pool_by_page?: boolean; llm_rewrite?: boolean }`（默认 pool_by_page=true, llm_rewrite=false），经 `validate-config.ts`/`generate-config.ts` 接入（仿 Spec 8 profile 做法）。
- 测试：`bunx vitest run <path> --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2`。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/store/search.ts` | Modify | `poolByPage` 默认改 true（读 config）；审查排序 |
| `src/store/wikilink.ts` | Create | `parseWikiLinks` + 写入后自布线 |
| `src/store/pages.ts` | Modify | `putPage` 末尾调 wikilink 自布线 |
| `src/store/query-rewrite.ts` | Create | 规则式 query 改写（+可选 LLM） |
| `src/core/config.ts` (+validate/generate) | Modify | `search.pool_by_page` / `search.llm_rewrite` |
| `tests/store/*.test.ts` | Modify/Create | 池化默认翻转回归更新 + wikilink + rewrite |
| `README.md`/`README.en.md` | Modify | 自布线/检索质量（小幅，可选） |

---

## Task 1: 池化默认翻转 + config

- [ ] **Step 1: 写失败测试** `tests/store/pooling-default.test.ts`：不传 opts 时 `query()` 行为 = max(best-chunk)（构造"一页多弱 chunk vs 一页一强 chunk"，强者胜）；`poolByPage:false` 显式仍可得 sum 行为。
- [ ] **Step 2: 审查现有断言** 跑 `tests/store/search.test.ts`，找出依赖 sum 排序的断言。
- [ ] **Step 3: 实现** `query()` 默认 `opts?.poolByPage ?? config.search.pool_by_page ?? true`；config 加 `search` 段（默认 pool_by_page=true）。**更新受影响的既有断言**（明确允许 max 排序），注释说明。
- [ ] **Step 4: 跑通过** `tests/store/search.test.ts` + 新测试全绿。
- [ ] **Step 5: Commit** `feat(search): default best-chunk pooling on (sum→max) + config`

## Task 2: 写入时零-LLM 图边

- [ ] **Step 1: 写失败测试** `tests/store/wikilink.test.ts`：`parseWikiLinks` 解析 `[[entities/alice]]→{to,mentions}`、`[[reports_to:entities/bob]]→{to,reports_to}`、未知 rel→`custom`；写入含 wikilink 的页后 `links` 出现对应边且 `provenance.auto="wikilink"`；目标 slug 不存在 → 跳过不报错；重复写入幂等（UNIQUE 合并）。
- [ ] **Step 2-3: 跑失败 → 实现** `src/store/wikilink.ts` `parseWikiLinks(text)`（正则 `\[\[([^\]]+)\]\]`，含 `rel:slug` 解析，rel 不在 `LinkType` 归 `custom`）；在 `pages.putPage` 写库后扫 `compiled_truth`、对每条调 `graph.addLink(slug,to,type,{provenance:{auto:"wikilink"}})`，目标不存在则跳过。**只扫 compiled_truth**。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(store): zero-LLM wikilink edges on putPage`

## Task 3: query 意图改写（规则式、零依赖）

- [ ] **Step 1: 写失败测试** `tests/store/query-rewrite.test.ts`：同义词/缩写扩展（可配置词表）、停用词过滤、空白归一；`llm_rewrite=false`（默认）时不调 LLM（mock 断言 0 次）。
- [ ] **Step 2-3: 跑失败 → 实现** `src/store/query-rewrite.ts`（**不引入分词库**，纯规则）；`query()` 检索前调用（只影响召回，不改返回结构）；LLM 改写在 `search.llm_rewrite=true` 时才走。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(search): rule-based query rewrite (zero-dep), optional LLM`

## Task 4: README / 文档同步（小幅）

- [ ] 更新 README：功能清单加"写入时自布线（wikilink 零-LLM 建边）""best-chunk 池化检索"。无新 MCP 工具（工具计数不变）。
- [ ] **Commit** `docs(readme): note self-wiring links + best-chunk pooling`

## Task 5: 全量验证

- [ ] typecheck / lint:fix
- [ ] `bunx vitest run tests/store tests/synth --pool=forks ...`（全绿；池化翻转后 search 断言已更新）
- [ ] 回归：`tests/profile tests/consolidator tests/server/mcp.test.ts tests/server/mcp-contract.test.ts`（无回归；工具计数未变）
- [ ] 对照 spec §八 验收逐条
- [ ] **Push（实现分支）** `git push -u origin claude/spec10-retrieval-quality`

> 注：`tests/adapters/adapters.test.ts` "push reports errors when write fails" 在 root 环境预期失败，忽略。
> 注：本 spec **不加 MCP 工具**，无需改 mcp-contract 工具清单。

---

## 依赖与后续
- 依赖 Spec 7（poolByPage 参数）。Spec 11 复用本 spec 的 `parseWikiLinks` 自布线建 playbook 层级/顺序边。
