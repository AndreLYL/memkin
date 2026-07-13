# MCP 接入指南

> [← 返回 README](../README.md) · Memkin 是标准 MCP 服务器，任何 MCP 客户端都能读写你的记忆。

## 一键接入（推荐）

`memkin install` 自动把 MCP 配置 + 一份极简「记忆指令」写进你的 AI 客户端（默认全局，对所有项目生效），支持 **Claude Code · Claude Desktop · Cursor · Codex · Windsurf · Hermes/OpenClaw**：

```bash
memkin install                      # 探测本机已装的客户端并接入
memkin install --agent claude-code  # 指定单个客户端
memkin install --dry-run            # 先预览会改哪些文件，不写盘
memkin uninstall                    # 干净移除（幂等）
```

装完重开客户端即可——之后你问「X 上周跟我聊了啥」「这个项目推进到哪了」，Agent 会按注入的「记忆指令」**主动来 Memkin 检索**（cheap-first：先 `search` 零成本关键词，不够再 `query` / `recall`），而不是凭空作答。

> Claude Desktop 没有规则文件，靠 MCP server 的 `instructions` 字段兜底。
>
> **OpenClaw / Hermes**：`memkin install --agent hermes` 会写 `config.yaml` 的 `mcp_servers` 并铺 `memkin` skill（会话里 `/reload-mcp` 生效）；也可 `memkin skill scaffold --dir ~/.hermes/skills` 单独铺 skill。
>
> **让 Agent 自己接入**：对能读外链的 Agent，直接说「按 [`MEMKIN_FOR_AGENTS.md`](../MEMKIN_FOR_AGENTS.md) 把我接入 Memkin」，它会自跑命令完成接入并自检。

## Claude Code 自动召回（可选 · hooks）

在 Claude Code 上更进一步，让记忆「零感知」自动到手：

```bash
memkin hooks install               # SessionStart + UserPromptSubmit 读侧 hook（默认开）
memkin hooks install --write-back  # 额外开启会话结束自动写回（opt-in）
memkin hooks uninstall             # 移除
```

- **SessionStart**：开新会话自动注入「近期项目 / 决策 / 待办 / 关键人」摘要。
- **UserPromptSubmit**：每条提问前用零成本 FTS 试召回，命中才注入（限 3 条、≤3000 字符）。
- **SessionEnd**（`--write-back`，默认关）：会话结束异步增量抽取写回，记忆自生长。

> 读侧默认开（本地、便宜）；写回需显式 opt-in（成本 + 隐私）。其它客户端没有生命周期 hook，靠指令层让模型自主召回。

## 两种传输方式

- **stdio（`memkin serve --mcp`）** —— 本地直连，Agent 把 memkin 作为子进程拉起，零网络配置，单机单客户端首选。
- **Streamable HTTP（`memkin serve --mcp-http`）** —— 走 HTTP（默认 `http://localhost:3928/mcp`），适合远程接入或多个客户端共享同一份记忆；后台服务（`memkin up`）默认以这种方式常驻。

手动配置示例（Claude Code，stdio）：

```json
{
  "mcpServers": {
    "memkin": {
      "command": "memkin",
      "args": ["serve", "--mcp"]
    }
  }
}
```

## 工具总表

默认暴露 **15 个高意图工具**为主力，外加会话上下文、实体画像与人物身份等辅助工具；12 个低层 legacy 工具默认隐藏（`memkin.yaml` 设 `mcp.expose_legacy_tools: true` 开启），全量共 **36 个**。

| 类别 | 工具 |
|------|------|
| **检索（高意图）** | `query`、`search`、`get_page_context`、`timeline_feed`、`explore_graph` |
| **合成（高意图）** | `synthesize`、`recall`（带 `[n]` 引用的成段答案 + gap 分析）、`prep_for_person`（人物沟通画像 → 目标条件化的沟通策略）、`daily_report`（跨渠道 7 段日报）、`troubleshoot`（沿 playbook 排查链排查） |
| **写入（高意图）** | `put_page`、`add_timeline_entry`、`manage_links`、`manage_tags` |
| **健康（高意图）** | `get_health` |
| **会话 / 实体** | `get_session_context`、`get_entity_profile`、`list_signals_by_entity` |
| **身份（人物）** | `link_person_alias`、`list_person_handles`、`remove_person_alias`、`merge_persons`、`recanonicalize_person` |
| **飞书文档** | `ingest_feishu_doc` |
| **legacy（默认隐藏）** | `get_page`、`list_pages`、`get_chunks`、`add_link`、`remove_link`、`get_links`、`get_backlinks`、`traverse_graph`、`add_tag`、`remove_tag`、`get_tags`、`get_timeline` |
