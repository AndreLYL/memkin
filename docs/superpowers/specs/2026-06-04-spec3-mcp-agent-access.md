# Spec 3: MCP Agent 取用层

**日期**：2026-06-04  
**状态**：待实施  
**依赖**：Spec 1（信号类型 + Entity 架构）、Spec 2（记忆生命周期）必须先完成  
**定位**：让 Claude Code、Codex、Hermes、OpenClaw 等 Agent 真正"懂你"

---

## 一、背景与动机

### 当前 MCP 现状

Memoark 已有 17 个 MCP 工具，覆盖基础 CRUD 和搜索。但存在两个问题：

1. **无 SessionStart 注入**：Agent 每次启动都是"空白状态"，不知道用户最近在做什么
2. **工具太多太碎**：17个工具让 Agent 不知道该调哪个，降低实际使用率

### 目标

- SessionStart 时自动注入"近期工作概览"（用户最近7天的工作上下文）
- 新增3个高价值工具：按实体查询、获取实体档案、获取近期概览
- 精简现有工具，提升 Agent 实际调用率

---

## 二、调研依据

### 2.1 gbrain SessionStart 模式

gbrain 的 `Stop hook` 和 `SessionStart hook`（`src/hooks/`）：

- `Stop hook`：Agent session 结束时，将 session 内容写入 hot tier
- `SessionStart hook`：新 session 开始时，从 brain 拉取近期工作概览注入 system prompt
- `PreCompact hook`：Claude Code context compaction 前主动存档，防止信息在压缩中丢失

gbrain 的 recall 工具单调用即返回混合结果（semantic + FTS + RRF）：
```typescript
mcp__gbrain-recall__recall(query: string, limit: number)
```

这个"单一入口"设计让 Agent 不需要知道内部实现，降低了调用门槛。

### 2.2 OpenHuman ReflectionKind

OpenHuman 的 subconscious agent 会产生 `HotnessSpike`、`CrossSourcePattern`、`DailyDigest` 等洞察——这些是对 SessionStart 注入内容的参考。

SessionStart 注入的内容不应该是原始 signal 列表，而应该是**综合后的工作状态快照**。

### 2.3 token 成本考量

Agent 的 context window 是有限资源。注入过多会：
1. 挤占任务本身的 context 空间
2. 增加每次调用的费用
3. 降低 Agent 的注意力（越长的 context，早期内容越容易被忽略）

gbrain 的设计原则：**懒加载优于急加载**——SessionStart 只注入精简概览，细节按需 recall。

---

## 三、SessionStart 注入

### 3.1 注入方式

通过 Claude Code 的 CLAUDE.md 或 system prompt 文件，在 session 开始时引用 MCP 工具：

```markdown
<!-- CLAUDE.md 中添加 -->
At the start of each session, call `mcp__memoark__get_session_context` to load
your working memory. This tells you what the user has been working on recently.
```

### 3.2 注入内容格式

`get_session_context` 工具返回内容（控制在 800 token 以内）：

```markdown
## 近期工作概览（最近7天）

**活跃项目**：Memoark（信号类型重构）、飞书集成（WebHook 配置）

**关键决策**（最近3条）：
- 2026-06-04：选择 gbrain 式 entity 锚定架构，替代游离 signal 方案
- 2026-06-02：决定用 PGLite 替代 Redis，原因：运维成本
- 2026-05-30：信号类型从7种调整为7种（合并 discoveries，重定义 links）

**待办事项**（open tasks）：
- 实施 Spec 1：信号类型重构（未开始）
- 更新 CI pipeline 支持新 schema

**近期 preferences**（已知偏好）：
- 偏好中文界面和中文文档
- 工作时间通常晚上10点后

---
如需更多上下文，使用 recall("关键词") 或 get_entity_profile("entity_slug")。
```

### 3.3 内容来源逻辑

```typescript
async function getSessionContext(userId: string, pg: PGlite): Promise<string> {
    const [activeProjects, recentDecisions, openTasks, preferences] = await Promise.all([
        // 活跃项目：最近7天有关联 signal 的 project entity
        getActiveEntities(pg, 'project', 7),
        // 关键决策：最近3条 decisions signal
        getRecentSignals(pg, 'decisions', 3),
        // 待办：所有 status=open 的 tasks
        getOpenTasks(pg),
        // 偏好：所有 preferences signal（hot+warm tier）
        getPreferences(pg),
    ]);

    return formatSessionContext({ activeProjects, recentDecisions, openTasks, preferences });
}
```

