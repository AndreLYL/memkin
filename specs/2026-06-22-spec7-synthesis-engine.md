# Spec 7: 合成底座（Synthesis Engine）

**日期**：2026-06-22
**状态**：待审查
**依赖**：无（建立在现有 `src/store/search.ts` / `pages` / `timeline` / `graph` / LLM provider 之上）
**定位**：把 Memoark 从"返回片段的记忆库"升级为"给出行动建议的决策助手"——Spec 8（人物画像）/ Spec 9（日报）/ Spec 11（playbook）的共同底座

> 调研依据见 [gbrain 对比调研](research/2026-06-22-gbrain-comparison-research.md) §一/§三；产品定位见 [行动决策记忆总纲](2026-06-22-action-memory-brainstorming.md)。

---

## 一、背景与动机

### 现状（真实）

`src/server/mcp.ts` 的检索出口是 `query`（向量语义）和 `search`（关键词），二者都返回**排序后的 page/chunk 片段列表**。Agent 想要"我明天该注意什么"这类答案，必须自己把片段读完再归纳。

**问题：**
1. **只检索不合成**：没有"成段、带引用的答案"这一跳。
2. **无 gap 意识**：不会告诉用户"这条信息已过期""两处矛盾""还缺什么"。
3. **检索逐 chunk 命中**：`vectorSearch`（`search.ts:397-429`）按 chunk 返回，同一页多个 chunk 可能重复占榜，挤掉其他页。

### 目标

- 新增**合成引擎** `synthesize(intent, scope)`：检索 → 组装上下文 → 按意图模板 LLM 成段 → 附引用 + gap 分析。
- 建立**意图模板框架**，Spec 8/9/11 各注册一个意图（`person_strategy` / `daily_report` / `troubleshoot`），本 spec 只交付框架 + 一个最小参考意图。
- 对外**双层接口**：底层通用 `synthesize`，上层产品化高层工具。
- 顺带补 **best-chunk-per-page 池化**（借 gbrain），作为合成检索的基础增强。

**非目标**：人物画像维度（Spec 8）、文档 action_items 抽取（Spec 9）、playbook 结构（Spec 11）、reranker（Spec 10）。

---

## 二、调研依据

### 2.1 gbrain 的 `think`

gbrain 区分 `search`（返回片段，无 LLM）与 `think`（同样检索后，**合成带引用的成段答案 + gap 分析**："告诉你某页已过期、某断言无引用、两页矛盾、哪有该补的洞"）。这是它区别于裸 RAG 的核心。

**我们的扭转**：不做一个通用 `think`，而是**一引擎 + N 意图模板**，输出**行动建议**而非事实罗列；gap 分析绑定到"决策"语境。

### 2.2 best-chunk-per-page 池化

gbrain "pools the best chunk per page, so a page surfaces on its strongest evidence instead of losing to a neighbor on one weak chunk"。我们当前缺这一步（见 §一现状 3）。

---

## 三、合成引擎架构

新增 `src/synth/`（与 `consolidator/` 平级）：

```
synthesize(intent, scope, opts) → SynthesisResult
  1. resolve intent template      // 从意图注册表取模板
  2. retrieve(scope)              // 复用 hybrid search + best-chunk 池化
  3. assemble context             // 信号 + timeline + 引用编号
  4. compose                      // LLM：模板 system prompt + 组装上下文
  5. gap analysis                 // 过期/缺字段/矛盾
  6. attach citations             // 把成段答案里的引用编号回链到 source
```

### 3.1 输入：`SynthScope`

统一描述"合成哪些记忆"：

```typescript
interface SynthScope {
  // 三选一或组合
  entity?: string;        // 围绕某实体（如 person/zhang-san）→ backlinks + timeline
  time?: { from: string; to: string };  // 时间窗（如今天）→ 跨渠道按 date 过滤
  query?: string;         // 自由语义检索 → hybrid search
  // 过滤
  types?: string[];       // 限定信号类型（decision/task/...）
  channels?: string[];    // 限定来源渠道
  limit?: number;         // 候选上限
}
```

### 3.2 输出：`SynthesisResult`

结构化（便于 MCP 消费与 Web UI 渲染），而非裸 markdown：

```typescript
interface SynthesisResult {
  intent: string;
  answer: string;                 // 成段 markdown，内含 [^1][^2] 引用标记
  sections?: { title: string; body: string }[];  // 可选分段（如日报 7 段）
  citations: Citation[];          // 引用回链
  gaps: Gap[];                    // gap 分析
  meta: { model: string; generated_at: string; scope: SynthScope };
}
```

---

## 四、意图模板框架

意图 = (检索策略 + system prompt + 输出 schema)。注册表驱动，便于 Spec 8/9/11 扩展：

```typescript
interface IntentTemplate {
  id: string;                                   // "person_strategy" | "daily_report" | ...
  buildScope(args: Record<string, unknown>): SynthScope;     // 把高层参数转 scope
  systemPrompt: string;                         // 行动导向的 system 指令
  gapRules: GapRule[];                          // 该意图关心哪些 gap
  postProcess?(raw: string, ctx: AssembledContext): SynthesisResult;
}

const intentRegistry = new Map<string, IntentTemplate>();
```

