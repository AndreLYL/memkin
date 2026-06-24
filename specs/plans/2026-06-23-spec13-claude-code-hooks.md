# Spec 13 (Auto-Use B): Claude Code Hook 包 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. TDD, task-by-task.

> **分支须知**：实现分支 **`claude/agent-auto-use-specs`**（与 Spec 12 同分支，堆叠在其上；复用 Spec 12 的 `src/install` 文件原语与指令真源）。

> **系列说明**：四件套第二件。依赖 **Spec 12 (A)**（指令真源 `src/install/directive.ts`、JSON 配置 upsert）。建在 A 之上：A 让模型「会主动查」，B 在 Claude Code 上把读侧做成「零感知自动」、并加可选的「自动写回」。

**Goal:** 一个 `memoark hooks install` 给 Claude Code 装三个生命周期 hook，把记忆变成「自动到手」：
1. **SessionStart** → 自动把 `get_session_context` 摘要注入上下文（会话一开就记得你在忙啥）。
2. **UserPromptSubmit** → 每条 prompt 前用**零成本 FTS** 试召回，命中才注入（真·自动召回，不撑爆上下文）。
3. **SessionEnd**（opt-in）→ 会话结束异步抽取写回（记忆自生长）。

**默认策略（Spec B 头脑风暴已定）：读侧两 hook 默认开；写回 hook 默认关，靠 `--write-back` 显式 opt-in（成本 + 隐私）。**

**Architecture:** 新增 `src/hooks/`：三个 event handler（读 stdin hook JSON → 输出规范 JSON）、一个「快召回」客户端（**优先打已运行 `serve` 的 REST `/search`，否则回退直连 store**）、settings.json 幂等编辑器、install/uninstall 编排。CLI 加内部命令 `memoark hook <event>` 与面向用户的 `memoark hooks install|uninstall`。复用 Spec 12 的 `directive.ts`、`json-config` 思路与全局作用域哲学。

> 力度承接 Spec 12：cheap-first（FTS 闸门）+ 常驻 core（SessionStart 的 session digest）。写回用现成 L1/L2 噪声过滤当准入闸门。

### 实测 API / 现状（已核当前分支）
- **Claude Code hooks**：写 `~/.claude/settings.json` 的 `hooks` 键；事件 `SessionStart`（matcher `startup`/`resume`/`clear`/`compact`）、`UserPromptSubmit`（无 matcher）、`SessionEnd`。每项 `{ type:"command", command:"memoark hook <event>" }`。**实现时核对 CC 当前 hook schema 与事件名/matcher**。
- **注入方式（Task 1 锁定）**：SessionStart / UserPromptSubmit 的 hook **stdout 直接作为额外上下文注入**（这两个事件特有）；结构化形式用 `{ "hookSpecificOutput": { "hookEventName":"<事件名>", "additionalContext":"<文本>" } }`（依据 Claude Code Hooks 文档 code.claude.com/docs/en/hooks-guide）。**Task 1 先用 `claude` 当前版本文档 / `--help` 复核字段名再锁定**；若结构化被忽略则回退「纯文本 stdout」。注入文本**追加在用户消息之后以保 prompt 缓存**。
  > 评审 S13-P1-1：格式改为「Task 1 调研锁定 + 纯 stdout 回退」，不再无依据断言单一格式。
- **session context**：`getSessionContext(stores, days=7)`（`src/server/context.ts:13`）直接复用。
- **快召回（已核 zero-cost）**：REST `GET /search?q=...`（`src/server/api.ts` ~L178）→ `SearchEngine.search()`（`src/store/search.ts` ~L232）是 **page 级 FTS-only**（`to_tsquery('simple',…)`，**不调 embedding、零成本**），正合 cheap-first。**切勿用** `POST /query` / `SearchEngine.query()`（FTS+向量 hybrid，会触发 embedding）。**`GET /search` 无 `mode` 参数——不要传 `mode=fts`**。默认 `serve` 端口 3927。**优先 REST 的关键原因**：PGLite 单写者，`serve` 持库时另起进程直连可能撞 data-dir lock（见 `feat/data-dir-lock`）；打热服务的 REST 既快又避免锁冲突。
  > 评审 S13-P0-1：已确认 `/search` 即 FTS-only、zero-cost 成立；删除不存在的 `mode=fts`，并明确回退走 `SearchEngine.search()`（非 `query()`）。
