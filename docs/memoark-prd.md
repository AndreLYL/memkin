# Memoark 产品与技术蓝图

> 面向开发团队的内部文档 | 2026-05-22 | v1.0

---

## 1. 产品概述

**Memoark（记忆方舟）** 是一个本地优先的个人记忆系统。它从多个平台采集你的对话数据，利用 LLM 提取结构化信号，存入本地数据库，并提供自然语言查询、时间线回溯和知识图谱可视化。

**一句话定义**：Turn your scattered conversations into one private, searchable memory. Local-first, AI-powered.

**仓库地址**：https://github.com/AndreLYL/memoark

---

## 2. 为什么做这个产品

### 痛点

作为技术从业者，我们每天的信息流分散在大量平台上：

- 在 **Claude Code / Cursor** 里跟 AI Agent 讨论技术方案
- 在 **飞书** 上跟同事沟通需求、开会 review
- 在 **微信** 里跟合作伙伴讨论项目进展

每个平台都是一座信息孤岛。当你需要回忆"上周关于那个模块的讨论"时，你得分别去三个平台翻聊天记录——通常翻不到，因为你根本记不清是在哪个平台聊的。

**核心问题不是记忆力差，而是信息碎片化。**

### 解决方案

Memoark 把这些散落的对话统一采集到本地，用 LLM 提取出结构化信号（谁、什么时候、做了什么决策、发现了什么），存入一个可搜索的知识图谱。你可以用自然语言问它问题，也可以按时间线浏览你的活动历史。

**所有数据存在本地，不上传任何云服务。**

---

## 3. 目标用户

| 群体 | 特征 | 关注点 |
|---|---|---|
| 第二大脑爱好者 | 使用 Obsidian / Notion / Logseq 等工具，关注个人知识管理 | 自动化采集、关联发现、知识图谱 |
| AI Agent 重度用户 | 每天使用 Claude Code / Cursor / Copilot 编程 | 对话记忆持久化、跨会话检索 |

---

## 4. 产品架构

### 4.1 系统全景

```
┌─────────────────────────────────────────────────────────────┐
│                      数据源（Data Sources）                  │
│                                                             │
│  Claude Code   Codex    Hermes    飞书(Lark)    微信         │
│  (已完成)      (已完成)  (已完成)   (Phase 4)   (Phase 4)    │
└──────┬─────────┬────────┬──────────┬───────────┬────────────┘
       └─────────┴────────┴──────────┴───────────┘
                          │
               ┌──────────▼──────────┐
               │                     │
               │   信号提取 Pipeline  │  ← Phase 1（已完成）
               │                     │
               │  Collector          │
               │  → Dedup            │
               │  → BlockBuilder     │
               │  → NoiseFilter(LLM) │
               │  → SignalExtractor  │
               │  → PrivacyProcessor │
               │                     │
               └──────────┬──────────┘
                          │
                    6 种结构化信号
                          │
               ┌──────────▼──────────┐
               │                     │
               │   存储层            │  ← Phase 2（下一步）
               │                     │
               │  SQLite + FTS5      │  全文搜索
               │  + sqlite-vec      │  向量检索
               │  Drizzle ORM       │  类型安全
               │                     │
               └──────────┬──────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
  ┌───────▼───────┐ ┌────▼─────┐ ┌───────▼───────┐
  │               │ │          │ │               │
  │  CLI          │ │  MCP     │ │  Web UI       │  ← Phase 3
  │  管理 & 提取  │ │  Server  │ │  (Hono)       │
  │  (已完成)     │ │          │ │               │
  │               │ │  AI Agent│ │  时间线浏览    │
  │               │ │  记忆接口│ │  知识图谱可视化│
  └───────────────┘ └──────────┘ └───────────────┘
```

### 4.2 数据流

