# Spec 1: Signal Type Refactoring + Entity Architecture

**日期**：2026-06-04  
**状态**：待实施  
**依赖**：无（地基 spec）  
**后续**：Spec 2（记忆生命周期）、Spec 3（MCP Agent 取用层）

---

## 一、背景与动机

### 当前问题

Memoark 现有7种信号类型（entities, timeline, decisions, tasks, discoveries, knowledge, links），存在以下问题：

1. **类型边界模糊**：`discoveries` 与 `knowledge` 语义重叠，提取时 pipeline 无法稳定区分
2. **links 定义错误**：当前 `links` 被设计为实体关系图边，但实际需求是"有上下文的资源书签"（URL + 摘要 + 触发场景）
3. **缺少 preferences**：用户偏好/习惯是 Agent 个性化的核心输入，现有类型无法捕获
4. **信号游离**：所有 signal 相互独立，无法回答"关于 Project X 的所有上下文是什么"
5. **缺少半衰期语义**：不同类型的信号重要性随时间衰减速度不同，现有 schema 无此字段

### 目标

- 定义清晰、无歧义的7种信号类型
- 引入 entity 锚定架构，让所有 signal 可以按实体聚合查询
- 为 Spec 2（生命周期）和 Spec 3（MCP）打好地基

---

## 二、调研依据

### 2.1 gbrain（garrytan/gbrain）

**FactKind 及半衰期**（`src/core/facts/decay.ts`）：

```typescript
export const HALFLIFE_DAYS: Record<FactKind, number> = {
  event:      7,    // "周二的午饭约会，过了周二就没意义了"
  commitment: 90,   // 承诺和决策，需要较长保留
  preference: 90,   // 偏好习惯，会变化但变化慢
  belief:     365,  // 观点和假设，长期有效
  fact:       365,  // 客观事实，长期有效
};
```

**Entity 架构**（`src/schema.sql`）：
- 没有独立 entities 表；entity 就是 `pages` 表中 slug 带前缀的记录（`people/alice`、`project/memoark`）
- facts 通过 `entity_slug` TEXT 字段锚定到 entity page
- Entity resolution 使用 pg_trgm 模糊匹配，**零 LLM 调用**（`src/core/entities/resolve.ts`）

```typescript
// 4步解析链
resolveEntitySlug():
  1. 精确 slug 匹配
  2. pg_trgm 模糊匹配（相似度阈值 0.4）
  3. 前缀扩展（"Alice" → people/alice-*，按 connection_count 排序）
  4. 回退：deterministic slugify（创建 phantom stub，后续 phantom-redirect 修正）
```

**gbrain v2 页面类型精简**（15种，`src/core/schema-pack/base/gbrain-base-v2.yaml`）：
- 从 94 种精简为 15 种
- `guide`/`architecture` 被合并进 `note`/`writing`
- 保留了 `atom`（单源提取片段）和 `synthesis`（LLM 派生摘要）的区分

**gbrain-engineer learning_type**（`src/core/schema-pack/base/gbrain-engineer.yaml`）：
```
pattern | pitfall | preference | architecture | tool | operational | investigation
```
`operational` 和 `tool` 是操作性流程知识的子类型——这是 Memoark `knowledge.sub_type = procedure` 的直接来源。

### 2.2 OpenHuman（tinyhumansai/openhuman）

**EntityKind（15种）**（`src/openhuman/memory_entities/types.rs`）：
```rust
Person, Organization, Topic, Email, Url, Handle, Hashtag,
Location, Event, Product, Datetime, Technology, Artifact, Quantity, Misc
```

**双层 Entity 存储**：
- Pipeline 层：SQLite `mem_tree_entity_index`（临时，per-chunk 索引）
- Vault 层：Markdown 文件 `entities/<kind>/<canonical_id>.md`（持久，YAML frontmatter + 用户可编辑笔记）

**Entity ID 格式**：`"<kind>:<value>"`，例如 `"person:alice"`、`"email:alice@example.com"`

**ReflectionKind（洞察信号，`src/openhuman/subconscious/reflection.rs`）**：
```rust
HotnessSpike, CrossSourcePattern, DailyDigest, DueItem, Risk, Opportunity
```
这些是合并/分析后产生的高层信号，对应 Memoark 的 Consolidator 阶段（Spec 2 范围）。

**OpenHuman 没有内容语义分类系统**：它按来源（Chat/Email/Document）和存储层（MemoryKind）分类，没有等价于 decision/task/knowledge 的信号类型。这印证了 Memoark 的信号分类是一个有价值的差异化设计。

### 2.3 结论

