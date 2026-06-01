# Memoark PRD v2 — 个人记忆操作系统

> 面向开发团队的产品与技术蓝图 | 2026-05-31 | v2.0
>
> 基于 OpenHuman 与 GBrain 调研成果，重新定义 Memoark 的产品方向与技术架构。

---

## 1. 产品定位

### 1.1 一句话定义

**Memoark（记忆方舟）** 是一个本地优先的个人记忆操作系统。它从飞书、AI Agent 等平台持续采集对话数据，通过上下文感知的信号提取生成高质量结构化记忆，存入本地数据库，并通过 MCP Server 为 AI Agent 提供实时读写能力。

### 1.2 与 v1 的核心区别

| 维度 | v1（信号提取工具） | v2（记忆操作系统） |
|------|-------------------|-------------------|
| 定位 | 提取管道，输出给外部系统 | 完整的记忆系统，自包含 |
| 提取质量 | 单 block 独立提取，散装节点 | 上下文感知提取，叙事整合 |
| 存储 | 依赖外部（GBrain/文件） | 自有 PGLite，完整记忆存储 |
| 巩固 | 无 | 周期性维护（dream cycle） |
| 运行模式 | 手动跑一次 | 常驻后台服务，定时+手动 |
| 可审计性 | 无可视化 | Web UI + Obsidian 双向同步 |

### 1.3 产品哲学

- **本地优先**：所有数据存储在用户本地，不上传云服务
- **上下文即记忆**：孤立的信号节点没有价值，记忆必须有上下文
- **可审计**：用户能看到、检查、修正系统记下的每一条记忆
- **Agent 原生**：MCP Server 是一等公民，AI Agent 是主要消费者

---

## 2. 为什么做这个产品

### 2.1 信息碎片化问题

作为技术从业者，每天的信息流分散在大量平台上：

- **飞书**：群聊讨论、私信沟通、会议纪要、任务待办、云文档、邮件
- **AI Agent**：Claude Code / Cursor / Codex 的编程对话
- **其他**：微信、邮件、文档……

每个平台是一座信息孤岛。"上周和志冲聊了什么" — 你得翻三个平台才能拼出完整画面。

### 2.2 现有方案的不足

| 方案 | 问题 |
|------|------|
| 手动整理笔记 | 费时费力，坚持不下去 |
| 纯 RAG / 向量检索 | 只有向量没有实体关系，回答缺乏上下文 |
| OpenHuman | 端到端但闭源，且面向英文 agent 场景 |
| GBrain | 强大但过于庞大，MCP 工具多到用不过来 |
| Memoark v1 | 提取质量低，散装节点无上下文 |

### 2.3 Memoark v2 的核心价值

**把散落在各平台的对话，变成有上下文、可检索、可审计的个人记忆。**

具体表现为：

1. **"我上周和志冲聊了什么？"** → 从记忆系统中检索出完整的对话摘要、决策、任务
2. **"Memoark 这个项目的开发进度怎样？"** → 自动聚合项目相关的所有信号，给出连贯的进展报告
3. **"最近有什么重要决策？"** → 按时间线展示所有决策及其推理过程

---

## 3. 目标用户与优先级

### 3.1 核心用户

| 用户群体 | 特征 | 关键需求 |
|---------|------|---------|
| **飞书重度用户** | 互联网/科技公司员工，日常使用飞书沟通协作 | 自动提取工作对话中的决策、任务、知识 |
| **AI Agent 重度用户** | 每天使用 Claude Code / Cursor 编程 | 对话记忆持久化，跨会话上下文 |
| **第二大脑爱好者** | 使用 Obsidian / Logseq，关注个人知识管理 | 自动化采集，Obsidian 集成 |

### 3.2 数据源优先级

| 优先级 | 数据源 | 理由 |
|--------|--------|------|
| **P0** | 飞书群聊 | 国内科技公司主要协作平台，承载日常工作内容 |
| **P0** | 飞书私信 + 邮件 | 一对一沟通，高信息密度 |
| **P1** | AI Agent 对话 | Claude Code / Codex / Hermes，编程知识沉淀 |
| **P2** | 飞书日历 + 云文档 + 任务 | 补充结构化信息 |
| **P3** | 微信 | 技术难度高，优先级低 |