本 spec 交付框架 + 一个最小参考意图 `recall`（"围绕 scope 给一段带引用的综合回答 + gap"），用于打通端到端并写测试。`person_strategy` / `daily_report` / `troubleshoot` 分别由 Spec 8/9/11 注册。

---

## 五、引用模型（Citations）

合成的可信度来自**可回溯**。组装上下文时给每条候选信号编号，prompt 要求 LLM 在断言后标 `[^n]`：

```typescript
interface Citation {
  ref: number;            // [^n]
  slug: string;           // 来源 page
  title: string;
  source?: string;        // provenance（frontmatter.source / links.provenance / timeline.provenance）
  date?: string;
}
```

- 来源元数据复用现有 `frontmatter.source`、`links.provenance`、`timeline_entries.provenance`（M002 已加，见 `migrations/index.ts`）。
- 后处理校验：剔除 LLM 编造的、不在候选集里的引用编号。

---

## 六、gap 分析

按意图配置的 `GapRule` 计算，**确定性为主、LLM 为辅**：

| gap 类型 | 判定 | 实现 |
|---|---|---|
| `stale`（过期） | 最近相关信号日期距今 > 阈值 | 取候选信号 max(date)，对比 now |
| `missing_field`（缺字段） | 意图模板声明的期望字段为空 | 模板 `expects` 列表 vs 组装结果 |
| `contradiction`（矛盾，轻量） | 同一实体同一维度存在冲突信号 | 起步用 LLM 在 compose 阶段顺带标注；重量级矛盾检测留给 consolidator（调研 P4） |

输出示例：`{ type: "stale", message: "关于 张总 的最近信息是 18 天前", since: "2026-06-04" }`。

---

## 七、best-chunk-per-page 池化（检索增强）

改造 `src/store/search.ts` 的混合检索：候选汇总后**按 `page_id` 分组，每页只保留得分最高的 chunk**，再做 RRF/tier/freshness 加权排序。

- 影响范围：`hybridSearch`（`search.ts:236-351`）的候选合并阶段加一层 group-by-page reduce。
- 收益：避免一页霸榜、提升候选多样性，直接利好合成（上下文里覆盖更多页）。
- 兼容：`query`/`search` 的对外返回结构不变，仅排序结果质量提升；加开关 `poolByPage`（默认开），便于 A/B 与回归。

---

## 八、对外接口

### 8.1 底层通用工具

```typescript
server.tool("synthesize", {
  intent: z.string(),
  scope: z.object({ /* SynthScope */ }).partial(),
}, handler);
```

### 8.2 上层产品化工具（demo 友好，Spec 8/9/11 各自实现 handler，本 spec 先占位注册）

```
prep_for_person(person, goal?)   // Spec 8
daily_report(date?)              // Spec 9
troubleshoot(query)             // Spec 11
```

三者内部都调 `synthesize(<intent>, <buildScope(args)>)`。保持"高层工具一眼懂、底层 synthesize 灵活"的双层结构。

---

## 九、混合预合成（缓存抽象）

合成可能较贵。引擎提供**可选缓存层**，供上层意图选择"实时 / 预合成 / 混合"：

- 缓存载体：合成结果写回相关 page 的 `frontmatter.synth[intent]`（带 `generated_at` + 输入 hash）。
- 混合读取：命中且新鲜 → 直接返回；过期/未命中 → 实时合成；当日增量轻补算由具体意图决定。
- 预合成触发：复用 consolidator/scheduler（`serve` 内），夜间批量。
- 本 spec 只交付缓存读写接口与新鲜度判定；具体预合成策略由 Spec 8（人物画像采用"混合"）落地。

---

## 十、范围边界（Out of Scope）

- 人物画像三层模型与 DISC/四色 → **Spec 8**
- 文档 `decisions`/`action_items` 抽取、`entities/me`、日报模板细节 → **Spec 9**
- 零-LLM 图边、query 改写、reranker → **Spec 10**
- playbook 结构与分层树 → **Spec 11**
- 重量级矛盾检测、salience 打分 → consolidator 后续增强

---

## 十一、验收标准

1. `bun test` 全部通过（含合成引擎、意图框架、best-chunk 池化、gap 规则的单测）。
2. `synthesize("recall", { entity: "..." })` 返回结构化 `SynthesisResult`：成段答案 + 至少 1 条有效 citation + gap 列表。
3. citation 后处理能剔除不在候选集里的伪引用（测试用 mock provider 注入伪引用）。
4. gap `stale` 规则：构造 20 天前的信号，断言返回 `stale` gap。
5. best-chunk 池化：构造同一页多 chunk 命中，断言结果中该页只出现一次且取最强 chunk；`query`/`search` 既有测试不回归。
6. `synthesize` MCP 工具注册成功，`prep_for_person`/`daily_report`/`troubleshoot` 占位注册（返回"未实现"提示，待 Spec 8/9/11 填充），现有工具行为不变。
7. 缓存层：同一 scope 二次合成命中缓存（mock provider 调用次数为 1）。
