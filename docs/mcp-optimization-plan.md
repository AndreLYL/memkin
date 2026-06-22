# Memoark MCP 记忆能力层 PRD

## 1. 文档信息

| 字段 | 内容 |
| --- | --- |
| 文档名称 | Memoark MCP 记忆能力层 PRD |
| 版本 | v1.0 |
| 日期 | 2026-06-04 |
| 状态 | Draft |
| 目标读者 | 产品负责人、系统架构师、后端开发、MCP 集成开发、测试与文档维护者 |
| 相关模块 | `src/server/mcp.ts`, `src/core/types.ts`, `src/core/schemas.ts`, `src/extractors/signal-extractor.ts`, `src/store/*`, `src/adapters/store.ts`, `tests/server/*` |

## 2. 一句话定义

Memoark MCP 记忆能力层是 Memoark 面向 Agent 的稳定接口层，用统一工具、统一来源模型和统一过滤语义，把本地记忆库中的页面、时间线、图谱、标签和检索结果安全、可验证、可扩展地提供给 Claude Code、Codex、Cursor、Windsurf 等 MCP 客户端。

## 3. 背景

Memoark 的长期目标是成为本地优先的个人记忆系统。数据会持续来自飞书、微信、AI Agent 会话、邮件、会议、文档、任务等来源。Agent 需要通过 MCP 读取和写入这些记忆，但 Agent 不应理解每个数据源的 API 细节，也不应面对按平台拆分的工具面。

因此 MCP 层需要承担三个职责：

1. 将 Memoark 的统一记忆能力暴露给 Agent。
2. 隐藏数据源差异，让新增数据源进入统一来源模型。
3. 提供可描述、可验证、可限流、可恢复的工具契约。

本 PRD 规定 MCP 记忆能力层的目标形态、核心设计、数据模型、工具体系、交付要求和分阶段开发计划。

## 4. 产品目标

### 4.1 用户目标

面向使用 Agent 的用户，MCP 记忆能力层需要支持：

- 用自然语言回忆跨来源记忆。
- 用关键词精确查找页面、决策、任务和知识。
- 读取某个实体、项目、人物或决策的完整上下文。
- 按平台、来源类型、会话、参与人、时间范围筛选记忆。
- 让 Agent 写入新记忆、追加时间线、维护标签和关系。
- 让 Agent 在错误输入时能自我恢复，例如 slug 不存在时知道先查询正确 slug。
- 控制返回规模，避免一次调用返回过多内容。
- 保留来源证明，让 Agent 可以说明信息来自哪里。

### 4.2 产品目标

MCP 记忆能力层需要达成：

- 工具面稳定：新增数据源不引起 MCP 工具名膨胀。
- 来源模型统一：飞书、微信、Agent 会话、邮件、文档等都映射为统一 `SourceRef`。
- 检索过滤统一：`query`、`search`、`timeline_feed`、`get_page_context` 复用同一套来源过滤参数。
- 工具契约完整：每个工具有 title、description、inputSchema、参数说明、返回说明和错误语义。
- 返回契约稳定：核心工具先提供稳定 JSON 文本返回和错误结构，增强阶段再提供 `structuredContent` 和 `outputSchema`。
- 错误可恢复：错误包含 code、message、suggestion。
- 本地优先：默认 stdio MCP，远程能力按阶段单独设计。
- 可评估：建立 MCP eval，用真实任务验证工具选择、调用次数、过滤准确率和错误恢复能力。

### 4.3 工程目标

- `SourceRef` TypeScript interface 与 `SourceRefSchema` 保持字段一致。
- `buildSourceRef` 生成完整通用 provenance。
- Store 层保存页面、关系、时间线时不丢失 provenance。
- Search 层支持 SQL 级别来源过滤，避免先召回再过滤导致漏结果。
- MCP 层不出现普通检索类 source-specific 工具。
- 测试覆盖 MCP client 视角的 `listTools`、`callTool`、错误返回、结构化返回和过滤行为。
- 构建产物与源码一致，`memoark serve --mcp` 实际运行路径可验证。
- MCP server version 与 package version 对齐，工具契约变化进入 CHANGELOG。

## 5. 非目标

以下内容不纳入本 PRD 的短期交付：

- 不实现微信、飞书等具体 collector 的完整采集逻辑。
- 不实现远程多用户权限系统。
- 不默认开放公网 MCP 服务。
- 不设计按数据源命名的普通检索工具。
- 不把 MCP 层变成数据源 API 聚合层。
- 不要求所有 MCP 客户端都自动使用 Resources 或 Prompts。
- 不重构 Memoark 全部存储模型；优先通过 JSONB provenance 和通用 filter 演进。

## 6. 核心原则

### 6.1 记忆能力优先

MCP 工具按“Agent 要完成的记忆任务”设计，而不是按底层数据库表、REST API 或数据源设计。

推荐工具方向：

- `query`
- `search`
- `get_page_context`
- `timeline_feed`
- `explore_graph`
- `put_page`
- `add_timeline_entry`
- `manage_links`
- `manage_tags`

不推荐普通检索场景出现：

- `query_wechat`
- `search_feishu`
- `get_feishu_message`
- `get_wechat_chat`

判断标准：

- 如果只是“数据从哪里来”，使用 filter 和 provenance。
- 如果是“Agent 能做什么新动作”，再考虑新增工具。

### 6.2 数据源解耦

新增数据源必须通过以下路径进入 Memoark：

```mermaid
flowchart LR
  A["Data Sources"] --> B["Collectors"]
  B --> C["RawMessage / ConversationBlock"]
  C --> D["Canonicalize / Privacy / Dedup"]
  D --> E["Signal Extractor"]
  E --> F["Store: pages / chunks / links / tags / timeline"]
  F --> G["Search / Graph / Timeline APIs"]
  G --> H["MCP Memory Capability Layer"]
  H --> I["Agents"]
```

数据源差异只允许存在于：

- collector
- source-specific metadata
- source normalization
- provenance
- query filters

Agent-facing MCP 工具名保持稳定。

### 6.3 Provenance First

所有由数据源产生的记忆都必须保留来源证明。

来源证明至少回答：

- 来自哪个平台？
- 来自哪类来源？
- 来自哪个会话、文档、邮件或 Agent session？
- 发生在什么时候？
- 涉及哪些参与人？
- 对应哪些外部 ID？
- 证据摘录是什么？

### 6.4 契约优先

工具描述、参数 schema、返回 schema 和错误结构就是 Agent 使用 MCP 的产品说明。

