# Memoark Setup 易用性增强 — 技术方案

> 面向开发团队的内部文档 | 2026-05-27 | v1.0

---

## 1. 背景

用户 `git clone` 后，当前的 setup 体验存在以下问题：

| 问题 | 严重度 | 说明 |
|------|--------|------|
| 三份重叠的 setup 代码 | 高 | `auto-config.ts`、`config-wizard.ts`、`scripts/setup.ts` 功能重复，且均有 bug |
| 文件名错误 | 高 | `auto-config.ts` 和 `setup.ts` 写入 `dbe.yaml`（旧名），应为 `memoark.yaml` |
| 编译错误 | 高 | `config-wizard.ts` 导入了 `node:fs` 中不存在的 `createReadlineInterface` |
| Windows 不兼容 | 高 | `bin/memoark` 和 `scripts/setup.sh` 是 shell 脚本；wizard 的 raw mode 在 Windows 行为不确定 |
| npm 发布未配置 | 中 | 缺少 `files`/`exports`/`main` 字段，bin 指向 TypeScript 源码 |
| init 命令未接入 | 中 | wizard 已写好但 `cli.ts` 没有 `memoark init` 入口 |
| ESM 违规 | 中 | `auto-config.ts:86` 在 ESM 模块中使用 `require()` |
| 路径正则硬编码 | 低 | `hermes.ts:59,77` 用 `/` 匹配路径分隔符，Windows 下失败 |

**目标**：用户在 Linux / macOS / Windows 上 clone 后，一条命令完成引导式配置，开始使用。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| **三平台原生** | Linux、macOS、Windows（PowerShell + cmd）均可直接运行 |
| **Bun 优先，Node 兜底** | 优先使用 Bun；未安装时 fallback 到 Node.js + tsx |
| **无 raw mode** | 交互用数字选择 + Y/n 确认，不依赖终端 raw mode 和箭头键 |
| **可测试** | 所有模块接受注入式 I/O，单元测试无需真实终端 |
| **渐进式覆盖** | Phase 1 只增不删，Phase 2 替换旧代码，Phase 3 完成分发 |

---

## 3. 用户流程

### 3.1 git clone 用户

```
$ git clone https://github.com/AndreLYL/memoark.git
$ cd memoark
$ bun install              # 或 npm install
$ bun src/cli.ts init      # 或 npx tsx src/cli.ts init
```

### 3.2 npm install -g 用户

```
$ npm install -g memoark
$ memoark init
```

### 3.3 init 交互流程

```
╔════════════════════════════════════════╗
║      Welcome to Memoark Setup         ║
╚════════════════════════════════════════╝

--- Runtime ---
  [ok] Bun v1.2.0 detected

--- Data Sources ---
  [ok] Claude Code: Found sessions at ~/.claude/projects
  [--] Codex: Not found
  [--] Hermes: Not found

--- LLM Configuration ---
Select LLM Provider:
  1) OpenAI (GPT-4o, etc.)
  2) Anthropic (Claude, etc.)
  3) Custom / OpenAI-compatible
  4) Mock (for testing)
Choice [1]: 1

LLM Model [gpt-4o-mini]: <Enter>

API Key (detected: sk-xxx...xxx from env): <Enter>

--- Embedding ---
Select Embedding Provider:
  1) OpenAI (text-embedding-3-large)
  2) Ollama (nomic-embed-text, local)
Choice [1]: <Enter>

Configure advanced privacy settings? [y/N]: <Enter>

--- Preview ---
# memoark.yaml (16 lines)
llm:
  provider: openai
  model: gpt-4o-mini
sources:
  claude-code:
    enabled: true
...

Save this configuration? [Y/n]: <Enter>

[ok] Configuration saved to: memoark.yaml

--- Next Steps ---
  memoark extract --source claude-code    # Extract memories
  memoark serve                           # Start HTTP API
  memoark search "your query"             # Search memories
```

### 3.4 静默模式

```
$ OPENAI_API_KEY=sk-xxx memoark init --auto
```

从环境变量和文件系统自动检测，无交互提示。无 API key 时 exit(1)。

---

## 4. 文件变更

### 4.1 删除

| 文件 | 原因 |
|------|------|
| `src/core/auto-config.ts` | 写入 `dbe.yaml`、ESM 中用 `require()`、与其他两份代码重复 |
| `src/core/config-wizard.ts` | `createReadlineInterface` 编译错误、raw mode 不兼容 Windows |
| `scripts/setup.ts` | 写入 `dbe.yaml`、重复逻辑、ESM 中用 `require()` |
| `scripts/setup.sh` | Shell-only，无 Windows 支持 |
| `bin/memoark` | Shell 脚本，无 Windows 支持 |
| `tests/core/config-wizard.test.ts` | 迁移至 `tests/setup/` |

