# Spec 8: 人物沟通画像（Hero）— Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD, task-by-task, checkbox tracking.

> **分支须知**：本 plan 在 `docs/specs-and-research`；**实现代码不在此分支**。实现分支 **`claude/spec8-person-communication-profile`**，**从 `claude/spec7-synthesis-engine` 切出**（Spec 8 依赖 Spec 7 的合成引擎；main 受保护、Spec 7 尚未合入，故堆叠在 Spec 7 之上）。代码 + README 提交到该分支，勿在 docs 分支写代码。

**Goal:** 三层人物沟通画像（行为层零-LLM 统计 + 行为四象限特质层 + 关系层）+ 四色外壳；夜间预合成画像入 person page；`person_strategy` 意图 + `prep_for_person(person, goal?)` 工具。被动推断、零问卷、伦理护栏。

**Architecture:** 见 Spec §十模块布局。新增 `src/profile/`、`src/store/person-behavior.ts`、migration M005、`src/synth/intents/person-strategy.ts`。复用 Spec 7 引擎：`synthesize(intentId, scope, deps, opts?)`（`deps={stores,provider,model?}`）；意图钩子 `buildPinnedContext(scope, stores)` / `sortCandidates(candidates, stores)`；`registerIntent`。

**Tech Stack:** TS, PGlite, Zod, Vitest, mock LLM provider。

> 规格依据：`specs/2026-06-22-spec8-person-communication-profile.md`（类型见 §4，prompt 见 §6.3/附录）。