每个工具至少需要：

- `title`
- `description`
- `inputSchema`
- 参数 `.describe(...)`
- 默认值和最大值说明
- 返回结构说明
- 错误码与恢复建议

核心工具还需要：

- 简洁文本摘要 `content`
- 稳定 JSON 文本返回
- 增强阶段可追加 `structuredContent`
- 增强阶段可追加 `outputSchema`

### 6.5 有界返回

所有列表、搜索、图谱、时间线和 chunk 返回都必须有默认限制和最大限制。

建议默认：

| 类别 | default | max |
| --- | ---: | ---: |
| 搜索结果 | 20 | 50 |
| 页面列表 | 20 | 100 |
| links/backlinks | 50 | 200 |
| chunks | 20 | 100 |
| timeline | 20 | 100 |
| graph depth | 2 | 5 |
| graph nodes | 50 | 200 |

### 6.6 本地优先

默认 MCP transport 为 stdio，适配本地 Agent。远程 Streamable HTTP、认证、权限和 Origin 校验作为后续阶段单独交付。

## 7. 用户角色与使用场景

### 7.1 用户角色

| 角色 | 诉求 |
| --- | --- |
| 个人用户 | 让 Agent 理解自己的历史上下文、项目进展和沟通记录 |
| 开发者 | 在新 Agent 会话里快速恢复项目上下文 |
| 系统架构师 | 维护稳定的数据源接入边界和 MCP 工具契约 |
| Agent | 通过工具查询、读取、写入、整理记忆 |
| 前端/客户端 | 通过 MCP Resources 或 API 展示页面和时间线 |

### 7.2 核心使用场景

| 场景 | 用户表达 | MCP 能力 |
| --- | --- | --- |
| 跨来源回忆 | “我最近和张三讨论过 Memoark 部署吗？” | `query` + participant filter |
| 精确搜索 | “搜索 JWT token 相关决策” | `search` |
| 限定平台 | “只查微信里关于部署的问题” | `query` + `platform=wechat` |
| 限定来源类型 | “只看飞书群聊里的项目决策” | `query` + `platform=feishu` + `source_type=group` |
| 项目接手 | “memoark 现在进展如何？” | `query` + `get_page_context` |
| 时间线回顾 | “过去 7 天发生了什么？” | `timeline_feed` |
| 图谱探索 | “auth-system 依赖哪些工具？” | `explore_graph` |
| 写入记忆 | “记一下今天决定使用 PGLite” | `put_page` 或 `add_timeline_entry` |
| 关系维护 | “把 Alice 和 Memoark 标记为 works_on” | `manage_links` |
| 标签维护 | “给这个页面加 architecture 标签” | `manage_tags` |

## 8. 核心概念

### 8.1 RawMessage

collector 输出的最小消息单元。

```ts
export interface RawMessage {
  platform: string;
  channel: string;
  contact: string;
  timestamp: string;
  content: string;
  direction: "sent" | "received";
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];
}
```

设计要求：

- `platform` 使用稳定平台 ID，例如 `feishu`、`wechat`、`codex`。
- `channel` 使用稳定 channel 命名规范。
- source-specific 字段放入 `metadata`。
- 不在 MCP 工具层直接暴露 RawMessage。

### 8.2 ConversationBlock

由同一平台、同一 channel、相近时间范围内的 RawMessage 聚合而成。

```ts
export interface ConversationBlock {
  block_id: string;
  platform: string;
  channel: string;
  thread_id?: string;
  messages: RawMessage[];
  start_time: string;
  end_time: string;
  participants: string[];
  token_count: number;
}
```

设计要求：

- block 是 signal extractor 的输入。
- block 必须可生成稳定 `SourceRef`。
- block 不直接暴露给 Agent。

### 8.3 SourceRef v2

Memoark 的统一来源证明模型。

```ts
export type SourceType =
  | "dm"
  | "group"
  | "email"
  | "document"
  | "calendar"
  | "task"
  | "agent_session"
  | "meeting"
  | "structured"
  | "chat"
  | string;

export interface SourceParticipant {
  id?: string;
  name: string;
  role?: "author" | "sender" | "recipient" | "participant";
}

export interface SourceRefCore {
  platform: string;
  channel: string;
  timestamp: string;
  raw_hash: string;
  quote: string;
}

export interface SourceRef extends SourceRefCore {
  source_type?: SourceType;
  channel_name?: string;

  start_time?: string;
  end_time?: string;

  external_id?: string;
  message_id?: string;
  message_ids?: string[];
  thread_id?: string;
  conversation_id?: string;

  author?: SourceParticipant;
  participants?: SourceParticipant[];

  account_id?: string;
  tenant_id?: string;

  file_path?: string;
  line_range?: { start: number; end: number };
  attachment_id?: string;
  url?: string;

  sensitivity?: "normal" | "high";

  metadata?: Record<string, unknown>;
}
```

分层原则：

- `SourceRefCore` 是所有 collector 必须提供或由 pipeline 必须补齐的最小来源证明。
- `SourceRef` 扩展字段按来源能力补充，没有值时不写入 JSONB。
- 禁止把 `undefined` 存入 provenance。
- 默认不写入 `null`；只有当业务需要区分 “明确为空” 与 “未知” 时才允许写入 `null`。
- Agent-facing 返回应使用 compact provenance，只返回有值字段。

字段说明：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| `platform` | 数据来源平台 | `wechat`, `feishu`, `codex` |
| `source_type` | 来源类型 | `dm`, `group`, `document`, `agent_session` |
| `channel` | 稳定 channel id | `dm/wechat/wxid_xxx` |
| `channel_name` | 用户可读 channel 名 | `张三`, `产品评审群` |
| `timestamp` | 代表性时间 | `2026-06-04T10:00:00.000Z` |
| `start_time/end_time` | block 时间范围 | 一段会话或会议的起止时间 |
| `external_id` | 外部系统对象 id | 飞书文档 token、微信消息 id |
| `message_id/message_ids` | 消息 id | 单条或多条消息 |
| `thread_id` | 线程 id | 邮件 thread、Agent session thread |
| `conversation_id` | 会话 id | 微信 chatroom、飞书 chat |
| `author` | 主要作者或说话人 | `张三` |
| `participants` | 参与人 | 私聊双方、群聊发言人 |
| `sensitivity` | 敏感度 | 私聊可为 `high` |
| `raw_hash` | 来源稳定 hash | 用于去重和追踪 |
| `quote` | 证据摘录 | 原文摘录 |
| `metadata` | source-specific escape hatch | 平台原始类型、租户字段等 |

