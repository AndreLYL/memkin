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
hot  — 完整信号 page，全字段，新鲜有效期内
warm — 同 entity 同类信号合并去重后的聚合 page，降级后进入
cold — 每个 entity 的叙述性摘要 page，长期归档
```

**tier 边界由 §4 的 per-type 显式配置决定，不用统一公式。**

各类型写入时：`expires_at = created_at + interval '${hot_days} days'`（见 §4 hot→warm 列）。`expires_at IS NULL` 表示永不自动降级。

> **hot_days 与 halflife_days 的关系**：§4 中 hot_days 的值与 Spec 1 `halflife_days` 列的值相同（decision 均为 90，knowledge 均为 365）。这是有意为之——超过 halflife 的信号已过"重要性减半"点，正好是从 hot 降到 warm 的合理时机。两列服务不同目的：halflife_days 用于 query 分数加权，hot_days（即 expires_at 阈值）用于 tier 轮转触发。

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
page.type        | hot_days(expires_at) | warm→cold       | 可压缩  | 特殊规则
-----------------|----------------------|-----------------|--------|------------------
timeline_entries | 7天                  | 180天后          | ✅     | 压缩为"事件列表摘要"
decision         | 90天                 | 永不进 cold      | ❌     | "为什么"必须原文保留
task             | done后立即(NULL→0)   | 365天后          | ✅     | open 状态 expires_at=NULL
knowledge        | 365天                | 730天后          | ✅去重  | 同 entity 同 topic 合并
discovery-*      | 90天                 | 365天后          | ✅     | 合并进 entity 知识摘要
preference       | 90天                 | 365天后          | ✅合并  | 新偏好 supersede 旧偏好
reference        | NULL（永不）          | 永不进 cold      | ❌     | dead-link 标记，不删
entity 类 page    | NULL（永不）          | 永不进 cold      | ❌     | 实体本身是锚点
```

**expires_at 计算**：写入时 `expires_at = created_at + interval '${hot_days} days'`；`hot_days=NULL` 时 `expires_at=NULL`（永不自动触发）。task 在状态变为 done 时主动设 `expires_at = NOW()`。

**永不压缩名单**：`decision`、`reference`、entity 类 page。来自对 OpenHuman 有损压缩教训的直接回应。

---

## 五、轮转机制

### 5.1 真实 Scheduler 结构与 Consolidator 的接入方式

**真实结构**（`src/daemon/scheduler.ts`）：`Scheduler` 类管理多个 `SourceSchedule`（每个数据源一个 interval），`tick()` 遍历所有数据源调用 `runSource(sourceId: string)`。**没有通用 job 队列，没有 JobKind 枚举**——它只负责 pipeline 数据同步。

**Consolidator 作为独立模块**，不接入现有 Scheduler，而是在 daemon 启动时并列运行：

```typescript
// src/daemon/index.ts（示意）
await scheduler.start();     // 已有：负责飞书等数据源 pipeline
await consolidator.start();  // 新增：负责记忆生命周期轮转
```

`Consolidator` 类（新建 `src/consolidator/consolidator.ts`）内部用 `setInterval` 管理两个周期：

```typescript
class Consolidator {
  private hotTimer: ReturnType<typeof setInterval> | null = null;
  private warmTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    // hot→warm：每天运行（86400000ms）
    this.hotTimer = setInterval(() => this.consolidateHot(), 86_400_000);
    // warm→cold：每周运行（7 × 86400000ms）
    this.warmTimer = setInterval(() => this.consolidateWarm(), 7 * 86_400_000);
  }

  stop(): void {
    if (this.hotTimer) clearInterval(this.hotTimer);
    if (this.warmTimer) clearInterval(this.warmTimer);
  }
}
```

新增 CLI 命令 `memoark consolidate [--hot|--warm]` 直接实例化 Consolidator 并单次运行，供手动触发和测试。

### 5.2 Hot → Warm

```typescript
async function consolidateHotToWarm(stores): Promise<void> {
  // 1. 查过期 hot page（按 type 分流）
  const expired = await stores.pages.listExpiredHot();  // tier='hot' AND expires_at < NOW()

  // 1.5 跳过用户手动编辑过的 page（H4 规则，obsidian-sync 引入，src/adapters/store.ts:163 等 5 处）
  //     frontmatter.user_edited === true 的 page 不参与合并/重写，仅可改 tier 列（不改内容）
  //     原因：合并会拼接/重写 compiled_truth，等同覆盖用户的手动编辑，与 H4 的初衷直接冲突

  // 2. 永不压缩类型（decision/reference/entity）→ 仅改 tier='warm'，不合并
  // 3. 可压缩类型 → 按 (关联 entity, type) 分组合并为一条 warm page
  //    - 方向：信号 page → entity page（addLink(signalSlug, entitySlug)），
  //      所以要找信号的 entity 应用 getLinks(signalSlug)，不是 getBacklinks
  //    - 避免 N+1：复用 obsidian-sync 引入的批量分组模式
  //      graph.getAllLinksGrouped()（src/store/graph.ts）一次性按 from_slug 分组返回所有 links，
  //      无需对每个过期 page 单独查询；如数据量大可加 WHERE from_page_id IN (...) 的过滤版本
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
  const candidates = backlinks.filter((b) => canCompress(b) && !b.page?.frontmatter.user_edited);
  // user_edited page 排除在摘要源之外：仍可被引用，但不参与"会被改写"的压缩候选

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
8. `frontmatter.user_edited === true` 的 page 不被 Consolidator 合并/重写覆盖（H4 规则，详见 §5.2）——验证：手动编辑一条 decision page 后运行 `consolidate --hot`，原内容保持不变
