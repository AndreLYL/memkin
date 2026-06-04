# Spec 2: 记忆生命周期（hot/warm/cold + Consolidator）

**日期**：2026-06-04  
**状态**：待实施  
**依赖**：Spec 1（信号类型重构 + Entity 架构）必须先完成  
**后续**：Spec 3（MCP Agent 取用层）

---

## 一、背景与动机

### 当前问题

Memoark 现有所有 signal 永久保留，无任何生命周期管理：

1. **无衰减机制**：7天前"周二下午3点开会"的事件和今天的决策同等权重
2. **无压缩机制**：同一实体下积累数百条 signal 后，检索质量退化
3. **存储无限增长**：飞书数据持续摄入，无 TTL，长期运行后数据库膨胀
4. **原始内容无清理**：飞书原始消息（提取前的原始文本）永久保留，噪音大

### 目标

- 引入 hot/warm/cold 三层逻辑分层，不同年龄的数据以不同精度保留
- 实现 Consolidator：将同一实体下的旧 signal 聚合成更高层摘要
- 原始飞书内容30天 TTL 后自动清理
- preferences 的行为推断（跨消息统计，是显式提取的升级）

---

## 二、调研依据

### 2.1 gbrain 生命周期系统

**三层 hot/warm/cold**（`src/core/cycle/`）：

```
hot/   — 当前 session，14天 TTL，Stop hook 写入
warm/  — 近期工作，14天后自动压缩（memory-rotate.sh）
cold/  — 归档，需要显式检索
```

**关键机制**：
- `memory-rotate.sh`：15分钟 cron，按 TTL 触发 hot→warm 转移
- PreCompact hook：在 Claude Code context compaction 前主动存档，防止信息丢失
- Markdown 为 canonical source：数据库崩了可以从 vault 5分钟重建

**Facts 衰减**（`src/core/facts/decay.ts`）：

```typescript
const HALFLIFE_DAYS: Record<FactKind, number> = {
  event:      7,
  commitment: 90,
  preference: 90,
  belief:     365,
  fact:       365,
};
```

衰减公式（指数衰减）：
```
score(t) = notability_weight × exp(-ln(2) × t / halflife_days)
```

### 2.2 OpenHuman 生命周期系统

**层级摘要树**（`src/openhuman/memory_tree/`）：

```
L0 → L1 → L2 → L3  (每层是下层的摘要)
```

- 每层 buffer 满了（token 上限）触发 seal，向上合并
- 合并是**有损的**：原文在压缩后不再保留
- L0 是最细粒度（单次 session），L3 是全局摘要

**OpenHuman 的关键教训**：有损摘要树对 `decisions` 类型是危险的——决策的"为什么"会在合并中丢失。Memoark 的 Consolidator 必须针对不同 sub_type 采用不同策略。

**ReflectionKind**（`src/openhuman/subconscious/reflection.rs`）：

```rust
HotnessSpike, CrossSourcePattern, DailyDigest, DueItem, Risk, Opportunity
```

这些是 Consolidator 产生的高层洞察信号，是 warm→cold 阶段的输出物之一。

### 2.3 MemPalace 的教训

MemPalace 选择永久保留全部原始内容，依赖检索质量解决"什么重要"的问题。6个月后面临两个问题：
1. 检索语料库膨胀，向量检索退化（高维空间的近邻搜索精度随数据量下降）
2. 没有机制回答"项目X的当前状态是什么"——只能搜索，没有综合视图

Memoark 不走这条路。

---

## 三、三层存储模型

### 3.1 存储位置

**三层均存储在 PGLite**，通过 `tier` 字段区分，不引入新的物理存储。

选择理由：
- Memoark 是本地优先，不需要 gbrain 那样的 markdown vault（那是为了用户手动编辑）
- signals 是结构化数据，PGLite 的 SQL 查询比文件系统更高效
- 单一存储避免数据同步问题

### 3.2 层次定义

```
hot   (0-30天)    — 完整原始 signal，所有字段保留
warm  (30-180天)  — 同一 entity 下同类 signal 合并去重后的聚合记录
cold  (180天+)    — 每个 entity 的叙述性摘要，高度压缩
```

