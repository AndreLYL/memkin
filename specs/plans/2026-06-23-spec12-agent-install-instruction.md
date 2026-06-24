# Spec 12 (Auto-Use A): Agent 接入与指令层 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD, task-by-task.

> **分支须知**：plan 写在当前分支；实现分支建议 **`claude/spec12-agent-install`**，从 `docs/specs-and-research` 切出（与 Spec 7–11 同源，无堆叠依赖）。

> **系列说明**：本 spec 是「让 Memoark 被 AI 自动使用」三件套（A/B/C）的第一件（地基）。后续：Spec 13 (B) = Claude Code Hook 包；Spec 14 (C) = Agent 自安装 + skill（含 OpenClaw/Hermes）。B/C 都建在 A 之上。
> （原 P3「Recipe 连接器体系」经评估**决定不做**：Memoark 已有 `Collector` 接口 + pipeline，且只 4 个一方源；插件化是「源多 + 外部贡献者」时才回本的抽象，属过早设计。Phase 6 新源直接写成一方 collector。）

**Goal:** 一条命令 `memoark install` 让标准 MCP 客户端（Claude Code / Claude Desktop / Cursor / Codex / Windsurf）**全局**接入 Memoark，并写入一份**极简「记忆指令」**，使 Agent 在该用记忆时**可靠地主动去查**——直接满足两个核心用例：「这个项目推进到哪了」「X 上周跟我聊了啥」要落到 Memoark 检索，而非凭代码/空想作答。

**力度哲学（全线统一，来自 GBrain/MemGPT/OpenHuman 调研）：**
- **常驻小 core**：`get_session_context` 提供紧凑摘要，让 Agent 从不彻底失明（MemGPT 思路）。
- **cheap-first brain-first**：要查时 `search`（FTS，零成本，可激进）在前 → `query`/`recall`（语义，按需）在后 → 够好即停（GBrain `brain-first` 成本分级）。
- **渐进式三层披露**：L1 极简指令（常驻 rules 文件）→ L2 中等指令（MCP `instructions` 字段，对所有客户端兜底）→ L3 完整细节（工具 description / 后续 skill，按需展开）。
- **不设力度旋钮**：cheap-first 已压住成本，单一调好的默认即可（不引入 `recall_aggressiveness` 配置）。

**Architecture:** 新增 `src/install/` 模块（orchestrator + 幂等文件原语 + 单一真源指令文本 + 各客户端 adapter）；`src/cli.ts` 注册 `install`/`uninstall` 命令；`src/server/mcp.ts` 的 `createMcpServer` 补 L2 `instructions` 字段。指令文本**单一真源**（L1/L2 同源派生），各客户端只是写入位置/格式不同。

> 调研依据：`specs/research/2026-06-22-gbrain-comparison-research.md`、`specs/research/2026-06-08-openhuman-extraction-research.md`，及本轮 GBrain `skills/conventions/brain-first.md` / `skills/RESOLVER.md` / `CLAUDE.md`（成本分级 + 渐进披露）。

### 实测 API / 现状（已核当前分支）
- **CLI**：命令用 commander 在 `src/cli.ts` 注册（`program.command(...)`）；`serve` 在 ~750 行，`runServe()` 在 ~642 行起。本 spec 新增 `install`/`uninstall` 顶层命令。
- **MCP server**：`createMcpServer`（`src/server/mcp.ts`，**按函数名定位**——函数声明 ~L1701、内部 `new McpServer({ name:"memoark", version })` ~L1706）当前**未传 `instructions`**。SDK `McpServer(serverInfo, options?)` 的 `options.instructions?: string` 会被客户端注入上下文（**实现时核对 `@modelcontextprotocol/sdk` 的 `ServerOptions.instructions` 签名**）。
  > 评审 S12-P1-1：评审稿给的「L114」有误（114 处无此函数）；以函数名定位、不写死行号，避免随代码漂移。