### 4.2 新建

```
src/setup/
├── index.ts                  # 统一导出
├── terminal.ts               # 跨平台终端工具（颜色、prompt、numbered select）
├── detect-runtime.ts         # 检测 bun / node / tsx 可用性
├── detect-sources.ts         # 检测 claude-code / codex / hermes 数据目录
├── detect-api-keys.ts        # 检测环境变量中的 API key
├── validate-config.ts        # 配置校验
├── generate-config.ts        # 用 yaml.stringify 生成 memoark.yaml
└── init-wizard.ts            # memoark init 主编排逻辑

bin/
└── memoark.mjs               # 跨平台 JS 入口（替代 shell 脚本）

scripts/
└── post-build.mjs            # 构建后处理（shebang 注入、chmod）

tests/setup/
├── terminal.test.ts
├── detect-runtime.test.ts
├── detect-sources.test.ts
├── detect-api-keys.test.ts
├── validate-config.test.ts
├── generate-config.test.ts
└── init-wizard.test.ts
```

### 4.3 修改

| 文件 | 改动 |
|------|------|
| `src/cli.ts` | 添加 `init` 顶层命令；`config init` 重定向到 wizard；移除 `#!/usr/bin/env bun` shebang |
| `package.json` | `bin`/`files`/`exports`/`engines`/`scripts`/`repository` 全部更新 |
| `src/collectors/agent/hermes.ts` | 修复 L59、L77 硬编码 `/` 的路径正则 |

---

## 5. 模块设计

### 5.1 `src/setup/terminal.ts` — 跨平台终端工具

这是所有交互的基础。关键决策：**不使用 raw mode，不使用箭头键**。

**颜色检测策略**：

```
process.stdout.isTTY === true
  && process.env.NO_COLOR 未设置          // 遵循 no-color.org 标准
  && (process.env.FORCE_COLOR 已设置
      || process.platform !== 'win32'
      || process.env.WT_SESSION           // Windows Terminal
      || process.env.TERM_PROGRAM)        // VS Code 终端
```

**选择器用数字编号**（不用箭头键），保证在 bash / zsh / PowerShell / cmd / CI 管道中行为一致：

```
Select LLM Provider:
  1) OpenAI (GPT-4o, etc.)
  2) Anthropic (Claude, etc.)
  3) Custom / OpenAI-compatible
Choice [1]:
```

**导出 API**：

```typescript
// 颜色
function supportsColor(): boolean
function color(text: string, ansiCode: string): string

// 格式化输出
function success(msg: string): void    // [ok] ...
function warn(msg: string): void       // [!!] ...
function fail(msg: string): void       // [xx] ...
function section(title: string): void  // --- Title ---

// 交互式 prompt（可注入 I/O 用于测试）
function createPrompt(input?: Readable, output?: Writable): {
  ask(question: string, defaultValue?: string): Promise<string>
  confirm(question: string, defaultYes?: boolean): Promise<boolean>
  select(question: string, options: SelectOption[], defaultIndex?: number): Promise<string>
  close(): void
}
```

### 5.2 `src/setup/detect-runtime.ts`

```typescript
interface RuntimeInfo {
  name: "bun" | "node" | "tsx";
  version: string;
}

function detectCurrentRuntime(): RuntimeInfo
function detectAvailableRuntimes(): RuntimeInfo[]
```

- 当前运行时：检测 `typeof globalThis.Bun`
- 系统可用运行时：Windows 用 `where.exe`，POSIX 用 `which`（通过 `child_process.execFileSync`）

### 5.3 `src/setup/detect-sources.ts`

从 `auto-config.ts:58-98` 提取，修复 ESM 违规（`require("node:fs")` → 顶层 `import`）。

```typescript
interface DetectedSource {
  id: string;
  name: string;
  detected: boolean;
  path?: string;
  message: string;
}

function detectSources(): DetectedSource[]
```

使用 `os.homedir()` + `path.join()` 构造路径，跨平台安全。

### 5.4 `src/setup/detect-api-keys.ts`

从 `auto-config.ts:104-133` 提取。

```typescript
interface DetectedApiKeys {
  openai?: string;
  anthropic?: string;
  source: string;  // "environment" | "~/.zshrc" | "none"
}

function detectApiKeys(): DetectedApiKeys
```

**Windows 适配**：`process.platform === "win32"` 时跳过 `.zshrc` / `.bashrc` 扫描（这些文件不存在于 Windows），仅检查 `process.env`。

### 5.5 `src/setup/validate-config.ts`

从 `config-wizard.ts:60-94` 直接提取。逻辑正确，已有完整测试覆盖。

```typescript
interface PartialConfig { /* 同现有定义 */ }
interface ValidationResult { valid: boolean; errors: string[] }

function validateConfig(config: PartialConfig): ValidationResult
```