### 3.3 Schema 变更（依赖 Spec 1）

```sql
-- Spec 1 已添加 halflife_days，本 Spec 继续添加：
ALTER TABLE signals ADD COLUMN tier        TEXT DEFAULT 'hot'
    CHECK (tier IN ('hot', 'warm', 'cold'));
ALTER TABLE signals ADD COLUMN expires_at  TIMESTAMPTZ;  -- NULL = 永不过期
ALTER TABLE signals ADD COLUMN consolidated_into INTEGER REFERENCES signals(id);
                                                          -- warm/cold 合并时，原 hot 记录指向新的 warm 记录

-- 原始飞书内容表（独立于 signals 表）
ALTER TABLE raw_feishu_content ADD COLUMN IF NOT EXISTS delete_at TIMESTAMPTZ;
-- 摄入时设置 delete_at = NOW() + INTERVAL '30 days'
```

---

## 四、各类型专属生命周期规则

```
signal type     | hot→warm触发    | warm→cold触发   | 是否可压缩      | 特殊规则
----------------|----------------|----------------|----------------|------------------
timeline        | 7天后           | 90天后          | ✅ 可压缩       | 压缩为"事件列表摘要"
decisions       | 90天后          | 永不进入 cold   | ❌ 永不压缩     | "为什么"必须原文保留
tasks           | 完成后立即降级  | 180天后          | ✅ 可压缩       | open 状态长期保留
knowledge/fact  | 180天后         | 365天后          | ✅ 实体去重合并 | 同实体下的重复 fact 合并
knowledge/belief| 180天后         | 365天后          | ⚠️ 标注来源后压缩| 保留"用户当时认为X"的归因
knowledge/disc. | 90天后          | 365天后          | ✅ 可压缩       | 合并进实体知识摘要
knowledge/proc. | 180天后         | 永不进入 cold   | ❌ 永不压缩     | 操作步骤原文保留
references      | 永不降级        | 永不降级        | ❌             | URL 失效后标记 dead_link
preferences     | 90天后          | 365天后          | ✅ 合并同类偏好  | 新偏好 supersede 旧偏好
```

---

## 五、轮转机制

### 5.1 Daemon Scheduler 扩展

在现有 `src/daemon/scheduler.ts` 中新增 `consolidate` job 类型：

```typescript
// 现有 job 类型
type JobKind = 'sync' | 'extract' | ...;

// 新增
type JobKind = 'sync' | 'extract' | 'consolidate_hot' | 'consolidate_warm';
```

**调度规则**：
- `consolidate_hot`：每天凌晨2点运行，将所有 `tier=hot AND expires_at < NOW()` 的 signal 降级
- `consolidate_warm`：每周日凌晨3点运行，将 `tier=warm` 的旧 signal 聚合为 cold 摘要

### 5.2 Hot → Warm 转移逻辑

```typescript
async function consolidateHotToWarm(pg: PGlite): Promise<void> {
    // 1. 找到所有过期的 hot signal
    const expired = await pg.query(`
        SELECT * FROM signals
        WHERE tier = 'hot' AND expires_at < NOW()
        ORDER BY entity_slugs, type, created_at
    `);

    // 2. 按 (entity_slug, type) 分组
    // 3. 对每组：
    //    - decisions/knowledge(procedure)/references → 直接标记 tier=warm，不合并
    //    - 其他类型 → 合并同组 signal 为一条 warm 记录
    //      合并策略：内容拼接，保留最早 created_at 和所有 entity_slugs 的并集
    // 4. 原 hot 记录的 consolidated_into 指向新 warm 记录
}
```

### 5.3 Warm → Cold 转移逻辑（Consolidator）

**输入**：某 entity 下所有 `tier=warm` 且年龄 > 180 天的 signal  
**输出**：一条 `tier=cold` 的 `knowledge/fact` signal，内容为该 entity 的叙述性摘要