```
原始对话 → Collector 采集 → Dedup 去重 → BlockBuilder 分块
    → NoiseFilter 过滤噪声 → SignalExtractor 提取信号
    → PrivacyProcessor 脱敏 → 存入 SQLite
    → 用户通过 CLI / MCP / Web UI 查询
```

### 4.3 信号提取 Pipeline 详解

Pipeline 是整个系统的数据入口，负责把非结构化对话变成结构化信号。类比自动驾驶的感知层——原始传感器数据进来，结构化的目标检测结果出去。

| 阶段 | 职责 | 类比 |
|---|---|---|
| **Collector** | 从各平台拉取原始消息 | 传感器采集 |
| **Dedup** | 内容哈希去重 | 数据清洗 |
| **BlockBuilder** | 按时间窗口分组为对话块 | 帧聚合 |
| **NoiseFilter** | L1 规则 + L2 LLM 评估显著性 | 目标筛选 |
| **SignalExtractor** | LLM 提取 6 种结构化信号 | 目标检测 |
| **PrivacyProcessor** | 双轨脱敏（可逆/不可逆） | 数据脱敏 |

### 4.4 提取的 6 种信号

| 信号类型 | 说明 | 示例 |
|---------|------|------|
| **Entities（实体）** | 人物、项目、工具、概念 | `project/memoark`, `tool/claude-code` |
| **Timeline（时间线）** | 关键事件 + 时间戳 | "2026-05-19: 完成多平台采集器重构" |
| **Decisions（决策）** | 技术选型及其理由 | "选择 SQLite 因为本地优先哲学最匹配" |
| **Tasks（任务）** | 待办事项 + 状态 | `[open] 实现 Embedding Provider` |
| **Discoveries（发现）** | 技术洞察、bug 根因 | "UUID v4 不可按字典序排序" |
| **Links（关系）** | 实体间的关联 | `memoark --[depends_on]--> sqlite` |

---

## 5. 技术栈

| 层 | 技术 | 选型理由 |
|---|---|---|
| 语言 | **TypeScript** | 前后端统一，类型安全 |
| 运行时 | **Bun** | 快，原生支持 TS，内置测试和打包 |
| 数据库 | **SQLite + FTS5 + sqlite-vec** | 单文件、零配置、本地优先；FTS5 全文搜索成熟；sqlite-vec 支持向量检索 |
| ORM | **Drizzle** | 类型安全，SQLite 支持好，轻量 |
| 向量嵌入 | **Ollama（本地）+ OpenAI API（远程）** | 双模式：Ollama 保证完全离线隐私；API 保证开箱即用 |
| Web 框架 | **Hono** | 轻量，Bun 原生支持，适合做 API 和 MCP Server |
| MCP SDK | **@modelcontextprotocol/sdk** | 官方 SDK，让 AI Agent 直接查询记忆 |
| 前端 | **React + Vite** | 生态好，图谱可视化库丰富 |
| 图谱可视化 | **D3.js 或 react-force-graph** | 灵活，社区大 |
| Linter | **Biome** | 快速，替代 ESLint + Prettier |
| 测试 | **Vitest** | 与 Bun 配合好，已有 237 个测试 |
| CI | **GitHub Actions** | lint + test 双 job，已配置 |

### 为什么选 SQLite 而不是 PostgreSQL？

| 维度 | SQLite | PostgreSQL |
|---|---|---|
| 部署 | 零配置，单文件 | 需要安装服务或 Docker |
| 本地优先 | 天然适合 | 需要额外封装 |
| 备份 | 拷贝文件即可 | 需要 pg_dump |
| 全文搜索 | FTS5，成熟 | 内置，更强 |
| 向量检索 | sqlite-vec（较新但活跃） | pgvector（成熟） |
| 图查询 | 关联表 + 递归 CTE | Apache AGE 扩展 |

对于一个**本地优先的个人工具**，SQLite 的零配置和单文件特性是决定性优势。Obsidian、Apple Notes、Arc 浏览器都用 SQLite。

### 为什么需要 MCP Server？

