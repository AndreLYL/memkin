# Spec: 提取管道性能优化

**日期**：2026-06-09  
**状态**：待实测验证后实施  
**目标**：200 封邮件首次全量提取时间从 ~30 分钟压缩到 ~5 分钟；增量运行（10-30 封）< 60 秒

---

## 一、背景与当前状态

### 产品定位

Memoark 是本地优先、后台自托管的 AI 记忆系统。提取分两种模式：

- **首次全量**：用户定义时间区间，一次性跑完历史数据，可接受分钟级耗时
- **增量后台**：Scheduler 定时触发，静默运行，低资源占用，目标 < 60 秒/次

### 经代码分析确认的事实

| 结论 | 依据 | 置信度 |
|------|------|------|
| LLM 调用已有 CONCURRENCY=5 并发 | `pipeline.ts:226` | ✅ 确认 |
| MailSource 对每封邮件单独调用一次 `execShortcut` | `mail.ts:45` | ✅ 确认 |
| `execShortcut` 是无状态的，每次调 `execFile` 启动新子进程 | `lark-cli-client.ts:70-73` | ✅ 确认 |
| `rechunk()` 对每个 chunk 执行 1 次 INSERT，末尾 1 次 DELETE | `chunks.ts:40-61` | ✅ 确认 |
| 1000 词邮件约 4 个 chunk → `rechunk()` = 5 次 DB 查询 | 计算（CHUNK_SIZE=300, OVERLAP=50） | ✅ 确认 |
| PGLite 单次查询延迟约 0.1–1ms | PGLite 文档 + 架构特性 | ✅ 确认 |

### 需要实测才能确认的假设

| 假设 | 为什么需要实测 | 对应验证方法 |
|------|------|------|
| 采集阶段是 30 分钟的主要来源 | 没有实测过各阶段分项耗时 | `[perf]` 日志（已加入 pipeline.ts） |
| lark-cli 支持多进程并发调用 | binary 内部可能有 auth token 文件锁或单实例守护 | `scripts/test-lark-concurrency.ts` |
| 每次 `execShortcut` 耗时 2–8 秒 | 取决于 lark-cli 启动时间 + Feishu API 延迟 | 同上 |

---

## 二、不在本次优化范围内

明确排除以下方向，避免过度设计：

| 方向 | 排除原因 |
|------|------|
| 切换数据库（PGLite → PostgreSQL） | DB 不是瓶颈；切换破坏"本地零依赖"产品定位 |
| LLM 层优化（换小模型、增大并发） | 绝对耗时仅 3 分钟；换模型有质量风险；不同 provider 速率限制差异大 |
| Pipeline 流水线化（采集与提取并行） | 架构复杂度高；方案 A 预期已足够；留到 Spec 5 评估 |
| 多 Source 并发（messages + mail 同时跑） | 次要优化；首次全量多 source 场景才有意义 |

---

## 三、优化方案设计

### Phase 0：测量基线（已完成）

**已做**：在 `pipeline.ts` 的三个阶段加入 `[perf]` 日志，输出到 stderr：

```
[perf] stage1 collect: ???s  messages=???
[perf] stage3 extract: ???s  blocks=???
[perf] stage4 write:   ???s
```

**目的**：确认时间分布，作为优化前后对比的基线。数据收到后填入此 spec。

---

### Phase 1：MailSource 并发 detail 拉取

> **实施前置条件**：`scripts/test-lark-concurrency.ts` 输出显示：  
> (a) 各并发级别无报错  
> (b) `avg_per_call` 在不同并发级别下数值稳定（误差 < 2x）  
> 若不满足，此 Phase 暂停，改为分析 lark-cli 的限制。

#### 当前行为

```typescript
// mail.ts — fetch() 主循环
for (const item of triageItems) {
  const detail = await this.fetchMessage(item.message_id);  // ← 串行
  yield this.mapMessage(item, detail);
}
```

N 封邮件 = N 次串行子进程，时间 = `N × T_single`。

#### 目标行为

```
fetchTriage()                   ← 1 次 CLI 调用，获取列表（保持串行）
     ↓
filter by time window           ← 内存操作
     ↓
fetchAllConcurrent(items, 5)    ← 最多 5 个 CLI 子进程同时运行
     ↓
yield results in order          ← 按原始顺序 yield，保持幂等
```

时间 = `⌈N/5⌉ × T_single`，理论 5x 加速。

#### 接口设计

`MailSource` 新增私有方法 `fetchAllConcurrent`，`fetch()` 的 generator 语义不变（外部调用方无感知）：

```typescript
// 不改变：
async *fetch(checkpoint, cursorStaging): AsyncGenerator<RawMessage>

// 新增：
private async fetchAllConcurrent(
  items: TriageItem[],
  concurrency: number,
): Promise<Array<{ item: TriageItem; detail: FeishuMailMessage | null }>>
```

#### 配置

在 `FeishuMailSourceConfig`（`types.ts`）新增可选字段：

```typescript
export interface FeishuMailSourceConfig {
  enabled: boolean;
  lookback_days?: number;
  overlap_ms?: number;
  fetch_concurrency?: number;  // 新增，默认 5，建议范围 1-10
}
```

用户配置示例：
```yaml
sources:
  feishu:
    sources:
      mail:
        enabled: true
        fetch_concurrency: 5  # 可选，默认 5
```

#### 错误处理