> 飞书优先级高于 Agent 的原因：飞书承载的是工作内容本身（需求讨论、技术方案、团队决策），Agent 对话是基于工作内容的执行。先把源头信息做好，Agent 对话作为补充。

---

## 4. 系统架构

### 4.1 架构全景

Memoark v2 是一个完整的记忆系统，包含四个核心层：

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据源（感知层）                           │
│                                                                 │
│  飞书群聊    飞书私信    飞书邮件    飞书日历    Claude Code       │
│  (P0)       (P0)       (P0)       (P2)       Codex  Hermes     │
│                                               (P1)              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                        编码层（信号提取）                         │
│                                                                 │
│  Collector → Dedup → BlockBuilder → AdmissionScoring            │
│                                          │                      │
│                                    ContextBuffer                │
│                                    (跨 block 上下文共享)         │
│                                          │                      │
│                               Context-Aware Extractor           │
│                                          │                      │
│                               NarrativeAssembler                │
│                               (按实体/话题聚合叙事)              │
│                                          │                      │
│                               PrivacyProcessor                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                        存储层（PGLite）                           │
│                                                                 │
│  Pages          Chunks + Embeddings      Graph (Links)          │
│  (实体/叙事/    (语义检索)                (typed relationships)   │
│   决策/知识)                                                     │
│                                                                 │
│  Timeline       Tags                     Page Versions          │
│  (时间事件)     (分类索引)                (历史追溯)              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
┌────────▼───────┐ ┌───────▼───────┐ ┌───────▼───────┐
│   巩固层        │ │   检索层       │ │   交互层       │
│                │ │               │ │               │
│ Entity Merge   │ │ Hybrid Search │ │ MCP Server    │
│ Narrative      │ │ (keyword +    │ │ (5 核心工具)   │
│  Refresh       │ │  vector +     │ │               │
│ Link Repair    │ │  graph +      │ │ CLI           │
│ Pattern        │ │  timeline)    │ │               │
│  Discovery     │ │               │ │ Web UI        │
│                │ │               │ │ + Obsidian    │
│ 定时 + 手动    │ │               │ │   双向同步     │
└────────────────┘ └───────────────┘ └───────────────┘
```

### 4.2 记忆的生命周期

类比人脑的记忆过程：

| 阶段 | 人脑 | Memoark | 说明 |
|------|------|---------|------|
| **感知** | 视觉/听觉输入 | Collector 采集 | 从飞书/Agent 拉取原始对话 |
| **编码** | 短期记忆形成 | 上下文感知提取 | 带上下文的结构化信号提取 |
| **巩固** | 睡眠时记忆整合 | Consolidator | 周期性整合、关联、压缩 |
| **检索** | 回忆 | Hybrid Search | 语义/图谱/时间多维检索 |

### 4.3 编码层详解：上下文感知提取

这是 v2 最核心的改进。v1 的问题是每个 ConversationBlock 独立提取，丢失了跨 block 的上下文。

#### 4.3.1 ContextBuffer（借鉴 OpenHuman Memory Tree 叶子 buffer）

```
Channel A 的对话按时间顺序进入 buffer：

  Block 1: Alice 提出重构 auth 模块
  Block 2: Bob 问用什么方案，Alice 选 JWT
  Block 3: Alice 完成 JWT 重构，发 PR
  
v1 提取结果（独立提取）：
  → Decision: "重构 auth"     ← 孤立节点
  → Decision: "选 JWT"        ← 孤立节点  
  → Task: "发 PR"             ← 孤立节点

v2 提取结果（上下文感知）：
  → Narrative: "Alice 主导 auth 模块从 session 迁移到 JWT，
     Bob 参与方案评审，5月23日完成实现并提交 PR"
  → 关联的 decisions、tasks、knowledge 都有完整上下文