- **写回**：`memoark extract --source claude-code`（增量、已去重）已可用；hook 只负责「去抖 + 后台触发」。
- **配置 upsert**：复用/泛化 Spec 12 的 JSON upsert（settings.json 与 mcp 配置同为 JSON，但要「按 command 含 `memoark hook` 精确识别」以免误删用户其它 hook）。
- **测试**：`bunx vitest run <path> --pool=forks --poolOptions.forks.maxForks=2 --poolOptions.forks.minForks=2`。

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/hooks/handlers.ts` | Create | `runSessionStart` / `runUserPrompt` / `runSessionEnd`（读 stdin、产出 hook 输出 JSON）|
| `src/hooks/recall-client.ts` | Create | 快召回：优先 REST `/search`（热 serve），回退直连 store；统一 `{hits, scored}` |
| `src/hooks/inject.ts` | Create | 把 hits 渲染成受 token 预算约束的 `additionalContext`（追加语义）|
| `src/hooks/settings-edit.ts` | Create | `~/.claude/settings.json` hooks upsert/remove（按 `memoark hook` 识别，保留其它）|
| `src/hooks/install.ts` | Create | hooks install/uninstall 编排（含 `--write-back` 控制是否注册 SessionEnd）|
| `src/hooks/writeback.ts` | Create | 去抖 + 后台触发 `extract`；未 opt-in 则 no-op |
| `src/cli.ts` | Modify | 注册内部 `memoark hook <event>` + `memoark hooks install|uninstall` |
| `tests/hooks/*.test.ts` | Create | 各任务测试 |
| `README.md` / `README.en.md` | Modify | 「Claude Code 自动召回（hooks）」说明 |

---

## 注入预算（本 spec 锁定）
- UserPromptSubmit：**top-3 命中**、**score ≥ 阈值**（默认 0.5，承接 GBrain「>0.5 即采纳」）、**注入 ≤ 3000 字符**（按 `text.length` 截断，**不引 tokenizer 依赖**；≈ 750 token @ 4 chars/token 粗估）、超额截断；**无命中 → 输出空、零注入**。
  > 评审 S13-P1-2：token 预算改为**字符预算**，规避运行时无原生 tokenizer 的计量难题。
- 性能目标：UserPromptSubmit 端到端 **< 500ms**（热 REST 命中预期 < 100ms）；冷回退直连仅在无 serve 时。
- SessionStart：`get_session_context(7d)` 原样注入（已紧凑）；无库静默跳过。

---

## Task 1: hook 输出契约 + SessionStart handler

- [ ] **Step 0: 锁定 CC hook stdout 协议**（评审 S13-P1-1）：查 `claude` 当前版本 Hooks 文档 / `--help`，确认 SessionStart & UserPromptSubmit 的注入字段（预期 `hookSpecificOutput.additionalContext`），把锁定结论写回本 spec「注入方式」小节，作为后续实现依据；若结构化不被识别，约定回退纯文本 stdout。
- [ ] **Step 1: 写失败测试** `tests/hooks/session-start.test.ts`（mock stores）：`runSessionStart(stdinJson, deps)` 返回的 JSON 含 `hookSpecificOutput.hookEventName==="SessionStart"` 且 `additionalContext` 含 `getSessionContext` 文本（活跃项目/待办等）；无库/空摘要 → 返回**空对象**（不注入）。
- [ ] **Step 2-3: 跑失败 → 实现** `handlers.ts` 的 `runSessionStart`：解析 stdin（拿 cwd/session 信息备用）、调 `getSessionContext`、包成 hookSpecificOutput。`cli.ts` 加内部 `memoark hook session-start`（读 stdin→调 handler→打印 JSON）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(hooks): SessionStart injects session context`

## Task 2: 快召回客户端 + UserPromptSubmit handler

- [ ] **Step 1: 写失败测试** `tests/hooks/recall-client.test.ts`：serve 在跑（mock fetch 200）→ 走 REST；serve 不在（fetch 抛错/连接拒绝）→ 回退直连 store；返回统一打分结果。`tests/hooks/user-prompt.test.ts`：①prompt 命中（mock 高分结果）→ `additionalContext` 含引用片段、**条数 ≤3、长度受预算约束**；②无命中/低于阈值 → **返回空、零注入**；③超长结果被截断到预算内。
- [ ] **Step 2-3: 跑失败 → 实现** `recall-client.ts`（优先 `GET http://localhost:<port>/search?q=...`，**FTS-only、无 `mode` 参数**；超时/失败回退直连 `SearchEngine.search()`，**不要用 `query()`**）；`inject.ts`（top-k + 阈值 + **字符预算** + 追加语义渲染）；`handlers.ts` 的 `runUserPrompt`（从 stdin 取 `prompt`→召回→inject）。`cli.ts` 加 `memoark hook user-prompt`。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(hooks): UserPromptSubmit zero-cost FTS auto-recall (gated)`

## Task 3: SessionEnd 写回（opt-in + 去抖）

- [ ] **Step 1: 写失败测试** `tests/hooks/session-end.test.ts`：①未 opt-in → `runSessionEnd` **no-op**（不触发 extract）；②opt-in 且距上次 > 去抖窗 → 触发后台 extract（mock spawn，断言被调）；③opt-in 但在去抖窗内 → 跳过；④无论如何 hook **快速返回、不阻塞**（extract 后台化）。
- [ ] **Step 2-3: 跑失败 → 实现** `writeback.ts`（读 opt-in 标志 + 去抖时间戳文件，如 `~/.memoark/.last-writeback`；后台 detached spawn `memoark extract --source claude-code`，复用 L1/L2 噪声过滤准入）；`handlers.ts` 的 `runSessionEnd`。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(hooks): SessionEnd opt-in async write-back (debounced)`

## Task 4: settings.json hooks 幂等编辑

- [ ] **Step 1: 写失败测试** `tests/hooks/settings-edit.test.ts`：①空/无 settings → `upsertHooks(json, events)` 建出三事件项；②已有用户其它 hook → **保留**、只加/更新 `memoark hook` 项；③再次 upsert → 幂等不重复；④`removeHooks` → 仅删 `memoark hook` 项、保其余；⑤`--write-back` 关时**不写 SessionEnd 项**。
- [ ] **Step 2-3: 跑失败 → 实现** `settings-edit.ts`（JSON 解析；按 `command` 含 `"memoark hook"` 识别归属；保留缩进）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(hooks): idempotent settings.json hook upsert/remove`

## Task 5: hooks install/uninstall + CLI

- [ ] **Step 1: 写失败测试** `tests/hooks/install.test.ts`（tmp home）：①`hooksInstall({})` → settings.json 含 SessionStart+UserPromptSubmit、**无** SessionEnd；②`hooksInstall({writeBack:true})` → 含三者；③幂等；④`hooksUninstall()` → 移除全部 memoark hook；⑤`dryRun` → 不写盘、返回计划。
- [ ] **Step 2-3: 跑失败 → 实现** `install.ts`；`cli.ts` 注册：
  ```
  memoark hooks install   [--write-back] [--project] [--dry-run]
  memoark hooks uninstall [--project]
  ```
  默认全局 `~/.claude/settings.json`；`--project` 写 `./.claude/settings.json`。输出装了哪些 hook + 「重启/重开会话生效」+（未开写回时）提示 `--write-back` 可开。
  > 可选衔接：Spec 12 的 `memoark install --agent claude-code` 末尾提示「想要自动召回？跑 `memoark hooks install`」（不自动装，避免越权）。
- [ ] **Step 4-5: 跑通过 → Commit** `feat(cli): memoark hooks install/uninstall (read-on, write-back opt-in)`

## Task 6: 文档

- [ ] **Step 1: README** 在「接入你的 Agent」后加「Claude Code 自动召回（hooks）」：`memoark hooks install` 一句话开启；说明读侧默认开、写回 `--write-back` opt-in；更新客户端能力矩阵（CC = 确定性自动召回）。
- [ ] **Step 2: Commit** `docs(readme): claude code auto-recall hooks`

---

## 验收（Definition of Done）
- `memoark hooks install` 后：开新会话即见 session context 注入；问「X 上周聊了啥」时即便不显式调工具，相关记忆已在上下文（命中时）；`--write-back` 开启后会话结束能增量沉淀。
- UserPromptSubmit 无命中时**零注入、零额外延迟感**；命中时受 token 预算约束、不破坏缓存。
- 幂等安装 / 干净卸载 / `--dry-run` 零写盘；不误伤用户既有 hooks。
- `bun run test` + `typecheck` + `lint` 通过。

## 非目标
- 非 Claude Code 客户端的"确定性自动召回"（无生命周期 hook，靠 Spec 12 的指令层）。
- OpenClaw/Hermes 的 message 级钩子 → **Spec 14 (C)**。
- 写回的"加权准入评分"升级（沿用现有 L1/L2）→ 既有路线图 Phase 7。
