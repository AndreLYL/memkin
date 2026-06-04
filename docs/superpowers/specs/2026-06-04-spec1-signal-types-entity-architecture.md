# Spec 1: 信号类型重构 + Entity 锚定强化

**日期**：2026-06-04（v2 重写，基于真实代码）
**状态**：待实施
**依赖**：无（地基 spec）
**后续**：Spec 2（记忆生命周期）、Spec 3（MCP Agent 取用层）

> **v2 重写说明**：初版 spec 基于一个不存在的 `signals` 扁平表设计，与代码实际的 pages 模型完全脱节。本版基于真实存储架构重写。详见 §三。

---

## 一、背景与动机

### 当前问题

1. **类型边界模糊**：`Discovery.type` 已包含 `procedure | preference | pattern | insight | risk`，但 `preference` 这种核心信号被埋在 discovery 子类型里，没有作为一等概念暴露；同时 discovery 和 knowledge 的语义边界不清
2. **links 定义错位**：`Link` 类型（`src/core/types.ts:89`）是实体间关系图边（works_on/reports_to 等），但产品真正需要的"有上下文的资源书签"（文档 URL + 摘要 + 触发场景）没有任何类型承载
3. **缺少半衰期语义**：所有信号无衰减语义，为 Spec 2 的生命周期管理打地基时无字段可用
4. **无 migration 机制**：`src/store/database.ts` 每次启动重跑整个 `schema.sql`（全 `CREATE TABLE IF NOT EXISTS`），对已存在的库不会执行任何 schema 变更——任何加列操作都无处落地

### 目标

- 把 `preferences` 提升为一等信号类型（当前埋在 Discovery.type）
- 新增 `references` 信号类型（有上下文的资源书签）
- 为所有信号页面补充 `halflife_days` 元数据（驱动 Spec 2）
- 引入最小可用的 migration runner，让 schema 演进可落地
- 强化（而非重建）已有的 entity 锚定机制

---

## 二、调研依据

### 2.1 gbrain（garrytan/gbrain）

**FactKind 及半衰期**（`src/core/facts/decay.ts`）：

```typescript
export const HALFLIFE_DAYS: Record<FactKind, number> = {
  event:      7,    // "周二的午饭约会，过了周二就没意义了"
  commitment: 90,   // 承诺和决策
  preference: 90,   // 偏好习惯，会变化但变化慢
  belief:     365,  // 观点和假设
  fact:       365,  // 客观事实
};
```

**Entity 即 page**（`src/schema.sql`）：gbrain 没有独立 entities 表，entity 就是 `pages` 表中 slug 带前缀的记录（`people/alice`、`project/memoark`），facts 通过 `entity_slug` 锚定。**这与 Memoark 当前架构高度一致**——Memoark 的 entity 也是 page，signal page 通过 `links` 表锚定到 entity page。

**⚠️ pg_trgm 风险说明**：gbrain 的 entity resolution 使用 `pg_trgm` 模糊匹配（`similarity()` 函数）。Memoark 当前 schema 仅有 `CREATE EXTENSION vector`，代码库中无任何 `pg_trgm` 使用。PGLite 加载 pg_trgm 需要在 JS 侧显式引入 contrib 扩展，**可行性未验证**。本 spec 的 entity resolution（§六）已绕开 pg_trgm（只用飞书结构化元数据做精确匹配），不依赖此扩展。若未来需要模糊匹配，应先做 spike 验证 PGLite + pg_trgm 可用性，再写入 spec。

**gbrain-engineer learning_type**（`src/core/schema-pack/base/gbrain-engineer.yaml`）：
```
pattern | pitfall | preference | architecture | tool | operational | investigation
```
`operational`/`tool` 是操作性流程知识——对应 Memoark 已有的 `Discovery.type = "procedure"`。

### 2.2 OpenHuman（tinyhumansai/openhuman）