### 8.4 MemoryFilter

所有读取型 MCP 工具共享的来源过滤模型。

```ts
export interface MemoryFilter {
  platform?: string | string[];
  source_type?: string | string[];
  channel?: string;
  channel_name?: string;
  participant?: string;
  from?: string;
  to?: string;
  type?: string[];
  exclude_types?: string[];
  limit?: number;
}
```

设计要求：

- `query`、`search`、`timeline_feed`、`get_page_context` 复用同一套过滤语义。
- `platform` 与 `source_type` 支持单值或数组。
- `from/to` 使用 ISO date 或 ISO datetime。
- `participant` 先支持名称匹配，后续可扩展为 id 匹配。
- `limit` 必须 clamp 到工具允许的最大值。

## 9. channel 命名规范

新数据源必须使用可读、稳定、带类型前缀的 channel。

| 来源 | channel 示例 |
| --- | --- |
| 微信私聊 | `dm/wechat/{wxid}` |
| 微信群聊 | `group/wechat/{chatroom_id}` |
| 飞书私聊 | `dm/feishu/{chat_id}` |
| 飞书群聊 | `group/feishu/{chat_id}` |
| 飞书邮件 | `mail/feishu/INBOX` |
| 飞书文档 | `docs/feishu/{doc_token}` |
| 飞书日历 | `calendar/feishu/{calendar_id}` |
| 飞书任务 | `task/feishu/{task_id}` |
| Codex 会话 | `agent/codex/{session_id}` |
| Claude Code 会话 | `agent/claude-code/{session_id}` |

兼容要求：

- 已写入的旧 channel 格式继续可读。
- 新 collector 优先使用新规范。
- 查询过滤必须兼容旧格式和新格式。
- 格式迁移若需要批量改历史数据，单独立迁移任务。

## 10. 功能需求

### FR-1：SourceRef v2

系统必须定义统一 `SourceRef` v2，覆盖跨来源检索所需字段。

交付要求：

- `src/core/types.ts` 新增 `SourceRefCore`。
- `src/core/types.ts` 扩展 `SourceRef`。
- 新增 `SourceParticipant`。
- `SourceType` 覆盖主流来源类型并允许字符串扩展。
- 不新增平台专属顶层字段，例如 `wechat_chat_id`、`feishu_tenant_key`。
- 平台专属字段放入 `metadata`。
- provenance 写入前执行 compact，移除 `undefined` 和无业务语义的 `null`。

验收标准：

- TypeScript 编译通过。
- `SourceRefCore` 的 5 个字段为必填：`platform/channel/timestamp/raw_hash/quote`。
- 微信 mock、飞书 mock、Agent session mock 均能表达为 `SourceRef`。
- 保存到 JSONB 的 provenance 不包含 `undefined` 字段。

### FR-2：SourceRefSchema 对齐

运行时 schema 必须与 TypeScript interface 对齐。

交付要求：

- `src/core/schemas.ts` 新增 `SourceParticipantSchema`。
- `SourceRefCoreSchema` 强校验核心字段。
- `SourceRefSchema` 在 core 基础上覆盖扩展字段。
- 为 legacy source 保留默认值。
- 添加 core schema parity 测试。
- 扩展字段按来源场景测试，不要求每个 source 都填满所有可选字段。

验收标准：

- 缺少 core 必填字段时 parse 失败，legacy 兼容字段除外。
- 含 `source_type/channel_name/message_ids/participants/metadata` 的 source parse 成功。
- 缺少 `raw_hash/quote` 的 legacy source 可被默认填充。
- schema 测试覆盖新增字段。

### FR-3：buildSourceRef 写入通用 provenance

signal extractor 必须为每个 block 生成完整通用 provenance。

交付要求：

- `buildSourceRef` 写入：
  - `platform`
  - `source_type`
  - `channel`
  - `channel_name`
  - `timestamp`
  - `start_time`
  - `end_time`
  - `thread_id`
  - `conversation_id`
  - `message_ids`
  - `participants`
  - `author`
  - `sensitivity`
  - `raw_hash`
  - `metadata`
- `stampSourceRefs` 保留 LLM 输出的 `quote`。
- 单个 signal 若提供更具体的 `message_id`、`url`、`quote`，允许覆盖 canonical 的空值。

验收标准：

- 飞书 DM block 输出 `source_type=dm`。
- 微信 mock block 输出 `platform=wechat` 且包含参与人。
- Agent session block 输出 `source_type=agent_session`。

### FR-4：Store provenance 保存

StoreAdapter 写入页面、关系、时间线时必须保留来源证明。

交付要求：

- page frontmatter 保留 `source` 或 `first_seen`。
- link 写入 `provenance`。
- timeline entry 写入 `provenance`。
- MCP 返回时统一映射为 `provenance` 字段。
- legacy display 字段不作为 Agent-facing 主契约。

验收标准：

- 写入 decision/task/knowledge 后，page frontmatter 能读取完整 source。
- 写入 link 后，link provenance 保留 v2 字段。
- 写入 timeline 后，timeline provenance 保留 v2 字段。

### FR-5：统一来源过滤

搜索、语义查询、时间线和页面上下文必须支持同一套来源过滤。

交付要求：

- 定义 `MemoryFilter` 或等价共享类型。
- `SearchEngine.search` 支持 `platform/source_type/channel/channel_name/participant/from/to/type/exclude_types/limit`。
- `SearchEngine.query` 支持同样字段。
- `timeline_feed` 支持同样字段。
- `get_page_context` 对内部 links/timeline/chunks 应用 limit。
- `participant` 过滤第一版使用 provenance JSONB 和 exact display name，不承诺跨平台身份归一。

验收标准：

- 同一数据库内混合写入微信和飞书页面，`platform=wechat` 只返回微信结果。
- `source_type=dm` 只返回私聊结果。
- `participant=张三` 返回相关页面。
- `from/to` 限定时间范围。
- `query` 与 `search` 对 filter 的行为一致。

#### participant 过滤技术方案

`participant` 过滤分三阶段演进。

Phase 1 MVP 使用 JSONB 查询：

- 查询 `frontmatter.source.participants`。
- 查询 `frontmatter.first_seen.participants`。
- 支持 exact display name。
- 必要时 fallback 到 `compiled_truth ILIKE`。
- 不承诺飞书名、微信名、Agent 会话名之间的身份归一。

