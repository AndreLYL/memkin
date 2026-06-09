# Spec 6 — 数据抓取中心（Auto-fetch + 历史回溯）

## 目标

在 Web UI 新增 `/fetch` 页面，整合两个对称功能：

1. **Auto-fetch**：在 Web UI 中配置定时调度器（`SchedulerConfig`），替代手动编辑 YAML
2. **历史回溯**：用户通过覆盖热力时间轴选择起始日期，在后台触发飞书历史数据全量抓取，并在页面内实时查看进度

---

## 背景

### 对称关系

| | Auto-fetch | 历史回溯 |
|---|---|---|
| 方向 | 向前（增量，定时触发） | 向后（历史，手动触发） |
| 触发 | 自动，按 interval | 手动，用户选起始日期 |
| 当前 Web UI | ❌ 未暴露 | ❌ 未实现 |
| 底层实现 | `Scheduler`（已有） | `runPipeline()`（已有） |

### 现有约束

- `memoark extract` 是同步阻塞命令，无后台任务概念
- `Scheduler`（`src/daemon/scheduler.ts`）按 interval 定时触发，状态存 `scheduler-state.json`；飞书 collector 注册的 sourceId 是单个 `"feishu"`，无子源粒度
- `runPipeline()`（`src/core/pipeline.ts`）同步执行，返回 `PipelineResult`
- **cursor 优先级（关键）**：`messages`/`dm`/`mail`/`message_search` 的 `resolveStartTime` 逻辑是"有 checkpoint 就用 `last_sync_at`，否则才用 `lookbackDays`"。单靠覆盖 `lookback_days` 对用过的源无效，必须新增显式 `override_since_ms` 字段绕过 cursor。
- **仅支持时间范围回溯的源**：`messages`/`dm`/`mail`/`message_search` 有 `lookback_days`；`docs`/`tasks`/`calendar` 无此字段，不支持时间范围，不列入回溯范围。
- Spec 5 的 `/config` 设置页不含 `SchedulerConfig` 配置

### 历史回溯时间范围

**只支持 `since_ms`（左边界），右边界始终为今天。**

机制：在调用 `runPipeline()` 前，BackfillJob 构造一份临时 config，对目标子源设置 `override_since_ms = since_ms`。各子源的 `resolveStartTime` 优先检查 `override_since_ms`——如果存在且早于 `last_sync_at`，则用 `override_since_ms` 作为抓取下界，从而绕过 cursor 向历史回溯。重复数据通过 Pipeline 内置 dedup（`source_hash`）跳过，不会重写已存在记录。

`src/core/config.ts` 中需为四个子源的 config 类型新增 `override_since_ms?: number` 字段；对应 `resolveStartTime` 实现修改见"修改文件"小节。

---

## 架构

### 新增文件

```
src/server/
  backfill-job.ts       — 内存任务状态机（全局单例）
  backfill-routes.ts    — 4 条 API 路由，挂载到 createApiApp()

web/src/
  api/backfill.ts                          — 前端 API client
  pages/fetch/
    index.tsx                              — 页面主组件（两个折叠分区）
    sections/AutoFetchSection.tsx          — 调度器配置
    sections/BackfillSection.tsx           — 回溯时间轴 + 任务面板
```

### 修改文件

```
src/core/config.ts
  — 为 messages/dm/mail/message_search 的 config 接口新增 override_since_ms?: number

src/collectors/feishu/sources/messages.ts
src/collectors/feishu/sources/dm.ts
src/collectors/feishu/sources/mail.ts
src/collectors/feishu/sources/message-search.ts
  — resolveStartTime：当 opts.override_since_ms 存在且早于 checkpoint 的 last_sync_at 时，
    返回 opts.override_since_ms（使 backfill 能绕过 cursor 向历史拉取）

src/server/api.ts        — 挂载 backfill-routes
web/src/router.tsx       — 新增 /fetch 路由（Shell 内，带侧边栏）
```

### 不动

```
src/daemon/scheduler.ts  — 运行时调度逻辑，完整保留
src/core/pipeline.ts     — 完整保留
src/server/config-routes.ts — Auto-fetch 配置读写复用已有 POST /api/config
```

---

## 后端设计

### BackfillJob（`src/server/backfill-job.ts`）