| 设计决策 | 来源 |
|---|---|
| 每种信号类型有 halflife_days | gbrain FactKind decay 系统 |
| Entity 锚定（entity_slugs 字段） | gbrain facts.entity_slug 模式 |
| Entity resolution 零 LLM，pg_trgm | gbrain resolveEntitySlug() |
| knowledge.sub_type = procedure | gbrain engineer learning_type: operational/tool |
| preferences 作为独立信号类型 | gbrain FactKind: preference（halflife 90d） |
| references 独立类型（非图边） | 两个系统都没有，Memoark 原创 |

---

## 三、新信号类型系统

### 3.1 七种类型定义

```typescript
type SignalType =
  | 'entities'
  | 'timeline'
  | 'decisions'
  | 'tasks'
  | 'knowledge'
  | 'references'
  | 'preferences';
```

#### entities
人、项目、工具、组织。是所有其他 signal 的锚点。

- `kind`: `person | project | tool | organization | concept`
- halflife: 永久（实体本身不衰减，附属的 signal 会衰减）

#### timeline
发生过的事件，时间点明确。

- halflife: **7天**（来自 gbrain event halflife）
- 典型来源：飞书日历事件、群里的"今天下午3点开会"

#### decisions
做出的承诺、选择、决策。包含"为什么"。

- halflife: **90天**（来自 gbrain commitment halflife）
- 典型来源："我们决定用 PGLite，因为运维成本低"
- **永不进入 cold 压缩**（"为什么"是 Agent 最需要的上下文）

#### tasks
待办事项和行动项。

- halflife: **90天**
- 状态：`open | done | cancelled`
- 完成后立即降级到 warm，未完成长期保留

#### knowledge
事实、观点、流程知识的统一容器。

- halflife: **365天**（来自 gbrain fact/belief halflife）
- `sub_type`: 见下方
- **decisions 类型的知识永不压缩**

**knowledge.sub_type：**

| sub_type | 定义 | 来源 |
|---|---|---|
| `fact` | 客观可验证的事实 | gbrain FactKind: fact |
| `belief` | 主观观点、假设、判断（可能被推翻） | gbrain FactKind: belief |
| `discovery` | 新发现的 insight（原 discoveries 类型） | Memoark 原有 |
| `procedure` | Agent 可执行的操作步骤序列（含触发条件、工具、路径） | gbrain engineer: operational/tool |

#### references
有上下文的资源书签。核心字段是 URL。

- halflife: **永久**（URL 可能失效，但记录保留，标记 dead_link）
- 核心字段：`title`、`url`、`summary`、`trigger`（什么场景下使用）
- 典型来源：飞书群里分享的文档链接

#### preferences
用户的偏好、习惯、行为模式。

- halflife: **90天**（来自 gbrain preference halflife，偏好会变化）
- 典型来源：显式表态（"我不喜欢周一开会"）+ Consolidator 阶段的行为推断
- **当前阶段只提取显式表态**，行为推断留给 Spec 2 的 Consolidator

### 3.2 与旧类型的映射

| 旧类型 | 处理方式 |
|---|---|
| entities | 保留，新增 `kind` 枚举和 `aliases[]` |
| timeline | 保留，新增 halflife 语义 |
| decisions | 保留，新增 halflife 语义，标记永不压缩 |
| tasks | 保留，新增 `status` 字段 |
| discoveries | **合并**进 `knowledge.sub_type = discovery` |
| knowledge | 保留，新增 `sub_type` 字段 |
| links | **重定义**为 `references`，新增 url/summary/trigger 字段 |
| （新增）preferences | 全新类型 |

---

## 四、Entity 锚定架构

### 4.1 设计原则

参照 gbrain 的 facts 系统：**所有 signal 都通过 `entity_slugs` 字段锚定到一个或多个 entity**。

Entity 是知识图谱的重力中心——查询"关于 Project X 的所有上下文"时，直接按 entity_slug 过滤，而不是全局语义搜索。

### 4.2 Entity slug 格式

参照 gbrain slug 前缀约定，适配 Memoark/飞书场景：

```
person:<name>         e.g. person:alice, person:liyandre
project:<name>        e.g. project:memoark, project:feishu-integration
tool:<name>           e.g. tool:pglite, tool:bun, tool:claude-code
organization:<name>   e.g. org:anthropic, org:bytedance
concept:<name>        e.g. concept:vector-search, concept:mcp
```

### 4.3 PGLite Schema 变更