```

ContextBuffer 的核心数据结构：

```typescript
interface ContextBuffer {
  channel: string;
  leaves: ConversationBlock[];           // 原始 blocks
  totalTokens: number;
  entities: Map<string, EntityContext>;   // 跨 block 累积的实体
  activeNarratives: Narrative[];         // 进行中的叙事线
}
```

#### 4.3.2 AdmissionScoring（借鉴 OpenHuman 7 维评分）

替换 v1 的二元噪声过滤，引入加权评分机制：

| 信号维度 | 权重 | 说明 |
|---------|------|------|
| interaction | 3.0 | 是否包含有意义的人际互动 |
| entity_density | 1.5 | 提到多少实体（人、项目、工具） |
| information_novelty | 1.5 | 相对 buffer 已有信息的新增量 |
| token_count | 1.0 | 信息量 |
| keyword_signals | 1.0 | 决策/任务/知识类关键词 |
| llm_importance | 0~2.0 | 中间地带才调用 LLM 判断 |

- 总分 ≥ 0.85：直接 admit
- 总分 ≤ 0.15：直接 drop
- 中间：调用 LLM 做最终判断

#### 4.3.3 NarrativeAssembler（借鉴 OpenHuman Topic Tree + GBrain compiled truth）

所有 block 提取完成后，按实体分组生成叙事页面：

```
提取结果按实体分组：
  person/alice → [decision1, task1, task3, knowledge2]
  project/auth-system → [decision1, decision2, task1]

对每组生成 narrative page：
  → alice 近期动态（连贯叙事 + 关键决策 + 相关知识）
  → auth-system 项目进展（时间线 + 里程碑 + 开放问题）
