# Spec 9: 日报 + 文档提取 + 「我」身份 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD, task-by-task, checkbox tracking.

> **分支须知**：plan 在 `docs/specs-and-research`；实现分支 **`claude/spec9-daily-report-and-doc-extraction`**，**从 `claude/spec8-person-communication-profile` 切出**（堆叠：依赖 Spec 7 引擎；main 受保护未合）。代码+README 提交到该分支。

**Goal:** `daily_report(date?)` 跨渠道日报（7 段）；文档卡片 `FullCard` 扩 `decisions[]`/`action_items[]{owner,due}` 并把 action_items 落为 task 信号；`entities/me` 自我身份页 + `isMe` 判定（self_open_id 自动解析含 Spike，手填兜底）。

**Architecture:** 见 Spec §七。复用 Spec 7 引擎 `synthesize(intentId, scope, deps, opts?)`（time-scope 检索已实现于 `src/synth/scope.ts`）。文档侧扩展现有卡片系统（`src/collectors/feishu/docs/*`）。身份扩展现有 `src/core/person-identity.ts`。

> 规格依据：`specs/2026-06-22-spec9-daily-report-and-doc-extraction.md`（§5.1 已给 systemPrompt 真字符串 + parseSections + today()；§3 卡片扩展；§4 entities/me）。

### 实测 API（已核 spec8 分支）
- 引擎/意图：`synthesize(id,scope,deps,opts?)`；`registerIntent` + `src/synth/intents/index.ts`；`scope.ts` 已支持 time/entity/query 三模式；gap：`import { missingFieldRule } from "../gaps.js"`。
- 文档：`src/collectors/feishu/docs/full-builder.ts` `buildPrompt` 现产出 `{purpose,topics,entities,overview}`；`FullCard` 在 `docs/types.ts`；`docs/store-writer.ts` `writeCard(stores, card)` 写 `feishu-docs/<token>` 页（**本 spec 在此加 action_items→task**）。
- 身份：`PersonIdentityStore`（`src/core/person-identity.ts`）已有 `mergePersons`（~207）；**无 entities/me/isMe**，本 spec 新增。self 解析：`src/collectors/feishu/self-open-id.ts` `resolveSelfOpenId()`。
- MCP：`prep_for_person`/`synthesize`/`recall` 已注册（spec7/8）；本 spec 加 `daily_report`，并同步 `tests/server/mcp-contract.test.ts` 工具清单（**务必更新,否则契约测试红**）。
- 测试：`createMockProvider`；`bunx vitest run <path> --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2`。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/collectors/feishu/docs/types.ts` | Modify | `FullCard` 加 `decisions[]`/`action_items[]`（+ ActionItem/DocDecision） |
| `src/collectors/feishu/docs/full-builder.ts` | Modify | `buildPrompt` 扩抽 decisions/action_items |
| `src/collectors/feishu/docs/store-writer.ts` | Modify | action_items → `type=task` 页（slug hash）+ 锚定链接 |
| `src/core/person-identity.ts` | Modify | `ensureEntitiesMe()`/`registerSelfHandle()`/`isMe()` |
| `src/synth/intents/daily-report.ts` | Create | `daily_report` 意图（§5.1 真字符串/parseSections/today） |
| `src/synth/intents/index.ts` | Modify | `registerIntent(dailyReportIntent)` |
| `src/server/mcp.ts` | Modify | 注册 `daily_report({date?})` |
| `tests/server/mcp-contract.test.ts` | Modify | 工具清单加 `daily_report` |
| `README.md`/`README.en.md` | Modify | 同步 daily_report + entities/me |
| `tests/...` | Create | 各任务测试 |

---

## Task 1: FullCard schema 扩展

- [ ] **Step 1: 写失败测试** `tests/collectors/feishu/docs/extract-fields.test.ts`：mock provider 返回含 `decisions`/`action_items` 的 JSON，`FullCardBuilder.build` 产出的卡片带 `decisions[]`、`action_items[]{text,owner_raw,due,status}`。
- [ ] **Step 2-3: 跑失败 → 实现** `docs/types.ts` 加 `DocDecision`/`ActionItem` 与 `FullCard.decisions/action_items`；`full-builder.ts` `buildPrompt` 的 JSON schema 追加 `"decisions":{text,made_by}[]`、`"action_items":{text,owner,due(ISO|null)}[]`；解析并填充。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(docs): extract decisions + action_items in full card`

## Task 2: action_items → task 信号