```sql
-- 新增 entities 表
CREATE TABLE entities (
    slug         TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('person','project','tool','organization','concept')),
    display_name TEXT,
    aliases      TEXT[] DEFAULT '{}',
    source_hints JSONB DEFAULT '{}',   -- 来源元数据，e.g. {"feishu_open_id": "xxx"}
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- pg_trgm 索引，支持模糊匹配
CREATE INDEX entities_slug_trgm ON entities USING gin(slug gin_trgm_ops);
CREATE INDEX entities_name_trgm ON entities USING gin(display_name gin_trgm_ops);

-- 现有 signals 表新增字段
ALTER TABLE signals ADD COLUMN entity_slugs  TEXT[]   DEFAULT '{}';
ALTER TABLE signals ADD COLUMN sub_type      TEXT;        -- knowledge 类型专用
ALTER TABLE signals ADD COLUMN halflife_days INTEGER;     -- 由类型决定，写入时自动赋值
ALTER TABLE signals ADD COLUMN status        TEXT;        -- tasks 类型专用: open|done|cancelled
ALTER TABLE signals ADD COLUMN url           TEXT;        -- references 类型专用
ALTER TABLE signals ADD COLUMN trigger_hint  TEXT;        -- references/procedure 类型专用

-- entity_slugs 的 GIN 索引，支持 @> 数组查询
CREATE INDEX signals_entity_slugs_gin ON signals USING gin(entity_slugs);
```

### 4.4 Entity Resolution Pipeline 步骤

在 `SignalExtractor` 之后，`Privacy` 之前，插入 `EntityResolver`：

**输入**：一个已提取的 signal（含 content 字段）  
**输出**：同一 signal，补充 `entity_slugs[]` 字段

**解析逻辑**（参照 gbrain `resolveEntitySlug()`，零 LLM）：

```
1. 从 signal 的 content 和 metadata 中识别候选名称
   - 飞书消息：发件人（open_id → person slug）、群名（chat_id → project/concept slug）
   - 明确提及：正则匹配 @人名、项目关键词、工具名

2. 对每个候选名称：
   a. 精确匹配 entities.slug
   b. pg_trgm 模糊匹配（similarity > 0.4）
   c. 前缀扩展（"Memoark" → project:memoark-*，按 signal 关联数量排序）
   d. 回退：自动创建 stub entity（kind=concept，待后续确认）

3. 返回解析成功的 slug 列表写入 entity_slugs[]
```

**飞书特化**：飞书消息自带结构化元数据（`sender_open_id`、`chat_id`、`mention_list`），可直接映射到 entity，比通用 NER 更准确。

---

## 五、存量数据迁移策略

### 原则
- **不破坏现有数据**：所有新字段有默认值，旧数据继续可查
- **不回填 entity_slugs**：存量数据的 `entity_slugs = []`，不做大规模 LLM 重新提取
- **渐进式**：新摄入数据走完整新 pipeline，旧数据保持原样

### Migration 文件

```sql
-- migration: 0010_signal_type_refactor.sql

-- 1. entities 表
CREATE TABLE IF NOT EXISTS entities (...);

-- 2. signals 表新增字段（均有默认值，不影响现有数据）
ALTER TABLE signals ADD COLUMN IF NOT EXISTS entity_slugs  TEXT[] DEFAULT '{}';
ALTER TABLE signals ADD COLUMN IF NOT EXISTS sub_type      TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS halflife_days INTEGER;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'open';
ALTER TABLE signals ADD COLUMN IF NOT EXISTS url           TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS trigger_hint  TEXT;

-- 3. discoveries → knowledge 类型重映射
UPDATE signals SET type = 'knowledge', sub_type = 'discovery'
WHERE type = 'discoveries';

-- 4. links → references 类型重映射（内容保留，新字段为空）
UPDATE signals SET type = 'references'
WHERE type = 'links';

-- 5. 为现有各类型补充 halflife_days
UPDATE signals SET halflife_days = 7   WHERE type = 'timeline';
UPDATE signals SET halflife_days = 90  WHERE type IN ('decisions', 'tasks', 'preferences');
UPDATE signals SET halflife_days = 365 WHERE type IN ('knowledge');
```

---

## 六、测试策略

- 现有 808 个测试用例**必须全部通过**（迁移不破坏现有行为）
- 新增测试文件：`src/core/entity-resolver.test.ts`（覆盖4步解析链）
- 新增测试文件：`src/core/signal-types.test.ts`（覆盖7种类型的字段验证）
- 新增测试文件：`src/core/migration.test.ts`（覆盖 discoveries→knowledge、links→references 重映射）

---

## 七、范围边界（Out of Scope）

以下内容**不在本 Spec 范围内**，由后续 Spec 处理：

- hot/warm/cold 三层生命周期轮转 → **Spec 2**
- Consolidator（warm→cold 合并算法） → **Spec 2**
- 原始飞书内容的 30 天 TTL 删除 → **Spec 2**
- SessionStart 注入 / MCP 新工具 → **Spec 3**
- preferences 的行为推断（跨消息统计） → **Spec 2 的 Consolidator**
- 飞书文档深度提取（用户标记） → 独立迭代

---

## 八、验收标准

1. `bun run typecheck` 通过
2. `bun test` 808+ 用例全部通过
3. 新增 migration 可在现有数据库上无损执行
4. 新摄入的飞书消息，signal 上有正确的 `entity_slugs[]`
5. 可以执行 `SELECT * FROM signals WHERE entity_slugs @> '["project:memoark"]'` 并返回有意义结果
