<p align="center">
  <img src="docs/assets/memkin-cover.png" alt="Memkin — 让你的 AI，最懂你" width="100%">
</p>

<h1 align="center">让你的 AI，最懂你。</h1>

<p align="center"><strong>你的 AI Agent 每天都在失忆。Memkin 把你的飞书聊天、会议、邮件和 AI 编程会话，沉淀成本地私有的记忆图谱——让任何 Agent 通过 MCP 秒懂你。</strong></p>

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
  <img src="docs/assets/demo.gif" alt="在 Claude Code 里向 Memkin 提问：上周和 Alice 聊了什么？—— 得到带 [n] 引用的回答" width="850">
  <br>
  <em>在 Claude Code 里问一句，Memkin 通过 MCP 给出带引用、可溯源的回答。</em>
</p>

---

## ⚡ 30 秒上手

```bash
curl -fsSL https://raw.githubusercontent.com/AndreLYL/memkin/main/scripts/install.sh | sh
```

一条命令，全部搞定：自动装运行时 → 全局安装 `memkin` → 浏览器打开 setup 向导让你填 LLM API Key → 保存后自动作为**开机自启的后台常驻服务**运行，并把记忆自动接入已安装的 AI agent（Claude Code、Codex、Hermes/OpenClaw）。

只想临时试一下、不装后台服务？

```bash
npx memkin start     # 没有配置会自动引导 setup 向导，完成后立即起服务并打开 Web UI
```

装好后的日常管理与彻底卸载：

```bash
memkin status        # 查看后台服务状态
memkin down          # 停止服务并取消开机自启
memkin down && memkin uninstall && npm rm -g memkin    # 彻底卸载
```