后续增强一：新增 `page_participants` 关联表。

```sql
CREATE TABLE page_participants (
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  participant_id TEXT,
  platform TEXT,
  source_type TEXT,
  channel TEXT,
  role TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

用途：

- 提升 participant 查询性能。
- 支持 `participant + platform + channel` 组合过滤。
- 支持后续 UI 参与人筛选。

后续增强二：接入 `identity_cache`。

用途：

- 解决同一人在飞书、微信、Agent 会话中名称不同的问题。
- 支持 participant slug 查询。
- 支持 alias 合并。

Phase 1 不强制实现 `page_participants` 和 `identity_cache` 归一，但必须在接口设计中预留 `participant_id` 和 `participants[].id`。

### FR-6：MCP 工具契约

所有 MCP 工具必须具备完整工具说明和参数说明。

交付要求：

- 使用 `registerTool` 注册工具。
- 每个工具有 `title`。
- 每个工具有 `description`。
- 每个参数有 `.describe(...)`。
- description 说明：
  - 工具做什么。
  - 何时使用。
  - 何时不使用。
  - 返回什么。
  - 错误后如何恢复。
- 读取型工具 description 明确使用 filter 限定来源。

验收标准：

- MCP `listTools` 返回的每个工具都有 description。
- 新增工具若缺 description，测试失败。
- 工具列表中不出现普通检索类 source-specific 名称。

### FR-7：增强型结构化返回

核心工具第一阶段必须提供稳定 JSON 文本返回。`structuredContent` 和 `outputSchema` 作为增强能力交付，不阻塞工具描述、来源过滤、错误处理和 limit clamp。

核心工具：

- `query`
- `search`
- `get_page`
- `get_page_context`
- `timeline_feed`
- `get_health`

交付要求：

- P0 阶段保留稳定 `content` 文本 JSON。
- P0 阶段所有记忆结果包含 compact provenance 或可追溯 source 信息。
- Phase 5 增强阶段再追加 `structuredContent`。
- Phase 5 增强阶段再为核心工具提供 `outputSchema`。
- `outputSchema` 必须有测试防止 schema 和实际返回漂移。

验收标准：

- P0 阶段 Agent 可以从 JSON 文本返回中读取结果和 provenance。
- Phase 5 阶段 MCP client 调用结果可按 outputSchema 校验。
- Agent 可从返回结果判断信息来源。

### FR-8：结构化错误

工具错误必须可恢复。

错误结构：

```ts
{
  error: {
    code: string;
    message: string;
    suggestion?: string;
  }
}
```

建议错误码：

| code | 含义 |
| --- | --- |
| `NOT_FOUND` | slug/page/link 不存在 |
| `INVALID_ARGUMENT` | 参数非法 |
| `INVALID_DATE` | 日期格式非法 |
| `LIMIT_EXCEEDED` | 请求超过限制 |
| `WRITE_FAILED` | 写入失败 |
| `INTERNAL_ERROR` | 未预期错误 |

验收标准：

- 缺失 slug 返回 `NOT_FOUND`。
- 非法日期返回 `INVALID_DATE`。
- 写操作目标不存在时不返回假成功。
- 错误包含 recovery suggestion。

### FR-9：get_page_context

提供页面综合上下文读取工具。

输入：

```ts
{
  slug: string;
  include?: {
    links?: boolean;
    backlinks?: boolean;
    timeline?: boolean;
    chunks?: boolean;
  };
  limit?: number;
}
```

输出：

```ts
{
  page: Page;
  tags: string[];
  links: LinkSummary[];
  backlinks: LinkSummary[];
  timeline: TimelineEntry[];
  chunks?: ChunkSummary[];
  provenance?: SourceRef;
}
```

验收标准：

- existing slug 返回完整上下文。
- missing slug 返回 `NOT_FOUND`。
- links/timeline/chunks 受 limit 限制。

### FR-10：timeline_feed

提供全局时间线查询工具。

输入：

```ts
{
  query?: string;
  platform?: string | string[];
  source_type?: string | string[];
  channel?: string;
  channel_name?: string;
  participant?: string;
  from?: string;
  to?: string;
  type?: string[];
  exclude_types?: string[];
  limit?: number;
}
```

验收标准：

- 支持最近 N 天记忆回顾。
- 支持按 platform/source_type/participant 筛选。
- 返回按时间排序。
- 每条结果包含 slug、title、type、summary/snippet、time、provenance。

### FR-11：put_page 幂等写入

`put_page` 是 Agent 写入或更新记忆页面的核心工具，必须具备幂等性。

输入：

```ts
{
  slug: string;
  content: string;
}
```

输出：

```ts
{
  ok: true;
  slug: string;
  changed: boolean;
  content_hash: string;
  previous_hash?: string;
  updated_at: string;
}
```

交付要求：

- 相同 `slug + content_hash` 再次写入时返回 `changed: false`。
- `changed: false` 时不更新 `updated_at`。
- `changed: false` 时不触发 rechunk。
- 内容变化时返回 `changed: true`。
- 内容变化时更新页面并触发 rechunk。
- 写入失败不产生部分状态。
- 返回结构包含 `content_hash`。

验收标准：

- 连续两次写入相同内容，第二次 `changed=false`。
- 连续两次写入相同内容，chunk 数量和 `updated_at` 不变化。
- 内容变化后 `changed=true`，chunk 随内容更新。
- 空 content 或非法 slug 返回结构化错误。

### FR-12：关系与标签管理

提供面向 Agent 的合并管理工具。

工具：

- `manage_links`
- `manage_tags`

验收标准：

- 支持 add/remove。
- 检查目标页面是否存在。
- 旧的底层工具可作为兼容入口调用同一 handler。

### FR-13：Resources 增强

Resources 用于支持客户端浏览和用户选择上下文。

建议资源：

| URI | 内容 |
| --- | --- |
| `memoark://health` | 健康状态 |
| `memoark://pages` | 页面索引 |
| `memoark://pages/{slug}` | 页面内容 |
| `memoark://pages/{slug}/context` | 页面上下文 |
| `memoark://pages/{slug}/timeline` | 页面时间线 |

验收标准：

- 支持 `listResources`。
- 支持 `readResource`。
- 内容有大小限制。
- Resources 不替代核心 Tool 路径。

### FR-14：Prompts 工作流

Prompts 用于标准化常见用户任务。

建议 prompts：

