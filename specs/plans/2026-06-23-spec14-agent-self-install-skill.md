# Spec 14 (Auto-Use C): Agent 自安装 + Skill（含 OpenClaw/Hermes） — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD, task-by-task.

> **分支须知**：实现分支 **`claude/agent-auto-use-specs`**（堆叠在 Spec 12/13 上；复用 `src/install` 框架与 adapter 接口、指令真源）。

> **系列说明**：Auto-Use 系列（A/B/C）第三件、收尾件。依赖 **Spec 12 (A)** 的 `src/install` 框架与 `ClientAdapter` 接口。把"自动被用"从「用户手动 `install`」推进到「**Agent 自己装**」，并补齐 **OpenClaw/Hermes** 这个非标准范式宿主。（原计划的 Spec 15「Recipe 连接器体系」经评估不做。）

**Goal:** 让任意 Agent 能**自己**把用户接上 Memoark，并提供 L3 完整能力说明：
1. **`MEMOARK_FOR_AGENTS.md`** —— 给 Agent 读的自安装剧本（仿 GBrain `INSTALL_FOR_AGENTS.md`）。用户对任意 Agent 说「按这个链接把我接上 Memoark」，Agent 自跑 Spec 12/13 命令。
2. **单一 `memoark` skill** —— 一份 SKILL.md = L3 全细节（工具目录 + cheap-first 约定 + 写回范式 + 例子）；`memoark skill scaffold` 铺进 workspace / `~/.hermes/skills/`。
3. **OpenClaw/Hermes adapter** —— `memoark install --agent hermes`：写 `config.yaml` `mcp_servers` + 铺 skill。

**Architecture:** 在 Spec 12 的 `src/install` 上扩：新增 `skill.ts`（单一真源 SKILL.md + scaffold）、`yaml-config.ts`（Hermes config.yaml 编辑）、`clients/hermes.ts`（新 adapter）；CLI 加 `memoark skill scaffold` 与 `--agent hermes`；仓库根加 `MEMOARK_FOR_AGENTS.md`。skill 走**约定**（brain-first convention 写进 SKILL.md），不建重型 plugin lifecycle hook。

> 力度/披露承接 Spec 12/13：skill 即 L3，按需展开；OpenClaw/Hermes 的「每条消息先过脑」用 skill 约定表达，不硬插件化。

### 实测 API / 现状（已核当前分支 + 调研）
- **Spec 12 框架**：`ClientAdapter`（`detect`/`plan` + `InstallOp`）、`json-config`、`command.ts`、`directive.ts`、orchestrator —— 本 spec 直接复用与扩展。
- **OpenClaw/Hermes 接入**（调研）：MCP 写 `config.yaml` 的 `mcp_servers:`（`~/.hermes/config.yaml`，自托管 `/opt/data/config.yaml`），CLI `hermes mcp`，`/reload-mcp` 生效；skill 丢 `~/.hermes/skills/` 或 config `external_dirs`。**实现时核对 Hermes 当前 config schema（mcp_servers vs tools 段）**。
  > 评审 S14-P2-1：Memoark 现从 **`~/.openclaw/agents`** 采集 Hermes 会话（`src/setup/detect-sources.ts:70`、`src/collectors/agent/hermes.ts:71`），而配置/skill 目录据调研为 **`~/.hermes`**——两前缀可能并存或随版本迁移。故 `detect()` **兼容两者**；config/skill 精确根路径实现时实测锁定（`~/.hermes` 不存在则回落 `~/.openclaw`）。
