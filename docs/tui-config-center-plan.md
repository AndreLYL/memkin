# Memoark TUI 配置中心改造方案

> 目标：把当前线性的 `memoark init` 配置向导升级为“可编辑、可返回、可管理完整配置”的 TUI 配置中心。本文基于当前代码结构、配置 schema 和已有 setup 业务逻辑设计，不直接改变数据采集、抽取、存储和服务能力。

## 1. 背景

当前 Memoark 的配置能力主要分散在以下模块：

| 模块 | 当前职责 |
|------|----------|
| `src/core/config.ts` | 定义完整 `Config` 类型、默认配置、读取 YAML、环境变量插值、与默认值深度合并 |
| `src/setup/init-wizard.ts` | 线性初始化流程：检测数据源/API key、选择 LLM、测试连接、配置 embedding、生成 YAML |
| `src/setup/terminal.ts` | 简单终端交互抽象：`ask`、`secret`、`confirm`、`select` |
| `src/setup/generate-config.ts` | 根据 `PartialConfig` 补默认值并生成 `memoark.yaml` |
| `src/setup/validate-config.ts` | 最小配置校验：LLM 必填、至少一个数据源、Feishu 凭证 |
| `src/cli.ts` | `init`、`config init`、`doctor`、`sources`、`extract`、`serve` 等命令入口 |

现状适合首轮初始化，但不适合后续管理：

- 交互是线性的，不能返回上一步，也不能从某个配置项直接进入编辑。
- 当前 wizard 没有覆盖完整配置，例如 `adapters`、Feishu 子数据源、`server`、`store`、`block_builder`、LLM filter 字段等。
- `loadConfig()` 会直接插值环境变量并合并默认值，适合运行时使用，但不适合编辑，因为它会丢失“用户原始写法”和“是否显式配置”的信息。
- 配置保存通过 `generateConfigYaml()` 重新生成完整 YAML，适合 init，但配置中心需要考虑保留未知字段、尽量保留注释、隐藏敏感值、展示差异和避免误覆盖。
- `doctor` 和 init wizard 已有连接测试/检测逻辑，但没有作为可复用的配置动作暴露给 UI。

## 2. 改造目标

### 2.1 产品目标

新增一个 TUI 配置中心，支持：

- 打开并编辑现有 `memoark.yaml`。
- 首次运行时从默认配置创建草稿，并引导保存。
- 左侧分区导航，右侧编辑当前分区。
- 支持返回、取消、保存、重置当前字段、重置当前分区。
- 支持完整配置管理，包括 LLM、Embedding、数据源、Feishu、隐私、分块、存储、服务和适配器。
- 支持敏感字段掩码展示，避免在界面、预览、diff 和日志中泄露 API key。
- 支持字段级校验、分区级校验、保存前整体校验。
- 支持连接测试，例如 LLM、Embedding、Feishu、数据源健康检查。
- 支持预览 YAML 和保存前 diff。
- 非 TTY 环境继续走当前 `memoark init` 或普通终端 fallback，不阻塞 CI/脚本使用。

### 2.2 工程目标

- 将 `memoark init` 升级为统一入口：TTY 进入 TUI 配置中心，`--auto` 保持静默模式，非 TTY fallback 到当前线性 wizard。
- 保留 `memoark config init` 作为 `memoark init` 的别名，避免破坏现有用户。
- 把配置编辑和配置运行时加载分离：运行时继续用 `loadConfig()`，编辑器使用新的 `ConfigDocument`。
- 把配置 schema、默认值、字段元信息、校验和测试动作沉淀成可复用模块。
- 把 `init-wizard.ts` 中可复用的连接测试和检测逻辑下沉，避免 TUI 和 wizard 复制业务逻辑。
- 测试可覆盖核心状态模型和配置读写，不依赖真实终端。

## 3. Init 升级策略

用户心智模型保持最简：

```bash
git clone https://github.com/AndreLYL/memoark.git
cd memoark
bun install
memoark init
```

不新增必需命令，`memoark init` 根据运行环境选择行为：

| 环境 | 行为 |
|------|------|
| TTY 正常终端 | 进入 TUI 配置中心 |
| `--auto` | 保持当前静默模式不变 |
| 非 TTY，例如 CI、管道输入 | fallback 到当前线性 wizard 或普通 prompt 流程 |
| `memoark config init` | 作为 `memoark init` 的别名，遵循同一套环境判断 |

| 命令 | 语义 |
|------|------|
| `memoark init` | 在 TTY 下打开 TUI 配置中心；配置不存在时创建默认草稿，配置存在时进入编辑 |
| `memoark init --auto` | 静默自动生成配置，行为保持当前实现 |
| `memoark init --force` | 允许覆盖已有配置；TUI 下进入覆盖确认流程 |
| `memoark init -c <path>` | 使用指定配置路径 |
| `memoark init --no-tui` | 强制使用非 TUI fallback，便于兼容不支持全屏 TUI 的终端 |

额外提供环境变量退路：

```bash
MEMOARK_NO_TUI=1 memoark init
```

该开关用于 TUI 出现兼容性问题时快速回退，也便于用户写入 shell alias、CI 环境或团队文档。它和 `--no-tui` 等价，但优先级低于 `--auto`。

实现判断顺序：