- 单封邮件 `fetchMessage` 失败 → 记录日志，跳过该封邮件，不中断整批（当前行为一致）
- 单批次中部分失败 → 收集所有结果后过滤 `null`，继续处理成功的邮件
- lark-cli 进程超时（当前 120s）→ 保持不变

#### cursor 行为

不变：`maxDateMs` 仍由所有成功处理的邮件中最大时间戳决定，确保部分失败时 cursor 保守推进。

---

### Phase 2：rechunk 批量 INSERT

> **无前置条件**，与 lark-cli 测试结果无关，可独立实施。

#### 当前行为

```typescript
// chunks.ts — 每 chunk 单独一次 INSERT
for (let i = 0; i < textChunks.length; i++) {
  await this.pg.query(`INSERT INTO content_chunks ... VALUES ($1, $2, $3, 'compiled_truth', $4)`, [...]);
}
```

N chunks = N 次串行 DB 查询。

#### 目标行为

```typescript
// 1 次 INSERT，多个 VALUES 行
await this.pg.query(
  `INSERT INTO content_chunks (page_id, chunk_index, chunk_text, chunk_source, token_count)
   VALUES ${placeholders}
   ON CONFLICT (page_id, chunk_index) DO UPDATE SET ...`,
  params
);
```

N chunks = 1 次 DB 查询。

#### 影响评估

- 对于 1000 词邮件（4 chunks）：5 次查询 → 2 次（1 INSERT + 1 DELETE）
- 绝对时间节省：`4 × ~0.5ms = 2ms` per signal — **不是主要瓶颈，但是正确的代码**
- 价值：减少 DB 往返次数，对内容更长的信号（如 knowledge、entity）效果更明显

#### 约束

- ON CONFLICT 逻辑必须与当前行为完全一致（embedding 清空逻辑保留）
- 必须保留末尾的 DELETE 清理过时 chunk 的逻辑
- PGLite 参数上限：单次 query 参数不超过 65535（PostgreSQL 限制），每 chunk 4 个参数，支持最多 ~16000 chunks/次，实际不会触到

---

### Phase 3：block_concurrency 可配置

#### 当前行为

`pipeline.ts:226` 硬编码 `const CONCURRENCY = 5`。

#### 目标

在 `memoark.yaml` 中暴露为可配置项：

```typescript
// config.ts
export interface PipelineConfig {
  block_concurrency?: number;  // 默认 5，首次全量可设更高
}
```

```yaml
# memoark.yaml
pipeline:
  block_concurrency: 5        # 后台增量：保守值
  # block_concurrency: 10     # 首次全量：可调高（需确认 LLM provider 速率限制）
```

**注意**：提高此值有触发 API 速率限制的风险，文档里须注明。

---

## 四、预期效果（待实测数据填充）

| 阶段 | 当前（推算） | 优化后（推算） | 实测前基线 | 实测后结果 |
|------|------|------|------|------|
| stage1 collect | ~23 分钟 | ~5 分钟（5x） | 待填 | 待填 |
| stage3 extract | ~3 分钟 | ~3 分钟（不变） | 待填 | 待填 |
| stage4 write | ~1 分钟 | ~10 秒 | 待填 | 待填 |
| **总计** | **~30 分钟** | **~8 分钟** | 待填 | 待填 |

---

## 五、测试策略

### 单元测试

**Phase 1**：`tests/collectors/feishu/sources/mail.test.ts`  
- `fetchAllConcurrent` 正确聚合所有结果
- 单封邮件失败时，其余邮件正常处理
- 结果按原始 triage 顺序排列（cursor 行为不变）
- `maxDateMs` 只基于成功的邮件计算

**Phase 2**：`tests/store/chunks.test.ts`  
- 批量 INSERT 结果与原逐条 INSERT 完全一致
- ON CONFLICT embedding 清空逻辑正确
- DELETE 清理过时 chunk 逻辑正确

### 集成验证

在用户本地运行后，对比 `[perf]` 日志：
```
# 优化前
[perf] stage1 collect: ???s  messages=200

# 优化后
[perf] stage1 collect: ???s  messages=200  ← 预期降低 ~80%
```

### 回归检查

- `bun run typecheck` 通过
- `bunx biome check` 通过
- 全量测试通过
- 手动验证：提取 10 封邮件，确认信号内容与优化前一致

---

## 六、实施顺序

```
Phase 0: 基线测量（已完成）
    ↓
[等待用户实测数据]
    ↓ 数据确认"采集是主瓶颈" + lark-cli 并发安全
Phase 1: MailSource 并发拉取     ← 主要收益
    ↓
Phase 2: rechunk 批量 INSERT     ← 可并行，任意顺序
    ↓
Phase 3: block_concurrency 可配置 ← 最后，用户自行调整
```

Phase 2 和 Phase 3 不依赖实测数据，可与 Phase 1 同步实施。

---

## 七、不做的决策记录

以下是明确评估后决定不做的事项，避免未来重复讨论：

1. **不换数据库**：PGLite 不是瓶颈，切换代价远大于收益
2. **不优化 LLM 层**：已有 CONCURRENCY=5，绝对耗时仅 3 分钟，质量风险不可接受
3. **不做 pipeline 流水线化**：复杂度高，Phase 1 后评估是否还有必要
4. **不做 Source 间并发**（messages + mail 并行）：当前不是主要使用场景

---

*本 spec 基于 2026-06-09 代码分析，部分数据（标注"待填"）需用户本地实测后补充。*
