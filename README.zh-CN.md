# DigitalBrainExtractor (DBE)

[English](README.md) | 中文

从 AI Agent 会话和通信平台中提取结构化信号的 CLI 工具，将原始对话转化为可机器读取的知识图谱。

## 概述

DigitalBrainExtractor 将非结构化对话数据转化为结构化信号——实体、关系、决策、任务和发现——输出到 GBrain 等知识管理系统。适用于使用 Claude Code、Codex、Hermes 等 AI Agent 的团队，将对话记录转化为组织记忆。

## 架构

```
Collector              Dedup              BlockBuilder           NoiseFilter
(多平台采集)          (消息去重)          (对话分块)             (显著性过滤)
     ↓                    ↓                    ↓                      ↓
   原始消息            去重消息            对话块                过滤后的块
                                                                    ↓
                                                         ┌──────────┴──────────┐
                                                         ↓                     ↓
                                                  SignalExtractor      Privacy Processor
                                                  (LLM 驱动提取)       (双轨脱敏)
                                                         ↓                     ↓
                                                    提取结果             脱敏结果
                                                         ↓                     ↓
                                                      ┌──┴──────────────────┐
                                                      ↓                     ↓
                                                   Formatters            Adapters
                                                (JSON/Markdown)    (File/GBrain/Stdout)
                                                      ↓                     ↓
                                                    输出                  存储
```

### Pipeline 阶段

1. **Collector（采集器）**：从配置的数据源获取原始消息（Claude Code、Codex、Hermes）
2. **Dedup Store（去重）**：基于内容哈希消除重复消息
3. **Block Builder（分块器）**：将时间相邻的消息分组为对话块
4. **Noise Filter（噪声过滤）**：使用 LLM 评估块的显著性（L1 规则 + L2 LLM）
5. **Signal Extractor（信号提取）**：提取实体、决策、任务、关系和发现（LLM 驱动）
6. **Privacy Processor（隐私处理）**：双轨脱敏（可逆 + 不可逆）
7. **Formatter（格式化）**：将提取结果转为 JSON 或 Markdown
8. **Adapter（适配器）**：输出到文件系统、GBrain 或标准输出

## 支持的数据源

| 数据源 | 路径 | 说明 |
|--------|------|------|
| **Claude Code** | `~/.claude/projects/` | Claude Code Agent 对话记录 |
| **Codex** | `~/.codex/` | OpenAI Codex CLI 会话 |
| **Hermes** | `~/.openclaw/agents/` | OpenClaw Hermes Agent 会话（支持多 Agent 自动发现） |

## 提取的信号类型

DBE 从对话中提取 **6 类结构化信号**：

| 信号类型 | 说明 | 示例 |
|---------|------|------|
| **Entities（实体）** | 人物、项目、工具、组织、概念 | `project/digitalbrain`, `tool/claude-code` |
| **Timeline（时间线）** | 关键事件及时间戳 | "2026-05-19: 完成多平台采集器重构" |
| **Decisions（决策）** | 架构选型、技术决策及其理由 | "选择 Apache 2.0 License，因为兼顾开源友好和专利保护" |
| **Tasks（任务）** | 待办事项及状态追踪 | `[open] 实现 token 自动刷新机制` |
| **Discoveries（发现）** | 技术洞察、bug 根因、edge case | "UUID v4 不可按字典序排序，需要改用时间戳比较" |
| **Links（关系）** | 实体间的依赖、引用、协作关系 | `project/dbe --[depends_on]--> tool/codex` |

## 快速开始

### 安装

```bash
git clone https://github.com/AndreLYL/digitalbrain-extractor.git
cd digitalbrain-extractor

# 安装依赖（需要 Bun 运行时）
bun install
```

### 初始化配置

```bash
bun src/cli.ts config init
```

生成 `dbe.yaml` 配置模板，编辑后设置 LLM API key：

```bash
export DBE_API_KEY=sk-your-api-key
```

### 检查环境

```bash
bun src/cli.ts doctor
```

### 运行提取

```bash
# 从 Claude Code 提取，输出到终端
bun src/cli.ts extract --source claude-code --format json

# 从所有启用的数据源提取
bun src/cli.ts extract --source all --adapter file --output ./output

# 只提取最近 1 天的数据
bun src/cli.ts extract --source claude-code --since 1d

# 干跑模式（不调用 LLM）
bun src/cli.ts extract --source claude-code --dry-run
```

