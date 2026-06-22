# Spec 7: 合成底座（Synthesis Engine）

**日期**：2026-06-22（v2，含工程评审修正）
**状态**：📝 待审查
**依赖**：无（建立在现有 `src/store/search.ts` / `pages` / `timeline` / `graph` / LLM provider 之上）
**定位**：把 Memoark 从"返回片段的记忆库"升级为"给出行动建议的决策助手"——Spec 8（人物画像）/ Spec 9（日报）/ Spec 11（playbook）的共同底座

> 调研依据见 [gbrain 对比调研](research/2026-06-22-gbrain-comparison-research.md) §一/§三；产品定位见 [行动决策记忆总纲](2026-06-22-action-memory-brainstorming.md)。
>
> **v2 评审修正**：补齐模块布局、全部类型定义、统一引用格式（[n]，弃用 [^n]）、intentRegistry 注册时机、缓存载体逐 scope 指定、best-chunk 池化默认关闭、recall 意图完整定义、移除占位工具。

---

## 一、背景与动机

### 现状（真实，main@eebb1b6 核对）

`src/server/mcp.ts` 的检索出口是 `query`（向量语义）和 `search`（关键词），二者都返回**排序后的 page/chunk 片段列表**。Agent 想要"我明天该注意什么"这类答案，必须自己把片段读完再归纳。

**问题：** ① 只检索不合成；② 无 gap 意识（不会说"已过期/有矛盾/还缺什么"）；③ `vectorSearch`（`search.ts:397-429` 区段）逐 chunk 返回，同一页多 chunk 可能重复占榜。

### 目标

- 新增**合成引擎** `synthesize(intent, scope)`：检索 → 组装 → 按意图模板 LLM 成段 → 附引用 + gap。
- 建立**意图模板框架**，Spec 8/9/11 各注册一个意图；本 spec 交付框架 + 一个**完整可跑的参考意图 `recall`**。
- 对外**双层接口**：底层 `synthesize` + 本 spec 的 `recall`；产品化高层工具由各自 spec 注册。
- 顺带补 **best-chunk-per-page 池化**（借 gbrain），**仅在合成内部启用**。

**非目标**：人物画像维度（Spec 8）、文档 action_items（Spec 9）、零-LLM 边/query 改写/reranker（Spec 10）、playbook（Spec 11）。

---

## 二、调研依据

> ⚠️ 本节 gbrain 结论均来自其 README/第三方解读，**未经源码核实**（见[调研 doc §六可信度分级](research/2026-06-22-gbrain-comparison-research.md)）。本 spec 一律**自研 + 行为对齐**，验收只测我们自己的行为（§十一），不假设 gbrain 实现正确。

- **gbrain `think`**：检索后合成带引用成段答案 + gap 分析。我们的扭转：一引擎 + N 意图模板，输出**行动建议**而非事实罗列。
- **best-chunk-per-page 池化**：每页以最强 chunk 露出，避免一页多弱 chunk 霸榜。

---

## 三、模块布局与数据契约

### 3.1 模块布局（`src/synth/`，与 `consolidator/` 平级）

```
src/synth/
  index.ts        # 对外导出 synthesize() 与类型；MCP/CLI 从此 import
  engine.ts       # synthesize() 主流程（§3.3 的 6 步编排）；顶部 import "./intents/index.js" 触发注册
  scope.ts        # SynthScope → 候选检索（调用 store/search），best-chunk 池化在此按需开启
  context.ts      # AssembledContext 组装（候选编号 + 派生量）
  citations.ts    # 引用编号分配、后处理校验、回链
  gaps.ts         # GapRule 引擎（stale / missing_field / contradiction）
  cache.ts        # 合成缓存读写 + 新鲜度判定（§九）
  intent.ts       # IntentTemplate 接口 + intentRegistry + registerIntent()/getIntent()
  intents/
    index.ts      # 显式 registerIntent(recallIntent)；Spec 8/9/11 在此追加注册
    recall.ts     # 本 spec 交付的完整参考意图（附录 A）
  types.ts        # 全部数据契约（§3.2）
```

每个文件职责单一，写 plan 者据此分任务，避免"在 src/synth/ 里随意拆分"。

### 3.2 数据契约（`src/synth/types.ts`，全部显式定义）