```typescript
async function consolidateWarmToCold(entitySlug: string, pg: PGlite): Promise<void> {
    const warmSignals = await pg.query(`
        SELECT * FROM signals
        WHERE tier = 'warm'
          AND entity_slugs @> $1
          AND created_at < NOW() - INTERVAL '180 days'
          AND type NOT IN ('decisions')      -- decisions 永不压缩
          AND (type != 'knowledge' OR sub_type != 'procedure')  -- procedure 永不压缩
    `, [`{${entitySlug}}`]);

    // 调用 LLM 生成摘要
    const summary = await generateEntitySummary(entitySlug, warmSignals);

    // 写入 cold 记录
    await pg.query(`
        INSERT INTO signals (type, sub_type, content, tier, entity_slugs, ...)
        VALUES ('knowledge', 'fact', $1, 'cold', $2, ...)
    `, [summary, [entitySlug]]);

    // 标记原 warm 记录已合并
    await pg.query(`
        UPDATE signals SET consolidated_into = $1
        WHERE id = ANY($2)
    `, [newColdId, warmSignals.map(s => s.id)]);
}
```

**Consolidator 使用的 LLM 模型**：`claude-haiku-4-5`（速度快、成本低，参照 gbrain 的 atom 提取使用 Haiku 的做法）

---

## 六、preferences 行为推断（跨消息统计）

显式提取（Spec 1 已覆盖）：单条消息中的明确表态 → 直接提取为 preference signal

行为推断（本 Spec 新增）：在 `consolidate_warm` 阶段，分析某 user entity 下的 timeline/decisions/tasks 信号，推断行为模式：

```
推断规则示例（基于 warm tier 的统计）：
- 如果 timeline 中 80%+ 的会议事件在 14:00-18:00 → preference: "下午开会"
- 如果 tasks 中 90%+ 的完成时间在 22:00 后 → preference: "深夜工作习惯"
- 如果 decisions 中重复出现某技术栈 → preference: "偏好 TypeScript/Bun"
```

推断出的 preference 会标注来源：`source: 'inferred'`（区别于显式提取的 `source: 'explicit'`）

---

## 七、原始飞书内容 30 天 TTL

```sql
-- 摄入时设置删除时间
INSERT INTO raw_feishu_content (content, source_id, delete_at, ...)
VALUES ($1, $2, NOW() + INTERVAL '30 days', ...);

-- consolidate_hot job 中同时清理过期原始内容
DELETE FROM raw_feishu_content WHERE delete_at < NOW();
```

**例外**：用户可通过 MCP 工具 `pin_raw_content(message_id)` 标记永久保留。

---

## 八、references 的 dead-link 检测

```typescript
// 在 consolidate_warm job 中，对所有 references 执行 HEAD 请求
async function checkDeadLinks(pg: PGlite): Promise<void> {
    const refs = await pg.query(`
        SELECT id, url FROM signals
        WHERE type = 'references' AND url IS NOT NULL
        AND (last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '30 days')
    `);

    for (const ref of refs) {
        const alive = await checkUrlAlive(ref.url);
        await pg.query(`
            UPDATE signals SET
                dead_link = $1,
                last_checked_at = NOW()
            WHERE id = $2
        `, [!alive, ref.id]);
    }
}
```

---

## 九、范围边界（Out of Scope）

- Signal 类型定义和 entity_slugs 字段 → **Spec 1**
- SessionStart 注入 / MCP 新工具 → **Spec 3**
- 飞书文档深度提取 → 独立迭代
- 跨用户记忆共享 → 不在 Memoark 当前范围

---

## 十、验收标准

1. `bun test` 全部通过（含新增 consolidator 测试）
2. 运行 `memoark consolidate`（新增 CLI 命令）后：
   - `tier=hot AND expires_at < NOW()` 的 signal 数量变为0
   - 对应 entity 下出现 `tier=warm` 的聚合记录
3. 原始飞书内容在 `delete_at` 过后被清理，不影响已提取的 signal
4. decisions 类型的 signal 在任何情况下不出现 `tier=cold`
5. knowledge/procedure 类型的 signal 不出现 `tier=cold`
6. references 中失效 URL 被标记 `dead_link=true`
