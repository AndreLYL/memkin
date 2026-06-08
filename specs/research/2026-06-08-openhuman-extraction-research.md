# OpenHuman 提取架构调研报告

**日期**：2026-06-08  
**调研目标**：学习 [tinyhumansai/openhuman](https://github.com/tinyhumansai/openhuman) 的邮件/数据提取机制，为 Memoark 提取管道性能优化提供参考  
**结论**：OpenHuman 的核心优化是 **有界并发提取**（bounded concurrent fetch），Memoark 当前是严格串行，存在系统性性能差距

---

## 一、OpenHuman 架构概要

### 技术栈
- **语言**：Rust（62%）+ TypeScript（34%）
- **运行时**：Tauri 桌面应用
- **存储**：本地 SQLite + Obsidian Markdown 文件（Memory Tree）
- **第三方集成**：通过 Composio OAuth connector layer（118+ 集成）

### 数据管道整体流程
```
连接配置（OAuth）
    ↓
auto-fetch 定时触发（每 20 分钟）
    ↓
reader.list_items()      ← 串行，获取列表
    ↓
for_each_concurrent(10)  ← 并发=10，处理每个 item
  ├─ reader.read_item()        ← 并发拉取 detail
  └─ ingest_document_with_scope()  ← 并发写入 Memory Tree
    ↓
check_and_rebuild_tree()     ← 条件性触发
    ↓
auto_snapshot_after_sync()   ← 快照
```

### 关键代码模式（`src/openhuman/memory_sources/sync.rs`）
```rust
// 常量：有界并发数
const SYNC_CONCURRENCY: usize = 10;

// 主同步逻辑
stream::iter(items.iter().enumerate())
    .for_each_concurrent(SYNC_CONCURRENCY, |(i, item)| async move {
        let detail = reader.read_item(&source, &item.id, &config).await;
        ingest_document_with_scope(detail, composite_source_id).await;
        ingested.fetch_add(1, Ordering::Relaxed);
    })
    .await;
```

---

## 二、Memoark 当前提取的串行问题

### MailSource 串行流程（`src/collectors/feishu/sources/mail.ts`）
```typescript
async *fetch(checkpoint, cursorStaging) {
  const triageItems = await this.fetchTriage();    // 1次 CLI 调用

  for (const item of triageItems) {
    // ↓ 每封邮件单独一次 CLI 进程，串行 await
    const detail = await this.fetchMessage(item.message_id);
    yield this.mapMessage(item, detail);
  }
}
```

**时间复杂度**：`O(N)` 串行，`N × T_single`（每次 CLI 启动 + 邮件拉取延迟）

### 其他 Source 的相似问题
MessageSource / DMSource 等 HTTP Source 也存在逐条请求的模式，虽然用了 token bucket 限流，但没有并发化 detail 拉取。

### Scheduler 未启动（已修复 2026-06-08）
`memoark serve` 从未实例化 Scheduler，auto-fetch 完全不可用。已在 `fix/feishu-mail-scheduler` 分支修复。

---

## 三、性能差距量化

| 指标 | Memoark（当前） | OpenHuman |
|------|--------------|-----------|
| detail 拉取方式 | 严格串行 | 有界并发（concurrency=10）|
| 100 封邮件耗时（假设单次 500ms） | ~50 秒 | ~5 秒 |
| 并发控制 | 无 | `for_each_concurrent(N)` |
| 背压（backpressure） | 无（生产者=消费者串行） | stream 自动背压 |
| build-blocks 并发 | 无（generator 串行消费） | list+detail+ingest 全并发 |

---

## 四、Memoark 优化路径（参考 OpenHuman）

### Phase 1：MailSource 并发 detail 拉取（最小改动，立竿见影）

```typescript
// 替换 for...await 串行为批量并发
private async fetchAllConcurrent(
  items: TriageItem[],
  concurrency = 5,
): Promise<Array<{ item: TriageItem; detail: FeishuMailMessage | null }>> {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (item) => ({
        item,
        detail: await this.fetchMessage(item.message_id),
      }))
    );
    results.push(...batchResults);
  }
  return results;
}
```

**预期提升**：5× 速度（concurrency=5），适合 CLI 进程并发安全前提下。

### Phase 2：HTTP Source 并发（MessageSource / DMSource）

在已有 token bucket rate limiter 基础上，将 detail 拉取改为 `Promise.all` + 并发窗口，利用 rate limiter 作为背压控制。

```typescript
// 使用 p-limit 或手写 sliding window
const CONCURRENT_REQUESTS = 3; // 配合 rate_limit_qps=50
```

### Phase 3：管道级并发（最激进，参考 OpenHuman 的 list+fetch+ingest 全并发）

目前 pipeline 对 generator 是串行消费（一条 yield → 一条 extract → 一条 write）。改造为：
- 将 collector.fetch() 产出的 RawMessage 放入队列
- 多个 extractor worker 并发消费队列
- 写入 store 可并发（PGlite 支持并发写）

**预期提升**：整体 pipeline 吞吐量提升 5-10×，在消息量大（>500 条/次）时效果显著。

---

## 五、实施优先级建议

| 优先级 | 任务 | 工作量 | 收益 |
|------|------|------|------|
| P0 | Scheduler 集成到 serve（已修复） | 已完成 | auto-fetch 可用 |
| P1 | MailSource 并发 detail 拉取 | 小（~50行） | 5× mail 提取速度 |
| P2 | HTTP Source 并发化（Message/DM） | 中（需配合 rate limiter） | 3× HTTP 提取速度 |
| P3 | Pipeline 级并发消费 | 大（架构改动） | 5-10× 整体吞吐 |
| P4 | 渐进式 yield（stream 背压） | 大 | 内存占用降低 |

---

## 六、参考资料

- [OpenHuman GitHub](https://github.com/tinyhumansai/openhuman)
- [OpenHuman 文档](https://tinyhumans.gitbook.io/openhuman)
- OpenHuman sync.rs: `src/openhuman/memory_sources/sync.rs`（`SYNC_CONCURRENCY = 10`，`for_each_concurrent`）