OpenHuman **没有内容语义分类系统**，只按来源（Chat/Email/Document）和存储层分类。这印证了 Memoark 的信号语义分类（decisions/tasks/knowledge 等）是有价值的差异化设计，应当保留并强化。

EntityKind 15种（`src/openhuman/memory_entities/types.rs`）对 Memoark 的 5 种 entity type（person/project/organization/tool/concept）是个参考，但当前 5 种已够用，不扩展。

### 2.3 结论映射

| 设计决策 | 来源 |
|---|---|
| 各信号类型有 halflife_days | gbrain FactKind decay |
| preferences 提升为一等类型 | gbrain FactKind: preference（halflife 90d） |
| references 新增类型 | 两系统都没有，Memoark 原创 |
| entity 锚定沿用 links 表 | gbrain entity-as-page + Memoark 现状 |
| 沿用 pages 模型不另起炉灶 | gbrain pages 模型 + Memoark 现状 |

---

## 三、真实存储架构（重写基础）

### 3.1 实际模型：pages，不是 signals

`src/store/schema.sql` 定义的核心表：

```sql
pages (id, slug UNIQUE, type, title, compiled_truth, frontmatter JSONB,
       content_hash, search_vector TSVECTOR, created_at, updated_at)
content_chunks (id, page_id FK, chunk_index, chunk_text, embedding vector(1536), ...)
links (id, from_page_id FK, to_page_id FK, link_type, context, created_at)
tags (id, page_id FK, tag)
timeline_entries (id, page_id FK, date, summary, detail, source)
```

**所有信号都存为 pages**，通过 `type` 字段 + slug 前缀区分（见 `src/adapters/store.ts`）：

| 信号 | page.type | slug 格式 |
|---|---|---|
| entity | person/project/tool/... | `<name>` / `project-memoark` |
| decision | `decision` | `decisions/<kebab-summary>` |
| task | `task` | `tasks/<kebab-title>` |
| discovery | `discovery-<subtype>` | `discoveries/<kebab-summary>` |
| knowledge | `knowledge` | `knowledge/<topic>/<hash12>` |
| timeline | （不是 page）写入 `timeline_entries` 表 | — |
| link | （不是 page）写入 `links` 表 | — |

**关键认知**：timeline 和 link 不是 page，是独立的关系/时序表。entity/decision/task/discovery/knowledge 才是 page。

### 3.2 Entity 锚定已经存在

`StoreAdapter.writeDecision/writeDiscovery/writeKnowledge`（`src/adapters/store.ts`）写信号 page 时，已经调用 `graph.addLink(signalSlug, entitySlug, "mentions", ...)` 把信号 page 连到 entity page。

**这就是 entity 锚定机制。** 查询"某 entity 关联的所有信号"通过 `graph.getBacklinks(entitySlug)` 即可实现——不需要新建 `entity_slugs[]` 字段或 entities 表。

初版 spec 的 `CREATE TABLE entities` 是错误的，删除。

### 3.3 元数据存放：frontmatter vs 真实列

信号的元数据当前存在 `pages.frontmatter` JSONB（如 `confidence`、`source_hash`、`entities`）。

新增的生命周期元数据（`halflife_days`、后续 Spec 2 的 `tier`/`expires_at`）**需要被轮转任务高频查询和排序**，放 JSONB 查询效率差（无法有效建索引）。

**决策**：新增为 `pages` 表的真实列，而非塞进 frontmatter。这需要 migration 机制（§五）。

---

## 四、信号类型变更

### 4.1 类型体系（基于真实 ExtractionResult）

当前 `ExtractionResult`（`src/core/types.ts:144`）：
```typescript
{ source, entities, timeline, links, decisions, tasks, discoveries, knowledge }
```

变更后：
```typescript
{ source, entities, timeline, links, decisions, tasks,
  knowledge,        // 吸收 discovery 的 insight/pattern 子类
  preferences,      // 从 Discovery.type 提升为一等数组
  references }       // 全新
```