MCP（Model Context Protocol）是 Anthropic 推出的协议，让 AI Agent 可以调用外部工具。把 Memoark 做成 MCP Server 意味着：

- 用户在 Claude Code 里直接问"我上周做了什么"，Agent 调用 Memoark 查询并返回结果
- **不需要做单独的问答前端**——用户已有的 AI Agent 就是最好的交互界面
- 这是目标用户（AI Agent 重度使用者）最自然的使用方式

---

## 6. 开发阶段与里程碑

### Phase 1 — 信号提取层 ✅ 已完成

| 模块 | 状态 | 说明 |
|---|---|---|
| 多平台采集器 | ✅ | Claude Code、Codex、Hermes |
| Dedup 去重 | ✅ | 内容哈希 |
| BlockBuilder 分块 | ✅ | 时间窗口 + token 限制 |
| NoiseFilter 噪声过滤 | ✅ | L1 规则 + L2 LLM |
| SignalExtractor 信号提取 | ✅ | LLM 驱动，6 种信号 |
| PrivacyProcessor 隐私处理 | ✅ | 双轨脱敏 |
| JSON / Markdown 格式化 | ✅ | 两种输出格式 |
| File / GBrain / Stdout 适配器 | ✅ | 三种输出目标 |
| CLI（extract / doctor / config / sources）| ✅ | Commander.js |
| 测试 + CI + Linter | ✅ | 237 tests, Biome, GitHub Actions |

### Phase 2 — 存储层（预计 1 周）

**目标**：让提取出的信号持久化到本地数据库，支持全文搜索和向量检索。

| 任务 | 说明 | 产出 |
|---|---|---|
| Drizzle schema 设计 | 定义 signals、entities、links 等表结构 | `src/db/schema.ts` |
| SQLite 初始化 + 迁移 | 数据库创建、版本管理 | `src/db/index.ts`, `drizzle/` |
| FTS5 全文索引 | 对信号内容建立全文搜索索引 | FTS5 虚拟表 |
| sqlite-vec 集成 | 向量存储和相似度查询 | 向量索引 |
| Embedding Provider | 接口 + Ollama 实现 + OpenAI 实现 | `src/embedders/` |
| Pipeline → DB 写入 | Pipeline 产出直接写入数据库（替代文件输出） | 修改 pipeline.ts |
| 信号去重和合并 | 跨源信号合并，避免重复 | 合并逻辑 |

### Phase 3 — 查询与界面（预计 1 周）

**目标**：让用户能够查询和浏览存储的记忆。

| 任务 | 说明 | 产出 |
|---|---|---|
| REST API | Hono 框架，暴露查询接口 | `src/server/` |
| MCP Server | 实现 MCP 协议，AI Agent 可直接查询 | `src/mcp/` |
| 自然语言 Q&A | 接收问题 → 检索相关信号 → LLM 生成回答 | Q&A 模块 |
| Web UI — 时间线 | React 页面，按时间轴展示活动历史 | `web/` |
| Web UI — 知识图谱 | D3.js / react-force-graph 可视化实体关系 | `web/` |
| CLI 增强 | 添加 query / search 命令 | 修改 cli.ts |

### Phase 4 — 新数据源（预计 1 周）

**目标**：扩展数据采集范围到即时通讯和协作平台。

| 任务 | 说明 | 产出 |
|---|---|---|
| 飞书消息采集器 | 通过飞书 Open API 采集消息 | `src/collectors/feishu/` |
| 飞书日历采集器 | 采集日程和会议信息 | `src/collectors/feishu/` |
| 微信聊天记录采集 | 解析本地微信数据库或导出文件 | `src/collectors/wechat/` |
| 采集器调度 | 增量采集、定时运行 | `src/scheduler/` |

---

## 7. 分工建议

三人团队，每人主攻一个垂直领域，按 Phase 协同推进。

### 角色划分

