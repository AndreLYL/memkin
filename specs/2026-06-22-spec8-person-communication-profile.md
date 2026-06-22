# Spec 8: 人物沟通画像（Hero）

**日期**：2026-06-22
**状态**：📝 待审查
**依赖**：**Spec 7（合成底座）必须先完成**；建立在现有 `pages` / `graph` / `timeline` / 人物身份层 / consolidator / pipeline 之上
**定位**：参赛主打场景——从真实职场互动**被动推断**沟通画像，并据此给出**目标条件化的沟通策略**。这是"人是社会关系的总和"最纯粹的产品表达。

> 产品定位与三层人格模型见 [行动决策记忆总纲](2026-06-22-action-memory-brainstorming.md) §三场景2；方法论与框架对比见 [gbrain 对比调研](research/2026-06-22-gbrain-comparison-research.md)。
>
> **术语**：下文 "DISC/行为四象限" 指 D/I/S/C 四个**行为倾向维度**。"DiSC" 为 Wiley 注册商标，本系统**内部仅作理论参考**，**对外统一用「行为四象限」并附免责**（见 §九）。

---

## 一、背景与动机

gbrain 的人物页只有 facts（works_at、last met）。市面性格测试（MBTI/四色/DiSC）都要**本人做问卷**。本 spec 做的是两者都不是的事：

> **从你与某人的真实互动里，被动推断其沟通风格，并回答"我该怎么跟 TA 沟通"——零问卷、数据不出本机。**

最终产品出口：`prep_for_person("张总", goal?)` → 带引用的沟通策略 + gap。

---

## 二、调研依据

- **gbrain `think` 人物范式**（📗，未核源码）："见 Alice 前你该知道什么" → 合成 + gap。我们扩展为"该**怎么**跟 Alice 沟通"。
- **人格框架**（📗 公开资料）：Big Five（OCEAN，学术金标准、连续值）；DISC（行为论、最可落地）；MBTI/四色（通俗、科学性弱）。结论：**Big Five 作科学脊柱、DISC 作可落地主轴、四色作通俗外壳**。
- **computational personality recognition**（📗 公开论文）：LLM 零样本判人格**不可靠**（外向/神经质尤难），必须"行为特征 + 证据 + 置信度 + 精心 prompt"。→ **反向论证本 spec 的三层（行为层垫底 + 证据/置信度）是方法论正确的**。

---

## 三、关键约束：行为层无现成数据源（先读）

**事实（main@eebb1b6 核对）**：schema 只有 7 张表，**无 message 级表**；pipeline 抽完只落 pages/timeline/links，**`RawMessage` 不入库**（沿用 `2026-06-04-product-form-brainstorming.md` §九结论）。

**后果**：行为层指标（响应时长、消息长度、活跃时段、主动性、@频率）**无法事后从库里重算**——原始消息在抽取后即丢弃。

**方案**：行为层必须在 **pipeline 处理 DM/群聊 block 时（原始消息尚在内存）就增量统计**，并以**可合并计数器**持久化，避免回看原始历史。新增轻量表 `person_behavior`（migration **M005**）——这是本 spec 的真实工作量，非"加个字段"。

---

## 四、三层人格数据模型

### 4.1 行为层（客观，零 LLM）

新增表 `person_behavior`（M005），按人物 canonical slug 聚合**可增量合并**的计数器：

```sql
CREATE TABLE IF NOT EXISTS person_behavior (
  person_slug        TEXT PRIMARY KEY,   -- canonical slug（与 person_handles.canonical_slug 一致）
  msg_count          INTEGER NOT NULL DEFAULT 0,
  sum_msg_chars      INTEGER NOT NULL DEFAULT 0,   -- avg 长度 = sum/count
  initiated_count    INTEGER NOT NULL DEFAULT 0,   -- 对方主动发起的会话段数
  reply_count        INTEGER NOT NULL DEFAULT 0,
  resp_latency_n     INTEGER NOT NULL DEFAULT 0,   -- 可测响应样本数
  resp_latency_sum_s BIGINT  NOT NULL DEFAULT 0,   -- avg 响应秒 = sum/n
  hour_histogram     JSONB   NOT NULL DEFAULT '[]',-- 长度 24 的活跃时段直方图
  at_count           INTEGER NOT NULL DEFAULT 0,
  window_start       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```typescript