```typescript
// —— 检索范围 ——
interface SynthScope {
  entity?: string;                       // 围绕某实体（person/zhang-san）→ backlinks + timeline
  time?: { from: string; to: string };   // 时间窗 → 跨渠道按 date 过滤
  query?: string;                        // 自由语义检索 → hybrid search
  types?: string[];                      // 限定信号类型（由 search.ts:133 的 `p.type = ANY($n)` 实现，scope.ts 透传）
  channels?: string[];                   // 限定来源渠道，合法值与 timeline_entries.source 对齐：
                                         //   feishu-dm | feishu-message | feishu-mail | feishu-calendar | feishu-task | feishu-docs | agent
  limit?: number;                        // 候选上限（默认 30）
}

// 合成调用选项：意图专属参数（如 daily_report 的 date、person_strategy 的 goal）经 extra 透传到 compose
interface SynthOpts {
  extra?: Record<string, unknown>;       // 透传给意图的 systemPrompt 拼装（见 §3.3 第 5 步）
  noCache?: boolean;
}

// —— 组装上下文 ——
interface AssembledCandidate {
  ref: number;        // 引用编号，从 1 起，对应 answer 里的 [n]
  slug: string;
  title: string;
  type: string;
  text: string;       // 喂给 LLM 的正文片段
  date?: string;      // 信号日期（gap 计算用）
  source?: string;    // provenance（frontmatter.source / links.provenance / timeline.provenance）
}
interface AssembledContext {
  scope: SynthScope;
  candidates: AssembledCandidate[];
  latestDate?: string;       // candidates 中 max(date)，供 stale gap 用
  pinnedContext?: string;    // 非可引用的前置框架文本（如人物画像摘要）；由意图的 buildPinnedContext 钩子产出，置于候选之前喂 LLM。不分配 ref，引用仍指向 candidates。
}

// —— LLM 产出（compose 阶段原始输出，未做引用校验/gap）——
interface ComposeOutput {
  answer: string;        // 含 inline [n] 标记的 markdown
}

// —— 引用 ——
interface Citation {
  ref: number;        // 与 answer 里的 [n] 一一对应
  slug: string;
  title: string;
  source?: string;
  date?: string;
}

// —— gap ——
interface Gap {
  type: "stale" | "missing_field" | "contradiction";
  message: string;
  meta?: Record<string, unknown>;
}
interface GapRule {
  id: Gap["type"];
  evaluate(ctx: AssembledContext, raw: ComposeOutput, intent: IntentTemplate): Gap[];
}

// —— 最终结果 ——
interface SynthesisResult {
  intent: string;
  answer: string;                              // 见 §3.4：始终非空
  sections?: { title: string; body: string }[]; // 仅 format="sections" 的意图产出
  citations: Citation[];                       // 仅保留被 answer 引用过的候选
  gaps: Gap[];
  meta: { model: string; generated_at: string; scope: SynthScope; cached: boolean };
}
```

### 3.3 `synthesize()` 6 步编排（`engine.ts`）

```
synthesize(intent, scope, opts?: SynthOpts) → SynthesisResult
  1. getIntent(intent)                       // intent.ts，未注册则抛错
  2. opts.noCache ? skip : cache.read(...)   // 命中且新鲜 → 直接返回（§九）
  3. scope.retrieve(scope, {poolByPage:true})// 检索候选（§七）；scope.types 透传给 search 的 type 过滤
  4. intent.sortCandidates?(candidates)      // 可选钩子：意图重排候选（如 Spec 11 沿 precedes）
  5. context.assemble(candidates)            // 编号 → AssembledContext
  6. intent.buildPinnedContext?(scope)       // 可选钩子：意图产出 ctx.pinnedContext（如 Spec 8 注入画像）
  7. compose(intent, ctx, opts?.extra)       // LLM → ComposeOutput；pinnedContext + extra 拼入
  8. citations.finalize + gaps.run + cache.write → SynthesisResult
```

- **钩子由 `engine.ts` 通用调用**：`sortCandidates`/`buildPinnedContext` 是 `IntentTemplate` 的可选方法，Spec 8/11 在各自意图文件里实现（如调 `getOrderedSequence`、读 `frontmatter.profile`）。**`engine.ts`/`scope.ts` 不 import 任何具体意图或 Spec 8/11 的函数**——彻底消除通用层→具体意图的反向依赖（回应 R2）。
- `compose(intent, ctx, extra)`：先放 `ctx.pinnedContext`（若有，作非可引用前置框架），再放编号候选 `[1..N]`；以 `intent.systemPrompt` 为基底，`extra` 非空按意图约定拼入（如 `person_strategy` 把 `extra.goal` 作"本次沟通目标"）。**Spec 8/9/11 不需改 `synthesize()` 签名**。

### 3.4 `answer` 与 `sections` 的关系（消除歧义）

- 意图声明 `format: "single" | "sections"`。
- `format="single"`（如 recall）：`sections` 省略，`answer` = 唯一成段内容。
- `format="sections"`（如日报）：`sections` 是权威结构；`answer` = 各 section 按序拼接的 markdown（冗余，供不解析 sections 的客户端直接展示）。
- **不变量：`answer` 始终非空**；`sections` 为可选。前端优先 `sections`（若存在），否则用 `answer`。