| Prompt | 目的 |
| --- | --- |
| `recall` | 回忆主题 |
| `weekly-digest` | 周报 |
| `who-is` | 人物画像 |
| `decision-log` | 决策日志 |
| `handoff` | 项目交接 |

验收标准：

- `listPrompts` 返回所有 prompts。
- `getPrompt` 校验参数。
- Prompt 不硬编码不存在的工具。

## 11. MCP 工具体系

### 11.1 首选工具

| 工具 | 类型 | 目的 |
| --- | --- | --- |
| `query` | read | 自然语言语义检索 |
| `search` | read | 关键词精确检索 |
| `get_page_context` | read | 获取页面综合上下文 |
| `timeline_feed` | read | 查询全局时间线 |
| `explore_graph` | read | 探索图谱关系 |
| `put_page` | write | 写入或更新页面 |
| `add_timeline_entry` | write | 追加时间线 |
| `manage_links` | write | 管理关系 |
| `manage_tags` | write | 管理标签 |
| `get_health` | diagnostic | 诊断健康状态 |

### 11.2 兼容工具

底层 CRUD 工具保留为内部 handler、HTTP API 或调试能力，默认不注册为 MCP tool。只有在配置显式开启时才暴露给 MCP 客户端。

配置：

```yaml
mcp:
  expose_legacy_tools: false
```

默认不注册：

- `get_page`
- `list_pages`
- `get_chunks`
- `get_links`
- `get_backlinks`
- `traverse_graph`
- `add_link`
- `remove_link`
- `add_tag`
- `remove_tag`
- `get_tags`

要求：

- `mcp.expose_legacy_tools` 默认值为 `false`。
- 默认 MCP tool list 只包含首选工具。
- 开启 `mcp.expose_legacy_tools=true` 后才注册兼容工具。
- 开启后 description 必须标注 legacy/debug/internal use。
- 首选工具和兼容工具调用同一底层 handler。
- 测试覆盖兼容路径。
- MCP eval 的默认模式必须使用 `expose_legacy_tools=false`。

### 11.3 读取工具统一参数

读取工具优先复用：

```ts
{
  platform?: string | string[];
  source_type?: string | string[];
  channel?: string;
  channel_name?: string;
  participant?: string;
  from?: string;
  to?: string;
  type?: string[];
  exclude_types?: string[];
  limit?: number;
}
```

### 11.4 写工具安全要求

写工具必须：

- 校验 slug。
- 校验目标页面存在。
- 校验 date 格式。
- 校验 content 非空。
- 对 upsert 类写入提供幂等性。
- 返回 `content_hash` 或等价变更标识。
- 返回结构化错误。
- 不返回假成功。

## 12. 非功能需求

### 12.1 性能

- 搜索默认返回不超过 20 条。
- 搜索最大返回不超过 50 条。
- 图谱默认 depth 不超过 2。
- 图谱最大 depth 不超过 5。
- 所有 list 类工具必须 limit。
- 查询过滤尽量在 SQL 层完成。

### 12.2 隐私

- 默认本地 stdio。
- 不主动上传用户数据。
- provenance 可返回给 Agent，但应避免返回过长原文。
- `quote` 保持短摘录。
- 私聊来源可标记 `sensitivity=high`。

### 12.3 兼容

- 旧 channel 格式继续可查。
- 旧 source 字段继续可读。
- 兼容工具的内部 handler 保留至少一个版本周期。
- 兼容工具默认不注册为 MCP tool。
- `mcp.expose_legacy_tools=true` 时才暴露兼容工具。
- breaking change 必须写入 CHANGELOG。
- MCP tool schema 变化必须写入 CHANGELOG。

### 12.4 版本策略

MCP server version 使用语义化版本，并与 `package.json` 版本保持一致。

版本规则：

| 变更类型 | 版本变化 |
| --- | --- |
| 修改 description、文案、内部实现，不改变 schema | patch |
| 新增工具、新增可选参数、新增 Resource/Prompt | minor |
| 删除工具、重命名工具、删除参数、改变必填参数、改变主返回契约 | major |

交付要求：

- `McpServer({ name: "memoark", version })` 的 version 来自 `package.json`。
- `get_health` 或后续 `get_capabilities` 返回 MCP contract version。
- CHANGELOG 记录 MCP tools、Resources、Prompts、schema 和 legacy mode 变化。
- legacy tools 开关状态应能通过 health/capabilities 或文档明确识别。

### 12.5 可测试

- MCP 工具列表测试。
- MCP 调用测试。
- SourceRef schema parity 测试。
- 跨来源过滤测试。
- 写操作错误测试。
- 构建产物 smoke test。

## 13. 交付物

### 13.1 代码交付

- `SourceRef v2` 类型和 schema。
- `buildSourceRef` provenance 写入。
- Store provenance 保存。
- SearchEngine 统一过滤。
- MCP 工具注册和描述。
- 结构化错误。
- limit clamp。
- `put_page` 幂等写入。
- MCP legacy tools 开关。
- MCP server version 对齐 package version。
- 高意图工具。
- Resources。
- Prompts。
- 增强型结构化返回。

### 13.2 测试交付

- `tests/core/schemas.test.ts`
- `tests/extractors/signal-extractor.test.ts`
- `tests/store/search.test.ts`
- `tests/server/mcp.test.ts`
- `tests/server/mcp-contract.test.ts`
- `tests/server/mcp-resources.test.ts`
- `tests/server/mcp-prompts.test.ts`
- `tests/fixtures/mcp-eval/tasks.jsonl`
- `tests/fixtures/mcp-eval/memory-seed.json`
- `tests/eval/mcp-runner.test.ts` 或 `scripts/mcp-eval.mjs`

### 13.3 文档交付

- README MCP 使用说明。
- MCP 工具说明表。
- SourceRef 字段说明。
- 新增工具 checklist。
- CHANGELOG。

### 13.4 验收命令

基础验收：

```bash
npm run typecheck
npm run test -- tests/core/schemas.test.ts
npm run test -- tests/extractors/signal-extractor.test.ts
npm run test -- tests/store/search.test.ts
npm run test -- tests/server/mcp.test.ts
npm run build
node bin/memoark.mjs --version
```

完整验收：

```bash
npm run test
npm run build
```

## 14. 开发阶段划分

### Phase 0：MCP 基线与发布路径校验

#### 阶段目标

建立 MCP client 视角测试和发布路径验证，确保后续改动能被真实 `memoark serve --mcp` 使用。

#### 范围

- MCP contract baseline。
- binary version smoke test。
- dist 构建产物校验。
- MCP server version 对齐 package version。