### 5.6 `src/setup/generate-config.ts`

**关键变化**：用 `yaml` 库（已有依赖）的 `stringify()` 替代 config-wizard.ts 中 256 行手工 YAML 拼接。

```typescript
import { stringify } from "yaml";

function generateConfigYaml(config: PartialConfig): string {
  const header = "# Memoark Configuration\n# Generated by 'memoark init'\n\n";
  const obj = buildConfigObject(config);  // 填充默认值
  return header + stringify(obj, { indent: 2 });
}
```

### 5.7 `src/setup/init-wizard.ts` — 主编排

```typescript
interface InitOptions {
  auto?: boolean;        // --auto 静默模式
  force?: boolean;       // --force 覆盖已有配置
  configPath?: string;   // 自定义输出路径
  input?: Readable;      // 测试注入
  output?: Writable;     // 测试注入
}

async function runInit(options?: InitOptions): Promise<void>
```

**编排流程**：

```
detectCurrentRuntime()  →  显示运行时版本
       │
detectSources()  →  显示每个源的检测状态
       │
detectApiKeys()  →  预填 API key
       │
prompt: LLM provider  →  numbered select
prompt: LLM model     →  智能默认值（OpenAI→gpt-4o-mini, Anthropic→claude-3-haiku）
prompt: API key        →  用检测到的值作为默认
prompt: base_url       →  非标准 provider 时显示
       │
prompt: Embedding provider  →  numbered select（OpenAI / Ollama）
       │
prompt: Advanced privacy?   →  confirm（默认跳过）
       │
generateConfigYaml()  →  预览
       │
confirm: Save?  →  写入 memoark.yaml
       │
检测 dbe.yaml 是否存在  →  提示迁移
       │
输出 Next Steps
```

`--auto` 模式下跳过所有 prompt，从检测结果推断配置。

---

## 6. CLI 变更

### 6.1 新增 `init` 顶层命令

```typescript
// src/cli.ts
program
  .command("init")
  .description("Interactive setup wizard — generates memoark.yaml")
  .option("--auto", "Automatic mode, no prompts")
  .option("--force", "Overwrite existing configuration")
  .action(async (options) => {
    const { runInit } = await import("./setup/index.js");
    await runInit({ auto: options.auto, force: options.force });
  });
```

动态 `import()` 保持 CLI 启动速度。

### 6.2 `config init` 重定向

```typescript
configCmd.command("init")
  .description("Generate memoark.yaml (alias for 'memoark init')")
  .action(async () => {
    const { runInit } = await import("./setup/index.js");
    await runInit();
  });
```

替换现有的 100 行静态模板生成。

### 6.3 移除 Bun shebang

`src/cli.ts` 第 1 行的 `#!/usr/bin/env bun` 移除。shebang 归 bin 入口管。

---

## 7. 跨平台 Bin 入口

### 7.1 `bin/memoark.mjs`

```javascript
#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distCli = resolve(__dirname, "..", "dist", "cli.js");
const srcCli = resolve(__dirname, "..", "src", "cli.ts");

// npm install -g：使用编译后的 dist/
// git clone 开发：直接加载 TS 源码（bun 原生支持，或通过 tsx）
if (existsSync(distCli)) {
  await import(distCli);
} else {
  await import(srcCli);
}
```

**跨平台原理**：
- POSIX：`#!/usr/bin/env node` 由操作系统调用
- Windows：`npm install -g` 自动生成 `.cmd` wrapper，直接调用 `node bin/memoark.mjs`，shebang 被忽略
- `.mjs` 扩展名确保 ESM 解析，不依赖 `package.json` 的 `type` 字段

---

## 8. npm 发布配置

### 8.1 `package.json` 变更

```jsonc
{
  "bin": {
    "memoark": "./bin/memoark.mjs"       // was: "./src/cli.ts"
  },
  "main": "./dist/cli.js",               // NEW
  "exports": {                            // NEW
    ".": "./dist/cli.js"
  },
  "files": [                              // NEW — 只发布必要文件
    "dist/",
    "bin/",
    "README.md",
    "LICENSE"
  ],
  "engines": {
    "node": ">=18.0.0",                   // NEW — 支持 Node.js
    "bun": ">=1.0.0"
  },
  "scripts": {
    "dev": "bun src/cli.ts",
    "build": "tsc && node scripts/post-build.mjs",
    "prepublishOnly": "npm run build"     // NEW — 发布前自动构建
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/AndreLYL/memoark.git"  // FIX: was digitalbrain-extractor
  }
}
```

### 8.2 `scripts/post-build.mjs`

构建后处理：为 `dist/cli.js` 添加 shebang，POSIX 上设置可执行权限。

```javascript
// 读取 dist/cli.js → 在首行插入 #!/usr/bin/env node → 写回
// process.platform !== "win32" 时 chmod 755
```