---

## 四、新增 MCP 工具

### 4.1 `get_session_context`

```typescript
{
    name: 'get_session_context',
    description: '获取用户近期工作概览，在 session 开始时调用。返回活跃项目、关键决策、待办事项和已知偏好。',
    inputSchema: {
        type: 'object',
        properties: {
            days: { type: 'number', default: 7, description: '查看最近几天的上下文' }
        }
    }
}
```

### 4.2 `list_signals_by_entity`

```typescript
{
    name: 'list_signals_by_entity',
    description: '获取某个实体（人/项目/工具）的所有关联信号。适合深入了解特定主题时使用。',
    inputSchema: {
        type: 'object',
        required: ['entity_slug'],
        properties: {
            entity_slug: { type: 'string', description: '实体标识符，如 project:memoark, person:alice' },
            signal_types: { type: 'array', items: { type: 'string' }, description: '过滤信号类型' },
            limit: { type: 'number', default: 20 }
        }
    }
}
```

### 4.3 `get_entity_profile`

```typescript
{
    name: 'get_entity_profile',
    description: '获取某个实体的综合档案：基本信息 + 关联的 decisions/knowledge/preferences 摘要。',
    inputSchema: {
        type: 'object',
        required: ['entity_slug'],
        properties: {
            entity_slug: { type: 'string' }
        }
    }
}
```

返回格式：

```markdown
## project:memoark

**基本信息**：本地优先个人记忆系统，TypeScript + Bun + PGLite

**关键决策**：
- 使用 gbrain 式 entity 锚定架构
- 信号类型：7种（entities/timeline/decisions/tasks/knowledge/references/preferences）

**相关工具**：tool:pglite, tool:bun, tool:claude-code

**近期活动**（最近30天）：
- 完成 Web UI 上线
- 开始信号类型重构讨论
```

### 4.4 `recall`（增强现有工具）

在现有搜索基础上，新增 entity 优先的 RRF 重排：

```typescript
// 查询流程
1. 向量检索（语义相关性）
2. FTS 全文检索（关键词匹配）
3. Entity boost：查询中识别出的 entity 关联 signal 额外加权
4. RRF 融合排序
5. Tier boost：hot tier 结果权重 > warm > cold
```

---

## 五、现有17个工具的精简建议

当前17个工具中，部分功能重叠或使用率低。建议：

- **保留**：recall, remember, get_timeline, get_decisions, get_tasks, get_entities
- **新增**：get_session_context, list_signals_by_entity, get_entity_profile（本 Spec）
- **合并**：将功能相近的 CRUD 工具合并为参数化版本
- **目标**：最终工具数量控制在 12 个以内（降低 Agent 选择成本）

具体精简方案在实施时确认（需要分析当前各工具的实际调用日志）。

---

## 六、PreCompact Hook（可选）

参照 gbrain 的 PreCompact hook 设计，在 Claude Code context compaction 前自动存档：

```bash
# .claude/hooks/pre-compact.sh
#!/bin/bash
# 在 context 压缩前，将当前 session 的工作状态保存到 memoark
memoark remember --session-summary "$(cat /tmp/session-context.md)"
```

这确保 Agent session 中产生的决策和发现不会因为 context 压缩而丢失。

**此功能为可选**，取决于 Claude Code hooks API 的支持情况。

---

## 七、范围边界（Out of Scope）

- Signal 类型和 entity 架构 → **Spec 1**
- 生命周期轮转和 Consolidator → **Spec 2**
- 跨 Agent 共享记忆（多用户） → 不在当前范围
- Obsidian 同步 → 独立迭代

---

## 八、验收标准

1. `get_session_context` 在新 session 中返回 < 800 token 的有意义概览
2. `list_signals_by_entity("project:memoark")` 返回正确的关联 signal 列表
3. `get_entity_profile` 返回结构化的实体档案
4. `recall("PGLite 决策")` 返回结果中，相关 entity 关联的 signal 排名靠前
5. 工具总数 ≤ 12 个