#### 涉及文件

- `tests/server/mcp.test.ts`
- `tests/server/mcp-contract.test.ts`
- `bin/memoark.mjs`
- `package.json`
- `dist/`

#### 交付要求

- `listTools` 基线测试。
- `callTool` 成功路径测试。
- `callTool` 基础错误路径测试。
- `node bin/memoark.mjs --version` 输出 package 版本。
- MCP server version 来自 `package.json`。

#### 验收标准

- 基线测试通过。
- 构建产物刷新。
- 真实 CLI 入口可验证。
- server version 不硬编码。

### Phase 1a：SourceRef Core、Schema 与 buildSourceRef

#### 阶段目标

统一 provenance 核心模型，保证所有数据源都能生成稳定、紧凑、可落库的 `SourceRef`。

#### 范围

- `SourceRefCore`。
- `SourceRef` extension。
- `SourceRefCoreSchema`。
- `SourceRefSchema`。
- `buildSourceRef`。
- `stampSourceRefs`。
- provenance compact。
- Store provenance 保存。

#### 涉及文件

- `src/core/types.ts`
- `src/core/schemas.ts`
- `src/core/canonicalize.ts`
- `src/extractors/signal-extractor.ts`
- `src/adapters/store.ts`
- `tests/core/schemas.test.ts`
- `tests/extractors/signal-extractor.test.ts`
- `tests/adapters/store.test.ts`

#### 交付要求

- `SourceRefCore` 与 `SourceRefCoreSchema` 对齐。
- `SourceRef` 与 `SourceRefSchema` 对齐。
- core 字段必填，extension 字段按场景可选。
- provenance 写入前移除 `undefined` 和无业务语义的 `null`。
- `buildSourceRef` 写入 `source_type/channel_name/participants/message_ids/conversation_id/sensitivity/metadata`。
- `stampSourceRefs` 保留 signal 级 quote。
- StoreAdapter 不丢失 v2 provenance 字段。

#### 测试用例

| 用例 | 预期 |
| --- | --- |
| SourceRefCore requires core fields | 缺 core 字段时校验失败 |
| SourceRefSchema accepts extension fields | extension 字段存在时 parse 成功且字段保留 |
| SourceRefSchema omits empty fields | compact 后不保存 `undefined` |
| buildSourceRef handles Feishu DM | 生成 `source_type=dm` |
| buildSourceRef handles WeChat mock | 生成 `platform=wechat` 和 participants |
| buildSourceRef handles Agent session | 生成 `source_type=agent_session` |
| StoreAdapter preserves provenance | page/link/timeline 读取到 v2 provenance |

#### 验收标准

- TypeScript 通过。
- schema 测试通过。
- extractor provenance 测试通过。
- Store provenance 测试通过。

### Phase 1b：MemoryFilter、Search Filter 与 MCP 参数透传

#### 阶段目标

让 `query`、`search`、`timeline_feed`、`get_page_context` 具备统一跨来源过滤能力。

#### 范围

- `MemoryFilter`。
- SearchEngine SQL filter。
- `query/search` filter parity。
- timeline filter。
- MCP 读取工具 filter 参数。
- participant filter MVP。

#### 涉及文件

- `src/store/search.ts`
- `src/store/pages.ts`
- `src/store/timeline.ts`
- `src/server/mcp.ts`
- `src/server/api.ts`
- `tests/store/search.test.ts`
- `tests/server/mcp.test.ts`
- `tests/server/mcp-contract.test.ts`

#### 交付要求

- 定义 `MemoryFilter` 或等价共享类型。
- `SearchEngine.search` 支持 `platform/source_type/channel/channel_name/participant/from/to/type/exclude_types/limit`。
- `SearchEngine.query` 支持同样字段。
- `query/search/timeline_feed/get_page_context` 支持统一 filter。
- `participant` MVP 使用 JSONB exact display name 查询。
- participant filter 暂不承诺跨平台身份归一。
- 不新增 source-specific 查询工具。

#### 测试用例

| 用例 | 预期 |
| --- | --- |
| query filters platform | 只返回指定 platform |
| query filters source_type | 只返回指定来源类型 |
| query filters participant | 返回相关参与人结果 |
| search and query filter parity | 两个工具都应用同样 filter |
| timeline_feed filters source | 结果符合来源过滤 |
| MCP passes filters | MCP `query/search` 参数透传到 SearchEngine |
| tool list avoids source-specific names | 不出现普通检索类平台工具 |

#### 验收标准

- TypeScript 通过。
- search filter 测试通过。
- MCP filter 测试通过。

### Phase 2：工具描述与输入 schema

#### 阶段目标

让 Agent 能准确理解每个工具的用途、参数和边界。

#### 范围

- `registerTool`。
- 工具 title。
- 工具 description。
- 参数 `.describe(...)`。
- 工具选择边界说明。

#### 涉及文件

- `src/server/mcp.ts`
- `tests/server/mcp.test.ts`
- `tests/server/mcp-contract.test.ts`

#### 交付要求

- 所有工具有 title 和 description。
- 读取工具说明 filter 使用方式。
- `query` 与 `search` 的区别明确。
- 默认注册工具不包含 legacy 工具。
- legacy 工具仅在 `mcp.expose_legacy_tools=true` 时注册。
- legacy 工具开启后标注 legacy/debug/internal use。

#### 工具描述模板

每个 MCP 工具 description 使用统一模板。

```md
## {tool_name}

{一句话说明。}

**When to use:** {适用场景。}
**When NOT to use:** {不适用场景，并指向正确工具。}
**Returns:** {返回结构概要。}
**On error:** {错误恢复策略。}

### Parameters

- `{param}` ({required|optional}, default: X, max: Y): {语义说明。}
  Example: `{example}`
```

`query` 示例：

```md
## query

Semantic search across Memoark memory.

**When to use:** Use for fuzzy, conceptual, cross-source recall about people, projects, decisions, tasks, and prior work.
**When NOT to use:** Do not use for exact keyword matching; use `search` instead. Do not look for source-specific tools; use `platform`, `source_type`, or `participant` filters.
**Returns:** Ranked memory results with slug, title, type, snippet, score, and provenance.
**On error:** If no result is found, broaden filters or retry with fewer constraints.

### Parameters

- `query` (required): Natural language search query. Example: `"上周和 Alice 讨论的部署方案"`
- `platform` (optional): Limit results to one platform. Example: `"wechat"`
- `participant` (optional): Limit results to memories involving a participant. Example: `"张三"`
- `limit` (optional, default: 20, max: 50): Maximum results.
```