---

## 四、意图模板框架

```typescript
// src/synth/intent.ts
interface IntentTemplate {
  id: string;                                  // "recall" | "person_strategy" | ...
  format: "single" | "sections";
  buildScope(args: Record<string, unknown>): SynthScope;
  systemPrompt: string;
  expects?: string[];                          // missing_field gap：期望 answer 覆盖的要点
  staleDays?: number;                          // stale gap 阈值（缺省 14）
  gapRules: GapRule[];
  parseSections?(answer: string): { title: string; body: string }[]; // format="sections" 必填
  // —— 可选扩展钩子：通用层只调用，不感知具体意图，杜绝 Spec 7 反向依赖 Spec 8/11（回应 R2-S8-P1-1 / R2-S11-P1-1）——
  buildPinnedContext?(scope: SynthScope, stores: StoreContext): Promise<string | undefined>; // 产出 AssembledContext.pinnedContext（如 Spec 8 读 frontmatter.profile）；StoreContext 见 src/server/api.ts:36
  sortCandidates?(candidates: AssembledCandidate[], stores: StoreContext): Promise<AssembledCandidate[]>; // 重排候选（如 Spec 11 沿 precedes 链）
}

const intentRegistry = new Map<string, IntentTemplate>();
export function registerIntent(t: IntentTemplate): void { intentRegistry.set(t.id, t); }
export function getIntent(id: string): IntentTemplate {
  const t = intentRegistry.get(id);
  if (!t) throw new Error(`unknown synth intent: ${id}`);
  return t;
}
```

**注册时机（明确）**：注册走**显式调用**，不依赖隐式 import 副作用顺序。
- `src/synth/intents/index.ts` 顶层显式 `registerIntent(recallIntent)`。
- `src/synth/engine.ts` 顶部 `import "./intents/index.js"`，保证 `synthesize()` 首次调用前注册表已填充。
- Spec 8/9/11 各自在 `intents/` 加文件，并在 `intents/index.ts` 追加一行 `registerIntent(...)`——注册集中可见，无隐式魔法。

---

## 五、引用模型（统一格式：inline `[n]`）

**决定：采用 inline `[n]` + `citations[]` 回链，n 从 1 起（Wikipedia 数字引用风格）。明确弃用 Markdown footnote `[^n]`**（它需文末 `[^n]:` 定义才能渲染，answer 是 inline 字符串，混用会导致前端渲染失败与后处理解析错误）。

流程（`citations.ts`）：
1. 组装时给每个候选分配 `ref`（1..N），写进喂 LLM 的上下文（"[1] <标题> …"）。
2. systemPrompt 要求 LLM 在每个事实性断言后写 `[n]`。
3. **后处理校验**：正则提取 `answer` 中的 `[n]`；剔除超出 `1..N` 的伪引用标记；`citations` 只保留**被实际引用过**的候选。

---

## 六、gap 分析（`gaps.ts`）

| gap 类型 | 判定 | 实现 | 本 spec 必测 |
|---|---|---|---|
| `stale` | `now - ctx.latestDate > intent.staleDays` | 确定性 | ✅ |
| `missing_field` | `intent.expects` 中的要点未被 answer 覆盖 | 确定性（关键词/启发式匹配） | ✅ |
| `contradiction` | 同一实体同一维度候选互相冲突 | **独立可选 pass**（默认关，配置开启）：专用 prompt 两两判断，输出结构化 `{a_ref,b_ref,reason}` | ⛔ 不进必测 |

**矛盾检测明确**：**不混入 compose 的 systemPrompt**（避免一个 prompt 背负"生成答案+检测矛盾"两职责导致膨胀与不稳定）。起步实现为独立、可选的轻量 pass，结构化输出；重量级矛盾检测留给 consolidator（调研 P4）。

---

## 七、best-chunk-per-page 池化（仅合成内部启用）

**池化逻辑只实现一处**：在 `src/store/search.ts` 的 `hybridSearch` 内部，由 `poolByPage` 参数控制——候选汇总后**按 `page_id` 分组，每页只保留最高分 chunk**，再做 RRF/tier/freshness 排序。`src/synth/scope.ts` **只传 `poolByPage:true`，不自己二次 reduce**（避免双重池化，回应 review S10-P1-5）。

- **`synthesize()` 经 scope.ts 传 `poolByPage:true`**。
- **对外 `query`/`search` 默认 `poolByPage:false`——排序行为零变化，无回退风险**。
- 是否对 `query`/`search` 默认开启，留待 Spec 10 评估（届时再处理既有测试的排序断言）。

---

## 八、对外接口（不预占位）

本 spec **只注册两个 MCP 工具**：

