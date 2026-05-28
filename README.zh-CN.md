<p align="center">
  <h1 align="center">Memoark</h1>
  <p align="center"><strong>把散落的对话变成可搜索的私人记忆。本地优先，AI 驱动。</strong></p>
</p>

<p align="center">
  <a href="README.md">English</a> | 中文
</p>

---

## 痛点

你的对话散落在各处 — Claude Code、飞书、微信、会议、邮件。每天你做出决策、发现洞察、讨论想法，分布在十几个平台上。但当你需要回忆当时说了什么、在哪里决定的、为什么选择那个方案 — 找不到了。

**你不是记忆力差，你是信息碎片化。**

## 解决方案

Memoark 是一个**本地优先的个人记忆系统**。它从多个平台采集你的对话，提取结构化信号（实体、决策、任务、发现、知识、关系），存入统一的可搜索知识图谱 — 一切都在你自己的机器上。

## 核心特性

**私密 & 本地优先**
数据永远不离开你的机器。PGLite 嵌入式数据库，Ollama 本地向量嵌入，无云依赖。

**AI 驱动信号提取**
LLM 驱动的 Pipeline 从原始对话中提取 7 类结构化信号：实体、时间线、决策、任务、发现、知识、关系。

**混合语义搜索**
全文搜索（tsvector）+ 向量检索（pgvector），通过 RRF（Reciprocal Rank Fusion）融合排序。支持自然语言提问。

**MCP 服务器**
17 个内置工具，让任何支持 MCP 的 AI Agent（Claude Code、Cursor、Windsurf）可以把 Memoark 作为记忆层使用。

**REST API**
基于 Hono 的 HTTP API，暴露所有存储操作。

**多平台采集**
一套系统，多个数据源。支持 Claude Code、Codex、Hermes 等 AI Agent 会话，以及飞书。

## 快速开始

### 前置条件

