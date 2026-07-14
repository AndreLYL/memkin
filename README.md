<p align="center">
  <img src="docs/assets/memkin-cover.png" alt="Memkin" width="100%">
</p>

<h1 align="center">Memkin</h1>

<p align="center">本地优先的个人记忆系统：从飞书与 AI 编程会话中提取结构化信号，构建本机知识图谱，通过 MCP 供任何 Agent 读写。</p>

<p align="center">
  简体中文 | <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <a href="https://www.npmjs.com/package/memkin"><img alt="npm" src="https://img.shields.io/npm/v/memkin?color=cb3837&logo=npm"></a>
  <img alt="Language: TypeScript" src="https://img.shields.io/badge/lang-TypeScript-3178c6">
  <img alt="Tests: 2000+" src="https://img.shields.io/badge/tests-2000%2B-success">
  <a href="https://glama.ai/mcp/servers/AndreLYL/memkin"><img alt="MCP Score" src="https://glama.ai/mcp/servers/AndreLYL/memkin/badges/score.svg"></a>
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="在 Claude Code 里向 Memkin 提问，得到带 [n] 引用的回答" width="850">
</p>

AI Agent 的会话没有跨会话记忆：每次新会话都需要重新解释你是谁、项目背景、既有决策。Memkin 把散落在飞书（私信、群聊、邮件、日历、文档、任务）和 AI 编程会话（Claude Code、Codex、Hermes）里的信息提取为结构化信号——实体、决策、任务、发现、知识、关系——存入你自己机器上的知识图谱，并通过 MCP 提供给任何 Agent 查询和写回。数据全程保留在本机。

## 核心特性

- **飞书采集**：私信、群聊、邮件、日历、文档、任务、消息搜索共 7 个源，增量采集 + 历史回填。见[飞书采集指南](docs/feishu.md)
- **AI 会话采集**：Claude Code（`~/.claude/projects/`）、Codex（`~/.codex/`）、Hermes/OpenClaw（`~/.openclaw/agents/`）
- **MCP 服务器**：36 个工具（默认暴露 15 个高意图工具），支持 stdio 与 Streamable HTTP 两种传输。见 [MCP 接入指南](docs/mcp.md)
- **信号提取**：LLM Pipeline 提取 7 类结构化信号，双层噪声过滤（规则 + LLM 打分），每条信号可溯源到原始消息
- **混合检索**：tsvector 全文（支持中文）+ pgvector 向量，RRF 融合排序
- **知识图谱**：信号锚定到实体（人、项目、工具），有向链接图，跨平台人物身份归并
- **隐私**：写入前脱敏（可逆 / 不可逆双轨），存储零云依赖（PGLite 嵌入式数据库），可选 Ollama 本地嵌入
- **常驻服务**：`memkin up` 注册开机自启 daemon，定时采集，带运行历史与告警
- **记忆巩固**：hot → warm → cold 分层轮转、死链修复、偏好推断
- **Obsidian 双向同步**：导出为 Markdown vault，编辑后导回
- **Web UI**：Dashboard、时间线、力导向知识图谱、搜索

完整清单见[功能清单](docs/features.md)。

## 快速上手

一键安装（推荐，注册为后台常驻服务）：

```bash
curl -fsSL https://raw.githubusercontent.com/AndreLYL/memkin/main/scripts/install.sh | sh
```

脚本依次执行：安装 Node 运行时（如缺失）→ `npm install -g memkin` → 打开浏览器 setup 向导（填入 LLM API Key）→ `memkin up` 注册开机自启后台服务，并把 MCP 配置写入本机已安装的 AI 客户端（Claude Code、Codex、Hermes/OpenClaw）。

临时试用（不安装后台服务）：

```bash
npx memkin start     # 无配置时自动进入 setup 向导，完成后启动服务并打开 Web UI
```

服务管理与卸载：

```bash
memkin status        # 查看后台服务状态
memkin down          # 停止服务并取消开机自启
memkin down && memkin uninstall && npm rm -g memkin    # 完全卸载
```

