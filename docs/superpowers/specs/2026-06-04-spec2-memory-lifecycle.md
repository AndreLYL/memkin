# Spec 2: 记忆生命周期（hot/warm/cold + Consolidator）

**日期**：2026-06-04（v2 重写，基于真实代码）
**状态**：待实施
**依赖**：Spec 1（信号类型 + migration runner）必须先完成
**后续**：Spec 3（MCP Agent 取用层）

> **v2 重写说明**：初版基于不存在的 `signals` 表和 `raw_feishu_content` 表设计。本版基于真实的 pages 模型重写，并修正"清理现有膨胀"这一不成立的动机。

---

## 一、背景与动机

### 当前问题（修正后）

1. **无衰减机制**：所有信号 page 永久同权重保留，7天前的会议事件和今天的决策无区别
2. **无压缩机制**：同一 entity 关联数百个信号 page 后，检索和概览质量退化
3. **存储无限增长**：飞书数据持续摄入，page 数量无上限

### 修正初版的错误动机

初版 §动机#4 称"原始飞书内容永久保留、噪音大"——**这是错的**。代码中 pipeline 处理完只落 pages，**原始飞书消息根本没有持久化**（`RawMessage` 流经 pipeline 后不入库）。因此：

- 不存在"清理原始内容膨胀"的问题
- §7 的 30天 TTL 删除**没有删除对象**
- 若要保留原始内容供重跑，需要先**新建**一套原始内容保留层——这是独立的设计决策，**移出本 spec**（见 §九）

本 spec 的生命周期只作用于**已提取的信号 page**。

---

## 二、调研依据

### 2.1 gbrain 三层 + 衰减

**hot/warm/cold**（`src/core/cycle/`）：hot（当前 session，14天 TTL）→ warm（14天后压缩）→ cold（归档，显式检索）。`memory-rotate.sh` 15分钟 cron 触发转移。

**衰减公式**（`src/core/facts/decay.ts`）：
```
score(t) = notability_weight × exp(-ln(2) × t / halflife_days)
```

### 2.2 OpenHuman 层级摘要树的教训

OpenHuman 的 L0→L3 摘要树是**有损**的——原文压缩后丢失。**对 decision 危险**：决策的"为什么"会在合并中丢失。Memoark 的 Consolidator 必须对 decision 和 procedure 类型禁用压缩。

### 2.3 MemPalace 的反面教训

MemPalace 永久全量保留，6个月后向量检索退化、无综合视图。Memoark 不走这条路，但也不照搬 OpenHuman 的激进有损压缩——采用**分类型差异化**策略。

---

## 三、三层模型（基于 pages）

### 3.1 存储位置

三层均为 `pages` 表中的记录，通过新增的 `tier` 列区分。**不引入新表、不引入文件存储**。

### 3.2 层次定义

```
hot   (0 ~ halflife)        — 完整信号 page，全字段
warm  (halflife ~ 2×halflife) — 同 entity 同类信号合并去重后的聚合 page
cold  (> 2×halflife)        — 每个 entity 的叙述性摘要 page
```

tier 边界由各 page 的 `halflife_days`（Spec 1 已写入）动态决定，而非固定天数。

### 3.3 Migration 002（依赖 Spec 1 的 runner）

```sql
-- 002_lifecycle_tier.sql
ALTER TABLE pages ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'hot';
ALTER TABLE pages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;       -- NULL = 永不降级
ALTER TABLE pages ADD COLUMN IF NOT EXISTS consolidated_into INTEGER REFERENCES pages(id);

CREATE INDEX IF NOT EXISTS idx_pages_tier ON pages (tier);
CREATE INDEX IF NOT EXISTS idx_pages_expires_at ON pages (expires_at) WHERE expires_at IS NOT NULL;

-- timeline_entries 也加生命周期字段（timeline 不是 page）
ALTER TABLE timeline_entries ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'hot';
ALTER TABLE timeline_entries ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
```

写入时设 `expires_at = created_at + halflife_days`（halflife 为 NULL 的 page，expires_at 也为 NULL）。

---

## 四、各类型差异化生命周期

```
page.type        | hot→warm        | warm→cold       | 可压缩  | 特殊规则
-----------------|-----------------|-----------------|--------|------------------
timeline_entries | 7天后            | 90天后           | ✅     | 压缩为"事件列表摘要"
decision         | 90天后           | 永不进 cold      | ❌     | "为什么"必须原文保留
task             | 完成(done)后立即  | 180天后          | ✅     | open 状态长期保留
knowledge        | 365天后          | 730天后          | ✅去重  | 同 entity 同 topic 合并
discovery-*      | 90天后           | 365天后          | ✅     | 合并进 entity 知识摘要
preference       | 90天后           | 365天后          | ✅合并  | 新偏好 supersede 旧偏好
reference        | 永不降级         | 永不降级         | ❌     | dead-link 标记，不删
entity 类 page    | 永不降级         | 永不降级         | ❌     | 实体本身是锚点
```