1. 如果传入 `--auto`，直接执行当前自动配置流程。
2. 如果传入 `--no-tui`，执行线性 wizard/fallback。
3. 如果 `MEMOARK_NO_TUI=1`，执行线性 wizard/fallback。
4. 如果 `stdin` 和 `stdout` 都是 TTY，进入 TUI 配置中心。
5. 其他情况执行线性 wizard/fallback。

`memoark config edit` 可以作为未来可选别名，但第一版不依赖它；主入口就是 `memoark init`。

## 4. 用户体验设计

### 4.1 主界面

每一个 TUI 界面顶部固定展示 Memoark 的经典 Slant ASCII Art，并在其下方使用分割线。该 Header 应封装为共享组件，所有 screen 复用，避免每个页面重复维护字符画。

```text
  ═══════════════════════════════════════════════════════════════════════
      __  ___                                __
     /  |/  /__  ____ ___  ____  ____ ______/ /__
    / /|_/ / _ \/ __ `__ \/ __ \/ __ `/ ___/ //_/
   / /  / /  __/ / / / / / /_/ / /_/ / /  / ,<<
  /_/  /_/\_\___/_/ /_/ /_/\____/\__,_/_/  /_/|_|
  
  ═══════════════════════════════════════════════════════════════════════
```

建议采用全屏布局：

```text
  ═══════════════════════════════════════════════════════════════════════
      __  ___                                __
     /  |/  /__  ____ ___  ____  ____ ______/ /__
    / /|_/ / _ \/ __ `__ \/ __ \/ __ `/ ___/ //_/
   / /  / /  __/ / / / / / /_/ / /_/ / /  / ,<<
  /_/  /_/\_\___/_/ /_/ /_/\____/\__,_/_/  /_/|_|

  ═══════════════════════════════════════════════════════════════════════

Memoark Config Center                         memoark.yaml                 modified
----------------------------------------------------------------------------------
  Overview              │  LLM
> LLM                   │  Provider        openai
  Embedding             │  Model           gpt-4o-mini
  Sources               │  Base URL        https://api.openai.com/v1
  Feishu                │  API Key         ${OPENAI_API_KEY}
  Privacy               │  Filter Provider -
  Block Builder         │  Filter Model    -
  Store                 │
  Server                │  [Test Connection]
  Adapters              │
  Preview & Save        │  Status: Valid
----------------------------------------------------------------------------------
Enter edit  Tab panel  Ctrl+S save  Esc back  ? help  Ctrl+Q quit
```

Header 设计要求：

- 每个 TUI screen 顶部都渲染同一个 Slant banner，包括主界面、二级页面、Preview & Save、只读错误页和帮助页。
- 分割线长度跟随终端宽度裁剪或补齐；终端过窄时优先保留字符画主体，再缩短分割线。
- Header 不参与字段滚动区。字段列表滚动时，Header 保持在顶部。
- 非 TUI fallback 不强制展示字符画，避免污染脚本输出。
- 测试需要断言主界面和至少一个子页面都包含 banner 第一行或分割线。

### 4.2 导航规则

| 按键 | 行为 |
|------|------|
| `Up` / `Down` | 移动当前列表项 |
| `Left` / `Right` | 在分区列表和字段列表之间切换 |
| `Enter` | 编辑字段、打开子页面、执行按钮 |
| `Esc` | 返回上一层；顶层时触发退出确认 |
| `Tab` | 在导航、编辑区、状态区之间切换 |
| `Ctrl+S` | 保存 |
| `Ctrl+Q` | 退出；有未保存变更时确认 |
| `?` | 打开帮助 |

### 4.3 编辑控件

| 字段类型 | 控件 |
|----------|------|
| boolean | 开关 |
| enum | 选择菜单 |
| string | 单行输入 |
| secret | 密码输入，默认掩码 |
| number | 数字输入，支持最小值、最大值 |
| string list | 列表编辑器，支持添加、删除、排序 |
| path | 路径输入，支持 `~` 展示和存在性检查 |
| section action | 按钮，例如 Test Connection |

### 4.4 状态和保存

- TUI 顶部显示文件路径和 dirty 状态。
- 每个分区显示校验状态：valid、warning、error。
- 保存前默认进入 `Preview & Save`，展示 masked diff。
- 保存时使用原子写入：先写临时文件，再 rename 到目标路径。
- 不默认创建备份文件，避免复制明文 secret。可以后续增加显式 `--backup`。

## 5. 完整配置字段覆盖

TUI 配置中心需要覆盖当前 `Config` 中所有字段，并明确哪些字段当前业务真正使用。

为避免 MVP 范围蔓延，字段覆盖分两档：

| 分区 | 阶段 | 说明 |
|------|------|------|
| LLM | MVP / Phase 4 | 首批完整编辑 |
| Embedding | MVP / Phase 4 | 首批完整编辑 |
| Sources: Claude Code / Codex / Hermes | MVP / Phase 4 | 只覆盖 agent sources |
| Privacy | MVP / Phase 4 | 首批完整编辑 |
| Block Builder | MVP / Phase 4 | 首批完整编辑 |
| Feishu | Phase 6 | Phase 4 左侧可显示，但点击提示 Coming soon |
| Store | Phase 6 | MVP 只允许通过 YAML 或默认值使用 |
| Server | Phase 6 | MVP 只允许通过 YAML 或默认值使用 |
| Adapters | Phase 6 | MVP 只允许通过 YAML 或默认值使用 |

