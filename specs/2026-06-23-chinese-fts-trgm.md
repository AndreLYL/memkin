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

1. **扩展装载（`src/store/pglite-assets.ts`，两条分发路径，勿混淆）**：
   `buildPGliteOptions` 用 `isCompiledBinary()`（检测 `$bunfs`，`pglite-assets.ts:6-8`）分流：
   - **dev / npx / npm 全局**（`bin/memoark.mjs` → `dist/cli.js`，跑在 Node/Bun 下，**不是** `$bunfs`）：走 dev 分支（`pglite-assets.ts:29-31`），从 `node_modules/@electric-sql/pglite/dist` 加载扩展。**只需**把 `pg_trgm` 加进 `extensions`：`{ vector: stockVector, pg_trgm }`（`import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm"`）。`@electric-sql/pglite` 已是运行时依赖，**npx 路径无需打包任何 tar**。
   - **`npm run compile`（`dist-bin/memoark`，`$bunfs`）+ Tauri sidecar**：走 explicit-blob 分支（`pglite-assets.ts:40-47`），目前手工构造 `vector` 扩展对象（带 `bundlePath` URL）。需**新增第二个手工扩展对象** `pg_trgm`，`bundlePath` 指向 `asset("pg_trgm.tar.gz")`，镜像第 39-46 行，返回 `extensions: { vector, pg_trgm }`。
   - **资产暂存（修正）**：`vector.tar.gz` 实际由 **`scripts/build-sidecar.mjs:20-21`** 的拷贝列表暂存（不是 `gen-embedded-assets.mjs`/`post-build.mjs`——这俩只内联字符串/加 shebang）。需把 `pg_trgm.tar.gz` 加进 `build-sidecar.mjs:20` 的文件列表；compiled（`$bunfs`）路径同样需确保该 tar 落到 `asset()` 解析目录。