- **客户端探测**：复用 `src/setup/detect-sources.ts` 的「查 home 下配置目录是否存在」模式。
- **MCP 注册项形态**（stdio）：`{ command, args:["serve","--mcp"] }`；`command` 由「当前 memoark 调用方式」推断（全局安装→`memoark`；否则 `npx -y @andre.li/memoark`）。
- **契约测试**：若 `tests/server/mcp-contract.test.ts` 断言 server info，需同步（本 spec 只加 `instructions`，不增删工具）。
- **测试**：`bunx vitest run <path> --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2`。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server/mcp.ts` | Modify | `createMcpServer` 传 L2 `instructions` |
| `src/install/directive.ts` | Create | **单一真源**：L1 极简文本 + L2 instructions 文本 + 标记常量 |
| `src/install/marked-block.ts` | Create | 幂等标记块 upsert/remove（markdown/text 追加文件）|
| `src/install/json-config.ts` | Create | JSON `mcpServers` upsert/remove（保留其它键，缺文件则建）|
| `src/install/toml-config.ts` | Create | Codex `config.toml` `[mcp_servers.memoark]` upsert/remove |
| `src/install/command.ts` | Create | 推断写出的 `command`/`args`（memoark on PATH / npx 回退）|
| `src/install/clients/*.ts` | Create | 各客户端 adapter（路径解析 + plan 产出）|
| `src/install/index.ts` | Create | orchestrator：install / uninstall / detect-all / dry-run |
| `src/cli.ts` | Modify | 注册 `install` / `uninstall` 命令 |
| `tests/install/*.test.ts` | Create | 各任务测试 |
| `README.md` / `README.en.md` | Modify | 「一键接入任意 Agent」说明 |

---

## 指令文本（本 spec 锁定，写进 `src/install/directive.ts` 作单一真源）

### L1（极简 · 常驻 rules 文件，约 120 字 / 4 行）
```md
<!-- memoark:start -->
## Memoark — 你的个人记忆库
你接入了 Memoark：用户关于「人 / 项目 / 决策 / 任务 / 过往」的本地持久记忆，是这些事的**事实来源**。
- **何时查**：问题涉及具体的人、项目进展、过去的决定、待办，或带「上周 / 之前 / 我们当时…」时——先查 Memoark，别只凭代码或猜测。
- **怎么查（便宜优先）**：先 `search`（关键词，零成本）→ 不够再 `query` / `recall`（语义 + 引用）；会话开始可先 `get_session_context` 进入状态。
- **何时不查**：与用户个人世界无关的通用问题（纯语法 / 通用算法），别打扰记忆库。
- 更多用法（写回、图谱、人物画像）按需发现：调用工具时看其说明，或 `get_health`。
<!-- memoark:end -->
```

### L2（中等 · MCP `instructions` 字段，对所有 MCP 客户端兜底）
```
Memoark is the user's local-first personal memory — the source of truth about the user's people, projects, decisions, tasks, and history.

Brain-first, cheap-first. When a request concerns a specific person, a project's status/history, a past decision, a todo, or contains "last week / earlier / what did we…", consult Memoark BEFORE answering from code or assumptions:
  1) search  (keyword, zero-cost)
  2) query / recall  (semantic + cited) — only if search is thin
  Accept good results; do not over-escalate.
Session start: call get_session_context for a compact digest of active projects, recent decisions, open tasks, and key people.
Project-status questions: combine Memoark (decisions/tasks/timeline) WITH repo reality (git/code); do not answer from code alone.
Do NOT consult Memoark for generic questions unrelated to the user's world (pure syntax, general algorithms).
Write-back (conservative): on a clear decision/discovery, or when the user says "remember this", persist via put_page / add_timeline_entry; if unsure, ask.
More tools (graph traversal, person profile, daily report, troubleshoot) are discoverable via their tool descriptions and get_health.
```

> L1 与 L2 同源：`directive.ts` 导出 `DIRECTIVE_L1`（中文 markdown 块，含 start/end 标记）与 `DIRECTIVE_L2`（英文纯文本）。标记常量 `MEMOARK_BLOCK_START="<!-- memoark:start -->"` / `MEMOARK_BLOCK_END="<!-- memoark:end -->"`。

---

## 客户端矩阵（全局作用域；`--project` 时改写项目级路径）

| 客户端 | MCP 注册（全局） | L1 指令文件（全局） | `--project` 时 |
|---|---|---|---|
| **claude-code** | `claude mcp add memoark -s user -- …`（CLI 存在则优先）/ 否则 upsert `~/.claude.json` `mcpServers` | 追加 `~/.claude/CLAUDE.md` | `.mcp.json` + `./CLAUDE.md` |
| **claude-desktop** | upsert `claude_desktop_config.json`（mac: `~/Library/Application Support/Claude/`；win: `%APPDATA%/Claude/`；linux: `~/.config/Claude/`）| ❌ 无 rules → **靠 L2 兜底** | 同左（Desktop 无项目概念）|
| **cursor** | upsert `~/.cursor/mcp.json` | `~/.cursor/rules/memoark.mdc`（frontmatter `alwaysApply: true`）| `.cursor/mcp.json` + `.cursor/rules/memoark.mdc` |
| **codex** | upsert `~/.codex/config.toml` `[mcp_servers.memoark]` | 追加 `~/.codex/AGENTS.md` | `./.mcp`? → 用 `./AGENTS.md`（MCP 仍全局）|
| **windsurf** | upsert `~/.codeium/windsurf/mcp_config.json` | 追加 `~/.codeium/windsurf/memories/global_rules.md` | `.windsurfrules` |

> 路径在实现时**逐一核对官方文档/版本**后锁定；adapter 用注入的 `home`/`platform` 以便测试。Cursor `.mdc` 需要 frontmatter（`---\nalwaysApply: true\n---` + L1 正文，不含 html 注释标记时改用文本标记块策略——见 Task 2 备注）。

---

## Task 1: MCP server `instructions` 字段（L2，独立可先发）

- [ ] **Step 1: 写失败测试** `tests/server/mcp-instructions.test.ts`：`createMcpServer(stores)` 构造的 server 的 server-info/options 暴露 `instructions`，且包含关键约束串（如 `"Brain-first"`、`"get_session_context"`、`"source of truth"`）。（按 SDK 实际可读取处断言；若只能经 initialize 响应，则起内存 server 读 `instructions`。）
- [ ] **Step 2-3: 跑失败 → 实现** 新建 `src/install/directive.ts` 导出 `DIRECTIVE_L2`；在 `src/server/mcp.ts` 的 `createMcpServer` 内（搜 `new McpServer(` 定位）改为 `new McpServer({name,version}, { instructions: DIRECTIVE_L2 })`。核对 SDK `ServerOptions.instructions` 签名。
- [ ] **Step 4: 同步契约** 若 `tests/server/mcp-contract.test.ts` 断言 server info，更新；确认工具清单**未变**。
- [ ] **Step 5: Commit** `feat(mcp): add server instructions (L2 memory directive)`

## Task 2: 指令单一真源 + 幂等标记块

- [ ] **Step 1: 写失败测试** `tests/install/marked-block.test.ts`：①空文件/无文件 → `upsertBlock(content, DIRECTIVE_L1)` 产出含 start/end 的块；②已有他文 → 块**追加在末尾**、原文不动；③再次 upsert（内容变更）→ **只替换块内**、不重复追加（幂等）；④`removeBlock` → 精确删块、保留其余、收尾空行整洁。`tests/install/directive.test.ts`：`DIRECTIVE_L1` 含 start/end 标记且含「先 `search`」「get_session_context」；`DIRECTIVE_L2` 为非空英文纯文本。
- [ ] **Step 2-3: 跑失败 → 实现** `directive.ts` 补 `DIRECTIVE_L1` + 标记常量；`marked-block.ts` 实现 `upsertBlock`/`removeBlock`（基于 start/end 正则切片）。
  > 备注：Cursor `.mdc` 需 frontmatter 且不宜放 html 注释——adapter 对 `.mdc` 用「整文件托管」策略（文件由 memoark 独占：install 写全量、uninstall 删文件），其余文件用标记块追加。把这条差异编码进 adapter，不污染 `marked-block`。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(install): directive single-source + idempotent marked block`

## Task 3: 配置文件原语（JSON / TOML upsert）

- [ ] **Step 1: 写失败测试** `tests/install/json-config.test.ts`：`upsertMcpServer(json, "memoark", entry)` → 新增不动其它 server；已存在则覆盖 `memoark`；无 `mcpServers` 则建；`removeMcpServer` 删键保其余；非法 JSON → 抛带路径的清晰错误。`tests/install/toml-config.test.ts`：对 `~/.codex/config.toml` 文本，upsert `[mcp_servers.memoark]`（command/args）保留其它表；remove 精确删表。
- [ ] **Step 2-3: 跑失败 → 实现** `json-config.ts`（`JSON.parse`/序列化保 2 空格缩进）；`toml-config.ts`（最小 TOML 编辑：定位/替换/插入 `[mcp_servers.memoark]` 块，**不引重依赖**，够用即可）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(install): json + toml mcp config upsert/remove`

## Task 4: command 解析

- [ ] **Step 1: 写失败测试** `tests/install/command.test.ts`：模拟「memoark 在 PATH」→ `{command:"memoark", args:["serve","--mcp"]}`；模拟「不在 PATH / 经 npx」→ `{command:"npx", args:["-y","@andre.li/memoark","serve","--mcp"]}`；`--mcp-http` 选项时 args 改 `serve --mcp-http`（默认 stdio）。**已核：`--mcp-http` flag 确实存在（`src/cli.ts` serve 命令 `.option("--mcp-http", …)`，约 L755），评审 S12-P2-1 的「需核实」已确认无误。**
- [ ] **Step 2-3: 跑失败 → 实现** `command.ts`：探测全局可执行（`which memoark` / `process.execPath` 线索），回退 npx。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(install): resolve mcp launch command (binary/npx)`

## Task 5: 各客户端 adapter

- [ ] **Step 1: 写失败测试** `tests/install/clients.test.ts`（注入 `home`/`platform`）：每个 adapter ①`detect()` 按配置目录存在与否返回真假；②`plan()` 产出正确的 file ops（MCP 路径 + 形态 json/toml、rules 路径 + 形态 block/managed-file；claude-desktop 无 rules op）；③mac/win/linux 路径分支正确。
- [ ] **Step 2-3: 跑失败 → 实现** `clients/{claude-code,claude-desktop,cursor,codex,windsurf}.ts`，统一接口：
  ```ts
  interface ClientAdapter {
    id: string; displayName: string;
    detect(home: string, platform: NodeJS.Platform): boolean;
    plan(opts: { home: string; platform: NodeJS.Platform; scope: "global"|"project"; cwd: string; launch: LaunchCmd }): InstallOp[];
  }
  type InstallOp =
    | { path: string; kind: "json-mcp"|"toml-mcp"; action: "upsert"|"remove"; entry?: McpEntry }
    | { path: string; kind: "marked-block"|"managed-file"; action: "upsert"|"remove"; content?: string }
    | { kind: "cli"; action: "upsert"|"remove"; args: string[] };  // 无 path：走子进程，如 `claude mcp add/remove`
  ```
  claude-code 优先 `claude mcp add`（探测到 `claude` CLI 时，plan 产出一个 `kind:"cli"` op，`args` 形如 `["mcp","add","memoark","-s","user","--",<launch.command>,...launch.args]`；否则降级 `json-mcp` 写 `~/.claude.json`）。**orchestrator（Task 6）必须有 `kind:"cli"` 的执行分支**（子进程调用），否则该 op 无人处理。
  > 评审 S12-P0-1：补齐了缺失的 `kind:"cli"` variant 与其执行分支约定。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(install): per-client adapters (cc/desktop/cursor/codex/windsurf)`

## Task 6: orchestrator + CLI（install / uninstall / dry-run / detect-all）

- [ ] **Step 1: 写失败测试** `tests/install/orchestrator.test.ts`（用 tmp home）：①`install({agent:"cursor"})` → `~/.cursor/mcp.json` 含 memoark 且 `~/.cursor/rules/memoark.mdc` 含 L1；②再跑一次幂等（无重复块、json 不长出第二个 memoark）；③`uninstall({agent:"cursor"})` → 移除两者；④`install({})`（无 agent）→ 仅对 `detect()` 命中的客户端动手；⑤`dryRun:true` → 返回计划、**不写盘**。
- [ ] **Step 2-3: 跑失败 → 实现** `index.ts`：聚合 adapter→执行 InstallOp（调 Task 2/3 原语 + `cli` op 走子进程）；`detectAll()`；`dryRun` 渲染计划。`src/cli.ts` 注册：
  ```
  memoark install   [--agent <id...>] [--project] [--http] [--dry-run]
  memoark uninstall [--agent <id...>] [--project]
  ```
  无 `--agent` 时 detect-all 后交互勾选（非 TTY/`--yes` 直接全装）；输出每个客户端写了哪些文件 + 「重启客户端生效」提示。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(cli): memoark install/uninstall (global default, dry-run, detect-all)`

## Task 7: 文档

- [ ] **Step 1: README** `README.md` / `README.en.md` 的「接入你的 Agent（MCP）」章节前置一句：`memoark install`（一键写好 MCP 配置 + 记忆指令，默认全局）；保留手动 JSON 作为 fallback。补一张「客户端支持矩阵 + 自动召回能力」表（CC 最强、其余靠指令）。
- [ ] **Step 2: Commit** `docs(readme): memoark install one-command onboarding`

---

## 验收（Definition of Done）
- `memoark install` 在本机标准 MCP 客户端上：①工具可用；②rules/instructions 就位；③重复安装幂等；④`uninstall` 干净回滚；⑤`--dry-run` 零写盘预览。
- 真机冒烟：在 Claude Code 里问「memoark 这个项目推进到哪了」「X 上周聊了啥」，Agent 主动走 `search`→`query`/`recall`（而非只读代码/空答）。
- 全量 `bun run test` + `bun run typecheck` + `bun run lint` 通过；MCP 契约测试同步。

## 非目标（明确划走，避免范围膨胀）
- 确定性 hook 自动召回 / 自动写回 → **Spec 13 (B)**。
- OpenClaw/Hermes 自安装 + skill、`MEMOARK_FOR_AGENTS.md` → **Spec 14 (C)**。
- Recipe / 插件化数据源连接器 → **经评估决定不做**（Phase 6 新源走一方 `Collector`；插件化留到真有外部贡献者需求再议）。
- `recall_aggressiveness` 配置旋钮 → 已决定不做。