---

## 9. Hermes 路径正则修复

`src/collectors/agent/hermes.ts`：

```typescript
// L59 BEFORE:
const match = filePath.match(/agents\/([^/]+)\/sessions\//);
// L59 AFTER:
const match = filePath.match(/agents[/\\]([^/\\]+)[/\\]sessions[/\\]/);

// L77 BEFORE:
const match = filePath.match(/([^/]+)\/sessions\//);
// L77 AFTER:
const match = filePath.match(/([^/\\]+)[/\\]sessions[/\\]/);
```

`[/\\]` 字符类同时匹配正斜杠和反斜杠。

---

## 10. 测试策略

### 10.1 从现有测试迁移

`tests/core/config-wizard.test.ts` 中的测试覆盖拆分迁移：

| 原测试 | 迁移目标 |
|--------|----------|
| `validateConfig` (L220-313) | `tests/setup/validate-config.test.ts` |
| `generateConfig` (L79-218) | `tests/setup/generate-config.test.ts` |
| `getConfigPath` / `isFirstRun` (L47-77) | `tests/setup/init-wizard.test.ts` |

### 10.2 新增测试

| 测试文件 | 覆盖内容 |
|----------|----------|
| `terminal.test.ts` | `supportsColor()` 在 NO_COLOR / FORCE_COLOR / TTY 下的行为；`createPrompt()` mock I/O |
| `detect-runtime.test.ts` | mock `execFileSync` 模拟 bun/node/tsx 可用/缺失 |
| `detect-sources.test.ts` | 创建临时目录 + mock `.jsonl` 文件验证检测 |
| `detect-api-keys.test.ts` | 设置/清除 `process.env` + mock `process.platform` 覆盖 Windows 分支 |
| `init-wizard.test.ts` | 用 `Readable.from()` mock 输入流，验证生成的 `memoark.yaml` 内容 |

### 10.3 可测试性设计

所有模块接受注入式依赖：
- `createPrompt(input?, output?)` 注入终端 I/O
- `InitOptions.input` / `InitOptions.output` 注入 wizard I/O
- 检测函数为纯函数（只读文件系统 + 环境变量）

---

## 11. 实施计划

### Phase 1: 基础设施（只增不删，无破坏性变更）

| 步骤 | 内容 |
|------|------|
| 1 | `src/setup/terminal.ts` + `tests/setup/terminal.test.ts` |
| 2 | `src/setup/detect-runtime.ts` + 测试 |
| 3 | `src/setup/detect-sources.ts` + 测试 |
| 4 | `src/setup/detect-api-keys.ts` + 测试 |
| 5 | `src/setup/validate-config.ts` + 测试 |
| 6 | `src/setup/generate-config.ts` + 测试 |
| 7 | `src/setup/index.ts` 统一导出 |

### Phase 2: Wizard + CLI 接入

| 步骤 | 内容 |
|------|------|
| 8 | `src/setup/init-wizard.ts` + 测试 |
| 9 | `src/cli.ts` 添加 `init` 命令，修改 `config init` |
| 10 | 删除旧文件：`auto-config.ts`、`config-wizard.ts`、`scripts/setup.ts` |
| 11 | 迁移 / 删除 `tests/core/config-wizard.test.ts` |

### Phase 3: 分发 + 跨平台收尾

| 步骤 | 内容 |
|------|------|
| 12 | 创建 `bin/memoark.mjs` + `scripts/post-build.mjs` |
| 13 | 删除 `bin/memoark`（shell 脚本）、`scripts/setup.sh` |
| 14 | 更新 `package.json` |
| 15 | 修复 `hermes.ts` 路径正则 |
| 16 | 移除 `src/cli.ts` 的 bun shebang |

---

## 12. 验证清单

- [ ] `bun run test` 全部通过
- [ ] `bun src/cli.ts init` 完整交互流程，检查生成的 memoark.yaml
- [ ] `bun src/cli.ts init --auto` 静默模式（需设置 OPENAI_API_KEY）
- [ ] `npm run build` 生成 dist/ 输出
- [ ] `npm pack` → `npm install -g ./memoark-*.tgz` → `memoark init` 可用
- [ ] macOS + Linux 实测
- [ ] Windows 实测（如有环境）

---

## 13. 已知限制

| 项 | 说明 | 处理 |
|----|------|------|
| `Bun.serve()` | `cli.ts:529` 使用 Bun 专有 API，Node.js 用户跑 `memoark serve` 会报错 | 后续加 `@hono/node-server` fallback |
| PGLite on Windows | WASM 理论可行但未实测 | `memoark doctor` 添加 Windows 特殊提示 |
| dbe.yaml 迁移 | 旧版用户可能有 `dbe.yaml` | init wizard 检测到时提示重命名 |