- [ ] **Step 1: 写失败测试** `tests/collectors/feishu/docs/store-writer.test.ts`：写一张带 action_items 的卡片后，生成 `tasks/doc-<token>-<hash8>` 页（slug 用 `sha256(text).slice(0,8)`，**非位置索引**）、`frontmatter` 带 owner_slug/due/status/source；`graph.addLink(task, owner_slug, "mentions")`；owner 是我时再 `addLink(task,"entities/me","mentions")`。重抽同文本 → 同 slug（幂等）。
- [ ] **Step 2-3: 跑失败 → 实现** 在 `store-writer.ts` `writeCard` 后追加 action_items 落地（owner 经身份层 canonical 化；isMe 判定见 Task 3，可注入）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(docs): persist action_items as task signals (hash slug + anchors)`

## Task 3: entities/me + self 身份

- [ ] **Step 1: 写失败测试** `tests/core/person-identity-me.test.ts`：`ensureEntitiesMe()` 建/返回 `entities/me`（type=person）；`registerSelfHandle(kind,value)` 写 `person_handles(canonical="entities/me",strong)`；`isMe(slug)` 对 canonical 化到 entities/me 的 handle 判真、他人判假。
- [ ] **Step 2-3: 跑失败 → 实现** 扩 `person-identity.ts` 三函数。**self_open_id**：手填路径（确定可用，默认）+ 调 `resolveSelfOpenId` 作增强。
  > ⚠️ **Spike**：在真实 lark-cli 环境验证自动解析；测试环境只测手填路径。结论记入本 plan 末尾。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(identity): add entities/me + registerSelfHandle + isMe`

## Task 4: daily_report 意图 + 工具

- [ ] **Step 1: 写失败测试** `tests/synth/daily-report.test.ts`（mock provider 返回 7 个 `## 标题` 文本）：`getIntent("daily_report")` 可得；端到端 `synthesize("daily_report", buildScope({date}), deps)` 返回 `sections` 7 段 + `answer`（拼接）；缺段触发 `missing_field` gap；time-scope 缓存写 `reports/daily/<date>`（`type="knowledge"`+`is_report=true`）。`daily_report` 工具存在可调。
- [ ] **Step 2-3: 跑失败 → 实现**
  - `intents/daily-report.ts`：照搬 spec §5.1（`format:"sections"`, `today()`, `parseSections` 按 `## ` 切, systemPrompt 固定 7 标题真字符串, `gapRules:[missingFieldRule]`）；`intents/index.ts` 注册。
  - `mcp.ts`：注册 `daily_report({date?})` → `synthesize("daily_report", dailyReportIntent.buildScope({date}), deps)`；同步 `mcp-contract.test.ts` 工具清单加 `daily_report`。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(synth): add daily_report intent + tool`

## Task 5: 跨渠道聚合 + 去重 + token budget

- [ ] **Step 1: 写失败测试** `tests/synth/daily-report-aggregate.test.ts`：构造邮件+IM+日历+文档当日信号，断言分别落入正确 section、"我的待办" 经 isMe 判定正确；重复(同 slug / 同 source_hash)去重；候选超预算被截断（断言喂 LLM 的候选数受限）。
- [ ] **Step 2-3: 跑失败 → 实现** time-scope 检索按 date 窗口取跨渠道信号；`dedupe`(slug + frontmatter.source_hash)；`context` 按 token budget(如 12k)截断。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(synth): daily report cross-channel aggregation + dedupe + token budget`

## Task 6: README / 文档同步

- [ ] 更新 `README.md`/`README.en.md`：工具表加 `daily_report`（跨渠道日报）；功能清单加"会议纪要 decisions/action_items 抽取""entities/me 自我身份";路线图日报场景移"已实现"。工具计数 +1（读当前实际值再写）。
- [ ] **Commit** `docs(readme): add daily_report + doc action_items to tools/roadmap`

## Task 7: 全量验证

- [ ] typecheck / lint:fix
- [ ] `bunx vitest run tests/synth tests/collectors/feishu/docs tests/core/person-identity*.test.ts tests/server/mcp.test.ts tests/server/mcp-contract.test.ts`（全绿）
- [ ] 回归：`tests/profile tests/store/search.test.ts tests/consolidator`（无回归）
- [ ] 对照 spec §九 验收逐条
- [ ] **Push（实现分支）** `git push -u origin claude/spec9-daily-report-and-doc-extraction`

> 注：`tests/adapters/adapters.test.ts` "push reports errors when write fails" 在本环境(root)预期失败，非回归，忽略。
> 注：每加一个 MCP 工具，必须同步 `tests/server/mcp-contract.test.ts` 的工具清单（否则契约测试红——Spec 8 曾漏）。

---

## 依赖与后续
- 依赖 Spec 7（引擎/time-scope/cache）。Task 2 的 isMe 依赖 Task 3。
- Spike（self_open_id 自动解析）结论：__实现时填__。