Phase 4 的 `Sources` 页面只实现 Claude Code、Codex、Hermes 三个 agent sources。Feishu 虽然属于 `sources` 配置，但不纳入 MVP。

### 5.1 LLM

路径：`llm`

| 字段 | 类型 | 默认值 | 当前用途 | TUI 行为 |
|------|------|--------|----------|----------|
| `provider` | string/enum | `openai` | `createLLMProvider()` | 选择 OpenAI、Anthropic、OpenAI-compatible、Mock |
| `model` | string | `gpt-4o-mini` | LLM 抽取和噪声过滤 | 根据 provider 给默认值，可手动输入 |
| `base_url` | string? | 空 | OpenAI/Anthropic provider 自定义 endpoint | OpenAI-compatible 必填，其他 provider 可选 |
| `api_key` | secret? | 空 | 非 dry-run extraction 必需 | 支持保存明文、保存 env placeholder、留空依赖环境变量 |
| `filter_provider` | string? | 空 | 已在类型中定义，当前未明显接入 | 标注为高级字段 |
| `filter_model` | string? | 空 | 已在类型中定义，当前未明显接入 | 标注为高级字段 |

建议把 API key 编辑拆成三种模式：

| 模式 | 保存值 |
|------|--------|
| Use environment variable | `${OPENAI_API_KEY}` / `${ANTHROPIC_API_KEY}` |
| Paste secret into config | 用户输入的明文，界面掩码 |
| Leave empty | 不写入 `api_key`，运行时依赖环境变量或报错 |

### 5.2 Embedding

路径：`embedding`

| 字段 | 类型 | 默认值 | 当前用途 | TUI 行为 |
|------|------|--------|----------|----------|
| `provider` | `openai` / `ollama` | `openai` | `EmbeddingService` | 选择 provider |
| `model` | string | OpenAI: `text-embedding-3-large`；Ollama: `nomic-embed-text` | embedding 模型 | 根据 provider 自动推荐，可覆盖 |
| `dimensions` | number | OpenAI: `1536`；Ollama: `768` | pgvector 维度 | provider 切换时提示是否同步默认维度 |
| `api_key` | secret? | 空 | OpenAI embedding | OpenAI 时可配置；Ollama 时隐藏或禁用 |
| `base_url` | string? | OpenAI official 或 Ollama local | embedding endpoint | provider 不同时展示不同默认值 |

复用当前 `runEmbeddingAssessment()`、`checkOllamaRunning()`、`checkOllamaModel()`、`testEmbeddingConnection()`，但需要从 `init-wizard.ts` 移到共享模块。

### 5.3 Sources

路径：`sources`

#### Agent sources

| 字段 | 类型 | 默认值 | 当前用途 | TUI 行为 |
|------|------|--------|----------|----------|
| `sources.claude-code.enabled` | boolean | `true` | 注册 Claude Code collector | 开关 |
| `sources.claude-code.base_dir` | path? | `~/.claude/projects` | 自定义 Claude Code session 路径 | 路径输入和检测 |
| `sources.codex.enabled` | boolean | `true` | 注册 Codex collector | 开关 |
| `sources.codex.base_dir` | path? | `~/.codex` | 自定义 Codex session 路径 | 路径输入和检测 |
| `sources.hermes.enabled` | boolean | `true` | 注册 Hermes collector | 开关 |
| `sources.hermes.base_dir` | path? | `~/.openclaw/agents` | 自定义 Hermes session 路径 | 路径输入和检测 |

需要复用 `detectSources()`，并支持在 UI 中执行“重新检测”。

#### Feishu

路径：`sources.feishu`

| 字段 | 类型 | 默认值 | 当前用途 | TUI 行为 |
|------|------|--------|----------|----------|
| `enabled` | boolean | `false` | 注册 Feishu collector | 开关 |
| `app_id` | secret/string | `${FEISHU_APP_ID}` | Feishu auth | 支持 env placeholder |
| `app_secret` | secret | `${FEISHU_APP_SECRET}` | Feishu auth | 掩码 |
| `base_url` | string? | 空 | Feishu API endpoint | 高级字段 |
| `rate_limit_qps` | number? | 默认由 `FeishuRateLimiter` 决定 | 限流 | 高级字段 |

Feishu 子数据源：

| 路径 | 字段 |
|------|------|
| `sources.feishu.sources.messages` | `enabled`、`chat_ids[]`、`lookback_days`、`overlap_ms` |
| `sources.feishu.sources.calendar` | `enabled`、`calendar_ids[]` |
| `sources.feishu.sources.docs` | `enabled`、`doc_folders[]`、`doc_deep_extract_folders[]`、`doc_summary_max_chars` |
| `sources.feishu.sources.tasks` | `enabled` |
| `sources.feishu.sources.dm` | `enabled`、`dm_chat_ids[]`、`self_open_id`、`lookback_days`、`overlap_ms` |

Feishu 的 TUI 需要分成二级页面，避免一个页面过长：

```text
Feishu
  Credentials
  Messages
  Calendar
  Docs
  Tasks
  Direct Messages
```

MVP 处理方式：Feishu 在左侧导航中可以显示为独立入口，但 Phase 4 点击时只展示占位提示：

```text
Coming soon — edit memoark.yaml directly.
```

该页面不允许编辑 Feishu 字段，也不执行 Feishu health check。完整 Feishu credentials、子数据源列表编辑和连接测试放到 Phase 6。