### 4.2 具体变更

#### (a) preferences 提升为一等类型

当前 `Discovery.type = "preference"` 被埋没。提升为独立类型：

```typescript
export interface Preference {
  summary: string;          // "偏好异步沟通，不喜欢临时会议"
  detail?: string;
  category: "communication" | "tooling" | "scheduling" | "workflow" | "other";
  entities: string[];       // 关联 entity slugs（通常是 person）
  source: SourceRef;
  confidence: SignalConfidence;
}
```

**当前阶段只提取显式表态**（单条消息里的明确偏好）。跨消息行为推断留给 Spec 2 Consolidator。

存储：`page.type = "preference"`，slug = `preferences/<kebab-summary>`，halflife = 90d。

#### (b) references 新增类型

```typescript
export interface Reference {
  title: string;            // 文档标题
  url: string;              // 核心字段
  summary: string;          // 100字以内摘要
  trigger?: string;         // "遇到 Claude 安装问题时查阅"
  entities: string[];       // 关联 entity slugs
  source: SourceRef;
  confidence: SignalConfidence;
}
```

存储：`page.type = "reference"`，slug = `references/<kebab-title>`，halflife = 永久（NULL）。URL 存 frontmatter，dead-link 检测在 Spec 2。

#### (c) discovery 收敛

`Discovery.type` 当前 = `procedure | preference | pattern | insight | risk`。变更：
- `preference` → 移除（提升为一等 Preference 类型）
- `procedure | pattern | insight | risk` → 保留在 discovery 内

discovery 继续作为 page（`discovery-<subtype>`），不变。这避免大改动，且 discovery 与 knowledge 的边界问题留待实际数据验证后再定，**本 spec 不强行合并 discovery 和 knowledge**（YAGNI——当前没有证据表明合并收益大于迁移成本）。

#### (d) knowledge 不变

`Knowledge` 类型保持现状。`sub_type` 的引入推迟——当前 knowledge 已有 `source_type`（conversation/document/teaching），强行加 sub_type 是过度设计。

### 4.3 halflife 赋值

各信号 page 写入时，在新增的 `halflife_days` 列写入：

| page.type | halflife_days |
|---|---|
| decision | 90 |
| task | 90 |
| preference | 90 |
| knowledge | 365 |
| discovery-* | 90 |
| reference | NULL（永久）|
| entity (person/project/...) | NULL（永久）|

timeline_entries 的 halflife（7d）在 Spec 2 处理（timeline 不是 page）。

---

## 五、Migration 机制（新增基础设施）

审查指出：无 migration runner，加列无处落地。本 spec 引入最小可用方案。

### 5.1 方案：编号 migration runner

新增 `src/store/migrations/` 目录 + runner：

```
src/store/migrations/
  001_lifecycle_columns.sql
  index.ts          # runner
```

`schema_migrations` 表记录已执行版本：

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Runner 逻辑（在 `Database.create()` 中，schema.sql 执行后调用）：

```typescript
async function runMigrations(pg: PGlite): Promise<void> {
  await pg.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`);
  const applied = await pg.query<{version: number}>(`SELECT version FROM schema_migrations`);
  const appliedSet = new Set(applied.rows.map(r => r.version));
  for (const m of MIGRATIONS) {          // 按 version 升序
    if (appliedSet.has(m.version)) continue;
    await pg.exec(m.sql);
    await pg.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [m.version]);
  }
}
```

每条 migration 用 `ADD COLUMN IF NOT EXISTS` 保证幂等。schema.sql 仍是新库的快照来源；migration 负责已有库的演进。新列也同步写入 schema.sql（保持新库一次建全）。

### 5.2 Migration 001：lifecycle 列

```sql
-- 001_lifecycle_columns.sql
ALTER TABLE pages ADD COLUMN IF NOT EXISTS halflife_days INTEGER;
-- tier / expires_at 由 Spec 2 的 migration 002 添加
```

### 5.3 类型重映射（在同一 migration 内）

```sql
-- discovery 的 preference 子类迁移为独立 preference page
UPDATE pages SET type = 'preference'
WHERE type = 'discovery-preference';