| 角色 | 职责范围 | 涉及目录 |
|---|---|---|
| **P1 — 数据与存储** | 数据库 schema、SQLite/FTS5/sqlite-vec 集成、Embedding Provider、信号写入和去重、新数据源采集器 | `src/db/`, `src/embedders/`, `src/collectors/` |
| **P2 — 服务与协议** | REST API (Hono)、MCP Server、Q&A 模块、Pipeline 优化、CLI query 命令 | `src/server/`, `src/mcp/`, `src/core/` |
| **P3 — 前端与可视化** | React Web UI、时间线页面、知识图谱可视化、交互设计 | `web/` |

### 各 Phase 的协作方式

**Phase 2（存储层）**：P1 主导，P2 协助 Pipeline → DB 对接，P3 做 Web 项目初始化和脚手架搭建。

**Phase 3（查询与界面）**：三人并行——P1 做 Embedding 和搜索优化，P2 做 API + MCP，P3 做前端页面。

**Phase 4（新数据源）**：P1 主导采集器开发，P2 做调度和增量采集，P3 做前端适配新数据源的展示。

---

## 8. 当前代码结构

```
memoark/
├── src/
│   ├── cli.ts                   # CLI 入口（Commander.js）
│   ├── core/                    # 核心模块
│   │   ├── types.ts             # TypeScript 接口定义
│   │   ├── config.ts            # 配置加载（YAML + 环境变量插值）
│   │   ├── pipeline.ts          # Pipeline 编排
│   │   ├── block-builder.ts     # 消息分块
│   │   ├── dedup.ts             # 去重
│   │   └── schemas.ts           # Zod 验证
│   ├── collectors/              # 数据源采集器
│   │   ├── index.ts             # 采集器注册表
│   │   └── agent/
│   │       ├── claude-code.ts   # Claude Code 解析器
│   │       ├── codex.ts         # Codex 解析器
│   │       └── hermes.ts        # Hermes 解析器
│   ├── extractors/              # LLM 提取
│   │   ├── signal-extractor.ts  # 信号提取
│   │   ├── noise-filter.ts      # 噪声过滤
│   │   └── providers/           # LLM Provider 适配
│   ├── processors/
│   │   └── privacy.ts           # 隐私处理器
│   ├── formatters/              # JSON / Markdown
│   └── adapters/                # File / GBrain / Stdout
├── tests/                       # 237 个测试
├── memoark.yaml                 # 配置模板
├── biome.json                   # Linter 配置
├── .github/workflows/ci.yml     # CI
└── package.json
```

---

## 9. 如何开始

### 环境准备

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 克隆仓库
git clone https://github.com/AndreLYL/memoark.git
cd memoark

# 安装依赖
bun install

# 运行测试（确认环境正常）
bun run test

# 检查 lint
bun run lint
```

### 了解代码

1. 从 `src/cli.ts` 开始，理解 CLI 命令结构
2. 看 `src/core/pipeline.ts`，理解数据流
3. 看 `src/core/types.ts`，理解核心数据结构
4. 跑一次提取：`bun src/cli.ts extract --source claude-code --dry-run`

### 开发规范

- **Conventional Commits**：`feat:`, `fix:`, `docs:`, `chore:` 等前缀
- **Biome**：提交前跑 `bun run lint:fix`
- **测试**：新功能必须有对应测试
- **PR Review**：所有改动通过 PR 合入 main

---

## 10. 未来展望

Memoark 的终极目标是成为**个人信息基础设施**——不是另一个笔记应用，而是一个底层的记忆服务，任何工具都可以通过 API 或 MCP 接入。

短期目标（4 周内）：
- 完成 Phase 2-4，实现从"提取工具"到"记忆系统"的跨越
- 支持 3 类数据源（AI 对话 + 飞书 + 微信）
- 提供可用的 Web UI 和 MCP Server

中期目标：
- 社区驱动新数据源（邮件、日历、浏览器历史）
- 移动端查询界面
- 多设备数据同步（端对端加密）