### 实测 API（已核 spec7 分支 + main）
- 引擎：`synthesize(intentId, scope, deps, opts?)`，`SynthDeps={stores:StoreContext, provider:LLMProvider, model?}`（`src/synth/engine.ts:72`）。意图经 `registerIntent` 注册（`src/synth/intent.ts`）。`IntentTemplate.buildPinnedContext?(scope,stores)`、`sortCandidates?(cands,stores)`（`src/synth/types.ts:113`）。
- 私聊方向：`src/collectors/feishu/sources/dm.ts:92,100` 已在每条消息打 `direction: "sent"|"received"`（基于 selfOpenId，采集时确定）。群聊无 direction。
- 人物身份：`PersonIdentityStore`（`src/core/person-identity.ts`）；`person_handles(kind,value,canonical_slug,strength)` 表已存在。
- consolidator 挂 pass：`Consolidator.consolidateWarm()`（`src/consolidator/consolidator.ts:71`）内已调用 `inferPreferences(this.stores, this.llm)`——`synthesizeProfiles` 仿此挂入。
- migration：`src/store/migrations/index.ts` 数组追加 `{ version:5, name:"person_behavior", sql:M005_... }`。
- LLM：`provider.chat(messages, {responseFormat:"json"})`；测试用 `createMockProvider`。
- 配置 Zod：`src/core/config.ts`。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/store/migrations/index.ts` | Modify | M005：建 `person_behavior` 表 |
| `src/store/person-behavior.ts` | Create | PersonBehaviorStore：`upsertContribution`/`get`/`merge` |
| `src/profile/types.ts` | Create | BehaviorContribution/BehaviorProfile/TraitLayer/RelationLayer/ProfileObject |
| `src/profile/behavior.ts` | Create | `computeContribution(block)` 纯函数 + BehaviorProfile 派生 |
| `src/profile/four-color.ts` | Create | 行为四象限 → 四色 纯映射 |
| `src/profile/profile-synth.ts` | Create | `synthesizeProfiles(stores, llm, config)` 夜间 pass |
| `src/synth/intents/person-strategy.ts` | Create | `person_strategy` 意图（含 buildPinnedContext 钩子） |
| `src/synth/intents/index.ts` | Modify | 追加 `registerIntent(personStrategyIntent)` |
| `src/core/pipeline.ts` | Modify | dm/group block 处理时累加行为层（gated by config） |
| `src/consolidator/consolidator.ts` | Modify | `consolidateWarm` 调 `synthesizeProfiles`（gated） |
| `src/core/person-identity.ts` | Modify | `merge_persons` 时合并 person_behavior 行 |
| `src/core/config.ts` | Modify | `profile.{enabled,allow,deny,min_sample_size}` Zod |
| `src/server/mcp.ts` | Modify | 注册 `prep_for_person` 工具 |
| `README.md`/`README.en.md` | Modify | Task：同步画像能力 + prep_for_person |
| `tests/profile/*.test.ts` / `tests/synth/person-strategy.test.ts` | Create | 测试 |

---

## Task 1: M005 + PersonBehaviorStore

- [ ] **Step 1: 写失败测试** `tests/profile/person-behavior.test.ts`：建库后 `person_behavior` 表存在；`upsertContribution` 首次 INSERT（写 `window_start`）、再次 UPDATE 加性合并（msg_count/sum_chars/hour_histogram[i] 累加，window_start 不变）；`get` 返回行；`merge(a,b)` 计数器相加。
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: 实现** —— migrations 追加 M005（建表 SQL 见 spec §4.1，`hour_histogram JSONB DEFAULT '[0,...×24]'`）；`src/store/person-behavior.ts` 实现 store（INSERT…ON CONFLICT DO UPDATE 加性合并；merge）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(profile): add person_behavior table (M005) + store`

## Task 2: 行为层 `src/profile/behavior.ts`

- [ ] **Step 1: 写失败测试** `tests/profile/behavior.test.ts`：`computeContribution(block)` 对构造的 dm block（用 `direction` 字段）算出 msg_count/sum_msg_chars/响应延迟（received→sent 相邻对）/hour_histogram/at_count；群聊 block（无 direction）按"段首发送者=主动方"算 initiated/reply。`deriveProfile(row)` 派生 avg_msg_chars/initiation_ratio/avg_response_sec(null when n=0)/peak_hours(top-3)/sample_size。
- [ ] **Step 2-3: 跑失败 → 实现** 纯函数，不依赖 isMe（私聊读 `direction`，群聊读段首 sender）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(profile): add behavior-layer computeContribution + deriveProfile`

## Task 3: pipeline 累加（gated）

- [ ] **Step 1: 写失败测试** `tests/profile/pipeline-behavior.test.ts`：`profile.enabled=true` 且非 deny 时，处理 dm/group block 后 `person_behavior` 有写入；`enabled=false` 时无写入（断言行数 0）。
- [ ] **Step 2-3: 跑失败 → 实现** 在 `pipeline.ts` 处理 dm/group block 阶段，gated 调 `computeContribution`+`upsertContribution`（按对方 canonical slug 键）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(profile): accumulate behavior layer in pipeline (gated by config)`

## Task 4: 四色映射 `src/profile/four-color.ts`

- [ ] **Step 1: 写失败测试** `tests/profile/four-color.test.ts`：D/I/S/C 各 high → 红/黄/绿/蓝；输出含"通俗映射，非临床诊断"标注；可双色。
- [ ] **Step 2-3: 跑失败 → 实现** 纯映射。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(profile): add behavior-quadrant → four-color mapping`

## Task 5: 夜间画像合成 `src/profile/profile-synth.ts`（独立结构化 LLM 路径，非 synthesize 引擎）

- [ ] **Step 1: 写失败测试** `tests/profile/profile-synth.test.ts`（mock provider 返回结构化 JSON）：`synthesizeProfiles` 对 `sample_size < min_sample_size` 的人 → `insufficient=true` 且 `dimensions=[]`，不写 LLM 结论；充足 → 每维带 `evidence_refs`/`confidence`，写 person page `frontmatter.profile`。
- [ ] **Step 2-3: 跑失败 → 实现** 仿 `infer-preferences.ts`：迭代 `type=person` 页 → 读 `person_behavior`+backlinks+timeline → `provider.chat(...,{responseFormat:"json"})` 产出 TraitLayer/RelationLayer → 合 four-color → 写 `frontmatter.profile`。**直接 LLM 调用，不经 `synthesize()`**（spec §七 / R2-S8-P1-1）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(profile): add nightly profile synthesis (trait+relation layers)`

## Task 6: consolidator 挂载（gated）

- [ ] **Step 1: 写失败测试**：`consolidateWarm` 在 `profile.enabled` 时调用 `synthesizeProfiles`（spy/计数）；关闭时不调。
- [ ] **Step 2-3: 跑失败 → 实现** 在 `consolidator.ts` `consolidateWarm` 内仿 `inferPreferences` 加一行（gated）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(consolidator): wire nightly profile synthesis (gated)`

## Task 7: person_strategy 意图 + prep_for_person 工具

- [ ] **Step 1: 写失败测试** `tests/synth/person-strategy.test.ts`（mock provider）：注册后 `getIntent("person_strategy")` 可得；`buildPinnedContext` 读 entity `frontmatter.profile` 渲染为 pinned 文本（无 profile → undefined）；端到端 `synthesize("person_strategy", {entity}, deps, {extra:{goal}})` 返回带 `[n]` 的建议；goal 注入 prompt（mock 校验）。`prep_for_person` 工具存在且可调。
- [ ] **Step 2-3: 跑失败 → 实现**
  - `intents/person-strategy.ts`：`personStrategyIntent`（`format:"single"`, `staleDays:21`, buildScope `{entity, limit:40}`, systemPrompt=spec §6.3 真字符串护栏, `gapRules:[staleRule]`, `buildPinnedContext` 读 `stores.pages.getPage(scope.entity).frontmatter.profile`）；`intents/index.ts` 追加 `registerIntent`。
  - `mcp.ts`：注册 `prep_for_person({person, goal?})` → `synthesize("person_strategy", {entity:person}, deps, {extra:{goal}})`（deps 用已接入的 provider；无 provider 回退 mock，与 spec7 同模式）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(synth): add person_strategy intent + prep_for_person tool`

## Task 8: 身份合并一致性 + 配置

- [ ] **Step 1: 写失败测试**：`merge_persons` 合并后两人 `person_behavior` 计数器相加、旧 `frontmatter.profile` 失效；`config.profile` 字段被 Zod 接受（enabled/allow/deny/min_sample_size，默认 enabled=false, min=20）。
- [ ] **Step 2-3: 跑失败 → 实现** 在 person 合并逻辑加 `personBehavior.merge`；`config.ts` 加 `profile` schema。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(profile): merge behavior on person merge + profile config schema`

## Task 9: README / 文档同步

- [ ] **Step 1:** 更新 `README.md`/`README.en.md`：功能清单 + MCP 工具表加 `prep_for_person`（人物沟通画像→目标条件化策略）；强调被动推断·零问卷·本地优先·伦理护栏；路线图把 Hero 场景移到"已实现"。工具计数同步（spec7 已到 28 → +1 = 29，核对实际再写）。
- [ ] **Step 2: Commit** `docs(readme): add prep_for_person (communication profile) to tools + roadmap`

## Task 10: 全量验证

- [ ] typecheck / lint:fix
- [ ] `bunx vitest run tests/profile tests/synth tests/server/mcp.test.ts ...`（全绿）
- [ ] 回归：`tests/store/search.test.ts`、`tests/consolidator/*`、`tests/core/pipeline*`（无回归）
- [ ] 对照 spec §十二 1–9 验收逐条
- [ ] **Push（实现分支）** `git push -u origin claude/spec8-person-communication-profile`

> 注：`tests/adapters/adapters.test.ts` 的 "push reports errors when write fails" 在本环境（root）预期失败（`/invalid` 可写），非回归，忽略。

---

## 依赖与后续
- 依赖 Spec 7（引擎/钩子/缓存）。下游无（Hero 终点）。
- Spec 9 的 `entities/me`/`isMe` 不在本 spec；行为层用对方 canonical slug 键，不需要 isMe。