-- 为存量信号 page 补 halflife
UPDATE pages SET halflife_days = 90  WHERE type IN ('decision','task','preference') OR type LIKE 'discovery-%';
UPDATE pages SET halflife_days = 365 WHERE type = 'knowledge';
```

`references` 无存量数据（新类型），不需要重映射。

---

## 六、Pipeline 改动

当前 pipeline（`src/core/pipeline.ts`）：
```
Collector → Dedup → BlockBuilder → NoiseFilter → Extractor → Privacy → Formatter → Adapter
```

### 6.1 改动点

1. **Extractor**（`src/extractors/signal-extractor.ts` + prompts）：LLM 输出 schema 增加 `preferences[]` 和 `references[]` 数组，从 discovery 移除 preference 子类。更新 `src/core/schemas.ts` 的 Zod 校验和 `src/core/types.ts` 的 `ExtractionResult`。

2. **StoreAdapter**（`src/adapters/store.ts`）：新增 `writePreference()` 和 `writeReference()` 方法，写 page + 调 `graph.addLink()` 锚定 entity + 写 `halflife_days`。仿照已有的 `writeDiscovery()`。

3. **Entity 锚定**：无需新增 pipeline 步骤——已有的 `entity-extract.ts` 和 adapter 的 `addLink` 调用已覆盖。新增的 preference/reference 在各自 write 方法里调用 `addLink`。

### 6.2 不改动的部分

- 不新增 EntityResolver 步骤（初版 spec 的设计，已被 §3.2 证明冗余）
- 不改 Collector/Dedup/BlockBuilder/NoiseFilter

---

## 七、存量数据迁移策略

- **不破坏**：所有新列 `ADD COLUMN IF NOT EXISTS` 带 NULL 默认，旧 page 继续可查
- **轻量重映射**：仅 `discovery-preference → preference` 的 type 改名 + halflife 回填（纯 SQL，无 LLM）
- **不回填关联**：存量信号已有 links 锚定，无需重新提取

---

## 八、测试策略

- 现有 808 测试用例**必须全部通过**
- 新增 `src/store/migrations/migrations.test.ts`：验证 runner 幂等、版本记录、ADD COLUMN IF NOT EXISTS
- 新增 `src/core/preference-reference.test.ts`：验证两种新类型的 Zod 校验
- 新增 `src/adapters/store-preference-reference.test.ts`：验证 write 方法正确写 page + link + halflife
- 更新 extractor 的 golden 测试以包含 preferences/references 输出

---

## 九、范围边界（Out of Scope）

- `tier`/`expires_at` 列、hot/warm/cold 轮转 → **Spec 2**
- Consolidator、原始内容 TTL、dead-link 检测 → **Spec 2**
- preferences 跨消息行为推断 → **Spec 2 Consolidator**
- SessionStart 注入、新 MCP 工具 → **Spec 3**
- discovery 与 knowledge 的合并 → 暂不做（YAGNI，等数据验证）
- entity type 扩展（OpenHuman 15种） → 暂不做（当前5种够用）

---

## 十、验收标准

1. `bun run typecheck` 通过
2. `bun test` 808+ 用例全部通过
3. Migration runner 在已有数据库上执行：`pages` 表出现 `halflife_days` 列，`schema_migrations` 记录 version 1
4. 重复启动不重复执行 migration（幂等）
5. 新摄入的飞书消息能产出 `type='preference'` 和 `type='reference'` 的 page，且通过 links 锚定到 entity
6. `graph.getBacklinks('project:memoark')` 能返回关联的 decision/preference/reference page
7. 存量 `discovery-preference` page 被迁移为 `preference` type