> 前置条件：[Node.js](https://nodejs.org) >= 18（一键安装脚本会自动装）。更多命令见 [📘 CLI 参考](docs/cli.md)。

## 三大支柱

**🕸️ 人是一切社会关系的总和**
记忆不是一堆向量分块。信号被锚定到实体（人、项目、工具）并以有向图相互链接——你得到的是有上下文的答案：谁、为什么、和什么相关。

**🔒 数据不出你的机器**
PGLite 嵌入式数据库本地存储一切，可选 Ollama 本地向量嵌入，零云依赖。双轨隐私脱敏（可逆 / 不可逆）在写入前清洗敏感信息。

**🤖 Agent 既读又写**
以 **15 个高意图 MCP 工具**为核心（`query` / `recall` / `synthesize` / `prep_for_person` / `daily_report`……），任何 Agent 都能查询你的历史、也把新的决策与发现写回来。Agent 用得越多，记忆越懂你。

## 为什么需要它

你的工作记忆有两个家，而你的 AI Agent 一个都够不着：**飞书**承载你的工作关系网（私信、群聊、邮件、会议、文档、任务），**AI Agent**（Claude Code、Codex、OpenClaw）承载你的构建过程（每次编程会话里的决策、发现和踩过的坑）。但每次打开新会话，Agent 都一无所知——你得重新解释你是谁、项目是什么、上周决定了什么。

**你不是记忆力差，你是信息碎片化——而你的 Agent 每天都在为此买单。**

Memkin 把这些工具里的对话提取成结构化信号（实体、决策、任务、发现、知识、关系），汇入你自己机器上一个统一、可搜索的知识图谱，再通过 **MCP** 把这份记忆喂回给任何 Agent：

> "我昨天在飞书和同事讨论了一个方案，今天在 Claude Code 里实现了一部分，下周还有个评审会。"
>
> Memkin 自动把这三件事串起来——跨平台、跨时间——并在你需要时把完整脉络交给 Agent。

<p align="center">
  <img src="docs/assets/web-ui-graph.jpeg" alt="Memkin 知识图谱 —— 实体、决策、任务、知识在你的工作中相互连接" width="850">
  <br>
  <em>把你的工作变成一张活的知识图谱 —— 人、决策、任务、知识，全部连起来。</em>
</p>

## 使用场景

> Memkin 回答的不是"我知道什么"，而是"**我该怎么做**"——每个场景的输出都是**带 `[n]` 引用、可溯源的行动建议**。

**🌟 见人之前，先想好怎么沟通**
*"我明天要见张总，谈续约涨价，该注意什么？"* —— `prep_for_person` 从你和张总的真实互动里**被动推断**出沟通画像（直接还是委婉、看数据还是看关系、有哪些雷区），结合本次目标给出沟通建议，并提醒缺口（*"你已 18 天没有他的新信息，画像可能过时"*）。零问卷，画像永不出本机。

**📋 一句话生成跨渠道日报**
*"帮我生成今天的日报"* —— `daily_report` 把今天散落在私聊、群聊、邮件、妙记会议纪要、日历里的信号，聚合成 7 段：今日决策 / 推进中 / 我的待办 / 待回复·被@ / 人脉动态 / 明日提醒。会议纪要里点到你名字的待办，自动进"我的待办"。

**🔧 按手册排查问题**
*"智驾为什么无法激活？"* —— `troubleshoot` 沿 playbook 的排查链给出有序步骤，并解释每一步不同结果代表什么。排查手册可以手动沉淀，也能从你帮人排查的对话里自动抽取成草稿。

**⚡ 让 Agent 几秒接手一个项目**
*"memkin 这个项目现在进展如何？"* —— `get_session_context` 直接拉出聚合的决策、待办和最近时间线，无需你重新解释。

**🔎 回忆某人、某件事**
*"我上周和这位同事聊了什么？"* —— 把飞书私信、会议、后续任务串成一个带引用的答案。

## 只用 Claude Code / Codex？

不用飞书也能完整用起来——把你的 AI 编程会话变成跨会话、跨项目的持久记忆：

```bash
npx memkin start                          # 向导里只启用 claude-code / codex 数据源即可
npx memkin extract --source claude-code   # 把历史会话提取成记忆
npx memkin install --agent claude-code    # 一键接入 Agent（自动写 MCP 配置 + 记忆指令）
npx memkin hooks install                  # （可选）开新会话自动注入近期决策 / 待办
```

装完重开客户端，问一句 *"这个项目上周决定了什么？"* —— Agent 直接从你的本地记忆作答。

## 核心特性

| | |
|---|---|
| 🛰️ **飞书全量采集** | 7 个源：私信、群聊、邮件、日历、文档、任务、消息搜索 → [📘 飞书指南](docs/feishu.md) |
| 🤖 **Agent 原生（MCP）** | 15 个高意图工具（全量 36 个），stdio + Streamable HTTP 双传输，一键接入主流客户端 → [📘 MCP 指南](docs/mcp.md) |
| 🧠 **AI 信号提取** | LLM Pipeline 从对话中提取 7 类结构化信号，双层噪声过滤，来源可溯 → [📘 架构详解](docs/architecture.md) |
| 🔍 **混合语义搜索** | 全文（tsvector，支持中文）+ 向量（pgvector），RRF 融合排序 |
| ♻️ **记忆巩固** | hot → warm → cold 分层轮转、死链修复、偏好推断，记忆随时间自我整理 |
| ⏰ **后台常驻服务** | `memkin up` 一条命令注册开机自启 daemon，定时采集、运行历史、告警 |
| 🔗 **Obsidian 双向同步** | 记忆导出为 Markdown vault，编辑后再导回 |
| 🕸️ **知识图谱 + Web UI** | Dashboard、时间线、力导向图谱、搜索，全在浏览器里 |

完整能力清单见 [📘 功能清单](docs/features.md)，`memkin.yaml` 配置项见 [📘 配置参考](docs/configuration.md)。

## 架构

Memkin 是 **5 层纵向数据流 + 3 个横切关注点**：数据源被采集、提取成信号、存入本地记忆，再由底层接口对外读写；人物身份、记忆巩固与调度横切贯穿其间。

<p align="center">
  <img src="docs/assets/architecture.png" alt="Memkin 架构图 —— 5 层纵向数据流 + 3 个横切关注点" width="920">
</p>

| 层 | 一句话 |
|----|--------|
| ① 配置与上手 | TUI 配置中心 / 浏览器向导，自动检测与连接测试 |
| ② 采集 | 飞书 7 源 + Claude Code / Codex / Hermes，增量 + 历史回填 |
| ③ 信号提取 | 分块 → 双层噪声过滤 → LLM 抽取 → 打分 → 隐私脱敏 |
| ④ 记忆存储 | PGLite + pgvector，混合检索（全文 + 向量 + RRF） |
| ⑤ 接口与消费 | CLI · MCP · REST API · Web UI · Obsidian |

> 运行平台：macOS / Linux / Windows（默认内嵌 PGLite，开箱即用）。可选的自管理本地 Postgres 引擎支持 macOS 与 Linux。分层细节、信号类型与存储组件见 [📘 架构详解](docs/architecture.md)。

## 🙏 站在谁的肩膀上，又有何不同

Memkin 不是凭空长出来的，它站在几个优秀项目的肩膀上：

- **[lark-cli](https://github.com/larksuite/cli)** —— 飞书开放平台官方 CLI。Memkin 的飞书 user 态采集（私信 / 消息搜索）直接构建在它之上，是名副其实的地基。
- **[GBrain](https://github.com/garrytan/gbrain)** —— Garry Tan 的 Agent 记忆系统。brain-first 的检索约定、自布线知识图谱、带引用的合成回答与 gap 分析，都深深启发了 Memkin 的设计。
- **[OpenHuman](https://github.com/tinyhumansai/openhuman)** —— 本地优先的个人 AI。Memory Tree 层级压缩与 Obsidian vault 互通的思路给了我们很多借鉴。
- **[mem0](https://github.com/mem0ai/mem0)** —— Agent 记忆层的先行者，为整个赛道验证了"给 Agent 装记忆"这件事的价值。

在它们的基础上，Memkin 选择了自己的路：**飞书等中国职场工具是一等公民**（私信、群聊、邮件、会议、文档、任务全量采集）；**本地优先、零云依赖**（数据永不出你的机器）；**Agent 通过 MCP 既读又写**（记忆随使用自生长）。

## 常用命令

| 命令 | 说明 |
|------|------|
| `memkin start` | 一键启动（无配置自动引导 setup） |
| `memkin up` / `down` / `status` | 后台常驻服务：注册开机自启 / 停止 / 状态 |
| `memkin install` | 一键接入 AI 客户端（MCP 配置 + 记忆指令） |
| `memkin extract --source <name>` | 从数据源提取信号 |
| `memkin search <query>` | 搜索记忆 |
| `memkin doctor` | 环境诊断 |

全部命令与选项见 [📘 CLI 参考](docs/cli.md)。

## 路线图

- [ ] **更多中国职场数据源**：钉钉、企业微信、微信聊天记录、本地文档
- [ ] **提取质量**：跨 block 共享上下文（ContextBuffer）、加权准入评分、按实体聚合叙事
- [ ] **自然语言问答**：直接对记忆库提问
- [ ] **Web UI 增强**：记忆编辑（当前只读）、信号溯源审计视图

## 社区与支持

- 🐛 发现 bug 或有功能建议？[提交 issue](https://github.com/AndreLYL/memkin/issues)。
- 💡 欢迎在 issue 区交流问题和想法。
- ⭐ 如果 Memkin 对你有帮助，点个 Star 支持一下 —— 这是对项目最大的鼓励。

参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

基于 [Apache License 2.0](LICENSE) 开源。