```

### 4.4 巩固层详解（借鉴 GBrain Dream Cycle）

巩固层是 v2 全新引入的，类似人睡眠时大脑整理白天的记忆。

#### 触发方式

- **数据驱动**：每次 pipeline run 结束后，轻量巩固（entity merge + narrative assembly）
- **时间驱动**：独立的 `memoark consolidate` 命令，深度巩固（pattern discovery + 全量 link repair）

#### 巩固任务清单

| 任务 | 频率 | 说明 |
|------|------|------|
| **Entity Merge** | 每次 run | 合并指向同一实体的不同 slug |
| **Narrative Refresh** | 每次 run | 更新实体的叙事页面 |
| **Link Repair** | 每日 | 修复断裂的 link、补全缺失关系 |
| **Orphan Cleanup** | 每日 | 发现并处理孤儿页面 |
| **Embedding Backfill** | 每日 | 给未 embed 的 chunks 补向量 |
| **Pattern Discovery** | 每周 | 跨时间发现重复模式和趋势 |

### 4.5 存储层

沿用现有 PGLite 架构，已有完整的 pages/chunks/links/timeline/tags 体系。v2 新增：

- **narrative page 类型**：存储实体/话题的聚合叙事
- **page_versions**：支持 compiled truth 的历史追溯
- **raw_data sidecar**：保留原始对话作为溯源依据

### 4.6 检索层

Hybrid Search 架构（已有基础）：

- **Keyword Search**：FTS 全文检索
- **Vector Search**：embedding 语义相似度
- **Graph Query**：按关系类型遍历图谱
- **Timeline Query**：按时间范围筛选
- **Boost 机制**：backlink 数量、source 权重、recency 加分

---

## 5. MCP Server 设计

### 5.1 设计原则

GBrain 的 MCP Server 有 40+ 工具，过于庞大。Memoark 保持精简，只暴露 5 个高频核心工具。

### 5.2 核心工具

| 工具 | 作用 | 使用场景 |
|------|------|---------|
| **query** | 自然语言语义搜索 | "我上周和志冲聊了什么" |
| **search** | 关键词精确搜索 | "搜索 auth 相关的决策" |
| **get_page** | 读取指定页面 | 查看某个实体/叙事的详情 |
| **put_page** | 写入/更新页面 | Agent 主动记录新的知识或决策 |
| **get_timeline** | 查询时间线 | "最近一周发生了什么" |

### 5.3 运行模式

- **常驻后台服务**：MCP Server 持续运行，Agent 随时可调用
- **定时采集**：每 30 分钟自动跑一次 pipeline（可配置）
- **手动触发**：`memoark extract` 随时手动触发采集

---

## 6. 可审计性与可视化

### 6.1 为什么需要可审计

大部分记忆系统是黑盒——数据进去了，但用户看不到系统记了什么、记对了没有。Memoark 要做到**可审计**：用户能看到、检查、修正每一条记忆。

### 6.2 两条可视化路径

#### 路径 A：Obsidian 双向同步

```
Memoark PGLite ←→ Obsidian Vault (Markdown)
```

- **导出**：将 pages 导出为 Markdown 文件，包含 frontmatter 元数据
- **导入**：用户在 Obsidian 中修改后，同步回 PGLite
- **优势**：复用 Obsidian 生态（图谱视图、反向链接、插件）
- **适合**：第二大脑爱好者，喜欢手动整理和浏览

#### 路径 B：Web UI

- **时间线视图**：按时间轴浏览活动历史
- **知识图谱**：D3.js / react-force-graph 可视化实体关系网络
- **实体详情页**：点击节点查看完整叙事、关联决策、任务、知识
- **搜索界面**：自然语言查询 + 结果高亮
- **适合**：快速查看和检索，不需要额外安装 Obsidian

---

## 7. 提取的信号类型

### 7.1 基础信号（v1 已有，v2 增强上下文）

| 信号类型 | 说明 | v2 改进 |
|---------|------|---------|
| **Entities** | 人物、项目、工具、概念 | 跨 block 累积，自动 merge |
| **Timeline** | 关键事件 + 时间戳 | 关联到 narrative 上下文 |
| **Decisions** | 技术选型及推理过程 | 保留完整讨论上下文 |
| **Tasks** | 待办事项 + 状态跟踪 | 跨 block 状态更新 |
| **Discoveries** | 技术洞察、bug 根因 | 关联到相关 knowledge |
| **Knowledge** | 可复用的知识事实 | 去上下文化，可独立检索 |
| **Links** | 实体间的 typed relationships | 自动推断关系类型 |

### 7.2 新增信号类型

| 信号类型 | 说明 | 示例 |
|---------|------|------|
| **Narrative** | 以实体为中心的聚合叙事 | "Alice 近期动态：主导 auth 重构..." |
| **Pattern** | 跨时间发现的重复模式 | "每周五团队讨论 release planning" |

---

## 8. 技术栈

### 8.1 核心技术选型

| 层 | 技术 | 选型理由 |
|---|---|---|
| 语言 | **TypeScript** | 前后端统一，类型安全 |
| 运行时 | **Bun** | 快，原生 TS 支持，内置测试和打包 |
| 数据库 | **PGLite** | 嵌入式 PostgreSQL，单文件部署，支持扩展 |
| 向量检索 | **pgvector (via PGLite)** | PGLite 原生支持，无需额外依赖 |
| Web 框架 | **Hono** | 轻量，Bun 原生支持 |
| MCP SDK | **@modelcontextprotocol/sdk** | 官方 SDK |
| 前端 | **React + Vite** | 生态好 |
| 图谱可视化 | **D3.js / react-force-graph** | 灵活，社区大 |
| Linter | **Biome** | 快速 |
| 测试 | **Bun test** | 内置，已有测试基础 |
| CI | **GitHub Actions** | lint + test |

### 8.2 v1 → v2 技术变更

| 维度 | v1 | v2 | 变更原因 |
|------|----|----|---------|
| 存储 | SQLite (计划) | PGLite (已有) | PGLite 已集成，支持 pgvector |
| 噪声过滤 | 二元 L1+L2 | 加权 AdmissionScoring | 参考 OpenHuman，更精准 |
| 提取 | 单 block 独立 | ContextBuffer + 上下文注入 | 解决散装节点问题 |
| 巩固 | 无 | Consolidator | 解决记忆整合缺失 |
| 运行模式 | 手动 CLI | 常驻后台 + 定时 + 手动 | 持续记忆积累 |

---

## 9. 开发阶段与里程碑

### Phase 1 — 信号提取层 ✅ 已完成

多平台采集器（Claude Code、Codex、Hermes）、Dedup、BlockBuilder、NoiseFilter、SignalExtractor、PrivacyProcessor、CLI、测试 + CI。

### Phase 2 — 飞书深度集成 ✅ 已完成

飞书 6 源采集器（群聊、私信、日历、云文档、任务、邮件）、lark-cli user auth、身份解析、CursorStaging、Signal Fidelity（身份/溯源/语言保真）。

### Phase 3 — 上下文感知提取（下一步，预计 2 周）

**目标**：解决"散装节点"问题，大幅提升提取质量。

| 任务 | 说明 | 预计 |
|------|------|------|
| ContextBuffer 实现 | 同 channel 的 blocks 共享上下文 buffer | 3 天 |
| AdmissionScoring | 替换二元 noise filter 为加权评分 | 2 天 |
| Context-Aware Extraction | 提取时注入已知实体和活跃叙事 | 3 天 |
| NarrativeAssembler | 按实体/话题聚合生成叙事页面 | 3 天 |
| Prompt 模板重写 | 适配上下文感知的新提取范式 | 2 天 |
| 测试 + 质量评估 | 对比 v1 vs v2 提取质量 | 2 天 |

### Phase 4 — 巩固层（预计 1 周）

**目标**：实现周期性记忆巩固，让记忆越用越好。

| 任务 | 说明 | 预计 |
|------|------|------|
| Entity Merge | 自动合并指向同一实体的不同 slug | 2 天 |
| Narrative Refresh | 新数据进来后更新叙事页面 | 2 天 |
| Link Repair + Orphan Cleanup | 修复断裂关系、清理孤儿页 | 1 天 |
| Embedding Backfill | 给未 embed 的 chunks 补向量 | 1 天 |
| `memoark consolidate` 命令 | CLI 手动触发深度巩固 | 1 天 |

### Phase 5 — 常驻服务 + MCP（预计 1 周）

**目标**：Memoark 作为常驻后台服务运行，Agent 实时读写。

| 任务 | 说明 | 预计 |
|------|------|------|
| MCP Server（5 工具） | query、search、get_page、put_page、get_timeline | 3 天 |
| 定时调度 | 每 30 分钟自动 pipeline run | 1 天 |
| 常驻进程管理 | `memoark serve` 启动/停止/状态 | 1 天 |
| 健康检查 + 日志 | 运行状态监控 | 1 天 |

### Phase 6 — 可视化与可审计（预计 2 周）

**目标**：用户能看到、检查、修正系统的记忆。

| 任务 | 说明 | 预计 |
|------|------|------|
| Obsidian 导出 | Pages → Markdown with frontmatter | 2 天 |
| Obsidian 导入（双向同步） | 用户修改后同步回 PGLite | 3 天 |
| Web UI — 时间线 | React + Hono，按时间轴浏览 | 3 天 |
| Web UI — 知识图谱 | D3.js 实体关系可视化 | 3 天 |
| Web UI — 搜索 | 自然语言查询界面 | 2 天 |

---

## 10. 分工建议

### 10.1 角色划分

三人团队，按功能层垂直分工：

| 角色 | 职责 | 涉及模块 |
|------|------|---------|
| **P1 — 提取与巩固** | 上下文感知提取、NarrativeAssembler、Consolidator、新数据源 | `src/extractors/`, `src/core/`, `src/collectors/` |
| **P2 — 服务与检索** | MCP Server、Hybrid Search、定时调度、常驻服务、CLI 增强 | `src/server/`, `src/store/`, `src/cli.ts` |
| **P3 — 前端与可审计** | Web UI（时间线、图谱、搜索）、Obsidian 双向同步 | `web/`, `src/sync/` |

### 10.2 协作方式

- **Phase 3-4**：P1 主导，P2 协助存储层适配
- **Phase 5**：P2 主导，P1 提供 pipeline 接口
- **Phase 6**：P3 主导，P2 提供 API 支持

---

## 11. 当前代码结构

```
memoark/
├── src/
│   ├── cli.ts                       # CLI 入口
│   ├── core/
│   │   ├── types.ts                 # 核心类型定义
│   │   ├── config.ts                # YAML 配置加载
│   │   ├── pipeline.ts              # Pipeline 编排
│   │   ├── block-builder.ts         # 消息分块
│   │   ├── dedup.ts                 # 去重
│   │   ├── cursors.ts               # 增量游标
│   │   ├── schemas.ts               # Zod 验证
│   │   ├── identity-resolver.ts     # 身份解析
│   │   └── state.ts                 # 状态管理
│   ├── collectors/
│   │   ├── agent/                   # AI Agent 采集器
│   │   │   ├── claude-code.ts
│   │   │   ├── codex.ts
│   │   │   └── hermes.ts
│   │   └── feishu/                  # 飞书采集器
│   │       ├── collector.ts         # 主 collector + identity backend
│   │       ├── sources/
│   │       │   ├── messages.ts      # 群聊消息
│   │       │   ├── dm.ts            # 私信
│   │       │   ├── calendar.ts      # 日历
│   │       │   ├── docs.ts          # 云文档
│   │       │   ├── tasks.ts         # 任务
│   │       │   ├── mail.ts          # 邮件
│   │       │   └── message-search.ts # 消息搜索
│   │       ├── auth.ts              # OAuth 认证
│   │       ├── http-client.ts       # HTTP 客户端接口
│   │       ├── lark-cli-client.ts   # lark-cli 用户身份
│   │       ├── cursor-staging.ts    # 游标暂存
│   │       └── rate-limiter.ts      # 限速
│   ├── extractors/
│   │   ├── signal-extractor.ts      # LLM 信号提取
│   │   ├── noise-filter.ts          # 噪声过滤
│   │   ├── prompts/                 # LLM 提示词模板
│   │   └── providers/               # LLM Provider 适配
│   ├── processors/
│   │   └── privacy.ts               # 隐私处理器
│   ├── store/                       # PGLite 存储层
│   │   ├── database.ts              # 数据库初始化
│   │   ├── pages.ts                 # 页面存储
│   │   ├── chunks.ts                # 文本分块
│   │   ├── embedding.ts             # 向量嵌入
│   │   ├── graph.ts                 # 图谱关系
│   │   ├── timeline.ts              # 时间线
│   │   ├── tags.ts                  # 标签
│   │   └── search.ts                # 搜索
│   ├── server/
│   │   ├── api.ts                   # REST API
│   │   └── mcp.ts                   # MCP Server
│   ├── adapters/                    # 输出适配器
│   │   ├── store.ts                 # PGLite 写入
│   │   ├── file.ts                  # 文件输出
│   │   ├── gbrain.ts                # GBrain 同步（可选）
│   │   └── stdout.ts                # 标准输出
│   └── formatters/                  # 格式化
├── docs/
│   ├── memoark-prd.md               # PRD v1
│   └── memoark-prd-v2.md            # PRD v2（本文档）
├── tests/
├── memoark.yaml                     # 配置模板
├── biome.json
├── .github/workflows/ci.yml
└── package.json
```

### v2 新增模块（规划中）

```
src/
├── core/
│   ├── context-buffer.ts            # [新] 跨 block 上下文共享
│   ├── admission-scoring.ts         # [新] 加权准入评分
│   └── consolidator.ts              # [新] 记忆巩固引擎
├── extractors/
│   ├── narrative-assembler.ts       # [新] 叙事聚合
│   └── prompts/
│       └── context-aware-extract.md # [新] 上下文感知提取模板
├── sync/
│   └── obsidian.ts                  # [新] Obsidian 双向同步
└── web/                             # [新] Web UI
    ├── timeline/
    ├── graph/
    └── search/