### 5.4 Privacy

路径：`privacy`

| 字段 | 类型 | 默认值 |
|------|------|--------|
| `enabled` | boolean | `true` |
| `mode` | `reversible` / `irreversible` | `reversible` |
| `redact_phone` | boolean | `true` |
| `redact_id_card` | boolean | `true` |
| `redact_bank_card` | boolean | `true` |
| `redact_email` | boolean | `false` |
| `redact_url` | boolean | `false` |
| `blocked_words` | string[] | `[]` |
| `replacement` | string | `[REDACTED]` |

当 `enabled=false` 时，其余字段仍可编辑，但 UI 显示“disabled by privacy.enabled”。

### 5.5 Block Builder

路径：`block_builder`

| 字段 | 类型 | 默认值 | 建议校验 |
|------|------|--------|----------|
| `block_gap_minutes` | number | `30` | `>= 1` |
| `max_block_tokens` | number | `4000` | `>= 100` |
| `max_block_messages` | number | `100` | `>= 1` |

### 5.6 Store

路径：`store`

| 字段 | 类型 | 默认值 | 当前用途 | TUI 行为 |
|------|------|--------|----------|----------|
| `data_dir` | path | `~/.memoark/data` | PGLite 数据目录 | 路径输入，支持存在性和可写性检查 |

### 5.7 Server

路径：`server`

| 字段 | 类型 | 默认值 | 当前用途 | TUI 行为 |
|------|------|--------|----------|----------|
| `http_port` | number | `3927` | `memoark serve` HTTP port | 数字输入，检查端口范围 |
| `mcp_transport` | `stdio` / `sse` | `stdio` | 类型中定义，当前 `serve --mcp` 使用 stdio | 选择菜单，并标注当前 CLI 行为 |

### 5.8 Adapters

路径：`adapters`

| 字段 | 类型 | 当前状态 | TUI 行为 |
|------|------|----------|----------|
| `adapters.file.enabled` | boolean | schema 支持，`extract` 当前主要由 CLI `--adapter file` 驱动 | 暴露为可编辑，但标注“需配合 extract CLI 默认值改造” |
| `adapters.file.output_dir` | path | schema 支持 | 路径输入 |
| `adapters.gbrain.enabled` | boolean | schema 支持，`extract` 当前主要由 CLI `--adapter gbrain` 驱动 | 暴露为可编辑，但标注当前使用边界 |
| `adapters.gbrain.output_dir` | path | schema 支持 | 路径输入 |

注意：`store` 和 `stdout` adapter 当前不是 `Config.adapters` 的字段。`extract` 默认 `--adapter store`，实际 adapter 选择由命令行参数决定。若希望配置中心真正管理默认 adapter，需要另开一个配置字段，例如：

```yaml
pipeline:
  default_adapter: store
  default_format: json
```

这属于扩展需求，不建议和第一版 TUI 配置中心同时引入，避免改变 `extract` 行为。

## 6. 技术架构

### 6.1 新增配置编辑核心

建议新增目录：

```text
src/config-center/
├── index.ts
├── document.ts
├── schema.ts
├── validation.ts
├── secrets.ts
├── actions.ts
├── reducer.ts
├── tui/
│   ├── app.tsx
│   ├── screens.tsx
│   ├── fields.tsx
│   ├── modals.tsx
│   └── theme.ts
└── fallback.ts
```

职责：

| 文件 | 职责 |
|------|------|
| `document.ts` | 读取原始 YAML、构造 draft、计算 effective config、原子保存 |
| `schema.ts` | 配置字段注册表：路径、类型、默认值、标签、说明、校验规则、敏感字段标记 |
| `validation.ts` | 强化版校验，复用并逐步替代 `src/setup/validate-config.ts` |
| `secrets.ts` | 掩码、secret diff、env placeholder 处理 |
| `actions.ts` | 包装 setup 层检测/连接测试，管理 TUI loading、结果状态和错误展示 |
| `reducer.ts` | TUI 状态模型，处理导航、编辑、dirty、validation、保存 |
| `tui/*` | 全屏 TUI 组件 |
| `fallback.ts` | 非 TTY 或禁用 TUI 时的最小编辑/初始化 fallback |

职责边界：

| 目录 | 职责 | 依赖方向 |
|------|------|----------|
| `src/setup/` | 检测、连接测试、自动配置、线性 wizard 所需的纯逻辑；不依赖 TUI | 可被 `src/config-center/` 和 `init-wizard.ts` 复用 |
| `src/config-center/` | 配置编辑模型、TUI 状态管理、TUI 组件、保存预览；依赖 `src/setup/` | 不被 `src/setup/` 反向依赖 |

这个边界避免循环依赖：`init-wizard.ts` 和 TUI 都从 `src/setup/connection-tests.ts` 导入连接测试；`src/config-center/actions.ts` 只负责把这些测试包装成 TUI action。

### 6.2 ConfigDocument

运行时加载和编辑器加载要分开：

```ts
interface ConfigDocument {
  path: string;
  exists: boolean;
  rawYaml: string;
  rawObject: Record<string, unknown>;
  draft: ConfigDraft;
  effective: Config;
  diagnostics: ConfigDiagnostic[];
  unknownKeys: string[];
}
```

建议新增 API：