```typescript
server.tool("synthesize", { intent: z.string(), scope: z.object({...}).partial() }, ...);
server.tool("recall",     { entity: z.string().optional(), query: z.string().optional(),
                            time: z.object({from:z.string(),to:z.string()}).optional() }, ...);
// recall 内部 = synthesize("recall", buildScope(args))
```

**不预占位** `prep_for_person` / `daily_report` / `troubleshoot`——它们由 Spec 8/9/11 **各自注册自己的工具**，避免占位被覆盖、同名冲突、以及"Spec 7 注册未实现工具"造成的回退。

---

## 九、缓存（逐 scope 指定载体）

`cache.ts` 提供 `read/write`，载体按 scope 模式区分：

| scope 模式 | 缓存载体 |
|---|---|
| `entity` | 该 entity page 的 `frontmatter.synth[intent]`（含 `input_hash` + `generated_at`） |
| `time` | 专用摘要页 `reports/<intent>/<from..to>`（如 `reports/daily/2026-06-22`）的 `frontmatter.synth` |
| `query` | 无单一 page 对应 → **起步不缓存**（后续可引入 `synth_cache` 表，key = `hash(intent+scope)`） |

> **`reports/` 页的 type（回应 review CROSS-2 / S9-P0-3）**：`type = "knowledge"` + `frontmatter.is_report = true`（**不扩展 type union**）。Spec 9 沿用此约定。

**新鲜度**：`input_hash`（候选 slug+date 集合的哈希）变化，或超过 `ttl` → 失效重算。混合预合成（夜间批量 + 当日增量）的具体策略由 Spec 8 落地，本 spec 只交付读写与新鲜度判定。

---

## 十、范围边界（Out of Scope）

- 人物画像三层模型与行为四象限/四色 → **Spec 8**
- 文档 `decisions`/`action_items`、`entities/me`、日报模板 → **Spec 9**
- 零-LLM 图边、query 改写、reranker、对 query/search 默认开池化 → **Spec 10**
- playbook 结构与分层树 → **Spec 11**
- 重量级矛盾检测、salience 打分 → consolidator 后续

---

## 十一、验收标准

1. `bun test` 全部通过（含引擎、意图框架、引用、gap、池化、缓存、recall 端到端的单测）。
2. `synthesize("recall", { entity })` 返回 `SynthesisResult`：`answer` 非空 + ≥1 条有效 `[n]` 引用 + `gaps` 列表。
3. 引用后处理：mock provider 注入伪引用 `[99]`，断言被剔除、`citations` 不含其。
4. `stale` gap：构造 20 天前信号、`staleDays=14`，断言返回 `stale` gap；`missing_field`：构造 `expects` 未覆盖项，断言返回。
5. best-chunk 池化：`synthesize` 内同页多 chunk 命中 → 结果该页只出现一次取最强 chunk；**`query`/`search` 默认行为与排序零变化（既有测试全绿）**。
6. MCP：注册 `synthesize` + `recall` 两个工具；**不注册任何占位/未实现工具**；现有工具行为不变。
7. 缓存：`entity` scope 二次合成命中（mock provider 调用次数 = 1）；`time` scope 写回 `reports/<intent>/<date>` 页；`query` scope 不缓存。
8. recall 意图：`buildScope`/`systemPrompt`/`gapRules`/`format` 在 `intents/recall.ts` 完整定义并端到端可跑。
9. 扩展钩子：当 intent 提供 `sortCandidates`/`buildPinnedContext` 时 `engine.ts` 正确调用（候选被重排、`ctx.pinnedContext` 被设置并前置进 compose）；`engine.ts`/`scope.ts` **不 import 任何具体意图模块**（静态检查/约定），保证通用层零反向依赖。

---

## 附录 A：`recall` 参考意图（本 spec 交付，`intents/recall.ts`）

```typescript
export const recallIntent: IntentTemplate = {
  id: "recall",
  format: "single",
  staleDays: 14,
  buildScope: (args) => ({
    entity: args.entity as string | undefined,
    query: args.query as string | undefined,
    time: args.time as { from: string; to: string } | undefined,
    limit: 30,
  }),
  systemPrompt: [
    "你是用户的工作记忆助手。下面是带编号的记忆片段。",
    "请用中文写一段简洁、客观的综合回答，概括用户所问范围的情况。",
    "每个事实性断言后用 [n] 标注来源编号（n 对应片段编号）。",
    "只使用提供的片段，不要编造未提供的信息；信息不足时直说。",
  ].join("\n"),
  expects: [],            // recall 无强制覆盖要点
  gapRules: [staleRule],  // gaps.ts 导出的 stale 规则，阈值取 intent.staleDays
};
```

`registerIntent(recallIntent)` 在 `intents/index.ts` 顶层调用。
