# Memoark 产品形态头脑风暴笔记

**日期**：2026-06-04  
**状态**：进行中，信号类型重构阶段待详细设计  
**下一步**：对"阶段1：信号类型重构"做完整设计 → 写实施计划

---

## 一、已确定的产品方向

### 核心定位
**飞书 + Agent 双主线**：飞书是主要工作数据源，AI Agent（Claude Code、Codex、Hermes、OpenClaw 等）既是记忆的消费者也是生产者。核心价值是"让所有与你协作的 Agent 真正懂你"。

### 各维度决策

| 维度 | 决策 | 理由 |
|---|---|---|
| 核心触点 | MCP 优先（隐形基设） | 主价值是喂给 Agent 的记忆，Web UI 是可见性/信任层 |
| 飞书摄入 | 主动轮询（daemon 定时） | 完全无感，用户无需手动触发 |
| 记忆生命周期 | 分级保留 + gbrain 式三层轮转 | 见下方详细说明 |
| 信号类型 | 7种（重构后） | 见下方详细说明 |
| 飞书文档处理 | 分级（默认摘要+reference，可标记深度提取） | 平衡成本与信息价值 |
| Agent 取用方式 | 混合型（C）| SessionStart 注入近期工作概览 + 按需 recall 细节 |

---

## 二、记忆生命周期策略

### 参照系统对比

| 项目 | 合并策略 | 存储 | 摄入 |
|---|---|---|---|
| **MemPalace** (53k⭐) | 无，全部原始永久保留 | ChromaDB + SQLite | 手动触发 |
| **OpenHuman** | 层级摘要树（有损压缩） | SQLite + Obsidian vault | 被动自动轮询（20分钟） |
| **gbrain** | 三层 hot/warm/cold，TTL 自动轮转 | Markdown 为主（git-versioned）+ Postgres/pgvector | 事件驱动（Agent lifecycle hooks） |

### Memoark 采用策略：重要性分级保留 + gbrain 三层模型

**三层轮转：**
- `hot`（近期信号，完整保留，约14天）
- `warm`（实体合并、去重后的信号，月级别）
- `cold`（每个实体/项目的叙述性摘要，长期保留）

**信号类型专属规则：**
- `decisions`、`discoveries`（并入 knowledge）→ **永久原始保留，永不压缩**（Agent 需要"为什么"）
- `entities`、`tasks`、`timeline` → 按 hot→warm→cold 轮转
- 原始飞书聊天记录 → TTL 衰减（保留30天），30天后只保留提取出的 signal

**原始信号保留策略：**
- 原始飞书内容保留 **30天**，作为 pipeline 重跑的安全网
- 30天后删除原始内容，只保留提取的 signal
- 提供"标记永久保留"机制，供用户对特别重要的对话使用

---

## 三、信号类型重构（核心地基）

### 当前7种 → 重构后7种

| 原类型 | 状态 | 变化说明 |
|---|---|---|
| entities | ✅ 保留 | 不变 |
| timeline | ✅ 保留 | 不变 |
| decisions | ✅ 保留，强化 | 永久原始保留，不参与压缩 |
| tasks | ✅ 保留 | 不变 |
| discoveries | ⚠️ 合并 | 并入 knowledge，用 sub_type 区分"新发现"vs"稳定事实" |
| knowledge | ⚠️ 扩展 | 吸收 discoveries，sub_type: `fact` / `discovery` / `concept` |
| links | ❌ 重新定义 | 改名为 references，定义为"有上下文的资源书签"（URL 为必须字段） |

### 新增类型

| 新类型 | 说明 | 飞书来源 |
|---|---|---|
| **procedures** | 操作手册/流程（"怎么做某件事"），来自飞书文档 | 飞书文档、技术指南 |
| **references** | 有上下文的资源书签。存储：标题 + URL + 摘要 + 触发场景 | 飞书消息中分享的文档链接 |

### references 类型的数据结构

```typescript
interface ReferenceSignal {
  type: 'references';
  title: string;        // 文档标题
  url: string;          // URL（核心字段，失效时标记 dead_link）
  summary: string;      // 文档主要内容摘要（100字以内）
  trigger: string;      // 适合在什么场景使用（"遇到 Claude 安装问题时"）
  source: string;       // 来源（飞书群/消息 ID）
  created_at: Date;
}
```

### 暂缓的类型

- **preferences**（偏好/习惯）：有价值，但大部分需要跨多条消息统计推断，不适合当前的逐-block 提取 pipeline。留给后续 Consolidator 阶段做衍生推断。

---

## 四、飞书文档处理策略

**分级处理（C 方案）：**
- **默认**：每篇文档生成一条 `references` signal（标题 + URL + 摘要），不深度拆解
- **标记重要**：用户可标记特定文档，触发深度提取，从文档中提取完整的 decisions/procedures/knowledge signals

---

## 五、尚未讨论的设计问题

以下议题在本次会话中被跳过，下次继续前需要讨论：