#### 验收标准

- `listTools` 中每个工具有 description。
- 每个输入参数有说明。
- 新增工具缺少 description 时测试失败。

### Phase 3：结构化错误、限制与幂等性

#### 阶段目标

让工具错误可恢复、结果规模可控、写操作可安全重复调用。

#### 范围

- 结构化错误。
- 默认 limit。
- 最大 limit。
- 写操作目标存在性检查。
- `put_page` 幂等性。
- 稳定 JSON 文本返回。

#### 涉及文件

- `src/server/mcp.ts`
- `src/store/pages.ts`
- `src/store/search.ts`
- `src/store/graph.ts`
- `src/store/timeline.ts`
- `src/store/chunks.ts`
- `tests/server/mcp.test.ts`
- `tests/store/*.test.ts`

#### 交付要求

- 错误包含 code/message/suggestion。
- 所有列表工具应用 limit clamp。
- 写操作不返回假成功。
- `put_page` 相同内容重复写入返回 `changed=false`。
- `put_page` 相同内容重复写入不触发 rechunk。
- 核心工具返回稳定 JSON 文本。

#### 验收标准

- 无效 slug 返回 `NOT_FOUND`。
- 非法日期返回 `INVALID_DATE`。
- 高 limit 被 clamp。
- 重复 `put_page` 不更新 `updated_at`。
- 重复 `put_page` 不改变 chunk。

### Phase 4：高意图工具

#### 阶段目标

减少 Agent 多跳调用，让常见记忆任务通过少量工具完成。

#### 范围

- `get_page_context`
- `timeline_feed`
- `manage_links`
- `manage_tags`
- `explore_graph`

#### 交付要求

- 新工具复用 Phase 1 的 MemoryFilter。
- 新工具有完整 schema 和 description。
- 兼容工具调用同一 handler。

#### 验收标准

- 页面上下文一次返回 page/tags/links/backlinks/timeline。
- 时间线支持全局过滤。
- link/tag 管理支持 add/remove。
- 常见任务平均工具调用次数下降。

### Phase 5：Resources、Prompts 与增强型结构化返回

#### 阶段目标

提供客户端可浏览上下文、用户工作流模板，以及面向新 MCP 客户端的结构化返回增强。

#### 范围

- Resources。
- ResourceTemplate。
- Prompts。
- `structuredContent`。
- `outputSchema`。
- README 示例。

#### 交付要求

- `memoark://health`
- `memoark://pages`
- `memoark://pages/{slug}`
- `memoark://pages/{slug}/context`
- `recall`
- `weekly-digest`
- `who-is`
- `decision-log`
- `handoff`
- 核心工具追加 `structuredContent`
- 核心工具追加 `outputSchema`

#### 验收标准

- `listResources/readResource` 通过。
- `listPrompts/getPrompt` 通过。
- 核心工具结构化输出可按 schema 校验。
- README 包含使用示例。

### Phase 6：Streamable HTTP 与安全

#### 阶段目标

在本地 stdio 稳定后，按需求提供安全远程 MCP 能力。

#### 触发条件

- 远程 Agent 需要访问 Memoark。
- Web 端 MCP 客户端需要接入。
- 多设备或多用户共享成为明确需求。

#### 范围

- Streamable HTTP transport。
- 本地绑定配置。
- Origin 校验。
- host allowlist。
- token 或 OAuth 前置设计。
- 工具权限分级。

#### 验收标准

- 默认不暴露公网。
- invalid Origin 被拒绝。
- read-only 权限不能调用 write 工具。
- stdio 行为不受影响。

## 15. PR 切分建议

| PR | 内容 | 验收重点 |
| --- | --- | --- |
| PR 1 | MCP baseline + dist smoke | `listTools`, `callTool`, build, binary version |
| PR 2 | SourceRef Core + schema + buildSourceRef | core schema parity, compact provenance, extractor provenance |
| PR 3 | MemoryFilter + search/MCP filters | search filter, query/search parity, participant MVP, no source-specific tools |
| PR 4 | registerTool + descriptions | 工具/参数描述完整，legacy tools 默认不注册 |
| PR 5 | errors + limits + idempotency | 结构化错误、limit clamp、写操作不假成功、`put_page` 幂等 |
| PR 6 | high-intent read tools | `get_page_context`, `timeline_feed` |
| PR 7 | high-intent write tools | `manage_links`, `manage_tags` |
| PR 8 | Resources + Prompts | `listResources/readResource`, `listPrompts/getPrompt` |
| PR 9 | structuredContent + outputSchema | 核心工具 schema 可验证 |
| PR 10 | Streamable HTTP + security | 按远程需求触发 |

## 16. Eval 设计

### 16.1 Eval 目标

验证 MCP 工具是否被 Agent 正确选择，并验证跨来源过滤和错误恢复能力。

### 16.2 Eval 数据集

准备 30 到 50 条任务，覆盖：

| 类型 | 示例 |
| --- | --- |
| 语义回忆 | “我上周和 Alice 讨论的 auth 方案是什么？” |
| 精确搜索 | “搜索 JWT token 相关决策” |
| 跨来源过滤 | “只查微信里我和张三聊过的 Memoark 部署问题” |
| 来源类型过滤 | “只看飞书群聊里的项目决策” |
| 时间线回顾 | “过去 7 天发生了什么？” |
| 项目接手 | “memoark 项目现在进展如何？” |
| 图谱探索 | “auth-system 和哪些工具相关？” |
| 写入记忆 | “记一下今天决定用 PGLite” |
| 错误恢复 | 给错 slug 后是否能先搜索正确 slug |
| 反模式检查 | 是否调用 source-specific 工具 |

### 16.3 指标

| 指标 | 目标 |
| --- | ---: |
| tool selection accuracy | >= 85% |
| source filter correctness | >= 90% |
| missing slug recovery | >= 80% |
| oversized result rate | 0 |
| write false success | 0 |
| schema validation failures | 0 |
| source-specific MCP tool usage | 0 |
| average tool calls per task | 下降 30% |

### 16.4 执行路径

Eval 分两层执行。

#### Contract Eval

Contract Eval 不依赖真实 LLM，用 Vitest 和 MCP SDK client 验证 MCP 契约。

覆盖：

