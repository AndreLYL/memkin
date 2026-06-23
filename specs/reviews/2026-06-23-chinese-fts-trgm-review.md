# Spec Review: Chinese FTS via pg_trgm

- **日期**: 2026-06-23
- **被审 spec**: `specs/2026-06-23-chinese-fts-trgm.md`
- **方式**: 子代理对照 `/home/user/memoark` 源码的对抗式审查；关键项已由主代理复核。
- **结论**: needs-rework → **已按下列修订，现为 ready-with-fixes**。

## Blockers（已修）

- **B1 生成常量路径错误**：spec 写 `src/store/embedded-assets.generated.ts`，实际为 **`src/embedded-assets.generated.ts`**（`gen-embedded-assets.mjs:14` 生成、`database.ts:2` 引用）；命令应为 `bun run gen:assets`（非 `npm`）。→ §4.2.3 已改。
- **B2 资产暂存机制张冠李戴 + "npx 二进制"错判**：`vector.tar.gz` 实由 **`build-sidecar.mjs:20-21`** 暂存，非 `gen-embedded-assets`/`post-build`。`npx memoark` 跑 Node/Bun（非 `$bunfs`）→ 走 dev 分支，**无需 tar**，只需把 `pg_trgm` 加进 dev `extensions`。真正需要 explicit-blob 的只有 `npm run compile`（`$bunfs`）与 Tauri sidecar。→ §4.2.1 重写。
- **B3 compiled 分支对称性遗漏**：`pglite-assets.ts:40-47` 手工构造 `vector` blob；`pg_trgm` 须**同样手工新增**一个带 `bundlePath` 的扩展对象。→ §4.2.1 已明确。

## Should-fix（已修）

- **S1 扩展/索引顺序**：`CREATE EXTENSION pg_trgm` 须在任何 `gin_trgm_ops` 索引之前（schema.sql 与迁移皆是）。→ §4.2.2/§4.2.3。
- **S2 保留列**：重写 chunk 查询须保留 `chunk_source`（`COMPILED_TRUTH_BOOST`，`search.ts:306`）与 `updated_at`（freshness，`search.ts:342`）。→ §4.3 + 测试 4。
- **S3 非 RRF 路径打分回归**：`search()`（`--mode fts`/MCP/API）把 `page_rank` 原样当 score 返回（`search.ts:238`）；`ts_rank`→`similarity()` 使短中文查询分值近 0、排序弱。→ §4.3 决策：接受召回优先 + 确定性兜底排序键；§8 限定 `--mode fts` 只保证召回。
- **S4 snippet**：`buildSnippet` 须大小写不敏感、按原始未转义词定位、保留 `**` 高亮标记。→ §4.4。
- **S5 多词/短词索引**：多词 AND 的 EXPLAIN 守卫；1–2 字（< 3-gram）查询**正确但不走索引**，明确记录。→ §4.5 + 测试 6。
- **S6 转义顺序**：先 `\`→`\\`，再 `%`/`_`，参数化绑定。→ §4.3 + 测试 1。

## Nice-to-have

- **N1 迁移测试版本计数**：现有断言 `[1,2,3,4]` 须更新含 m005。→ 测试 5。
- 其余（dim-change 与 trgm 索引互不影响、空查询短路）已确认无碍。

## 审查确认无误的部分

- 核心诊断准确：`search.ts:197/382` `split(/\s+/)` 喂 `to_tsquery('simple')`；schema 触发器 83-118 用 `to_tsvector('simple')` → 中文塌成单一巨型词元。
- `pg_trgm.tar.gz` 确在 PGLite 0.4.6 dist；"无需重抽取/重嵌入"成立。
- RRF 按位次融合（`search.ts:279`）→ hybrid 路径 `similarity()` 排序可接受。
- 删 `search_vector` 写安全：仅 `search.ts`/`schema.sql`/生成常量引用，插入路径不碰。