interface BehaviorContribution {   // 单个 block 算出的增量，可加性合并入表
  person_slug: string;
  msg_count: number;
  sum_msg_chars: number;
  initiated_count: number;
  reply_count: number;
  resp_latency_n: number;
  resp_latency_sum_s: number;
  hour_histogram: number[];   // 24
  at_count: number;
}
interface BehaviorProfile {        // 读出时派生的可用视图
  person_slug: string;
  avg_msg_chars: number;
  initiation_ratio: number;       // initiated/(initiated+reply)
  avg_response_sec: number | null;// resp_latency_n=0 → null
  peak_hours: number[];           // histogram top-k
  at_per_msg: number;
  sample_size: number;            // = msg_count，用于置信度
}
```

**计算位置**：`src/profile/behavior.ts` 提供 `computeContribution(block)`（纯函数，从 block 内排序消息算响应延迟/长度/时段/主动性）。pipeline 在处理 `dm/`、`group/` block 且**画像功能开启**时调用，`upsertContribution()` 加性合并入表。响应延迟在 block 内按"对方发→我回"相邻消息对测量。

### 4.2 特质层（推断，行为四象限 + 证据/置信度）

```typescript
type Axis = "D" | "I" | "S" | "C";   // 支配/影响/稳健/谨慎
interface TraitDimension {
  axis: Axis;
  level: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  evidence_count: number;
  evidence_refs: string[];     // 支撑信号 slug（复用 Spec 7 Citation 回链）
  note: string;                // 一句话说明
}
interface TraitLayer {
  dimensions: TraitDimension[];        // 4 条（D/I/S/C）
  big_five?: Record<string, number>;   // 可选校验，0-100
  insufficient: boolean;               // 证据不足 → true，不强行画像
}
```

由 LLM 合成，**强制喂行为层做垫底**，要求每维给 `evidence_refs` 与 `confidence`。`sample_size` 低于阈值（默认 20 条互动）→ `insufficient=true`，仅给"信息不足"提示。

### 4.3 关系层（专属）

```typescript
interface RelationLayer {
  tone: string;          // 关系基调（合作顺畅 / 有摩擦 / 上下级 ...）
  concerns: string[];    // 对方反复在意的点
  landmines: string[];   // 雷区/禁忌
  evidence_refs: string[];
}
```

LLM over 你俩共享历史（该人 backlinks 的 decision/timeline/对话信号）。

### 4.4 画像聚合（落在 person page）

特质层 + 关系层 + 四色外壳合成后，缓存进 **person page 的 `frontmatter.profile`**（复用 Spec 7 §九 entity-scope 缓存：`frontmatter.synth["person_profile"]` + `input_hash` + `generated_at`）。行为层仍在 `person_behavior` 表（高频可变，不塞 frontmatter）。

---

## 五、四色外壳映射（`src/profile/four-color.ts`）

行为四象限 → 四色（纯映射，确定性）：

| 主导维 | 四色 | 通俗描述 |
|---|---|---|
| D 支配 | 🔴 红 | 直接、目标导向、要结论 |
| I 影响 | 🟡 黄 | 活跃、重关系、爱表达 |
| S 稳健 | 🟢 绿 | 温和、求稳、重配合 |
| C 谨慎 | 🔵 蓝 | 严谨、重数据、求准确 |

取 `level=high` 的维做主色（可双色）。**所有四色输出强制带标注**："通俗映射，非临床诊断"。

---

## 六、策略合成：`person_strategy` 意图 + `prep_for_person` 工具

### 6.1 意图（注册进 Spec 7 框架，`src/synth/intents/person-strategy.ts`）

```typescript
export const personStrategyIntent: IntentTemplate = {
  id: "person_strategy",
  format: "single",
  staleDays: 21,
  buildScope: (args) => ({ entity: args.person as string, limit: 40 }),
  systemPrompt: /* §6.3 含护栏 */,
  expects: ["沟通建议"],
  gapRules: [staleRule],
};
registerIntent(personStrategyIntent);   // 在 intents/index.ts 追加
```

合成时上下文 = **缓存的画像（特质+关系+四色）** + 该人近期未决事项 + （混合）当日增量信号。**目标条件化**：`goal` 非空时拼入 prompt，给针对该目标的策略。

### 6.2 工具（本 spec 注册，非 Spec 7 占位）

```typescript
server.tool("prep_for_person",
  { person: z.string(), goal: z.string().optional() },
  ({ person, goal }) => synthesize("person_strategy", { entity: person },
                                   { extra: { goal } }));
