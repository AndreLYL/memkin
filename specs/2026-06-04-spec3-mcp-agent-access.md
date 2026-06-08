# Spec 3: MCP Agent 取用层

**日期**：2026-06-04（v2 重写，基于真实代码）
**状态**：待实施
**依赖**：Spec 1（信号类型）、Spec 2（生命周期 tier）必须先完成
**定位**：让 Claude Code、Codex、Hermes、OpenClaw 等 Agent 真正"懂你"

> **v2 重写说明**：初版假设的工具查询基于不存在的 signals 表。本版基于真实的 `src/server/mcp.ts`（17 个工具，全部走 pages/links/tags/timeline）重写。

---

## 一、背景与动机

### 当前 MCP 现状（真实）

`src/server/mcp.ts` 暴露 17 个工具，全部是 page/graph/tag/timeline 的底层 CRUD：

```
query, search, get_page, put_page, list_pages, get_chunks,
add_link, remove_link, get_links, get_backlinks, traverse_graph,
add_tag, remove_tag, get_tags, add_timeline_entry, get_timeline, get_health
```

**问题：**
1. **全是底层原语**：没有一个"高层语义"工具。Agent 想了解"用户最近在干什么"，得自己组合 list_pages + get_backlinks + get_timeline，门槛高
2. **无 SessionStart 注入**：Agent 每次启动是空白状态
3. **query/search 并存但语义不清**：两个检索工具，Agent 不知道用哪个

### 目标

- 新增 3 个高层语义工具，建立在现有原语之上
- 提供 SessionStart 可调用的工作概览工具
- 厘清 query/search 职责，利用 Spec 2 的 tier 做检索加权

---

## 二、调研依据

### 2.1 gbrain 的高层工具与 hooks

gbrain 的 recall 是**单一高层入口**（`mcp__gbrain-recall__recall(query, limit)`），内部融合 semantic + FTS + RRF，Agent 不需要知道实现。降低调用门槛。

gbrain 的 SessionStart hook 在新 session 拉取近期工作概览注入 system prompt；PreCompact hook 在 context 压缩前存档。

### 2.2 OpenHuman ReflectionKind

OpenHuman subconscious 产出 `DailyDigest`/`HotnessSpike`/`DueItem` 等高层洞察——SessionStart 注入的内容应是这种**综合快照**，不是原始信号列表。

### 2.3 token 成本原则

懒加载优于急加载：SessionStart 只注入精简概览（目标 < 800 token），细节按需 recall。

---

## 三、SessionStart 注入

### 3.1 机制

通过项目 CLAUDE.md 引导 Agent 在 session 开始调用新工具：

```markdown
<!-- 用户项目的 CLAUDE.md 中添加 -->
At session start, call `get_session_context` to load working memory.
```

不依赖 Claude Code 私有 hook API（跨 Agent 兼容：Codex/Hermes 也能用同一工具）。

### 3.2 注入内容（< 800 token）

`get_session_context` 返回 markdown：

```markdown
## 近期工作概览（最近7天）

**活跃项目**：project/memoark, project/feishu-integration
**关键决策**（最近3条）：
- 2026-06-04 采用 gbrain 式 entity-as-page，沿用 links 锚定
- 2026-06-02 选 PGLite 替代 Redis（运维成本）
**待办**（open tasks）：
- 实施 Spec 1 信号类型重构
**已知偏好**：
- 偏好中文文档；深夜工作习惯

如需细节：query("关键词") 或 get_entity_profile("project/memoark")
```

### 3.3 数据来源（基于真实 stores）

```typescript
async function getSessionContext(stores: StoreContext, days = 7): Promise<string> {
  const [projects, decisions, tasks, prefs] = await Promise.all([
    // 活跃项目：type='project' 且 tier='hot'（Spec 2）的 page，按 updated_at
    stores.pages.listPages({ type: 'project', sort: 'updated_at', limit: 5 }),
    // 最近决策：type='decision'，按 signal_time
    stores.pages.listPages({ type: 'decision', sort: 'signal_time', limit: 3 }),
    // open tasks：type='task'，frontmatter.status='open'（需在 PageStore 加过滤或后置过滤）
    stores.pages.listPages({ type: 'task', limit: 50 }),
    // 偏好：type='preference'（Spec 1 新类型）
    stores.pages.listPages({ type: 'preference', limit: 10 }),
  ]);
  return formatSessionContext({ projects, decisions, tasks, prefs });
}
```

注：open task 过滤当前需后置（frontmatter JSONB），若性能不足，Spec 1/2 可考虑把 status 提为列。

---

## 四、新增 3 个高层工具

### 4.1 `get_session_context`

```typescript
// handler
get_session_context: ({ days }: { days?: number }) =>
  getSessionContext(stores, days ?? 7),
// tool schema
server.tool("get_session_context", { days: z.number().optional() }, ...)
```

### 4.2 `list_signals_by_entity`

建立在 `graph.getBacklinks` 之上（entity 锚定已存在）：