## CLI 命令

### `dbe extract`

主命令：从数据源提取信号。

```bash
dbe extract \
  --source <name>           # 数据源：claude-code, codex, hermes, all
  --format json|markdown    # 输出格式，默认 json
  --adapter file|gbrain|stdout  # 输出目标，默认 stdout
  --output <dir>            # file adapter 的输出目录
  --since <date>            # 只处理此时间之后的消息（ISO 8601 或相对值：1d, 2h, 30m）
  --limit <n>               # 限制处理的消息数
  --dry-run                 # 测试模式，不写入输出
```

### `dbe doctor`

诊断配置、数据源连通性和 LLM 设置。

```bash
dbe doctor
```

### `dbe config init`

生成配置模板。

```bash
dbe config init
```

### `dbe sources list`

列出所有已启用的数据源。

```bash
dbe sources list
```

### `dbe sources test <name>`

测试数据源的连通性和健康状态。

```bash
dbe sources test claude-code
```

## 配置

### `dbe.yaml` 结构

```yaml
# 隐私配置
privacy:
  enabled: true
  mode: reversible          # reversible（可逆）或 irreversible（不可逆）
  redact_phone: true        # 脱敏手机号
  redact_id_card: true      # 脱敏身份证号
  redact_bank_card: true    # 脱敏银行卡号
  redact_email: false
  redact_url: false
  blocked_words: []         # 自定义敏感词
  replacement: "[REDACTED]"

# LLM 配置
llm:
  provider: openai           # openai 或 mock
  model: gpt-4o-mini
  base_url: https://api.openai.com/v1  # 可选：自定义端点
  api_key: ${OPENAI_API_KEY}           # 支持环境变量插值

# 分块配置
block_builder:
  block_gap_minutes: 30      # 超过此时间间隔开始新块
  max_block_tokens: 4000     # 每块最大 token 数
  max_block_messages: 100    # 每块最大消息数

# 数据源配置
sources:
  claude-code:
    enabled: true
    # base_dir: ~/.claude/projects/
  codex:
    enabled: true
    # base_dir: ~/.codex/
  hermes:
    enabled: true
    # base_dir: ~/.openclaw/agents/

# 适配器配置
adapters:
  file:
    enabled: false
    output_dir: ./output
  gbrain:
    enabled: false
    output_dir: ./gbrain-output
```

### 隐私双轨脱敏

**可逆模式**：保留原始内容到映射文件，授权人员可恢复。适合内部审计场景。

**不可逆模式**：永久删除敏感内容，不可恢复。适合 GDPR 合规和公开数据集。

## 开发

### 项目结构

```
src/
├── cli.ts                      # CLI 入口（Commander.js）
├── core/                       # 核心模块
│   ├── types.ts                # TypeScript 接口定义
│   ├── config.ts               # 配置加载器
│   ├── pipeline.ts             # Pipeline 编排
│   ├── block-builder.ts        # 消息分块
│   ├── dedup.ts                # 去重存储
│   └── schemas.ts              # Zod 验证 schema
├── collectors/                 # 数据源采集器
│   ├── index.ts                # 采集器注册表
│   └── agent/
│       ├── claude-code.ts      # Claude Code 采集器
│       ├── codex.ts            # Codex 采集器
│       └── hermes.ts           # Hermes 采集器
├── extractors/                 # LLM 提取器
│   ├── signal-extractor.ts     # 信号提取（LLM）
│   ├── noise-filter.ts         # 噪声过滤（规则 + LLM）
│   └── providers/              # LLM Provider 适配层
├── processors/
│   └── privacy.ts              # 隐私处理器
├── formatters/                 # 输出格式化
│   ├── json.ts
│   └── markdown.ts
└── adapters/                   # 输出适配器
    ├── file.ts
    ├── gbrain.ts
    └── stdout.ts
```

### 运行测试

```bash
# 全量测试
bun run test

# 监听模式
bun run test:watch

# 运行指定测试
bun run test -- path/to/test.ts
```

测试套件包含 252 个测试，覆盖核心组件、Pipeline 集成、CLI 参数解析和 Golden 输出验证。

### 贡献

欢迎贡献！请确保：

- 代码通过 `bun run test`
- CLI 变更同步更新帮助文本
- 新采集器遵循 `Collector` 接口
- 新适配器遵循 `Adapter` 接口

## License

基于 [Apache License 2.0](LICENSE) 开源。
