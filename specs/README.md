# Memoark Spec Repository

本仓库是 Memoark 记忆层重构的设计文档中心，记录产品决策、技术规格、实施计划，以及外部参考调研。

## 目录结构

```
specs/          产品规格说明（What & Why）
plans/          实施计划（How，面向 AI 工程师的 TDD 步骤）
research/       外部参考调研报告
```

## 三阶段重构总览

```
Spec 1 → Spec 2 → Spec 3
信号类型   记忆生命周期   MCP Agent 取用层
  ✅ 已合并    ✅ PR 中      ✅ PR 中
```

| Spec | 核心交付 | 状态 | 代码分支 |
|------|---------|------|---------|
| Spec 1：信号类型重构 | preference/reference 一等类型；halflife_days；migration runner | ✅ 已合并 main | — |
| Spec 2：记忆生命周期 | hot→warm→cold tier；consolidateHotToWarm/WarmToCold；CLI | ✅ PR 待合并 | `claude/repository-issues-review-TZG4j` |
| Spec 3：MCP Agent 取用层 | get_session_context / list_signals_by_entity / get_entity_profile | ✅ PR 待合并 | 同上 |
| Spec 4：抽取性能优化 | 并发抽取 + pipeline 阶段计时 | ✅ 已合并 main | spec：`2026-06-09-extraction-performance-spec.md` |
| Spec 5：Web 配置 UI | 配置中心 Web 界面 | ✅ 已合并 main（#60/#61 相关） | 归档：`docs/spec5-spec6-archive` 分支 |
| Spec 6：Fetch Center | 抓取中心 / 数据源管理 | ✅ 已合并 main | 归档：`docs/spec5-spec6-archive` 分支 |

> Spec 4 的 spec 文档在本分支 `specs/2026-06-09-extraction-performance-spec.md`、plan 在 `docs/superpowers/plans/`；Spec 5/6 的 spec 文档归档在 `docs/spec5-spec6-archive` 分支的 `docs/superpowers/specs/`。

## 行动决策记忆（2026-06，对标 gbrain）

> 主线：从"我知道什么"→"我该怎么做"。借 gbrain 的"读"（合成/自布线），守我们的"写"（中文职场多渠道抽取）。详见 [总纲](2026-06-22-action-memory-brainstorming.md)。

| Spec | 核心交付 | 状态 |
|------|---------|------|
| Spec 7：合成底座 | synthesize 引擎 + 意图框架 + 引用 + gap + best-chunk 池化 | ✅ 已合并 main |
| Spec 8：人物沟通画像（Hero） | 三层人格（行为层+行为四象限主轴+关系层）+ 四色外壳；prep_for_person | ✅ 已合并 main |
| Spec 9：日报 + 文档提取 | 卡片 schema 加 decisions/action_items；entities/me；daily_report | ✅ 已合并 main |
| Spec 10：检索质量 | best-chunk 池化深化 / 零-LLM 边 / query 改写 | ✅ 已合并 main |
| Spec 11：playbook | 分支 runbook + 分层树状图 + troubleshoot | ✅ 已合并 main |

## 规格文档速读

- [产品形态头脑风暴](2026-06-04-product-form-brainstorming.md) — 三阶段规划的背景与动机
- [Spec 1](2026-06-04-spec1-signal-types-entity-architecture.md) — 信号类型重构 + Entity 锚定强化
- [Spec 2](2026-06-04-spec2-memory-lifecycle.md) — 记忆生命周期（tier 系统）
- [Spec 3](2026-06-04-spec3-mcp-agent-access.md) — MCP Agent 取用层
- [Spec 4](2026-06-09-extraction-performance-spec.md) — 抽取性能优化（并发 + 阶段计时）
- [行动决策记忆头脑风暴总纲](2026-06-22-action-memory-brainstorming.md) — thesis、三场景、防抄袭台账、Spec 7–11 蓝图
- [Spec 7：合成底座](2026-06-22-spec7-synthesis-engine.md) — synthesize 引擎 + 意图框架 + 引用 + gap
- [Spec 8：人物沟通画像（Hero）](2026-06-22-spec8-person-communication-profile.md) — 三层人格 + 行为层数据约束 + prep_for_person + 伦理护栏
- [Spec 9：日报 + 文档提取](2026-06-22-spec9-daily-report-and-doc-extraction.md) — 卡片加 decisions/action_items + entities/me + daily_report
- [Spec 10：检索质量](2026-06-22-spec10-retrieval-quality.md) — best-chunk 池化 / 零-LLM 边 / query 改写
- [Spec 11：playbook](2026-06-22-spec11-playbook.md) — 分支 runbook + 分层树 + troubleshoot

## 实施计划速读

- [Spec 1 实施计划](plans/2026-06-07-spec1-signal-types-implementation.md) — 含 TDD 步骤、迁移 SQL、Zod 验证
- [Spec 2 实施计划](plans/2026-06-07-spec2-memory-lifecycle.md) — 含 9 个任务、consolidator 架构
- [Spec 3 实施计划](plans/2026-06-08-spec3-mcp-agent-access.md) — 含 MCP 工具注册、session context 设计
- [Spec 7 实施计划](plans/2026-06-22-spec7-synthesis-engine.md) — 合成引擎 TDD（实现分支 `claude/spec7-synthesis-engine`，✅ 已实现/测试绿）
- [Spec 8 实施计划](plans/2026-06-22-spec8-person-communication-profile.md) — 人物画像 TDD（实现分支 `claude/spec8-...`，堆叠于 spec7）

## 调研报告

- [OpenHuman 提取架构调研](research/2026-06-08-openhuman-extraction-research.md) — 并发提取机制与性能优化参考
- [gbrain × Memoark 细致对比](research/2026-06-22-gbrain-comparison-research.md) — 数据库/分渠道提取/检索栈逐项对比 + 可借鉴台账