```

### 6.3 systemPrompt 护栏（伦理硬约束）

> 你基于用户与某人的真实互动画像，给出**实用的沟通建议**。要求：① 只给"如何更好沟通/协作"的建议，**不得给操纵、PUA、施压话术**；② 尊重对方，假设善意；③ 每条建议后用 `[n]` 标注画像/信号证据；④ 证据不足时直说"了解不够，建议先……"，不编造性格判断。

---

## 七、混合计算（夜间预合成 + 当日增量）

落实总纲"混合"决策：

- **夜间预合成**（特质层+关系层+四色 → person page）：新增 consolidator pass `synthesizeProfiles()`（`src/profile/profile-synth.ts`），**仿 `infer-preferences.ts`**：迭代 `type=person` 页 → 读 `person_behavior` + backlinks + timeline → LLM 合成 `TraitLayer/RelationLayer` → 写 `frontmatter.profile`。挂在现有 consolidator / scheduler（`serve` 内），夜间批量。
- **当日增量**：`prep_for_person` 调用时，Spec 7 缓存层若判定画像 `input_hash` 未变则直接用；当天有新互动（`person_behavior.updated_at` 晚于画像 `generated_at`）→ 对增量信号做一次轻量补算后再合成策略。
- **行为层**：始终在 pipeline 实时累加（§4.1），与上面两者解耦。

---

## 八、人物身份一致性

- 画像、行为表均以**canonical person slug** 为键（`person_handles.canonical_slug`，见 `src/core/person-identity.ts`）。
- `merge_persons` / `recanonicalize_person`（现有 MCP 工具）合并人物时，**必须同时合并 `person_behavior` 行**（计数器相加）并失效旧 `frontmatter.profile`。本 spec 在合并逻辑里加这一步。

---

## 九、伦理与合规

- **开关**：`config.profile.enabled`（全局，**默认关**）；`profile.allow[]` / `profile.deny[]`（**逐人 opt-in/out**）。功能关闭时，pipeline 不累加行为层、不夜间合成。
- **prompt 护栏**：见 §6.3（建议非操纵）。
- **隐私**：全部本地；DM 已带 `sensitivity:high`。画像永不出本机——参赛核心卖点。
- **商标**：对外表述用「行为四象限」+ 免责，不用 "DiSC" 字样、不暗示官方认证。
- **诚实**：证据不足 → `insufficient`，明示"信息不足"。

---

## 十、模块布局（`src/profile/`）

```
src/profile/
  behavior.ts        # computeContribution(block) 纯函数 + upsertContribution()（行为层）
  profile-synth.ts   # synthesizeProfiles() 夜间 consolidator pass（特质+关系层）
  four-color.ts      # 行为四象限 → 四色 纯映射
  types.ts           # BehaviorContribution/BehaviorProfile/TraitLayer/RelationLayer 等
src/synth/intents/
  person-strategy.ts # person_strategy 意图（注册进 Spec 7）
src/store/
  person-behavior.ts # person_behavior 表的 store（upsert/get/merge）
  migrations/        # M005: person_behavior 表
```

---

## 十一、范围边界（Out of Scope）

- 合成引擎/意图框架/引用/gap/缓存机制 → **Spec 7**
- 日报、文档 action_items、entities/me → **Spec 9**
- best-chunk 池化、query 改写 → **Spec 7/10**
- 团队级/组织级画像聚合、跨人对比 → 后续
- 重量级矛盾检测 → consolidator 后续

---

## 十二、验收标准

1. `bun test` 通过（行为层纯函数、four-color 映射、profile-synth、person_strategy、合并一致性单测）。
2. **M005** 建 `person_behavior` 表；`computeContribution` 对构造 block 正确算出 avg 长度/响应秒/主动比/活跃时段；`upsertContribution` 加性合并幂等可累加。
3. 行为层仅在 `profile.enabled` 且非 `deny` 时累加；关闭时 pipeline 不写 `person_behavior`（断言无写入）。
4. `synthesizeProfiles()` 对 `sample_size < 20` 的人产出 `insufficient=true`、不强行画像；充足时每维带 `evidence_refs` 与 `confidence`。
5. `four-color` 映射：D/I/S/C high → 红/黄/绿/蓝，输出含"通俗映射，非临床诊断"标注。
6. `prep_for_person("person")` 返回带 `[n]` 引用的沟通建议 + gap；带 `goal` 时策略随目标变化（mock provider 校验 goal 注入 prompt）。
7. systemPrompt 护栏存在；构造"施压"类请求时输出仍为建议性（以 prompt 内容断言，非模型行为断言）。
8. `merge_persons` 合并后 `person_behavior` 计数器相加、旧 `frontmatter.profile` 失效。
9. 混合缓存：画像 `input_hash` 未变 → `prep_for_person` 命中缓存不重合成；`person_behavior` 有新增 → 触发增量补算。