```typescript
list_signals_by_entity: async ({ entity_slug, signal_types, limit }) => {
  const backlinks = await stores.graph.getBacklinksEnriched(entity_slug);
  let signals = backlinks.map(b => ({ slug: b.from_slug, ...b.page }));
  if (signal_types) signals = signals.filter(s => signal_types.includes(s.type));
  return signals.slice(0, limit ?? 20);
}
```

`getBacklinksEnriched` 已返回 page 的 title/type/frontmatter（`src/store/graph.ts:149`），无需额外查询。

> **限制**：`EnrichedLinkRow.page` 只包含 `{ title, type, frontmatter }`，**不含 `compiled_truth`（正文）**。此工具定位为"信号列表"（轻量元数据），Agent 按需对感兴趣的 slug 调用 `get_page` 拿正文。如需批量正文，实施时可扩展为 JOIN 查询，或接受当前"两步：list → get_page"的使用模式。

### 4.3 `get_entity_profile`

组合 entity page + backlinks + timeline：

```typescript
get_entity_profile: async ({ entity_slug }) => {
  const [page, backlinks, timeline] = await Promise.all([
    stores.pages.getPage(entity_slug),
    stores.graph.getBacklinksEnriched(entity_slug),
    stores.timeline.getTimeline(entity_slug),
  ]);
  // 按 type 分组 backlinks（decisions/knowledge/preferences/references）
  return formatEntityProfile(page, groupByType(backlinks), timeline);
}
```

返回结构化档案：基本信息 + 关键决策 + 相关偏好 + 近期 timeline。

> **timeline 范围限制**：`getTimeline(entity_slug)` 只返回直接附加在 entity page 上的 timeline entries（`WHERE pages.slug = entity_slug`）。大部分 timeline entry 附加在 decision/task page 上，不直接挂在 entity page。因此 entity profile 的 timeline 可能不完整，不代表该 entity 的全部活动历史。如需完整活动时间线，需先用 backlinks 找到所有相关 page，再对每个 page 拉 timeline——计算量较高，留作后续增强。

---

## 五、query 增强与 tier 加权

**真实工具名**（`src/server/mcp.ts`）：语义检索是 `query`，关键词检索是 `search`。不存在 `recall` 工具。

### 5.1 职责厘清

- `search`：全文/关键词检索，返回 page 列表（保留，不改）
- `query`：向量语义检索（保留，作为 Agent 主入口）
- CLAUDE.md 引导 Agent 默认用 `query`，需要精确关键词时用 `search`

### 5.2 query 的 tier 加权（依赖 Spec 2）

在 `SearchEngine`（`src/store/search.ts`）排序阶段，对 Spec 2 引入的 `tier` 列加权：

```
hot   → ×1.0
warm  → ×0.8
cold  → ×0.6
```

最新鲜的信号优先返回。这是对现有 search 的增量改动，不重写检索核心。

---

## 六、工具数量

初版称"精简到 ≤12"。**修正**：现有 17 个原语各有用途（CRUD 完整性），盲目删除会破坏 Web UI 和现有集成（它们依赖这些原语）。

**实际策略**：不删原语，**新增** 3 个高层工具（共 20 个），通过 CLAUDE.md 引导 Agent **优先用高层工具**（get_session_context / list_signals_by_entity / get_entity_profile / query），底层原语作为高级用法保留。

降低门槛靠"引导优先级"，不靠"删工具"。

---

## 七、主动存档引导（替代 PreCompact Hook）

gbrain 的 PreCompact hook 依赖 Claude Code 私有 API，跨 Agent 不通用。**本 spec 不实现 hook**。

替代方案：在 CLAUDE.md 模板中引导 Agent 在关键节点主动调用已有的 `put_page` 工具存档：

```markdown
<!-- CLAUDE.md 引导语 -->
When you make a significant decision or discovery, save it with:
  put_page(slug="decisions/<slug>", content="---\ntitle: ...\ntype: decision\n---\n...")
```

没有 `remember` 这个 CLI 命令或 MCP 工具——直接用 `put_page` 即可，无需包装。

---

## 八、范围边界（Out of Scope）

- 信号类型、migration → **Spec 1**
- tier/生命周期轮转 → **Spec 2**
- Claude Code 私有 hook 自动化 → 独立增强
- 跨用户共享、Obsidian 同步 → 不在范围

---

## 九、验收标准

1. `bun test` 全部通过（含 3 个新工具的测试）
2. `get_session_context()` 返回 < 800 token 的有意义概览
3. `list_signals_by_entity("project/memoark")` 通过 backlinks 返回正确信号列表
4. `get_entity_profile("project/memoark")` 返回结构化档案（基本信息+决策+偏好+timeline）
5. `query("PGLite 决策")` 结果中 tier='hot' 的 page 排序优先于 tier='cold'
6. 现有 17 个工具行为不变（Web UI 不受影响）
7. CLAUDE.md 模板更新，引导 Agent 优先使用高层工具
