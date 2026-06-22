# Spec 7: 合成底座（Synthesis Engine）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **分支须知（重要）**：本 plan 文档存放在 `docs/specs-and-research` 分支；**实现代码不在此分支**。实现时从 **main** 切出 **`claude/spec7-synthesis-engine`**，所有代码 + README 改动提交到该分支，再合回 main。切勿在 `docs/specs-and-research` 写代码。

**Goal:** 实现 `synthesize(intent, scope, opts?)` 合成引擎——检索 → 组装 → LLM 成段 → 引用 + gap，附意图模板框架、最小参考意图 `recall`、逐 scope 缓存、best-chunk 池化（仅合成内启用）。对外注册 `synthesize` + `recall` 两个 MCP 工具。

**Architecture:** 新增 `src/synth/` 目录（与 `consolidator/` 平级），见 Spec §3.1。池化逻辑放进现有 `src/store/search.ts` 的 `hybridSearch`（`poolByPage` 参数，默认 false）。引擎不 import 任何具体意图——意图经 `intents/index.ts` 显式注册；可选钩子 `sortCandidates`/`buildPinnedContext` 由 engine 通用调用。

**Tech Stack:** TypeScript, PGlite, Zod, `@modelcontextprotocol/sdk`, Vitest。LLM 走现有 `src/extractors/providers`（含 mock）。