**永不压缩名单**：`decision`、`reference`、entity 类 page。这是对 OpenHuman 有损压缩教训的直接回应。

---

## 五、轮转机制

### 5.1 接入现有 daemon scheduler

`src/daemon/scheduler.ts` 已有调度框架。新增两个 job：

- `consolidate_hot`：每天 02:00，处理 `tier='hot' AND expires_at < NOW()` 的 page
- `consolidate_warm`：每周日 03:00，处理 `tier='warm'` 且年龄 > 2×halflife 的 page

新增 CLI 命令 `memoark consolidate [--hot|--warm]` 供手动触发和测试。

### 5.2 Hot → Warm

```typescript
async function consolidateHotToWarm(stores): Promise<void> {
  // 1. 查过期 hot page（按 type 分流）
  const expired = await stores.pages.listExpiredHot();  // tier='hot' AND expires_at < NOW()

  // 2. 永不压缩类型（decision/reference/entity）→ 仅改 tier='warm'，不合并
  // 3. 可压缩类型 → 按 (关联 entity, type) 分组合并为一条 warm page
  //    - 用 graph.getBacklinks 找每个信号 page 关联的 entity
  //    - 合并：内容拼接，保留最早 created_at，原 page.consolidated_into 指向新 warm page
  //    - 原 page 改 tier='warm' 或软引用到聚合 page
}
```

合并产物是新的 page（`type` 保持原类型，frontmatter 标 `consolidated: true`），通过 links 继承原信号的 entity 锚定。

### 5.3 Warm → Cold（Consolidator）

```typescript
async function consolidateWarmToCold(entitySlug: string, stores): Promise<void> {
  // 1. 取该 entity 关联的、可压缩的、年龄 > 2×halflife 的 warm page
  const backlinks = await stores.graph.getBacklinks(entitySlug);
  const candidates = backlinks.filter(canCompress);  // 排除 decision/reference

  // 2. LLM（claude-haiku-4-5）生成该 entity 的叙述性摘要
  const summary = await generateEntitySummary(entitySlug, candidates);

  // 3. 写一条 cold page：type='knowledge', slug=`cold/<entitySlug>`, tier='cold'
  // 4. 原 warm page 的 consolidated_into 指向 cold page
}
```

模型选 `claude-haiku-4-5`（参照 gbrain 用 Haiku 做 atom 提取，成本低速度快）。

---

## 六、preferences 行为推断

显式提取（Spec 1 已覆盖）：单条消息明确表态。

行为推断（本 spec）：在 `consolidate_warm` 阶段，统计某 person entity 关联的 timeline/task page，推断模式：

```
- timeline 中 80%+ 会议在 14:00-18:00 → preference: "偏好下午开会"（category=scheduling）
- task 中 90%+ 完成时间 22:00 后        → preference: "深夜工作习惯"（category=workflow）
```

推断出的 preference page 在 frontmatter 标 `inferred: true`（区别于显式的 `inferred: false`），并用 confidence='inferred'。

---

## 七、references dead-link 检测

在 `consolidate_warm` job 中，对 `type='reference'` 且 frontmatter 中 `last_checked_at` 超过 30 天的 page 发 HEAD 请求，结果写回 frontmatter：

```typescript
// frontmatter 更新：dead_link: boolean, last_checked_at: ISO string
```

dead-link 不删除 page（书签记录本身有价值），仅标记。

---

## 八、原始内容保留（明确移出）

初版假设的 `raw_feishu_content` 表不存在。"保留原始内容供 pipeline 重跑"是合理需求，但需要：
1. 新建原始内容表（schema + migration）
2. 改造 pipeline 在 Collector 后落原始消息
3. 30天 TTL 清理 job

这是一个**独立的子项目**，移出本 spec，记入 backlog（见头脑风暴笔记 §五未讨论问题）。本 spec 的"标记永久保留"机制相应移除。

---

## 九、范围边界（Out of Scope）

- 信号类型定义、migration runner → **Spec 1**
- 原始飞书内容保留层 → 独立子项目（backlog）
- SessionStart 注入、新 MCP 工具 → **Spec 3**
- 跨用户记忆共享 → 不在范围

---

## 十、验收标准

1. `bun test` 全部通过（含新增 consolidator 测试）
2. Migration 002 在已有库上执行：`pages` 出现 `tier`/`expires_at`/`consolidated_into` 列
3. 运行 `memoark consolidate --hot` 后：`tier='hot' AND expires_at < NOW()` 的 page 数归零，相关 entity 下出现 tier='warm' 记录
4. `type='decision'` 的 page 在任何情况下不出现 `tier='cold'`
5. `type='reference'` 的 page 永远保持 `tier='hot'`（永不降级），失效 URL 的 frontmatter `dead_link=true`
6. 运行 `memoark consolidate --warm` 后，活跃 entity 出现 `slug='cold/<entity>'` 的摘要 page
7. 幂等：重复运行 consolidate 不产生重复聚合
