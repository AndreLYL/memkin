# Spec 10: 检索质量（借鉴消化）

**日期**：2026-06-22
**状态**：📝 待审查
**依赖**：Spec 7（best-chunk 池化的开关已在 Spec 7 引入，本 spec 深化）；其余建立在 `src/store/search.ts` / `src/store/graph.ts` / put_page 写入路径之上
**定位**：把 gbrain 读侧的若干工程零件消化进我们的检索栈，全部**自研 + 行为对齐**。

> gbrain 结论均 📗/📰、未核源码（见[调研 §六](research/2026-06-22-gbrain-comparison-research.md)）。本 spec 验收只测我们自己的行为。

---

## 一、背景与动机

调研 P1/P2 列出三个可借鉴零件，本 spec 落地：① best-chunk-per-page 池化（Spec 7 已对合成内启用，这里评估对 `query`/`search` 默认开）；② 写入时**零-LLM 图边**（省钱、稳定、离线）；③ **query 意图改写**（提升召回）。reranker 因依赖外部组件（ZeroEntropy），**本 spec 不引入**。

---

## 二、调研依据

- **best-chunk-per-page 池化**（📗）：每页以最强 chunk 露出。
- **自布线零-LLM typed edges**（📗）：`put_page` 时从 markdown wikilink 解析建边。
- **intent-aware query 改写**（📗）：检索前按意图重写 query。

---

## 三、best-chunk-per-page 池化对 `query`/`search` 默认开

Spec 7 §七 已实现 `poolByPage`，且**对 `query`/`search` 默认关**（零回退）。本 spec 评估**默认开**：

- 改 `src/store/search.ts` `query()`（混合检索方法，非 `hybridSearch`）默认 `poolByPage:true`。
- **语义**：把 `query()` 对同页多 chunk 的 RRF **累加(sum)** 改为默认 **取最强单 chunk(max)**（Spec 7 §七已实现该参数，默认 false；本 spec 评估翻转默认）。
- **池化单点（回应 review S10-P1-5）**：逻辑**只在 `query()` 内**；`src/synth/scope.ts` 仅传参，**不二次 reduce**，无双重池化。
- **影响**：现有对排序顺序有硬断言的测试可能变红 → 本 spec **负责审查并更新这些测试**（明确允许排序结果变化）。
- **配置（回应 S10-P1-4）**：新增 `search.pool_by_page`（默认 true，可回退），**需同步在 `src/core/config.ts` 的 Zod schema 增此字段**，否则 `memoark.yaml` 读取报错。

---

## 四、写入时零-LLM 图边（自布线）

### 4.1 现状

链接当前全部由 LLM 抽取后 `graph.addLink(slug, entity, "mentions")`（`src/adapters/store.ts`）。贵且依赖 LLM。

### 4.2 方案

新增 `src/store/wikilink.ts`。**集成点（回应 review S10-P0-1）**：在 **`src/store/pages.ts` 的 `upsertPage()` 末尾**统一调用——所有写入路径（MCP `put_page`、pipeline adapter、低层）都经 `upsertPage`，在此插入可保证全覆盖、不遗漏。**只扫 `compiled_truth`（回应 S10-P1-2）**（权威视图；`pages` 无独立 `content` 列时即正文字段），不扫历史/原始条目。

统一语法（与 Spec 11 一致，回应 S10-P0-2）：`[[slug]]` 与 `[[rel:slug]]`：

```typescript
parseWikiLinks(compiledTruth): { to: string; type: LinkType }[]
// [[entities/alice]]          → { to: "entities/alice", type: "mentions" }
// [[reports_to:entities/bob]] → { to: "entities/bob",   type: "reports_to" }
```

- 对每条解析结果 `graph.addLink(fromSlug, to, type, { provenance: { auto: "wikilink" } })`。
- **provenance 存储**：已核 `schema.sql:50` `links.provenance` 为 **`JSONB`**（回应 S10-P1-6），可直接存 `{ auto: "wikilink" }` 对象，无需序列化。
- **去重**：`links` 表 `UNIQUE(from,to,link_type)` 天然合并；`provenance.auto` 标记来源，便于与 LLM 抽边区分/审计。
- **目标缺失（回应 S10-P1-1，锁定）**：`to` slug 不存在时 **跳过**（不建占位指针——占位难清理、污染图），不报错中断写入。
- 作为 **LLM 抽边的便宜兜底/补充**，二者并存。

`type` 仅接受 `LinkType` union（`core/types.ts:109`）内的值，**已核含 `custom`（回应 S10-P2-1）**，未知 rel 归 `custom`。

---

## 五、query 意图改写

新增 `src/store/query-rewrite.ts`，在 `query()` 检索前对 query 预处理：

- **起步：规则式 + 零依赖**（回应 review S10-P1-3）——**不引入分词库**（jieba/`@node-rs/*` 在 Bun 下有 native binding 风险）。仅做：同义词/缩写扩展（可配置词表）、停用词表过滤、空白归一。CJK 检索召回已由现有 `tsvector('simple')` + 向量覆盖，分词不是起步必需。若后续确需分词，单独评估 Bun 兼容性。
- **可选：LLM 改写**——按意图扩写检索词（开关 `search.llm_rewrite`，默认关，避免每次检索烧 LLM）。
- 改写**只影响检索召回**，不改对外返回结构。

---

## 六、模块布局

```
src/store/
  search.ts        # poolByPage 默认开 + 接入 query 改写
  wikilink.ts      # parseWikiLinks + 写入后自布线（零-LLM 边）
  query-rewrite.ts # 规则式（+可选 LLM）query 改写
```

---

## 七、范围边界（Out of Scope）

- 合成引擎/池化开关首次引入 → **Spec 7**
- reranker（ZeroEntropy 等外部组件）→ 不做
- 重量级矛盾检测/salience → consolidator 后续
- LinkType union 的 playbook 专用边（part_of/precedes/…）→ **Spec 11**

---

## 八、验收标准

1. `bun test` 通过（wikilink 解析、query 改写、池化默认开后的回归）。
2. `poolByPage` 默认开：同页多 chunk 命中只取最强；**受影响的既有排序断言被审查并更新**，全绿。
3. `parseWikiLinks` 正确解析 `[[slug]]` 与 `[[rel:slug]]`；未知 rel 归 `custom`；目标不存在时跳过不报错。
4. 写入含 wikilink 的页后，`links` 表出现对应边且 `provenance.auto="wikilink"`；重复写入幂等（UNIQUE 合并）。
5. query 改写：规则式扩展可配置、可关；`search.llm_rewrite` 默认关时不调用 LLM（mock 断言 0 次调用）。