```ts
async function loadConfigDocument(path: string): Promise<ConfigDocument>;
function createDefaultConfigDocument(path: string): ConfigDocument;
function updateDraft(doc: ConfigDocument, path: ConfigPath, value: unknown): ConfigDocument;
function validateDraft(draft: ConfigDraft): ConfigDiagnostic[];
async function saveConfigDocument(doc: ConfigDocument): Promise<void>;
```

关键点：

- `loadConfig()` 继续服务运行时，不直接用于编辑器保存。
- 编辑器读取 YAML 时保留原始字符串，避免保存时不必要地重写。
- 编辑器展示 effective config，但保存 draft/raw config。
- 对于 `${OPENAI_API_KEY}` 这类字符串，编辑器要把它当作 raw value，不要保存插值后的真实值。
- 保存前用 `buildConfigObject()` 或共享默认值机制补齐需要写出的字段。

### 6.3 字段注册表

需要一个统一字段注册表，避免 TUI、校验、生成 YAML 三处各写一份字段知识：

```ts
type FieldKind = "boolean" | "string" | "secret" | "number" | "enum" | "path" | "string-list";

interface ConfigField<T = unknown> {
  path: string;
  section: string;
  label: string;
  kind: FieldKind;
  defaultValue?: T;
  options?: Array<{ value: string; label: string }>;
  secret?: boolean;
  advanced?: boolean;
  visibleWhen?: (draft: ConfigDraft) => boolean;
  validate?: (value: T, draft: ConfigDraft) => ConfigDiagnostic[];
}
```

示例：

```ts
{
  path: "embedding.provider",
  section: "Embedding",
  label: "Provider",
  kind: "enum",
  defaultValue: "openai",
  options: [
    { value: "openai", label: "OpenAI" },
    { value: "ollama", label: "Ollama" },
  ],
}
```

### 6.4 TUI 框架选择

完整配置中心比当前 `Prompt` 复杂，需要状态驱动渲染。建议第一版采用 React 风格 TUI：

```json
{
  "dependencies": {
    "ink": "<locked-version>",
    "react": "<locked-version>"
  },
  "devDependencies": {
    "ink-testing-library": "<locked-version>"
  }
}
```

Ink + Bun 兼容性是第一优先级技术风险。正式接入业务前，先做最小 spike：

```bash
bun add ink react
```

然后实现一个 10 行左右的 hello-world TUI，验证：

- Bun 下 Ink 能正常渲染。
- `useInput()` 或等价键盘事件能接收方向键、Enter、Esc、Ctrl+C。
- 应用退出后进程不挂起、不残留 raw mode。
- 动态 import TUI 入口不会影响普通 CLI 启动。

如果 spike 不通过，立即切换方案到 blessed 或手写 raw mode，不继续投入 Ink 业务代码。

理由：

- 当前项目是 TypeScript + ESM，Ink 的组件模型更适合把 screen、field、modal 拆开。
- 编辑器有 dirty state、validation state、modal、async action，状态驱动比手写 ANSI 更容易维护。
- UI 组件可测试，核心 reducer 可脱离终端做单测。

备选方案：

| 方案 | 优点 | 缺点 |
|------|------|------|
| Ink + React | 状态模型清晰、组件化、可测试 | 增加 React 依赖和打包体积 |
| blessed / neo-blessed | 传统 TUI 控件多 | 类型体验一般，状态管理需自行设计 |
| 手写 readline raw mode | 依赖少 | 可维护性差，返回、modal、diff 和测试成本高 |

如果团队对 React 依赖敏感，可以先实现 `ConfigDocument`、`schema`、`validation`、`actions`，TUI 层稍后替换。

### 6.5 复用当前业务逻辑

从 `src/setup/init-wizard.ts` 下沉以下函数到 `src/setup/connection-tests.ts`，保持纯逻辑、无 UI 依赖：

| 当前函数 | 建议移动到 | 复用场景 |
|----------|------------|----------|
| `testLLMConnection()` | `src/setup/connection-tests.ts` | TUI LLM Test、init wizard |
| `testEmbeddingConnection()` | `src/setup/connection-tests.ts` | TUI Embedding Test、init wizard |
| `checkOllamaRunning()` | `src/setup/connection-tests.ts` | TUI Ollama Test、init wizard |
| `checkOllamaModel()` | `src/setup/connection-tests.ts` | TUI Ollama Model Check、init wizard |
| `setupOllama()` | 拆成检测动作和命令建议 | TUI 不应直接长时间阻塞渲染 |
| `buildAutoConfig()` | `src/setup/auto-config.ts` 或配置中心共享模块 | first-run 草稿、`--auto` |
| `sourceConfigFromDetections()` | 共享模块 | init wizard、TUI 重新检测 |

`detectSources()`、`detectApiKeys()`、`runEmbeddingAssessment()` 可以直接复用，但 TUI 中要通过 `src/config-center/actions.ts` 包装为 async action，展示 loading、success、warning、error 状态。

### 6.6 抽出 CLI 内部运行时服务

当前 `src/cli.ts` 内部有两个对配置中心有价值但没有导出的函数：

| 当前函数 | 当前用途 | 配置中心需求 |
|----------|----------|--------------|
| `bootstrapCollectors()` | 根据 `config.sources` 注册 collector，供 `extract`、`doctor`、`sources` 使用 | Source health check、Feishu health check、Sources 页面状态展示 |
| `createStores()` | 根据 `store` 和 `embedding` 配置创建 PGLite store 和 embedding service | Store 检查、Embedding 检查、后续数据库状态页 |