```typescript
type BackfillState = "idle" | "running" | "done" | "error";

// 仅支持有 lookback_days / override_since_ms 的 4 个子源
type BackfillSourceType = "dm" | "messages" | "mail" | "message_search";

interface SourceProgress {
  source: BackfillSourceType;
  processed: number;   // runPipeline 返回的 totalMessages
  blocks: number;      // runPipeline 返回的 totalBlocks
  status: "pending" | "running" | "done" | "error" | "skipped";
  error?: string;
}

interface BackfillStatus {
  state: BackfillState;
  sources: SourceProgress[];
  started_at?: number;
  finished_at?: number;
  error?: string;
  total_messages: number;
  total_blocks: number;
}

interface BackfillOpts {
  since_ms: number;
  source_types: BackfillSourceType[];
  configPath: string;
}
```

`BackfillJob` 类：
- `start(opts: BackfillOpts): void` — 检查 state 非 running，在后台依次按 `source_types` 调用 `runPipeline()`；用 `AbortController` 支持取消；每完成一个子源更新对应 `SourceProgress`
- `cancel(): void` — 调用 `abortController.abort()`，state → `"error"`，error = `"cancelled"`
- `getStatus(): BackfillStatus` — 返回当前快照
- 单例：在 `createApiApp()` 内实例化，注入到路由

**`runPipeline()` 调用方式（每个子源单独跑）：**

```typescript
// 伪代码，BackfillJob.start() 内部逻辑
for (const srcType of opts.source_types) {
  if (abortController.signal.aborted) break;
  
  // 1. 读磁盘 config
  const config = loadConfig(opts.configPath);
  
  // 2. 构造只启用目标子源、其余子源全禁用的临时 config
  //    同时注入 override_since_ms，绕过 last_sync_at cursor
  const tempConfig = deepClone(config);
  for (const t of ALL_BACKFILL_TYPES) {
    tempConfig.sources.feishu.sources[t].enabled = (t === srcType);
  }
  tempConfig.sources.feishu.sources[srcType].override_since_ms = opts.since_ms;
  
  // 3. 运行
  updateProgress(srcType, "running");
  const result = await runPipeline(tempConfig, { source: "feishu" });
  updateProgress(srcType, result.fatal ? "error" : "done", result);
}
```

子源级隔离（每次只启用一个子源）是获得逐源进度的唯一方式；Collector 内部无进度回调，无法做到比子源更细粒度的实时更新。

### 覆盖密度（`GET /api/backfill/coverage`）

从 `timeline_entries` 按 `source = 'feishu'` 过滤（`SourceRef.platform = "feishu"`，所有飞书子源共用），按 `date`（事件发生日期，TEXT ISO-8601）以 7 天为一桶聚合，返回最近 104 周（2 年）。**注意：此图度量"时间线条目密度"而非"已抓取消息总量"**——未产生 timeline entry 的消息/邮件不计入，空白格只表示该周无时间线事件，不代表未抓取。无需新表或迁移。

```typescript
// 响应
{ buckets: Array<{ week_start: number; count: number }> }
```

### API 路由（`src/server/backfill-routes.ts`）

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/api/backfill/start` | Body: `{ since_ms: number; source_types: BackfillSourceType[] }` → 启动任务；已有任务返回 409 |
| `POST` | `/api/backfill/cancel` | 取消当前任务，幂等 |
| `GET` | `/api/backfill/status` | 返回 `BackfillStatus` |
| `GET` | `/api/backfill/coverage` | 返回时间桶密度，需 `StoreContext`（直接查 `timeline_entries`） |

`backfill-routes.ts` 导出 `createBackfillRoutes(job: BackfillJob, stores: StoreContext, configPath: string): Hono`，挂载到 `createApiApp()` 的 `app.route("/", ...)`。

---

## 前端设计

### `/fetch` 页面结构

```
web/src/pages/fetch/index.tsx
  ├── <Section title="定时抓取（Auto-fetch）">
  │     <AutoFetchSection config={config} onSave={handleSave} />
  └── <Section title="历史回溯">
        <BackfillSection />