> 规格依据：`specs/2026-06-22-spec7-synthesis-engine.md`。所有类型定义以该 spec §3.2 为准。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/synth/types.ts` | Create | 全部数据契约（SynthScope/SynthOpts/AssembledContext/Citation/Gap/GapRule/SynthesisResult/IntentTemplate） |
| `src/synth/intent.ts` | Create | `intentRegistry` + `registerIntent()`/`getIntent()` |
| `src/synth/scope.ts` | Create | `retrieve(scope, {poolByPage})` → 候选；types 透传 search |
| `src/synth/context.ts` | Create | `assemble(candidates)` → 编号 AssembledContext |
| `src/synth/citations.ts` | Create | `finalize(answer, candidates)` → 校验 [n] + 回链 |
| `src/synth/gaps.ts` | Create | `staleRule` / `missingFieldRule`（contradiction 留接口） |
| `src/synth/cache.ts` | Create | 逐 scope 缓存 read/write + 新鲜度 |
| `src/synth/engine.ts` | Create | `synthesize()` 8 步编排 + 钩子通用调用 |
| `src/synth/intents/recall.ts` | Create | 参考意图 recall |
| `src/synth/intents/index.ts` | Create | 显式 `registerIntent(recallIntent)` |
| `src/synth/index.ts` | Create | 对外导出 synthesize + 类型 |
| `src/store/search.ts` | Modify | `hybridSearch` 加 `poolByPage`（默认 false） |
| `src/server/mcp.ts` | Modify | 注册 `synthesize` + `recall` 工具 |
| `tests/synth/*.test.ts` | Create | 各模块 + 端到端测试 |
| `README.md` / `README.en.md` | Modify | Task 10：同步合成能力（见末尾 README 同步） |

---

## Task 1: 数据契约 `src/synth/types.ts`

- [ ] **Step 1: Create `src/synth/types.ts`** — 照搬 spec §3.2 的全部 interface：`SynthScope`、`SynthOpts`、`AssembledCandidate`、`AssembledContext`（含 `pinnedContext?`）、`ComposeOutput`、`Citation`、`Gap`、`GapRule`、`SynthesisResult`、`IntentTemplate`（含可选钩子 `buildPinnedContext?`/`sortCandidates?`，签名用 `StoreContext`，从 `../server/api.js` import type）。

- [ ] **Step 2: typecheck** `bun run typecheck` —— 仅类型文件，应无错。

- [ ] **Step 3: Commit** `git commit -m "feat(synth): add synthesis data contracts (types.ts)"`

---

## Task 2: best-chunk 池化 `src/store/search.ts`

- [ ] **Step 1: 写失败测试** `tests/synth/pooling.test.ts`：构造同一 page 的多个 chunk 都命中，断言 `hybridSearch(q, {poolByPage:true})` 该 page 只出现一次且取最强 chunk；`hybridSearch(q)`（默认）行为与改动前一致（同页多 chunk 仍各自出现 / 原排序）。

- [ ] **Step 2: 跑测试确认失败** `bunx vitest run tests/synth/pooling.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2`

- [ ] **Step 3: 实现** —— `hybridSearch(query, opts)` 增 `poolByPage?: boolean`（默认 `false`）。在候选合并、RRF/tier/freshness 加权**之后**，若 `poolByPage`，按 `page_id`（或 slug）分组取最高分项再排序。**默认 false ⇒ `query`/`search` 零行为变化**（回应 review S10-P1-5：池化只此一处）。

- [ ] **Step 4: 跑测试确认通过 + 现有 search 测试不回归**
```bash
bunx vitest run tests/synth/pooling.test.ts tests/store/search.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2
```

- [ ] **Step 5: Commit** `git commit -m "feat(search): add opt-in poolByPage (best-chunk-per-page), default off"`

---

## Task 3: 检索 `src/synth/scope.ts`

- [ ] **Step 1: 写失败测试** `tests/synth/scope.test.ts`：① entity scope → 取该实体 backlinks + timeline 转候选；② time scope → 按 date 窗口过滤；③ query scope → 走 `hybridSearch(poolByPage:true)`；④ `types:["x"]` 透传到 search 的 `p.type=ANY` 过滤（已存在于 `search.ts:133`）。

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 实现 `retrieve(scope, opts, stores): Promise<AssembledCandidate[]>`** —— 按 scope 三模式分派；query 模式调 `hybridSearch(scope.query, { poolByPage:true, types: scope.types, limit })`；entity 模式用 `graph.getBacklinksEnriched` + `timeline.getTimeline`；time 模式按 date 过滤 pages/timeline。返回未编号的候选（编号在 context.ts）。

- [ ] **Step 4: 跑测试确认通过**

- [ ] **Step 5: Commit** `git commit -m "feat(synth): add scope retrieval (entity/time/query)"`

---

## Task 4: 组装 `src/synth/context.ts`

- [ ] **Step 1: 写失败测试** `tests/synth/context.test.ts`：`assemble(candidates)` 给候选编号 `ref=1..N`、计算 `latestDate=max(date)`；`pinnedContext` 默认 undefined。

- [ ] **Step 2-3: 跑失败 → 实现** `assemble(candidates): AssembledContext`。

- [ ] **Step 4-5: 跑通过 → Commit** `git commit -m "feat(synth): add context assembly with ref numbering"`

---

## Task 5: 引用 `src/synth/citations.ts`

- [ ] **Step 1: 写失败测试** `tests/synth/citations.test.ts`：`finalize(answer, candidates)` —— ① 提取 `answer` 中 `[n]`；② 剔除超出 `1..N` 的伪引用（注入 `[99]` 应被去除）；③ 返回的 `citations` 只含被实际引用过的候选。

- [ ] **Step 2-3: 跑失败 → 实现** 正则 `/\[(\d+)\]/g` 提取；过滤；映射回 `Citation[]`。

- [ ] **Step 4-5: 跑通过 → Commit** `git commit -m "feat(synth): add citation finalize + pseudo-ref stripping"`

---

## Task 6: gap 规则 `src/synth/gaps.ts`

- [ ] **Step 1: 写失败测试** `tests/synth/gaps.test.ts`：`staleRule` —— `latestDate` 距今 > `intent.staleDays` 返回 `stale` gap（构造 20 天前 + staleDays=14）；`missingFieldRule` —— `intent.expects` 中要点未在 answer 出现则返回 `missing_field`。

- [ ] **Step 2-3: 跑失败 → 实现** 导出 `staleRule`、`missingFieldRule`（均实现 `GapRule`）。`contradiction` 仅留导出占位（默认关、不进本任务测试，见 spec §六）。

- [ ] **Step 4-5: 跑通过 → Commit** `git commit -m "feat(synth): add stale + missing_field gap rules"`

---

## Task 7: 意图框架 + recall `src/synth/intent.ts` + `intents/`

- [ ] **Step 1: 写失败测试** `tests/synth/intent.test.ts`：`registerIntent`/`getIntent` 往返；`getIntent("unknown")` 抛错；import `intents/index.js` 后 `getIntent("recall")` 可得。

- [ ] **Step 2-3: 跑失败 → 实现**
  - `intent.ts`：`intentRegistry` Map + `registerIntent`/`getIntent`。
  - `intents/recall.ts`：`recallIntent`（照搬 spec 附录 A：`format:"single"`, `staleDays:14`, buildScope 透传 entity/query/time, systemPrompt, `gapRules:[staleRule]`，`import { staleRule } from "../gaps.js"`）。
  - `intents/index.ts`：`import { recallIntent }...; registerIntent(recallIntent);`

- [ ] **Step 4-5: 跑通过 → Commit** `git commit -m "feat(synth): add intent registry + recall reference intent"`

---

## Task 8: 缓存 `src/synth/cache.ts`

- [ ] **Step 1: 写失败测试** `tests/synth/cache.test.ts`：① entity scope → 写/读 entity page `frontmatter.synth[intent]`（含 `input_hash`+`generated_at`）；② time scope → 写 `reports/<intent>/<date>` 页（`type="knowledge"`+`frontmatter.is_report=true`）；③ query scope → 不缓存（read 恒 miss）；④ `input_hash` 变 → 失效。

- [ ] **Step 2-3: 跑失败 → 实现** `read(intent,scope,stores)` / `write(intent,scope,result,stores)`；`input_hash = hash(候选 slug+date 集合)`。

- [ ] **Step 4-5: 跑通过 → Commit** `git commit -m "feat(synth): add per-scope synthesis cache"`

---

## Task 9: 引擎 `src/synth/engine.ts` + `index.ts`（端到端）

- [ ] **Step 1: 写失败测试** `tests/synth/engine.test.ts`（用 mock provider）：
  - `synthesize("recall", {entity})` 返回 `SynthesisResult`：`answer` 非空 + ≥1 有效 `[n]` 引用 + `gaps`。
  - 缓存命中：同 scope 二次调用 mock provider 仅 1 次。
  - 钩子：构造一个带 `sortCandidates`/`buildPinnedContext` 的临时意图，断言候选被重排、`ctx.pinnedContext` 被前置进 compose。
  - **静态约束**：`engine.ts`/`scope.ts` 不出现对 `intents/` 之外具体意图的 import（约定/grep 检查）。

- [ ] **Step 2-3: 跑失败 → 实现** `synthesize(intent, scope, opts)` 按 spec §3.3 八步：getIntent → cache.read → scope.retrieve(poolByPage:true) → `intent.sortCandidates?` → context.assemble → `intent.buildPinnedContext?` → compose(intent, ctx, opts.extra) → citations.finalize + gaps.run + cache.write。`index.ts` 导出 `synthesize` + 类型，顶部 `import "./intents/index.js"`。

- [ ] **Step 4-5: 跑通过 → Commit** `git commit -m "feat(synth): add synthesize() engine orchestration + hooks"`

---

## Task 10: MCP 工具注册 `src/server/mcp.ts`

- [ ] **Step 1: 写失败测试** `tests/server/mcp.test.ts`：`synthesize` 与 `recall` 工具存在且可调；**断言未注册** `prep_for_person`/`daily_report`/`troubleshoot`（占位由 Spec 8/9/11 负责，回应 spec §八）。

- [ ] **Step 2-3: 跑失败 → 实现** 注册 `synthesize`（`intent`+`scope`）和 `recall`（`entity?`/`query?`/`time?`，内部调 `synthesize("recall", buildScope(args))`）。

- [ ] **Step 4-5: 跑通过 → Commit** `git commit -m "feat(mcp): register synthesize + recall tools"`

---

## Task 11: README / 文档同步（参赛门面，勿滞后）

> 在**同一实现分支**上做（README 在 main 体系，不在 docs 分支）。Spec 7 是地基、无直接用户场景，故只做最小同步；场景化展示留给 Spec 8/9 的 plan。

- [ ] **Step 1: 更新 `README.md` 与 `README.en.md`**
  - MCP 工具表 / 功能清单：新增 `synthesize`、`recall`（合成检索：带引用成段答案 + gap 分析）。
  - 路线图：把"合成层"从规划移到"已实现（基础）"。
  - 不夸大（Spec 8/9 的产品工具尚未实现，勿提前写 prep_for_person 等）。

- [ ] **Step 2: Commit** `git commit -m "docs(readme): add synthesize/recall to tools + roadmap"`

---

## Task 12: 全量验证

- [ ] **Step 1: typecheck** `bun run typecheck`
- [ ] **Step 2: lint** `bun run lint:fix`
- [ ] **Step 3: 全 synth 测试** `bunx vitest run tests/synth tests/server/mcp.test.ts --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2`
- [ ] **Step 4: 回归** `bunx vitest run tests/store/search.test.ts --pool=forks ...`（确认 `query`/`search` 默认排序零变化）
- [ ] **Step 5: 核对验收标准**（对照 spec §十一 1–9 逐条）：合成结果结构、伪引用剔除、stale/missing gap、池化仅合成内、仅注册 2 工具、逐 scope 缓存、recall 完整、钩子通用调用且无反向 import。
- [ ] **Step 6: Push（实现分支，非 docs 分支）**
```bash
git push -u origin claude/spec7-synthesis-engine
```

---

## 依赖与后续

- **下游**：Spec 8（`person_strategy` + `prep_for_person`）、Spec 9（`daily_report`）、Spec 11（`troubleshoot`）各自注册意图与工具，复用本引擎的钩子/缓存。
- **不在本 plan**：reranker、query 改写、对 `query`/`search` 默认开池化（Spec 10）；重量级矛盾检测（consolidator）。