1. **信号类型重构的具体实施方案**：schema 迁移、现有数据兼容性、pipeline 各阶段的改动范围
2. **procedures 的提取逻辑**：如何从飞书文档中识别"这是一个操作流程"
3. **references 的 dead-link 检测**：URL 失效时如何处理
4. **SessionStart 注入的内容格式**：注入什么、注入多少、如何控制 token 成本
5. **hot/warm/cold 轮转的触发机制**：cron 还是事件触发，与现有 daemon scheduler 如何集成
6. **Consolidator 的优先级**：warm→cold 的合并逻辑是阶段1的一部分还是单独迭代

---

## 六、拆分后的实施阶段（未详细设计）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **阶段1（下一步）** | 信号类型重构（7种新 schema） | 无，地基 |
| 阶段2 | 飞书文档分级处理 | 阶段1（references/procedures schema） |
| 阶段3 | 记忆生命周期（hot/warm/cold + Consolidator） | 阶段1（稳定的信号类型） |
| 阶段4 | MCP 取用层（SessionStart 注入 + recall 优化） | 阶段3（有可用的记忆层） |

---

## 八、Spec 文件索引

| Spec | 文件 | 状态 |
|---|---|---|
| Spec 1：信号类型重构 + Entity 架构 | `2026-06-04-spec1-signal-types-entity-architecture.md` | 待审查 |
| Spec 2：记忆生命周期 | `2026-06-04-spec2-memory-lifecycle.md` | 待审查 |
| Spec 3：MCP Agent 取用层 | `2026-06-04-spec3-mcp-agent-access.md` | 待审查 |

---

## 九、代码审查修正（2026-06-04，三个 spec 已基于此重写为 v2）

初版三个 spec 基于错误的架构假设，经代码审查后全部重写。**关键事实，后续不要再搞错：**

### 真实存储架构（src/store/schema.sql）
- **没有 `signals` 表。** 所有信号存为 `pages` 表记录，用 `type` 字段 + slug 前缀区分
  - entity → `type=person/project/...`，slug=`<name>`
  - decision → `type=decision`，slug=`decisions/<kebab>`
  - task → `type=task`，slug=`tasks/<kebab>`
  - discovery → `type=discovery-<subtype>`，slug=`discoveries/<kebab>`
  - knowledge → `type=knowledge`，slug=`knowledge/<topic>/<hash12>`
- **timeline 和 link 不是 page**：分别存 `timeline_entries` 表和 `links` 表
- 信号元数据存在 `pages.frontmatter` JSONB

### Entity 锚定已经存在（src/adapters/store.ts）
- 写 decision/discovery/knowledge 时已调用 `graph.addLink(signalSlug, entitySlug, "mentions")` 锚定到 entity page
- 查"某 entity 的所有信号" = `graph.getBacklinks(entitySlug)`
- **不需要新建 entities 表或 entity_slugs[] 字段**——初版 spec 的这个设计是错的

### procedure/preference 已部分存在（src/core/types.ts:125）
- `Discovery.type = "procedure" | "preference" | "pattern" | "insight" | "risk"`
- preference 当前埋在 discovery 子类里，Spec 1 把它提升为一等类型

### 无 migration runner（src/store/database.ts）
- 每次启动重跑整个 schema.sql（全 `CREATE TABLE IF NOT EXISTS`），对已有库不执行 ALTER
- Spec 1 新增最小 migration runner（`schema_migrations` 表 + 编号 SQL）作为地基

### 原始飞书内容根本没存（修正 Spec 2 动机）
- pipeline 处理完只落 pages，`RawMessage` 不入库
- 初版"清理原始内容膨胀"动机不成立，"30天 TTL"无删除对象
- 原始内容保留层是独立子项目，移出 Spec 2，记入下方 backlog

### MCP 现状（src/server/mcp.ts）
- 17 个底层原语工具（query/search/get_page/.../get_timeline/get_health）
- Spec 3 新增 3 个高层语义工具，不删原语（Web UI 依赖它们）

### v2 修正后的类型结论
最终信号类型（v2）：entities / timeline / decisions / tasks / knowledge / discovery / **preferences（提升）** / **references（新增）**
- 不强行合并 discovery 和 knowledge（YAGNI，等数据验证）
- knowledge 不加 sub_type（已有 source_type，过度设计）

### Backlog（独立子项目）
- 原始飞书内容保留层（供 pipeline 重跑）：需新建表 + 改 Collector + TTL 清理
- Claude Code PreCompact hook 自动化（私有 API，跨 Agent 不通用）
- 飞书文档深度提取（用户标记触发）

---

## 七、关键共识备忘

- gbrain 的设计哲学和 Memoark 高度一致：一个人的工作记忆，服务于所有与这个人协作的 Agent（Claude/Codex/Hermes/OpenClaw 等），是多 Agent 共享记忆层，不是单 Agent 专属
- gbrain 是 entity-as-page 模型（无独立 entities 表），与 Memoark 现状一致——这验证了沿用 pages 模型的正确性
- MemPalace 的"全部原始保留"策略本质是逃避决策，6个月后检索质量会退化
- OpenHuman 的有损摘要对 decisions 信号危险，会丢失"为什么"——故 decision/reference/entity 列入永不压缩名单
- gbrain 成熟的三个理由：①生命周期有明确操作语义（TTL+cron）②Markdown 为 canonical 源（数据库可重建）③PreCompact hook（在 context 压缩前主动存档）
