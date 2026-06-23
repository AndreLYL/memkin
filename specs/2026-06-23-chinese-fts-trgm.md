# 中文全文检索修复（trgm 替换方案）— 设计文档

- **日期**: 2026-06-23
- **作者**: brainstorming (superpowers) 协作产出
- **状态**: 待实现（已通过设计评审，待 spec 复核）
- **基线**: `origin/main` @ `adb6361`
- **范围编号**: #1（词法检索 / 中文 FTS）

## 1. 背景与问题

Memoark 主打中国职场（飞书）用户，但中文全文检索（FTS）实际上是坏的。

- `src/store/search.ts` 的查询构造按空白切词：`query.trim().split(/\s+/)...join(" & ")`。中文没有空格，整句变成**一个** `to_tsquery('simple', '认证中间件决策')` 词元。
- 索引侧 `src/store/schema.sql` 同样 `to_tsvector('simple', ...)`，把每段无空格中文当**一个巨型词元**。
- `to_tsquery` 是**精确词元匹配，不是子串匹配** → 只有查询逐字等于原文某段连续中文时才命中。
- 全仓**无中文分词**（`pinyin-pro` 仅用于人名拼音 slug）。

**后果**：面向中文用户，FTS 这条腿形同虚设；`memoark search --mode fts "中文"` 几乎召不回；混合检索对中文退化成"纯向量"。在未配置嵌入的场景下，中文检索整体不可用。

**在最新 main（`adb6361`）上仍然存在**：`search.ts:197` 与 `:382` 仍是 `split(/\s+/)`；近期 16 个提交（spec7 synthesis engine）未触及分词。

### 1.1 与 Spec 10 的关系（重要：纠正一个错误前提）

`specs/2026-06-22-spec10-retrieval-quality.md` §五（query 意图改写）写道：

> "**不引入分词库**（jieba/`@node-rs/*` 在 Bun 下有 native binding 风险）……**CJK 检索召回已由现有 `tsvector('simple')` + 向量覆盖**，分词不是起步必需。"

本 spec 的 spike **证伪了这个前提**：`tsvector('simple')` 对中文是整段无空格 → 单一巨型词元的精确匹配，**并不覆盖 CJK 词法召回**（`认证中间件`、`中间件`、`回滚` 等子串查询全 0）。spec10 把"分词不是起步必需"建立在一个不成立的假设上。

同时，本方案**恰好满足 spec10 的约束**：spec10 拒绝 jieba/`@node-rs/*` 是因为 **Bun native binding 风险**；而 `pg_trgm` 是 **PGLite 自带的 WASM 扩展**，零 npm 依赖、零 native binding，从根上规避了该风险。因此本 spec 不与 spec10 冲突，而是**纠正其前提并补上 spec10 主动留白的 CJK 词法召回**。建议合入时同步修订 spec10 §五该段表述。

## 2. 约束与关键发现（来自 spike）

存储是 PGLite（WASM Postgres）。最初假设"PGLite 无法加载原生 FTS 扩展（zhparser/pg_jieba）"——**该假设被证伪**：PGLite 0.4.6 自带一批 WASM 编译的扩展，其中包含 **`pg_trgm`**（以及 `pg_textsearch`、`unaccent`、`fuzzystrmatch`）。

三轮 spike 结论（在 PGLite 实测）：

1. ✅ `pg_trgm` 在 PGLite 正常 `CREATE EXTENSION`；`gin_trgm_ops` GIN 索引可建。
2. ✅ **中文词法召回**用 `body ILIKE '%phrase%'`（精确子串）可靠命中：`认证中间件`、`中间件`、`回滚`、`中间`、`认证`、`数据库选型` 全部命中（此前全 0）。
3. ✅ **GIN 索引在规模下被使用**：3000 行中文表上 `EXPLAIN` 显示 `Bitmap Index Scan on docs_body_trgm, Index Cond: (body ~~* '%中间件%')`，即便 `enable_seqscan=on`。中文 `ILIKE` 子串是**索引加速**的，不是 seq scan。
4. ✅ **无需重抽取 / 重嵌入**：trgm 索引直接建在现有文本列上，是一次迁移 + 查询改写，不动采集/提取管线。

spike 暴露的两个注意点：
- `<%`（word_similarity）算子用独立的 `word_similarity_threshold`（默认 0.6），中文相似度常落在阈值下 → **不能用 `<%` 做召回**；召回必须用 `ILIKE` 子串。
- `similarity()` 排序分对短查询不区分（0.00–0.20）→ 单独排序弱，但 Memoark 把 FTS 以**排名位次**喂入 **RRF** 融合（叠 tier/freshness/backlink 加权），因此召回正确即可，顺序可接受。

## 3. 方案选型

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. JS 词典分词（jieba 类） | 切词后喂 `to_tsvector('simple')` | 排序/高亮最准；但加依赖 + 词典（影响 npx 安装体积）、版本不确定性、OOV、需重建索引 |
| B. JS 双字（bigram） | 入库/查询两侧切二元喂 tsvector | 零依赖、确定性；但要改入库+查询两侧、重建 tsvector，等于手搓 trgm |
| **C. `pg_trgm` 原生（选定）** | 扩展 + GIN trgm 索引 + ILIKE 子串 | 改动最小、无 JS 分词、无词典、中文开箱即用、**无需重抽取**；代价是失去 `ts_rank`/`ts_headline` |

**决策：C**。词法检索层**替换**策略：中英文统一走 trgm-ILIKE，移除 `to_tsvector('simple')` 那套（`search_vector` 列 + 触发器 + 触发函数 + GIN tsvector 索引）。