- `listTools` 默认不暴露 legacy tools。
- `mcp.expose_legacy_tools=true` 时才暴露 legacy tools。
- 工具 description 和 inputSchema 完整。
- `query/search/timeline_feed` filter 参数透传。
- limit clamp 生效。
- 结构化错误生效。
- source-specific tool usage 为 0。

建议文件：

```txt
tests/server/mcp-contract.test.ts
tests/fixtures/mcp-eval/memory-seed.json
```

CI 策略：

- 每个 PR 必跑。
- 不依赖网络。
- 不依赖真实 LLM。

#### Agent Behavior Eval

Agent Behavior Eval 用于评估真实模型或模拟模型的 tool selection 行为。

建议文件：

```txt
tests/fixtures/mcp-eval/tasks.jsonl
scripts/mcp-eval.mjs
```

任务格式：

```json
{
  "id": "wechat-deploy-recall-001",
  "prompt": "只查微信里我和张三聊过的 Memoark 部署问题",
  "expected_tools": ["query"],
  "forbidden_tools": ["query_wechat", "get_wechat_chat"],
  "expected_filters": {
    "platform": "wechat",
    "participant": "张三"
  },
  "success_criteria": [
    "uses platform filter",
    "does not use source-specific tool",
    "returns only wechat provenance"
  ]
}
```

执行策略：

- 初期手工或定期跑，不阻塞每个 PR。
- 每次工具面变化后必须跑一次。
- 稳定后可接入 nightly CI。

#### Baseline

衡量 “average tool calls per task 下降 30%” 需要先建立 baseline。

baseline 建立方式：

1. 使用固定 memory seed。
2. 使用固定任务集。
3. 使用默认 MCP 工具面。
4. 记录每个任务的工具调用序列、调用次数、错误次数、filter 是否正确。
5. 保存为 `tests/fixtures/mcp-eval/baseline.json`。

后续优化对比 baseline：

- 平均工具调用次数。
- 工具选择准确率。
- source filter correctness。
- source-specific MCP tool usage。
- missing slug recovery。

## 17. 新增 MCP 工具 Checklist

新增任何 MCP 工具前必须满足：

- [ ] 工具名是 Agent 意图，不是内部实现细节。
- [ ] 工具名不是普通数据源查询工具名。
- [ ] 不使用 `query_wechat`、`search_feishu`、`get_feishu_message` 等名称表达普通读取需求。
- [ ] 有 `title`。
- [ ] 有 `description`。
- [ ] 描述包含何时用、何时不用。
- [ ] 每个参数有 `.describe(...)`。
- [ ] 读取型工具复用 MemoryFilter。
- [ ] 返回记忆结果时包含 provenance。
- [ ] 列表返回有 default/max limit。
- [ ] 有成功测试。
- [ ] 有错误测试。
- [ ] 写操作检查目标存在。
- [ ] 写操作不会假成功。
- [ ] README 或开发文档已更新。

## 18. 风险与缓解

| 风险 | 严重度 | 说明 | 缓解 |
| --- | --- | --- | --- |
| SourceRef 与 schema 漂移 | 高 | 字段在类型层和运行时不一致 | schema parity 测试 |
| MCP 工具按数据源膨胀 | 高 | 新来源带来工具名膨胀 | checklist + eval 禁止普通 source-specific 查询工具 |
| 过滤不完整 | 中 | Agent 无法准确限定来源 | MemoryFilter 统一进入 query/search/timeline |
| participant 过滤复杂度 | 中 | 同一人可能有多个平台名称 | Phase 1b 先 exact display name，后续接 `page_participants` 和 `identity_cache` |
| JSONB 查询性能 | 中 | participant/source 查询可能变慢 | 初期保守实现，后续加 `page_participants` 或索引 |
| 旧数据字段缺失 | 中 | 历史数据没有 v2 source 字段 | COALESCE fallback |
| 结构化 schema 成本高 | 中 | `outputSchema` 维护成本高 | 移到 Phase 5，先做错误和 limit |
| legacy tools 默认暴露 | 高 | 工具数量增加会影响 tool selection | 默认 `mcp.expose_legacy_tools=false` |
| dist 漂移 | 高 | 用户运行路径不是源码 | Phase 0 build smoke |
| 远程 MCP 安全 | 高 | 涉及私密记忆 | 默认 stdio，HTTP 按需求触发 |

## 19. 时间计划

按单人执行估算：

| 阶段 | 工作量 | 优先级 |
| --- | ---: | --- |
| Phase 0：MCP 基线与发布路径 | 0.5 到 1 天 | P0 |
| Phase 1a：SourceRef Core、Schema 与 buildSourceRef | 2 到 3 天 | P0 |
| Phase 1b：MemoryFilter、Search Filter 与 MCP 参数透传 | 2 到 3 天 | P0 |
| Phase 2：工具描述与输入 schema | 1 到 2 天 | P0 |
| Phase 3：结构化错误、限制与幂等性 | 2 到 3 天 | P0 |
| Phase 4：高意图工具 | 2 到 4 天 | P1 |
| Phase 5：Resources、Prompts 与增强型结构化返回 | 3 到 5 天 | P2 |
| Phase 6：Streamable HTTP 与安全 | 5 到 10 天 | P3 |

首批交付建议：

1. Phase 0。
2. Phase 1a。
3. Phase 1b。
4. Phase 2。
5. Phase 3。

首批交付完成后，MCP 记忆能力层将具备稳定 provenance、统一跨来源过滤、可描述工具契约、结构化错误、幂等写入和有界返回，为后续新增微信、企业微信等数据源提供稳定接口基础。

## 20. 最终验收标准

达到以下标准后，本 PRD 视为完成主要目标：

- 新数据源可通过 `SourceRef` 和 MemoryFilter 接入，不需要新增普通 source-specific 查询工具。
- `query/search/timeline_feed/get_page_context` 支持统一跨来源过滤。
- MCP 工具列表自解释。
- 核心工具返回稳定 JSON 文本，增强阶段返回结构可按 schema 验证。
- 所有错误可恢复。
- 写操作不返回假成功。
- `put_page` 相同内容重复写入幂等。
- 所有读取结果有上限。
- Agent 可从返回结果追溯信息来源。
- MCP eval 中 source-specific MCP tool usage 为 0。
- 本地 stdio 使用体验稳定。

## 21. 参考资料

- MCP Tools specification: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP Resources specification: https://modelcontextprotocol.io/specification/2025-11-25/server/resources
- MCP Prompts specification: https://modelcontextprotocol.io/specification/2025-11-25/server/prompts
- MCP Transports specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- MCP Security Best Practices: https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
