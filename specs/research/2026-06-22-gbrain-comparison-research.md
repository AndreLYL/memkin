# gbrain × Memoark 细致对比调研

**日期**：2026-06-22
**对象**：[garrytan/gbrain](https://github.com/garrytan/gbrain)（Garry Tan 的 self-wiring memory layer，OpenClaw/Hermes 生产大脑）
**目的**：摸清 gbrain 最新形态，与 Memoark 现状做逐项对比，明确"该借什么 / 该守什么"，为 Spec 7–11 提供调研依据
**关联**：[行动决策记忆头脑风暴总纲](../2026-06-22-action-memory-brainstorming.md)

> 调研方法：gbrain 侧通过其公开 README / docs / 第三方解读获取（实现细节藏在 design docs，部分为外部描述）；Memoark 侧基于真实代码逐文件核对，所有结论附 `file:line`。

---

## 〇、最根本差异：两种产品哲学

| | **gbrain** | **Memoark** |
|---|---|---|
| 核心循环 | 捕获 → 自布线图谱 → 合成检索 | 采集 → 分渠道提取压缩 → 信号存储 → 检索 |
| 数据怎么进来 | 以 `capture` / webhook / skillpack recipes 为主；邮件/日历/Slack 都是"接线 recipe"，**无内建渠道专用提取管线** | **内建多渠道专用采集器**（飞书 DM/群/邮件/日历/任务/文档 + Claude Code/Codex），每个渠道有自己的 block 规则、降噪、canonicalize |
| 写入时做什么 | **零 LLM**：每次 `put_page` 从 markdown 的 wikilink/typed-link 解析出 typed edges | **重 LLM**：整条提取管线靠 LLM 抽信号，links 也由 LLM 抽 |
| 读出时做什么 | **合成层 `think`**：带引用的成段答案 + gap 分析 | `query`/`search` 返回排序后片段，**无合成层** |
| 类型系统 | **schema packs**（可配置，15 类基础 taxonomy，`schema detect/suggest` 自动聚类） | 固定枚举（decision/task/knowledge/…） |
| 引擎 | **双引擎**：PGLite（≤50k 页）+ Postgres/pgvector（大规模/共享），同一 `BrainEngine` 47-op 接口生成 CLI+MCP | 单引擎 PGLite（pgvector），CLI+MCP 各自实现 |

**一句话**：gbrain 强在"读"（图谱 + 合成），弱在"写"（靠人/recipe 喂）；Memoark 正相反，强在"写"（自动化分渠道提取压缩），弱在"读"（无合成、无重排、类型固定）。**这正好定义了我们该向它借什么——借"读"，守"写"。**

---

## 一、数据库设计对比

Memoark 核心模型在 `src/store/schema.sql`，5 张核心表 + 2 张身份表，migration 在 `src/store/migrations/index.ts`。

| 概念 | Memoark | gbrain | 评价 |
|---|---|---|---|
| 页（实体/信号） | `pages`（`slug` 唯一、`type`、**`compiled_truth`**、`frontmatter` JSONB、`content_hash`、`halflife_days`、`tier`、`expires_at`、`consolidated_into`、`search_vector`） | page 为中心，**compiled truth 在上 + timeline 在下** | **理念一致**：`compiled_truth` 列 = 它的"编译后真相"，timeline 单独成表 |
| 切块+向量 | `content_chunks`（300 词窗/50 词重叠，`embedding vector(dim)`，`hnsw vector_cosine_ops`，`chunks.ts:14-31`） | chunk + HNSW，**按页取最强 chunk**（best-chunk-per-page pooling） | 索引方式相同；**它多了"每页只用最强证据 chunk"的池化**，我们目前逐 chunk 命中，同一页可能多次占榜 ⚠️ |
| 图边 | `links`（`from/to/link_type/context/provenance/source_hash`，UNIQUE 去重，`graph.ts`） | 自布线 typed edges，**写入时零 LLM 解析** | 表结构都够用；差别在"边怎么产生" |
| 时间线 | `timeline_entries`（`date/summary/detail/source/provenance/tier`，独立分层老化） | timeline 追加在页底 | 我们更细（每条 timeline 能独立 tier 老化） |
| 身份 | `identity_cache` + `person_handles`（`feishu_open_id/email/name/nickname/slug` → canonical slug，strong/weak 强度） | 夜间 enrichment 里 dedupe people pages | **我们有专门的跨平台人物身份层，比它工程化**；它靠夜间 daemon 兜底 |

### 检索栈

| 能力 | Memoark（`src/store/search.ts`） | gbrain |
|---|---|---|
| 向量 | pgvector + HNSW，cosine | pgvector + HNSW，cosine |
| 关键词 | Postgres tsvector（`simple` 配置，title=A/body=B 加权，CJK 友好） | BM25 |
| 融合 | **RRF**（K=60）+ compiled_truth ×2.0 + tier 权重（hot1.0/warm0.8/cold0.6）+ backlink 提升 + freshness（半衰期 90 天） | RRF + source-tier boost + **intent-aware query 改写** + **reranker（ZeroEntropy）** + 图信号（邻接提升/跨源印证/session 降权） |
| 模式 | 单一 hybrid | conservative / balanced / tokenmax 三档 |
| 合成 | ❌ 无 | ✅ `think`：成段 + 引用 + gap 分析 |

**读侧我们缺的**：① query 改写 ② 重排 ③ best-chunk-per-page 池化 ④ 合成层。
**我们多的**：freshness/backlink/tier 这套"时间衰减 + 图轻量加权"。

### 老化/巩固

| | Memoark consolidator | gbrain dream cycle |
|---|---|---|
| 分层 | hot→warm→cold（`halflife_days`+`expires_at` 驱动，可压缩类型按 (entity,type) 合并成 warm 聚合页，`src/consolidator/hot-warm.ts`） | hot→durable 提升 |
| 修边 | dead-link 修复 | citation 修复 |
| 推断 | preference 推断 | **salience 打分 + 矛盾检测 + entity sweep（从当日 session 反扫补实体页）** |
| 触发 | `serve` 内 scheduler / `memoark consolidate` | cron（默认 2AM autopilot） |

**我们缺它的**：矛盾检测、salience 打分、从当日会话主动反扫补实体页。

---

## 二、分渠道提取与压缩策略（Memoark 的护城河）

整条管线：`Collector.fetch + Dedup → BlockBuilder → Canonicalize → NoiseFilter(L1规则+L2打分) → SignalExtractor(LLM JSON) → Privacy → IdentityResolver → Adapter`（`src/core/pipeline.ts`）。

> **gbrain 完全没有这一层**——它把渠道接入丢给 recipe，raw 内容直接当 capture 入库。所以本节严格说"无可对比"，但正因如此这是 Memoark 的差异化护城河。

### (a) 邮件 & 云文档

**邮件**（`collectors/feishu/sources/mail.ts` + `core/canonicalize.ts:64`）
- Block：Rule 0a，每封邮件独立成块，绝不跨邮件合并
- 压缩（canonicalize 是真正的压缩点）：剥回复链/引用块/原文标记/页脚，重组为 `From/Subject/Date + 正文`
- L1 降噪：自动回复/out of office/会议取消 → skip；含决策关键词 → escalate
- 权重 0.9（最高档），受保护不被短内容 guard 误杀

**飞书文档**（`collectors/feishu/docs/*`，PR #55）
- **已实现两级卡片系统**：指针卡（仅元数据，零 LLM）vs 全量卡（LLM 摘要）
- 触发器（`docs/triggers.ts`）：T1 自己编辑过 / T2 近 N 天改过 / T4 重要文件夹·wiki 空间 → 升级全量；T5 body 变了才重摘要
- 全量卡 schema（`docs/full-builder.ts`）：`purpose(≤50字)` / `topics(3-7)` / `entities[]` / `overview(200-400字)` / `toc`
- **缺口**：schema 里**没有 `decisions` 和带 owner 的 `action_items`**——日报场景的真正待补点（见 Spec 9）

> 对照 gbrain：它对长文/会议纪要靠夜间 enrichment 做 dedupe+consolidate。Memoark 的文档压缩**已成体系且有成本控制**，唯独缺"决策/待办"维度的结构化抽取。

### (b) 私聊 DM & 群聊

**群聊**（`sources/messages.ts` + `canonicalize.ts:127`）
- Block（核心压缩）：Rule 1 thread/reply 边界 → Rule 2 时间间隔（>30min 切）→ Rule 3 token 预算（>4000 切）→ Rule 4 条数（≥100 切）；中文 token 按 1.5/字估
- 切块：300 词窗/50 词重叠
- canonicalize：`[时间] 发言人: 内容`
- L1 降噪：系统通知（进群/退群/撤回/改群名）、红包/转账、纯 emoji → skip；决策/任务关键词 → escalate
- 权重最低 0.5；guard：`<20 token 且无实体无互动且非邮件/文档/结构化 → 强制 drop`

**私聊 DM**（`sources/dm.ts`）：同管线，差异为 channel 前缀 `dm/`、`sensitivity:high`、检测 sent/received 方向、权重 0.7（高于群聊）

> 对照 gbrain：无"群聊压缩"概念，Slack 之类靠 recipe 当 capture 喂入。Memoark 的四级 block 切分 + 中文降噪词表是针对中国职场 IM 的真功夫。

### (c) 日历 & 任务

**日历**（`sources/calendar.ts` + `canonicalize.ts:138` structured）
- 支持 `sync_token` 增量；无 token 取 [−30d, +90d]
- Block：Rule 0b 每事件独立；结构化 key-value 压缩；L1 不过滤直接进提取；权重 0.8
- 抽取：decisions（会议结论）/timeline（事件日期）/entities（参会人）/links（协作）

**任务**（`sources/tasks.ts`）：`updated_from` 增量；每任务独立块；结构化压缩；抽 task（状态/owner/due）+timeline+entities；权重 0.8

> 对照 gbrain：日历是它的 webhook recipe，拿到数据后仍落成 capture 页。Memoark 把日历/任务做成"结构化源 + 标准抽取"，直接转成 decision/timeline 信号。

---

## 三、可借鉴清单（按 ROI 排序）

| 优先级 | 借鉴零件 | 引入形态 | 落点 |
|---|---|---|---|
| 🥇 P0 | 合成层 `think`（带引用成段 + gap 分析） | 一引擎多意图 `synthesize` | Spec 7 |
| 🥈 P1 | 写入时零-LLM 图边抽取 | `put_page` 时从 compiled_truth 解析 wikilink 建边，作 LLM 抽边兜底 | Spec 10 |
| 🥉 P2 | best-chunk-per-page 池化 + intent query 改写 + 可选 reranker | 检索增强 | Spec 10 |
| P3 | 文档/长文压缩增强 | 卡片 schema 加 decisions/action_items | Spec 9 |
| P4 | consolidator 增强：矛盾检测 + salience 打分 + 当日会话反扫 | dream cycle 增强 | 后续 |
| P5 | schema packs（可配置类型） | 固定枚举 → 可配置 taxonomy | 后续 |

---

## 四、防"抄袭"原则

**借它的"读"，守我们的"写"。** 每借一个零件配一个原创扭转：

| gbrain 零件 | 我们的原创扭转 |
|---|---|
| 通用 `think` | 一引擎 + N 意图模板（日报/人物策略/排查）；输出**行动建议**不是事实罗列 |
| gap 分析 | 绑定到**决策**："你做这个决定前还缺 X" |
| 人物页（facts） | 加 **DISC 沟通风格画像层**，从真实聊天行为**被动推断、零问卷** |
| 夜间 enrichment | 加**人物画像夜间预合成** |
| 自布线零-LLM 边 | 面向**中文职场实体**，并承载 playbook 的分层树状结构 |
| schema packs | 承载 playbook 分支 runbook |

**总防线**：gbrain 服务 AI agent、给世界事实；Memoark 服务人、给职场行动建议。底座零件可同源，但产品形态、数据源、输出目标全不同。

---

## 五、关键共识备忘

- gbrain 的 page-centric（entity-as-page，无独立 entities 表）与 Memoark 现状一致——再次验证沿用 pages 模型正确（延续 `2026-06-04-product-form-brainstorming.md` §七结论）。
- gbrain 的 `compiled truth 在上 + timeline 在下`，我们用 `pages.compiled_truth` + `timeline_entries` 已天然吻合。
- gbrain 最大的、我们最该补的，是**读侧合成层**（P0）。
- Memoark 最该守住、且 gbrain 给不了的，是**中文职场多渠道自动提取压缩**。