建议把它们拆到共享模块：

```text
src/runtime/
├── collectors.ts    # bootstrapCollectors, listCollectorsFromConfig, testCollector
└── stores.ts        # expandDataDir, createStores, testStore
```

第一版 TUI 至少需要抽出 `bootstrapCollectors()`，否则配置中心的 source test 只能重复 `cli.ts` 里的注册逻辑。`createStores()` 可以稍后抽出，因为 Store 页面第一版只做路径校验也能满足基本需求。

## 7. CLI 改造点

### 7.1 `src/cli.ts`

升级现有 `init` 命令，而不是新增必需命令：

```ts
program
  .command("init")
  .description("Setup Memoark configuration")
  .option("--auto", "Automatic mode, no prompts")
  .option("--force", "Overwrite existing configuration")
  .option("-c, --config <path>", "Path to output config file (default: memoark.yaml)")
  .option("--no-tui", "Use non-TUI fallback")
  .action(async (options) => {
    const { runInit } = await import("./setup/index.js");
    await runInit({
      auto: options.auto,
      force: options.force,
      configPath: options.config,
      tui: options.tui,
    });
  });
```

注意 Commander 对 `--no-tui` 会生成 `options.tui === false`。`runInit()` 内部再根据 `options.auto`、`options.tui`、`process.env.MEMOARK_NO_TUI`、`input.isTTY` 和 `output.isTTY` 决定进入 TUI 还是 fallback。

`runInit()` 需要读取 `process.env.MEMOARK_NO_TUI`。当值为 `1`、`true` 或 `yes` 时，强制 fallback 到线性 wizard。该环境变量不影响 `--auto`，因为 `--auto` 本身已经不进入 TUI。

### 7.2 保留 `config init`

`config init` 继续调用 `runInit()`，并遵循与顶层 `init` 相同的环境判断：

- TTY：进入 TUI。
- `--auto`：静默配置。
- 非 TTY、`--no-tui` 或 `MEMOARK_NO_TUI=1`：fallback 到线性 wizard。

这样保留旧入口，同时把 TUI 作为正常终端下的默认体验。

### 7.3 可选：增强 `doctor`

后续可以把 `doctor` 的检查逻辑迁移到 `src/setup/connection-tests.ts` 和 `src/runtime/*`，让 CLI 和 TUI 共用同一套诊断能力。`src/config-center/actions.ts` 只负责 TUI loading 和结果展示，不作为 CLI 依赖。

## 8. 校验策略

当前 `validateConfig()` 只做最小校验。配置中心需要更细粒度诊断：

```ts
type DiagnosticSeverity = "error" | "warning" | "info";

interface ConfigDiagnostic {
  path: string;
  severity: DiagnosticSeverity;
  message: string;
}
```

建议新增校验：

| 分区 | 校验 |
|------|------|
| LLM | provider/model 必填；非 mock 时 api_key 或对应环境变量存在；base_url 如果填写需是 URL |
| Embedding | provider enum；dimensions 为正数；OpenAI provider 要有 api_key 或环境变量；Ollama base_url 可访问则标 ok，不可访问为 warning |
| Sources | 至少一个 source enabled；agent source base_dir 不存在为 warning；enabled Feishu 必须有 app_id/app_secret |
| Feishu | 启用子数据源时对应 ID 列表必填；DM 启用时 `self_open_id` 必填 |
| Privacy | mode enum；replacement 非空；blocked_words 不应有空字符串 |
| Block Builder | 三个数值都必须为正；token 和 message 上限过低给 warning |
| Store | data_dir 非空；路径不可写为 warning 或 error |
| Server | http_port 在 1 到 65535；mcp_transport enum |
| Adapters | enabled 时 output_dir 必填；目录不存在时提示将创建或检查失败 |

保存规则：

- 有 error 时默认不允许保存，除非用户选择 “Save anyway”。
- warning 不阻止保存。
- secret 字段为空不一定是 error，因为用户可能依赖环境变量。

## 9. 敏感信息策略

当前配置文件可能包含明文 `api_key`。配置中心必须默认保护敏感值。

### 9.1 敏感字段清单

| 路径 | 策略 |
|------|------|
| `llm.api_key` | 掩码展示；diff 掩码；编辑时单独输入 |
| `embedding.api_key` | 掩码展示；diff 掩码；编辑时单独输入 |
| `sources.feishu.app_id` | 可半掩码展示 |
| `sources.feishu.app_secret` | 掩码展示 |

### 9.2 展示策略

| 原始值 | 展示 |
|--------|------|
| `${OPENAI_API_KEY}` | `${OPENAI_API_KEY}` |
| `sk-abcdef...` | `sk-abc...****` |
| 空 | `(empty)` |
| 未配置 | `(not set)` |

### 9.3 保存策略

- 默认推荐保存 env placeholder。
- 用户粘贴明文 secret 时，保存前明确提示。
- YAML preview 和 diff 永远不显示完整 secret。
- 日志和错误信息不打印完整 secret。

## 10. YAML 保存策略

第一版建议采用“稳定生成 + 保留未知字段”的折中方案：