## 4. 设计

### 4.1 匹配模型
- 召回 = trgm 加速的 `ILIKE '%term%'` 子串包含（精确，含中文）。
- 排序 = `similarity()` 提供顺序，最终交给现有 **RRF** + tier/freshness/backlink 加权融合。
- **向量检索腿不动。**

### 4.2 Schema 与迁移
1. **扩展装载**（`src/store/pglite-assets.ts`）：
   - dev 模式：`extensions: { vector: stockVector, pg_trgm }`（`import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"`）。
   - compiled / `npx` 二进制模式：按 `vector.tar.gz` 的同款 explicit-blob 方式，把 **`pg_trgm.tar.gz`** 打进 assets；`scripts/gen-embedded-assets.mjs` / `post-build.mjs` 平行复制该 tar。
2. **新迁移**（`src/store/migrations/index.ts` 追加一条，幂等，升序版本号）：
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
   - 建 GIN trgm 索引：`pages USING gin (title gin_trgm_ops)`、`pages USING gin (compiled_truth gin_trgm_ops)`、`content_chunks USING gin (chunk_text gin_trgm_ops)`（`IF NOT EXISTS`）。
   - 拆除旧机制：`DROP TRIGGER` `trg_pages_search_vector`、`chunk_search_vector_trigger`；`DROP FUNCTION` `update_page_search_vector`、`update_chunk_search_vector`；`DROP INDEX` `idx_pages_search_vector`、`idx_chunks_search_vector`；`ALTER TABLE ... DROP COLUMN search_vector`（pages、content_chunks）。全部 `IF EXISTS`。
3. **新库路径**（`src/store/schema.sql`）：同步去掉 tsvector 那套、内置 trgm 扩展与索引，保证全新库与迁移后的库结构一致。**注意**：schema 还以常量形式内联在 `src/store/embedded-assets.generated.ts`（打包/Node 运行用），改完 `schema.sql` 必须跑 `npm run gen:assets` 重新生成，否则打包构建仍带旧 tsvector schema。
4. **存量库**：迁移在 DB 打开时执行；索引基于现有文本列即时构建，无需重抽取/重嵌入。插入代码不直接引用 `search_vector`（由触发器填充），删列不破坏写入。

### 4.3 查询构造（`src/store/search.ts`）
- `query` → `trim` → 按 `\s+` 切词 → 每词**转义 ILIKE 元字符**（`\`、`%`、`_`，配 `ESCAPE '\'`）→ 组成 `AND`：每词要求 `(p.title ILIKE $n ESCAPE '\' OR p.compiled_truth ILIKE $n ESCAPE '\')`；chunk 侧对 `cc.chunk_text` 同理。
- 词内非通配字符（如 `gpt-4` 的连字符）保留，仅转义通配符。
- 排序：取相关文本列 `similarity()` 较大值作为该 leg 的分，喂入 RRF。
- 空查询仍返回 `[]`。
- `MemoryFilter`（platform/source_type/channel/channel_name/participant/date 等）WHERE 条件原样保留，仅替换词法匹配那一段；与近期 `poolByPage`（best-chunk-per-page）兼容。

### 4.4 高亮 / snippet
失去 `ts_headline` → 实现一个小工具函数 `buildSnippet(text, terms, window=40)`：在文本中定位首个匹配词位置，前后各取 `window` 字（默认 40）切片并包裹高亮标记；命中靠近开头/结尾时裁剪边界。中英文统一，对中文比 `ts_headline` 更准。

### 4.5 边界与错误处理
- 单字中文查询（`回`/`认`）现可召回（子串），符合"精确短语搜不到"的修复目标。
- 仅转义通配符，保留连字符等 term 内字符。
- 混合中英查询走同一 AND 子串逻辑。
- 转义实现需覆盖反斜杠自身。

## 5. 测试（TDD：先写测试）

1. **查询构造单测**：切词、通配符转义（`%`/`_`/`\`）、AND 组装、空查询、混合中英。
2. **中文召回端到端**：`认证中间件`/`中间件`/`回滚`/`数据库选型` 必中（覆盖此前全 0 的回归）。
3. **英文不回归**：`JWT token`、`gpt-4` 仍按预期召回与排序。
4. **迁移幂等 + 存量升级**：在带旧 `search_vector` 的库上跑迁移 → 列/触发器/旧索引被清、trgm 索引建成、可重复执行不报错。
5. **索引使用守卫**：`EXPLAIN` 断言中文 `ILIKE` 走 `Bitmap Index Scan`（防退化成 seq scan）。
6. **扩展装载**：dev 与 compiled 两种模式都能 `CREATE EXTENSION pg_trgm` 成功（compiled 模式需 `pg_trgm.tar.gz` 已打包）。

## 6. 明确不在范围内（YAGNI）

- **语义召回失败**（"模糊描述召不回"）：属嵌入完整性（#2）+ RRF 权重，单独成 spec，本 spec 不碰。
- RRF 权重 / `poolByPage` 调参不动。
- 不做无关重构。

## 7. 实施注记

- 本 spec 已基于最新 `origin/main`（`adb6361`），实现分支 `claude/repo-status-background-agzw08` 已 fast-forward 到该提交。
- 实现遵循 superpowers `writing-plans` → `test-driven-development` → `verification-before-completion`。

## 8. 验收标准

- `memoark search --mode fts "认证中间件"` 在含该短语的记忆上能召回（当前为空）。
- 全量测试通过；新增中文召回测试、迁移幂等测试、索引使用守卫测试通过。
- 全新库与迁移后存量库结构一致；`npx` 打包二进制可加载 `pg_trgm`。