- **YAML**：项目已用 `yaml` 包解析 `memoark.yaml`，`yaml-config.ts` 复用之（保留注释优先用 `yaml` 的 Document API）。
- **Claude Code skill 格式**：`SKILL.md` 需 frontmatter `name` + `description`；放 `.claude/skills/<name>/SKILL.md`。**核对当前 skill 规范**。
- **测试**：`bunx vitest run <path> --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2`。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/install/skill.ts` | Create | **单一真源** `memoark` SKILL.md 文本 + `scaffoldSkill(dir)` |
| `src/install/yaml-config.ts` | Create | Hermes `config.yaml` `mcp_servers.memoark` upsert/remove（保注释/其它键）|
| `src/install/clients/hermes.ts` | Create | hermes adapter（detect `~/.hermes` **或** `~/.openclaw`；plan：yaml-mcp op + skill managed-file op）|
| `src/install/index.ts` | Modify | 注册 hermes adapter；导出 `scaffoldSkill` |
| `src/cli.ts` | Modify | `memoark skill scaffold [--dir]`；`install --agent hermes` 自然可用 |
| `MEMOARK_FOR_AGENTS.md` | Create | 仓库根 · Agent 自安装剧本（frontmatter + steps + verify）|
| `tests/install/*.test.ts` | Create | skill scaffold / yaml upsert / hermes adapter / FOR_AGENTS sanity |
| `README.md` / `README.en.md` | Modify | 「Agent 自安装」+ OpenClaw/Hermes 接入 |

---

## `memoark` SKILL.md（本 spec 锁定大纲，写进 `skill.ts`）
- **frontmatter**：`name: memoark`，`description:`（一句：用户个人记忆，何时该用）。
- **正文（L3）**：
  - 一句定位（同 L1）。
  - **何时用 / 不用**（同 L1 触发条件）。
  - **cheap-first 召回顺序**：`search` → `query`/`recall` → 够好即停；会话起手 `get_session_context`。
  - **工具目录**（按类）：检索（query/search/get_session_context/get_entity_profile/list_signals_by_entity）、合成（recall/synthesize/prep_for_person/daily_report/troubleshoot）、写回（put_page/add_timeline_entry/manage_links/manage_tags）、图谱、健康。
  - **写回范式**：保守、明确决策/发现或显式「记住」才写；slug 命名约定（`decisions/...`、`entities/...`）。
  - **两个范例**：①「项目推进到哪了」→ get_session_context + query + 合并仓库现状；②「X 上周聊了啥」→ query/recall（人物）。

---

## Task 1: 单一 `memoark` skill + scaffold

- [ ] **Step 1: 写失败测试** `tests/install/skill.test.ts`：`MEMOARK_SKILL` 含 frontmatter `name: memoark` + 关键段（「先 `search`」「get_session_context」「写回」「不查通用问题」）；`scaffoldSkill(tmpDir)` → 写出 `<dir>/memoark/SKILL.md` 内容一致；重复 scaffold 幂等（覆盖同文件、不报错）。
- [ ] **Step 2-3: 跑失败 → 实现** `skill.ts`（`MEMOARK_SKILL` 文本 + `scaffoldSkill`）；`cli.ts` 加 `memoark skill scaffold [--dir <path>]`（默认 `.claude/skills/`，`--dir` 可指 `~/.hermes/skills/`）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(install): single memoark skill + scaffold command`

## Task 2: Hermes YAML config + adapter + `--agent hermes`

- [ ] **Step 1: 写失败测试** `tests/install/yaml-config.test.ts`：`upsertMcpServer(yaml, "memoark", entry)` → 新增 `mcp_servers.memoark`、保留其它表与注释；已存在则覆盖；`removeMcpServer` 删键保其余。`tests/install/hermes-adapter.test.ts`（注入 home）：`detect()` 按 `~/.hermes` **或** `~/.openclaw` 存在与否（兼容两布局）；`plan()` 产出 yaml-mcp op（实测命中的 `…/config.yaml`）+ skill managed-file op（`…/skills/memoark/SKILL.md`）。
- [ ] **Step 2-3: 跑失败 → 实现** `yaml-config.ts`（`yaml` Document API 保注释）；`clients/hermes.ts`（接 `ClientAdapter`，复用 `command.ts`/`skill.ts`）；`index.ts` 注册。orchestrator 已能跑新 op 类型（`yaml-mcp` 复用 yaml-config；`managed-file` Spec 12 已有）。
  > 提示输出加「改完在 Hermes 会话里 `/reload-mcp` 生效」。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(install): hermes adapter (config.yaml mcp + skill)`

## Task 3: `MEMOARK_FOR_AGENTS.md`（Agent 自安装剧本）

- [ ] **Step 1: 写失败测试** `tests/install/for-agents.test.ts`（轻量结构校验）：文件存在；含 frontmatter（`id`/`name`/`version`）；含「You are the installer」式指令；引用真实命令 `memoark install`、`memoark hooks install`、`memoark skill scaffold`、验证用 query；不含已废弃命令。
- [ ] **Step 2-3: 跑失败 → 实现** 写 `MEMOARK_FOR_AGENTS.md`：frontmatter（id: memoark-install, requires: Node>=18, est: ~5min）+ 步骤：①确认 memoark 可用（`npx @andre.li/memoark --help`）②无配置则 `memoark start` 引导（**已核：`memoark start` 命令存在，`src/cli.ts:790`；评审 S14-P1-1 称其「不存在」有误，故保留**）③识别"我在哪个客户端" → `memoark install --agent <id>`（默认全局）④若 Claude Code 追加 `memoark hooks install`（说明写回 opt-in）⑤可选 `memoark skill scaffold` ⑥验证：跑一条 `query` 看是否召回 ⑦healthcheck：`get_health`。强调本地优先、不外泄。
- [ ] **Step 4-5: 跑通过 → Commit** `docs(agents): add MEMOARK_FOR_AGENTS.md self-install playbook`

## Task 4: 文档

- [ ] **Step 1: README** 加「让 Agent 自己接入」：贴 `MEMOARK_FOR_AGENTS.md` 的 raw URL 用法（对 Agent 说「按此链接接入」）；OpenClaw/Hermes 一节（`memoark install --agent hermes` + `/reload-mcp`）；能力矩阵补 Hermes 行。
- [ ] **Step 2: Commit** `docs(readme): agent self-install + openclaw/hermes`

---

## 验收（Definition of Done）
- 对支持读外链的 Agent 说「按 `MEMOARK_FOR_AGENTS.md` 接入我」，Agent 能自跑命令完成接入并用 query 验证。
- `memoark install --agent hermes` 写好 `config.yaml` mcp + skill；`memoark skill scaffold` 在任意目录铺出 SKILL.md。
- 幂等 / 卸载对称 / `--dry-run` 零写盘（继承 Spec 12 orchestrator）。
- `bun run test` + `typecheck` + `lint` 通过。

## 非目标
- OpenClaw/Hermes 的硬 plugin lifecycle hook（「每条消息先过脑」用 skill 约定表达）→ 未来扩展。
- 多 skill / RESOLVER 式 skillpack → 已决定只做单一 skill。
- Recipe / 插件化数据源连接器 → **经评估决定不做**（Phase 6 新源走一方 `Collector`）。