1. 读取 YAML 为 plain object。
2. 用 draft 更新已知配置字段。
3. 保留顶层未知字段和已知 section 内未知字段。
4. 使用 `yaml.stringify()` 生成保存结果。
5. 通过 masked diff 显示变更。
6. 原子写入目标文件。

不建议第一版承诺完整保留所有注释和原始字段顺序，因为这会显著增加复杂度。可以在文档里明确：

- 已知字段按 Memoark 标准顺序保存。
- 未知字段保留。
- 注释可能被规范化。

如果必须保留注释，需要使用 `yaml` 的 Document API 做 AST 级编辑，这可以作为第二版增强。

## 11. 实施阶段

### Phase 0：Ink + Bun 兼容性 spike

目标：先验证最大技术风险，不写业务代码。

估算：半天。

改动：

- 临时安装或在独立 spike 分支安装 `ink`、`react`。
- 写一个最小 hello-world TUI。
- 验证渲染、键盘事件、退出行为、raw mode 恢复。
- 验证 Bun 运行和构建下都不出问题。

验收：

- Bun 下 TUI 正常渲染。
- 方向键、Enter、Esc、Ctrl+C 可用。
- 退出后进程不挂起。
- 如果失败，立即切换 blessed 或手写方案，不继续投入 Ink 业务代码。

### Phase 1：ConfigDocument + 字段注册表 + validation 强化

目标：先把非 UI 的核心做好。

估算：2 天。

改动：

- 新增 `src/config-center/schema.ts`。
- 新增 `src/config-center/document.ts`。
- 新增 `src/config-center/secrets.ts`。
- 新增 `src/config-center/validation.ts`。
- 将 `src/setup/validate-config.ts` 改为复用新 validation，或保持兼容 re-export。
- 补齐字段级单元测试。

验收：

- 能读取不存在的配置并生成默认 draft。
- 能读取现有 YAML，不泄露 secret。
- 能修改任意字段并输出 parseable YAML。
- 能保留未知字段。
- validation 覆盖所有配置分区。

### Phase 2：connection-tests 下沉到共享模块

目标：复用当前 wizard 业务逻辑。

估算：半天。

改动：

- 从 `init-wizard.ts` 下沉连接测试函数。
- 把 Ollama 检查拆为非阻塞动作。
- 新增 `ConfigAction` 结果类型：

```ts
interface ConfigActionResult {
  ok: boolean;
  message: string;
  details?: string[];
}
```

验收：

- TUI 和 init wizard 使用同一个 LLM test。
- TUI 和 init wizard 使用同一个 embedding test。
- Source detect 可以在 TUI 中重新运行。
- Feishu health check 的纯逻辑接口可预留，但 TUI 调用和页面接入放到 Phase 6。

### Phase 3：TUI 主界面 + 导航框架

目标：接入 TUI 壳，但业务页面保持薄实现。

估算：2 天。

改动：

- 在 Phase 0 通过后正式增加 TUI 依赖。
- 新增 `src/config-center/reducer.ts`。
- 新增 `src/config-center/tui/app.tsx`。
- 将 `memoark init` 在 TTY 下接入 TUI。
- 非 TTY 或 `--no-tui` 时 fallback 到当前线性 wizard。
- 实现 Slant ASCII Art Header、左侧导航、右侧内容区、底部快捷键栏。

验收：

- `memoark init` 在正常终端进入 TUI。
- `memoark init --auto` 行为不变。
- 非 TTY 下不进入全屏 TUI。
- 可以在 Overview、LLM、Embedding、Sources、Privacy、Block Builder 占位页面之间导航。
- Feishu 可以出现在左侧导航，但点击只显示 Coming soon 占位页。
- Header 在所有页面顶部稳定展示。

### Phase 4：核心配置页面

目标：完成首批高价值页面。

估算：3 天。

覆盖页面：

- LLM
- Embedding
- Sources
- Privacy
- Block Builder

验收：

- 可以修改 LLM model 并保存。
- 可以切换 embedding provider，并提示是否同步默认 model/dimensions。
- 可以切换 Claude Code、Codex、Hermes 的 source enabled。
- Feishu 仍保持 Coming soon，占位页不提供编辑入口。
- 可以编辑 privacy 和 block builder 字段。
- 字段级 validation 即时更新。

### Phase 5：Preview & Save + 退出确认 + 测试

目标：让 TUI MVP 具备完整保存闭环。

估算：2 天。

改动：

- Preview & Save 页面。
- masked YAML preview 和 masked diff。
- `Ctrl+S` 保存。
- 未保存退出确认。
- 核心 reducer、document、validation、secrets 测试。

验收：

- 可以打开现有 `memoark.yaml`。
- 保存前能看到 masked diff。
- 保存使用原子写入。
- 未保存退出会确认。
- secret 不出现在 TUI 渲染输出、diff 和测试快照中。
- `bun run test` 通过。

### Phase 6：完整字段覆盖

目标：覆盖剩余配置，让配置中心真正完整。

估算：3 到 5 天。

改动：

- Feishu 二级页面。
- Store 页面。
- Server 页面。
- Adapters 页面。
- 高级字段开关。

验收：

- 字段矩阵中的所有字段都能编辑。
- Feishu 子数据源列表字段可增删。
- Server port 和 block builder 数字字段有校验。
- Adapters enabled/output_dir 可编辑。

### Phase 7：文档和稳定性

目标：让配置中心可以作为常规功能发布。

估算：1 到 2 天。