- [Bun](https://bun.sh) >= 1.0.0
- （可选）[Ollama](https://ollama.ai) 本地嵌入

### 安装

```bash
git clone https://github.com/AndreLYL/memoark.git
cd memoark
bun install
```

### 初始化配置

```bash
bun src/cli.ts config init
```

设置 LLM API key：

```bash
export OPENAI_API_KEY=your-api-key
```

### 检查环境

```bash
bun src/cli.ts doctor
```

### 运行提取

```bash
# 从 Claude Code 提取，直接存入 PGLite
bun src/cli.ts extract --source claude-code

# 从所有数据源提取
bun src/cli.ts extract --source all

# 干跑模式（不调用 LLM）
bun src/cli.ts extract --source claude-code --dry-run
```

### 搜索记忆

```bash
# 混合搜索（全文 + 向量）
bun src/cli.ts search "认证中间件决策"

# 仅全文搜索
bun src/cli.ts search "JWT token" --mode fts
```

### 启动服务器

```bash
# HTTP API
bun src/cli.ts serve

# MCP stdio（AI Agent 集成）
bun src/cli.ts serve --mcp
```

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据源                                    │
│  Claude Code  │  Codex  │  Hermes  │  飞书  │  微信              │
└───────┬───────┴────┬────┴────┬─────┴────┬───┴────┬──────────────┘
        └────────────┴────────┴──────────┴────────┘
                              │
                    ┌─────────▼──────────┐
                    │   信号提取 Pipeline  │
                    │                    │
                    │  采集 → 去重        │
                    │  → 分块 → 噪声过滤  │
                    │  → 信号提取 → 脱敏  │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   存储层            │
                    │                    │
                    │  PGLite + pgvector │
                    │  （嵌入式 PG）      │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
     │   CLI          │ │  MCP       │ │  REST API    │
     │   管理 & 提取   │ │  服务器     │ │  (Hono)      │
     └────────────────┘ └────────────┘ └──────────────┘
```

### 信号类型

| 信号类型 | 说明 | 示例 |
|---------|------|------|
| **实体** | 人物、项目、工具、概念 | `project/memoark`, `tool/claude-code` |
| **时间线** | 关键事件及时间戳 | "2026-05-19: 完成多平台采集器重构" |
| **决策** | 架构选型、技术决策及其理由 | "选择 PGLite 作为嵌入式 PostgreSQL 方案" |
| **任务** | 待办事项及状态追踪 | `[open] 实现 token 自动刷新` |
| **发现** | 技术洞察、bug 根因、edge case | "UUID v4 不可按字典序排序" |
| **知识** | 可复用的事实性知识 | "PGLite 通过 WASM 在进程内运行完整 Postgres" |
| **关系** | 实体间的依赖、引用、协作 | `project/memoark --[depends_on]--> tool/pglite` |

### 存储层

| 组件 | 说明 |
|------|------|
| **PageStore** | Wiki 风格页面，YAML frontmatter，CRUD |
| **ChunkStore** | 递归文本分块（300 词，50 词重叠），嵌入复用 |
| **SearchEngine** | tsvector 全文搜索 + pgvector 向量搜索，RRF 融合排序 |
| **GraphStore** | 有向链接图，BFS 遍历，链接类型过滤，反向链接 |
| **TagStore** | 页面标签，冲突安全 upsert |
| **TimelineStore** | 按时间排序的条目，去重 |
| **EmbeddingService** | OpenAI / Ollama 批量嵌入，过期 chunk 检测 |

## CLI 命令

### `memoark extract`

从数据源提取信号。

```bash
memoark extract \
  --source <name>              # claude-code, codex, hermes, feishu, all
  --format json|markdown       # 输出格式，默认 json
  --adapter store|file|gbrain|stdout  # 输出目标，默认 store
  --since <date>               # 只处理此日期之后的消息
  --limit <n>                  # 限制消息数
  --dry-run                    # 测试模式
```

### `memoark serve`

启动服务器。

```bash
memoark serve              # HTTP API
memoark serve --mcp        # MCP stdio 传输
```

### `memoark search <query>`

搜索存储的记忆。

```bash
memoark search "认证中间件"           # 混合搜索（默认）
memoark search "JWT" --mode fts      # 仅全文搜索
memoark search "部署" --limit 5      # 限制结果数
```

### `memoark embed`

为未嵌入的 chunk 生成向量嵌入。

```bash
memoark embed                  # 嵌入所有过期 chunk
memoark embed --limit 100     # 限制批量大小
```

### `memoark doctor`

诊断配置和环境。

### `memoark config init`

生成配置模板。

### `memoark sources list` / `memoark sources test <name>`

列出或测试数据源。

## 配置

### `memoark.yaml`

```yaml
# 隐私配置
privacy:
  enabled: true
  mode: reversible           # reversible（可逆）| irreversible（不可逆）
  redact_phone: true
  redact_id_card: true
  redact_bank_card: true
  replacement: "[REDACTED]"

# LLM（信号提取用）
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}

# 分块配置
block_builder:
  block_gap_minutes: 30
  max_block_tokens: 4000
  max_block_messages: 100

# 数据源
sources:
  claude-code:
    enabled: true
  codex:
    enabled: true
  hermes:
    enabled: true

# 存储（PGLite）
store:
  data_dir: ~/.memoark/data

# 嵌入
embedding:
  provider: openai           # openai | ollama
  model: text-embedding-3-large
  dimensions: 1536
  api_key: ${OPENAI_API_KEY}

# 服务器
server:
  http_port: 3927
```

## 支持的数据源

| 数据源 | 路径 | 说明 |
|--------|------|------|
| **Claude Code** | `~/.claude/projects/` | Claude Code Agent 对话记录 |
| **Codex** | `~/.codex/` | OpenAI Codex CLI 会话 |
| **Hermes** | `~/.openclaw/agents/` | OpenClaw Hermes Agent 会话 |
| **飞书** | API | 飞书消息、日历、文档、任务、邮件 |

## 路线图

### Phase 1 — 信号提取（已完成）

- [x] 多平台采集器（Claude Code、Codex、Hermes、飞书）
- [x] LLM 驱动的噪声过滤和信号提取
- [x] 7 类信号：实体、时间线、决策、任务、发现、知识、关系
- [x] 双轨隐私脱敏（可逆 + 不可逆）
- [x] JSON 和 Markdown 输出格式

### Phase 2 — 存储 & 服务器（已完成）

- [x] PGLite 嵌入式 PostgreSQL + pgvector
- [x] PageStore、ChunkStore、TagStore、TimelineStore、GraphStore
- [x] 全文搜索（simple 分词器，支持中文）+ 向量搜索
- [x] RRF 混合搜索
- [x] EmbeddingService（OpenAI / Ollama）
- [x] StoreAdapter — Pipeline 直接写入 PGLite
- [x] Hono REST API
- [x] MCP 服务器（17 个 stdio 工具）
- [x] CLI serve、search、embed 命令

### Phase 3 — 查询 & 界面（进行中）

- [ ] 自然语言问答
- [x] Web UI — 时间线视图
- [x] Web UI — 知识图谱可视化
- [x] Web UI — Dashboard、搜索、页面详情

### Phase 4 — 新数据源

- [ ] 微信聊天记录
- [ ] 更多平台（社区驱动）

## 技术栈

| 层 | 技术 |
|----|------|
| 语言 | TypeScript |
| 运行时 | Bun |
| 数据库 | PGLite（嵌入式 PostgreSQL） |
| 向量搜索 | pgvector |
| 嵌入 | OpenAI / Ollama |
| Web 框架 | Hono |
| MCP | @modelcontextprotocol/sdk |
| Linter | Biome |
| 测试 | Vitest（400+ 测试） |

## 开发

```bash
bun run test              # 全量测试
bun run test:watch        # 监听模式
bun run lint              # 代码检查
bun run lint:fix          # 自动修复
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

基于 [Apache License 2.0](LICENSE) 开源。