```

`ConfigPage` 中已有 `Section` 折叠组件，`/fetch` 页直接复用相同模式（`useQuery` 读 config，`useMutation` 写 config）。

### AutoFetchSection（`sections/AutoFetchSection.tsx`）

读 `GET /api/config` 的 `scheduler` 字段，保存写 `POST /api/config`。

飞书 collector 的 scheduler sourceId 是单个 `"feishu"`（`FeishuCollector.id = "feishu"`），**不存在** `feishu_dm`/`feishu_mail` 等子源粒度键。

字段：
- Scheduler 启用开关（`scheduler.enabled`）
- 全局默认抓取间隔（`scheduler.defaults.interval_secs`，秒）
- 各 collector 独立 interval（`scheduler.sources.<sourceId>.interval_secs`，留空 = 用全局默认值）；当前注册的 sourceId 包括 `feishu`、`claude-code`、`codex`、`hermes`

保存按钮在分区右上角，调用现有 `configApi.saveConfig()`。

### BackfillSection（`sections/BackfillSection.tsx`）

#### 覆盖热力时间轴

- 横轴：最近 2 年，每格 = 1 周，共 104 格
- 颜色：`count === 0` → 浅灰（空白）；`count > 0` → 蓝色，深浅按 `count / maxCount` 线性映射
- 下方叠加一个 `<input type="range">` 单 handle 滑块，范围 0（2 年前）→ 104（今天），拖动更新起始日期显示
- 组件挂载时调用 `GET /api/backfill/coverage`，轮询间隔：仅在 state=`done` 后刷新一次
- 图例标注："时间线条目密度（飞书）"，避免用户误读空白为未抓取

#### 任务控制面板

**idle 状态：**
```
回溯起始：2024-01-15（距今约 17 个月）

数据源：[✓] 群聊消息  [✓] DM  [✓] 邮件  [✓] 消息搜索
（云文档 / 任务 / 日历不支持时间范围回溯，已隐藏）

                              [开始回溯]
```

**running 状态：**（每 2 秒轮询 `GET /api/backfill/status`）
```
■ 正在回溯... 已用时 2m 14s                              [取消]

群聊消息   ████████████████████  342 条    done
DM        ████████████████████   89 条    done
邮件       ████░░░░░░░░░░░░░░░░   67 条    running
消息搜索   ──────────────────────          pending
```

进度条宽度：`processed / maxProcessed * 100%`（各源比较最大值）。无逐消息动态行（Collector 内部无进度回调钩子）。

**done 状态：**
```
✓ 回溯完成（3m 42s）

共抓取 598 条消息 → 生成 87 个 block

                              [再次回溯]
```

**error/cancelled 状态：**
```
✗ 任务已取消

                              [重新开始]
```

#### 轮询策略

- `running` → 每 2 秒 `GET /api/backfill/status`，状态变为 `done/error` 时停止轮询
- 使用 `useEffect` + `setInterval`，组件卸载时清除
- 不使用 SSE/WebSocket（避免架构复杂化）

---

## 路由接入

`web/src/router.tsx` 在 Shell children 内新增：

```typescript
{ path: "fetch", element: <FetchPage /> }
```

放在 `timeline` 后面。`/fetch` 有侧边栏（Shell 内），与 dashboard/timeline/search 同级。

---

## 文件结构汇总

### 新增

```
src/server/
  backfill-job.ts
  backfill-routes.ts

web/src/
  api/backfill.ts
  pages/fetch/
    index.tsx
    sections/AutoFetchSection.tsx
    sections/BackfillSection.tsx
```

### 修改

```
src/core/config.ts
  — messages/dm/mail/message_search 子源 config 接口加 override_since_ms?: number

src/collectors/feishu/sources/messages.ts
src/collectors/feishu/sources/dm.ts
src/collectors/feishu/sources/mail.ts
src/collectors/feishu/sources/message-search.ts
  — resolveStartTime 逻辑：override_since_ms 存在时优先于 last_sync_at

src/server/api.ts         — 挂载 createBackfillRoutes()
web/src/router.tsx        — 新增 /fetch 路由
```

---

## 范围外（Spec 7+）

- 非飞书源（claude-code / codex / hermes）的历史回溯
- 回溯任务跨重启持久化（当前重启即 idle）
- SSE / WebSocket 实时推送（当前用轮询）
- 逐消息/逐群进度更新（需在 Collector 内加进度回调钩子）
- docs / tasks / calendar 时间范围回溯（需为这三个子源加 `override_since_ms`）
- 覆盖热力图按子源分层显示
- `until_ms` 支持（右边界限制）