```

---

## 12. 设计决策记录

### D1: 为什么不照搬 OpenHuman 的 Memory Tree？

OpenHuman 的三棵树（Source/Topic/Global）+ job queue 适合端到端的 runtime memory system。Memoark 已有 PGLite 存储层，照搬会造成两套存储的职责重叠。

**取其精华**：ContextBuffer（叶子 buffer 上下文共享）、AdmissionScoring（加权准入）、NarrativeAssembler（Topic Tree 的聚合思想）。

### D2: 为什么不完全依赖 GBrain？

GBrain 的 dream cycle 能做后处理整合，但它收到的已经是散装信号——无法回到原始对话重新理解上下文。Memoark 在提取阶段保留上下文，比事后整合更准确。

GBrain adapter 保留为**可选同步目标**，不是必需依赖。

### D3: compiled truth vs append-only tree？

两者结合：compiled truth 是当前最佳判断（可覆盖），page_versions 保留演化轨迹，raw_data 保留原始对话。

### D4: 巩固触发方式？

数据驱动 + 时间驱动并用。每次 pipeline run 做轻量巩固，独立命令做深度巩固。

### D5: MCP 工具数量？

5 个核心工具（query/search/get_page/put_page/get_timeline）。GBrain 40+ 工具的教训是工具太多反而降低 Agent 使用效率。

---

## 13. 未来展望

### 短期（8 周）

- 完成 Phase 3-5，实现完整的记忆操作系统
- 提取质量达到"能生成有用的实体叙事"水平
- MCP Server 上线，Agent 可实时查询记忆

### 中期

- Web UI + Obsidian 双向同步
- Pattern Discovery（长期行为模式发现）
- 社区驱动新数据源（钉钉、企业微信）

### 长期

- 移动端查询界面
- 多设备同步（端对端加密）
- 开源社区建设，成为国内个人记忆系统的标杆工具