改动：

- 补齐 TUI 组件测试覆盖关键屏幕。
- CLI 测试覆盖 `memoark init` 的 TTY、`--auto`、`--no-tui`、非 TTY 分支。
- README 增加配置中心说明。
- 加入故障恢复说明，例如保存失败、配置 YAML 解析失败。

验收：

- `bun run test` 通过。
- `bun run lint` 通过。
- 配置解析错误时能进入只读错误页或提示修复，不直接崩溃。

## 12. 测试计划

### 12.1 单元测试

| 文件 | 测试重点 |
|------|----------|
| `tests/config-center/schema.test.ts` | 字段路径唯一、默认值存在、secret 字段标记正确 |
| `tests/config-center/secrets.test.ts` | 掩码、masked diff、env placeholder 识别 |
| `tests/config-center/validation.test.ts` | 所有分区的 error/warning |
| `tests/config-center/document.test.ts` | load、draft update、save、未知字段保留、parseable YAML |
| `tests/config-center/reducer.test.ts` | 导航、编辑、dirty、modal、save guard |

### 12.2 TUI 组件测试

如果使用 Ink：

- 用 `ink-testing-library` 渲染主界面。
- 模拟方向键和 Enter。
- 验证当前分区高亮、字段值变化、dirty 状态变化。
- 验证 secret 不出现在渲染输出中。

### 12.3 CLI 测试

- `memoark init --auto` 行为保持当前静默模式。
- `memoark init --no-tui` 强制走非 TUI fallback。
- `MEMOARK_NO_TUI=1 memoark init` 强制走非 TUI fallback。
- TTY 下 `memoark init` 进入 TUI 配置中心。
- 非 TTY 下 `memoark init` 不进入全屏 TUI。
- `memoark config init` 与 `memoark init` 使用同一套环境判断。
- 缺失配置文件时 `memoark init` 能创建默认草稿并提示保存。

### 12.4 回归测试

- `memoark init --auto` 的静默生成行为不变。
- `memoark config init --auto` 的静默生成行为不变。
- `memoark config init` 作为 `memoark init` 别名，不产生分叉逻辑。
- `loadConfig()` 默认值和环境变量插值行为不变。
- `doctor`、`extract`、`serve` 不受配置中心改造影响。

## 13. 风险和处理

| 风险 | 影响 | 处理 |
|------|------|------|
| Ink + Bun 不兼容 | 高 | Phase 0 先做最小 spike；渲染、键盘、退出任一不稳定就切 blessed 或手写 |
| secret 泄露 | 高 | 所有 secret 渲染和 diff 经过 `secrets.ts`；测试断言完整 secret 不出现 |
| TUI 依赖增加体积 | 中 | 只在 `memoark init` 需要 TUI 时动态 import；`--auto` 和其他 CLI 路径不加载 TUI |
| YAML 注释无法完整保留 | 中 | 第一版明确规范化保存；如必须保留注释，第二版切换 Document AST 编辑 |
| `loadConfig()` 与编辑器语义不同 | 中 | 明确区分 runtime config 和 editable config document |
| Feishu 配置复杂 | 中 | 二级页面和字段注册表，避免在一个页面塞满字段 |
| adapters 配置当前未真正驱动 extract 默认行为 | 中 | UI 标注当前边界；不要第一版改变 `extract` 默认语义 |
| 终端兼容性 | 中 | 非 TTY fallback；`memoark init --no-tui` 或 `MEMOARK_NO_TUI=1` 强制 fallback；`--auto` 保持脚本友好 |
| async action 阻塞界面 | 低 | action 统一进入 loading 状态，完成后写入状态区 |

## 14. 预计工作量

| 阶段 | 估算 |
|------|------|
| Phase 0 Ink + Bun 兼容性 spike | 半天 |
| Phase 1 ConfigDocument + 字段注册表 + validation 强化 | 2 天 |
| Phase 2 connection-tests 下沉 | 半天 |
| Phase 3 TUI 主界面 + 导航框架 | 2 天 |
| Phase 4 LLM + Embedding + Sources + Privacy + Block Builder | 3 天 |
| Phase 5 Preview & Save + 退出确认 + 测试 | 2 天 |
| Phase 6 完整字段覆盖 | 3 到 5 天 |
| Phase 7 文档和稳定性 | 1 到 2 天 |

首个可用 TUI MVP 估算约 1.5 周。完整覆盖 Feishu、Store、Server、Adapters 后，整体约 2 到 3 周。

## 15. 推荐落地顺序

1. 先做 Ink + Bun 兼容性 spike，确认技术路线。
2. 做 `ConfigDocument`、`schema`、`validation`、`secrets`，不要先写业务 UI。
3. 把 `init-wizard.ts` 里的连接测试下沉，保证业务逻辑复用。
4. 接入 `memoark init` TUI 壳，完成 Header、导航和 fallback 判断。
5. 做 LLM、Embedding、Sources、Privacy、Block Builder 五个页面。
6. 做 Preview & Save、退出确认、masked diff 和测试。
7. 补齐 Feishu、Store、Server、Adapters。
8. 最后增强 help、readonly、README 和故障恢复说明。

这个顺序的核心原因是：配置中心真正复杂的部分不是全屏渲染，而是可编辑配置模型、secret 安全、保存策略和业务校验。先把这些沉淀好，TUI 只是它们的一个视图。