2. **新迁移**（`src/store/migrations/index.ts` 追加一条，幂等，升序版本号；当前最高版本为 4 → 新增 **m005**）：
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm;` **（必须在任何 `gin_trgm_ops` 索引之前**——否则 opclass 未定义）。
   - 建 GIN trgm 索引（`IF NOT EXISTS`）：`pages USING gin (title gin_trgm_ops)`、`pages USING gin (compiled_truth gin_trgm_ops)`、`content_chunks USING gin (chunk_text gin_trgm_ops)`。
   - 拆除旧机制（全部 `IF EXISTS`）：`DROP TRIGGER` `trg_pages_search_vector`、`chunk_search_vector_trigger`；`DROP FUNCTION` `update_page_search_vector`、`update_chunk_search_vector`；`DROP INDEX` `idx_pages_search_vector`、`idx_chunks_search_vector`；`ALTER TABLE ... DROP COLUMN search_vector`（pages、content_chunks）。
3. **新库路径**（`src/store/schema.sql`）：同步去掉 tsvector 那套、在顶部 `CREATE EXTENSION vector` 旁加 `pg_trgm`、内置三个 trgm 索引，保证全新库与迁移后结构一致。`CREATE EXTENSION pg_trgm` 必须排在 trgm 索引前。**注意（路径修正）**：schema 还以常量内联在 **`src/embedded-assets.generated.ts`**（注意是 `src/` 不是 `src/store/`；由 `scripts/gen-embedded-assets.mjs:14` 生成、`src/store/database.ts:2` 引用）。改完 `schema.sql` 必须跑 **`bun run gen:assets`**（即 `node scripts/gen-embedded-assets.mjs`）重新生成，否则打包/Node 运行仍带旧 tsvector schema。
4. **迁移顺序**（已核 `database.ts:52-53`）：`schema.sql` 先跑（全 `IF NOT EXISTS`），再 `runMigrations`。新库由 schema 建 trgm 索引、迁移 `IF NOT EXISTS` no-op；存量库 schema no-op、迁移做实际拆改——两条路径一致。
5. **存量库**：迁移在 DB 打开时执行；索引基于现有文本列即时构建，无需重抽取/重嵌入。插入代码不直接引用 `search_vector`（由触发器填充），删列不破坏写入（已核：仅 `search.ts`/`schema.sql`/生成常量引用 `search_vector`/`ts_*`）。

### 4.3 查询构造（`src/store/search.ts`，**两条路径都要改**）

`search.ts` 有两个词法入口，**别只改一个**：
- **`search()`（FTS-only，非 RRF）**：`--mode fts`、MCP `search`、HTTP API 直接消费它（`cli.ts:799`、`server/mcp.ts:254`、`server/api.ts:182`）。它把 `score: Number(row.page_rank)`（`search.ts:238`）**原样**返回给调用方。
- **`query()`（hybrid）**：FTS leg 只按**数组位次**喂 RRF（`rrfScore = 1/(RRF_K + rank + 1)`，`search.ts:279`，丢弃 SQL 分值），再叠 tier/freshness/backlink。

改法：
- `query` → `trim` → 按 `\s+` 切词 → 每词**转义 ILIKE 元字符**，转义**顺序固定**：先 `\` → `\\`，再 `%` → `\%`、`_` → `\_`，最后包 `%…%` 并作为**参数绑定**（不做字符串插值），SQL 用 `ILIKE $n ESCAPE '\'`。
- 组成 `AND`：每词 `(p.title ILIKE $n ESCAPE '\' OR p.compiled_truth ILIKE $n ESCAPE '\')`；chunk 侧对 `cc.chunk_text` 同理。
- 词内非通配字符（如 `gpt-4` 的连字符）保留，仅转义 `% _ \`。
- 排序：取相关文本列 `similarity(col, 原始未转义词)` 较大值作为该 leg 的分。
  - 在 `query()` 里：该分仅用于 leg 内排序，对 RRF 无量纲影响，安全。
  - 在 `search()` 里（**行为变化，须明确接受或缓解**）：`page_rank` 由 `ts_rank` 换成 `similarity()`，短中文查询分值落在 0.00–0.20、区分度弱。**决策：接受**召回正确优先；为避免顺序抖动，加**确定性兜底排序键**（如 `similarity DESC, updated_at DESC, slug ASC`）。验收明确 `--mode fts` 只保证**召回**，不保证打分质量。
- **必须保留的列**（RRF/boost 依赖，勿在重写 chunk 查询时丢）：`chunk_source`（`search.ts:306` 的 `COMPILED_TRUTH_BOOST` 依赖 `=== 'compiled_truth'`）、`updated_at`（freshness，`search.ts:342`）、以及 `slug/title/type/snippet/provenance`。
- 空查询、以及切词+转义后归约为空的查询，仍 `return []`（对齐 `search.ts:203,388`）。
- `MemoryFilter`（platform/source_type/channel/channel_name/participant/date 等）WHERE 条件原样保留，仅替换词法匹配那一段；与 `poolByPage`（best-chunk-per-page，Spec 7）兼容。

### 4.4 高亮 / snippet
失去 `ts_headline` → 实现 `buildSnippet(text, terms, window=40)`：以**原始未转义词**、**大小写不敏感**地定位首个命中位置，前后各取 `window` 字（默认 40）切片；命中靠近首尾时裁剪边界。**保持现有 `**…**` 高亮标记约定**（`ts_headline` 的 StartSel/StopSel 当前是 `**`，下游 `highlights:[snippet]` 与 UI 依赖它）。页面侧高亮 `compiled_truth`、chunk 侧高亮 `chunk_text`。

### 4.5 边界与错误处理
- 单字/双字中文查询（`回`/`认`/`中间`）：**召回正确**（ILIKE 子串），但 **< 3 字符无法用 trgm 索引**（trigram 最小 3-gram），会走 recheck/seqscan。这是 trgm 固有限制：1–2 字查询**正确但不走索引**，大库上可能慢。明确记录，不在本 spec 内优化。
- 仅转义通配符，保留连字符等 term 内字符。
- 混合中英查询走同一 AND 子串逻辑。
- 转义实现先处理反斜杠自身（见 §4.3 顺序）。

## 5. 测试（TDD：先写测试）

1. **查询构造单测**：切词、通配符转义（`\`→`\\` 先、再 `%`/`_`，顺序断言）、AND 组装、空查询/归约为空、混合中英。
2. **中文召回端到端**：`认证中间件`/`中间件`/`回滚`/`数据库选型` 必中（覆盖此前全 0 的回归）；覆盖 `query()` 与 `search()` 两条路径。
3. **英文不回归**：`JWT token`、`gpt-4` 仍按预期召回；`search()` 路径断言确定性兜底排序键稳定。
4. **保列回归**：断言 chunk 查询仍返回 `chunk_source`/`updated_at`，且 `compiled_truth` boost 与 freshness 仍生效。
5. **迁移幂等 + 存量升级**：在**写入了真实 `search_vector` 数据**的库上跑迁移 → 经 `information_schema`/`pg_trigger`/`pg_proc`/`pg_indexes` 断言列/触发器/函数/旧索引全被清、trgm 索引建成、可重复执行不报错。**同步更新** `migrations` 版本计数断言（现有测试断言 `[1,2,3,4]` → 改为含 m005）。
6. **索引使用守卫**：`EXPLAIN` 断言**单词与多词 AND** 的中文 `ILIKE` 都走 `Bitmap Index Scan`（多词应 BitmapAnd），防退化成 seqscan；并断言 1–2 字查询**召回正确**（不强求走索引）。
7. **扩展装载**：dev 模式 `CREATE EXTENSION pg_trgm` 成功；compiled（`$bunfs`）/sidecar 模式在 `pg_trgm.tar.gz` 已暂存时成功（smoke）。

## 6. 明确不在范围内（YAGNI）

- **语义召回失败**（"模糊描述召不回"）：属嵌入完整性（#2）+ RRF 权重，单独成 spec，本 spec 不碰。
- RRF 权重 / `poolByPage` 调参不动。
- 不做无关重构。

## 7. 实施注记

- 本 spec 已基于最新 `origin/main`（`adb6361`），实现分支 `claude/repo-status-background-agzw08` 已 fast-forward 到该提交。
- 实现遵循 superpowers `writing-plans` → `test-driven-development` → `verification-before-completion`。
- **已过一轮子代理对照源码的对抗式审查**（2026-06-23）。已修订项：生成常量路径（`src/embedded-assets.generated.ts`，非 `src/store/`）、`gen:assets` 命令、分发路径与资产暂存（`build-sidecar.mjs`，非 `gen/post-build`）、compiled 分支需手工加 `pg_trgm` blob、`search()` 非 RRF 路径打分回归、保留 `chunk_source`/`updated_at`、转义顺序、`buildSnippet` 大小写与 `**` 标记、1–2 字查询不走索引、多词索引守卫、迁移版本计数。审查全文见 `specs/reviews/`（如归档）。

## 8. 验收标准

- `memoark search --mode fts "认证中间件"` 在含该短语的记忆上能**召回**（当前为空）；`--mode fts` 只保证召回，打分/排序质量不在验收内（见 §4.3）。
- `query()` 混合检索对上述中文查询能召回并合理排序。
- 全量测试通过；新增：中文召回（双路径）、保列回归、迁移幂等（真实数据 + 版本计数）、单/多词索引守卫、扩展装载 smoke。
- 全新库与迁移后存量库结构一致；dev/npx 路径加载 `pg_trgm`（无需 tar），compiled/sidecar 路径 `pg_trgm.tar.gz` 已暂存并可 `CREATE EXTENSION`。
