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

## 规格文档速读

- [产品形态头脑风暴](specs/2026-06-04-product-form-brainstorming.md) — 三阶段规划的背景与动机
- [Spec 1](specs/2026-06-04-spec1-signal-types-entity-architecture.md) — 信号类型重构 + Entity 锚定强化
- [Spec 2](specs/2026-06-04-spec2-memory-lifecycle.md) — 记忆生命周期（tier 系统）
- [Spec 3](specs/2026-06-04-spec3-mcp-agent-access.md) — MCP Agent 取用层

## 实施计划速读

- [Spec 1 实施计划](plans/2026-06-07-spec1-signal-types-implementation.md) — 含 TDD 步骤、迁移 SQL、Zod 验证
- [Spec 2 实施计划](plans/2026-06-07-spec2-memory-lifecycle.md) — 含 9 个任务、consolidator 架构
- [Spec 3 实施计划](plans/2026-06-08-spec3-mcp-agent-access.md) — 含 MCP 工具注册、session context 设计

## 调研报告

- [OpenHuman 提取架构调研](research/2026-06-08-openhuman-extraction-research.md) — 并发提取机制与性能优化参考