前置条件：[Node.js](https://nodejs.org) >= 18（安装脚本会自动处理）。

## 接入 AI Agent

`memkin install` 把 MCP 配置和记忆使用指令写入本机 AI 客户端，支持 Claude Code、Claude Desktop、Cursor、Codex、Windsurf、Hermes/OpenClaw：

```bash
memkin install                      # 探测已安装的客户端并接入
memkin install --agent claude-code  # 指定单个客户端
memkin install --dry-run            # 预览将修改的文件
memkin extract --source claude-code # 把历史会话提取为记忆
memkin hooks install                # （可选）Claude Code 自动召回 hooks
```

接入后重启客户端即可。传输方式（stdio / Streamable HTTP）、手动配置和 hooks 说明见 [MCP 接入指南](docs/mcp.md)。

## 使用场景

以下问题均可在接入 Memkin 的 Agent 中直接提问，回答带 `[n]` 引用，可溯源到原始消息：

| 问题 | 使用的工具 |
|------|-----------|
| "明天要见张总谈续约，该注意什么？" | `prep_for_person` 从历史互动推断沟通画像，按本次目标给出建议 |
| "生成今天的日报" | `daily_report` 聚合当天私聊、群聊、邮件、会议纪要、日历为 7 段日报 |
| "智驾为什么无法激活？" | `troubleshoot` 按排查手册（playbook）给出有序排查步骤 |
| "memkin 项目现在进展如何？" | `get_session_context` 返回聚合的决策、待办与最近时间线 |
| "上周和这位同事聊了什么？" | `recall` 把私信、会议、后续任务合成为带引用的回答 |

## 界面预览

<p align="center">
  <img src="docs/assets/web-ui-graph.png" alt="Memkin Web UI 知识图谱页面" width="850">
</p>

## 架构

数据流为 5 层：数据源采集 → 信号提取 → 本地存储 → 接口输出；人物身份、记忆巩固、调度三个模块横切各层。

<p align="center">
  <img src="docs/assets/architecture.png" alt="Memkin 架构图" width="920">
</p>

| 层 | 内容 |
|----|------|
| 配置与上手 | TUI 配置中心 / 浏览器向导，自动检测与连接测试 |
| 采集 | 飞书 7 源 + Claude Code / Codex / Hermes，增量 + 历史回填 |
| 信号提取 | 分块 → 双层噪声过滤 → LLM 抽取 → 打分 → 隐私脱敏 |
| 记忆存储 | PGLite + pgvector，混合检索（全文 + 向量 + RRF） |
| 接口 | CLI、MCP、REST API、Web UI、Obsidian |

运行平台：macOS / Linux / Windows（默认 PGLite，零外部依赖）。可选的自管理本地 Postgres 引擎支持 macOS（arm64 / x64）与 Linux（x64 / arm64）。详见[架构详解](docs/architecture.md)。

## 常用命令

| 命令 | 说明 |
|------|------|
| `memkin start` | 启动（无配置时自动进入 setup） |
| `memkin up` / `down` / `status` | 后台服务：注册开机自启 / 停止 / 状态 |
| `memkin install` | 接入 AI 客户端 |
| `memkin extract --source <name>` | 从数据源提取信号 |
| `memkin search <query>` | 搜索记忆 |
| `memkin doctor` | 环境诊断 |

完整命令见 [CLI 参考](docs/cli.md)。

## 文档

- [功能清单](docs/features.md)
- [CLI 参考](docs/cli.md)
- [配置参考](docs/configuration.md)（memkin.yaml、端口、鉴权）
- [飞书采集指南](docs/feishu.md)
- [MCP 接入指南](docs/mcp.md)
- [架构详解](docs/architecture.md)

## 路线图

- [ ] 更多数据源：钉钉、企业微信、微信聊天记录、本地文档
- [ ] 提取质量：跨 block 共享上下文、加权准入评分、按实体聚合叙事
- [ ] 自然语言问答
- [ ] Web UI：记忆编辑（当前只读）、信号溯源审计视图

## 致谢

Memkin 的设计与实现受益于以下项目：

- [lark-cli](https://github.com/larksuite/cli) —— 飞书开放平台官方 CLI，Memkin 的飞书 user 态采集构建在它之上
- [GBrain](https://github.com/garrytan/gbrain) —— brain-first 检索约定、自布线知识图谱与带引用的合成回答
- [OpenHuman](https://github.com/tinyhumansai/openhuman) —— Memory Tree 层级压缩与 Obsidian 互通的设计
- [mem0](https://github.com/mem0ai/mem0) —— Agent 记忆层的先行者

与它们相比，Memkin 侧重：飞书等中国职场工具的采集、本地优先零云依赖、Agent 经 MCP 读写。

## 贡献

Bug 报告和功能建议请提交 [issue](https://github.com/AndreLYL/memkin/issues)。开发流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

[Apache License 2.0](LICENSE)
