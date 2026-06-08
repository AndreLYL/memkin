# Memoark → 5K Stars 实现方案（中文生态 · 飞书头牌版）

> 目标：让 memoark 成为 GitHub 5,000+ star 的开源项目。
> 现状基线（2026-06）：**3 stars / 1 fork / 1 issue / 212 commits / v0.2.0**。工程扎实（800+ 测试、全栈功能齐备、CI/社区文件完备），但**零流量、上手摩擦高、未做过任何 launch**。
>
> **战略方向（已拍板）**：① 定位主轴 = **飞书工作记忆为头牌**；② **维持中文 README 首屏**，主攻中文/飞书生态，全球长尾为辅。本文档据此制定。

---

## 0. 执行摘要（TL;DR）

1. **5k star 不是工程问题**，是**定位清晰度 + 上手摩擦 + 中文生态分发**三件事。
2. **方向利好已被验证**：2026 飞书生态日官方主推 **MCP / Agent / 记忆**；**飞书 CLI 开源 47 天破万 star** —— 证明"飞书 + 开发者 + AI"在中文社区能爆，且有官方势能可蹭。
3. **memoark 的可防御定位**（对内对外都立得住）：
   > **把你的飞书工作 + AI Agent 会话，沉淀成一份「本地、私有、跨 Agent」的核心记忆 —— 它记住的是"决策和为什么",并通过 MCP 还给任何 Agent。**
4. **对飞书官方 aily 的差异化**（必须讲清,否则被问"为什么不用飞书自己的"）：aily 是**云端、企业、锁飞书**的智能伙伴;memoark 是**本地优先、私有、个人、跨任意 MCP Agent(Claude Code/Cursor/Codex)**的记忆中枢,且做**结构化决策/知识图谱**而非黑盒。
5. **副线武器(同样是中文开发者刚需)**:自动从 **Claude Code/Codex 会话**挖"决策与为什么"——命中开发者三大记忆刚需(session continuity / preference / decision)。这条线让 memoark 同时吃到"飞书办公"和"AI 编程"两个中文热点人群。
6. **必须先补**:英文非首屏不改,但要补 `npx` 一键上手 + 一个 demo 视频(B 站/视频号)+ GitHub 元数据;然后打一套**中文生态协调 launch**(HelloGitHub + 飙升榜 + 掘金/V2EX/少数派/知乎 + 飞书社群)。

---

## 1. 竞品全景与定位

### 1.1 对手与参照

| 项目 | 定位 | 量级 | 强 | 弱（=memoark 的机会） |
|---|---|---|---|---|
| **mem0** | 通用 AI Agent 记忆层 | ~48–55k★ | 生态/SDK/benchmark | 偏托管云;通用、不懂"飞书办公"也不深做"决策/为什么" |
| **khoj** | AI 第二大脑(文档问答) | ~34k★ | 多端、RAG 成熟 | 不懂飞书、不懂代码;无 decision/preference 记忆 |
| **飞书 aily** | 飞书官方云端智能伙伴(有记忆) | 官方 | 原生集成、企业级 | 云端、锁飞书、企业向、非本地私有、非开源 |
| **飞书 CLI** | 让 AI 操作飞书(开源) | 47 天破万★ | 官方背书、证明赛道能爆 | 是"操作"工具,不是"记忆沉淀";可**联动而非竞争** |
| **claude-mem / agentmemory / OpenMemory** | coding-agent 记忆(MCP) | 中小 | 贴近 Claude Code | 锁单一客户端/工具臃肿/无飞书、无图谱 |

**memoark 占住的空位**：本地优先 + 飞书办公记忆 + AI 编程会话记忆 + 结构化「决策/为什么」+ 知识图谱 + 双向 MCP —— 这个组合**没有第二家**。

### 1.2 开发者/知识工作者真正想要的（研究 + 飞书生态双重佐证）

- **决策记忆**：不只"做了什么",而是**"为什么"**(飞书里的方案讨论、Claude Code 里的架构选型)。
- **跨平台/跨时间串联**:昨天飞书聊的方案 + 今天 Claude Code 写的实现 + 下周的评审会,自动串成脉络。
- **本地私有**:工作记忆不愿上第三方云 —— 这正是 memoark 对 aily/mem0 的最大差异。

### 1.3 对外一句话（中文头图文案候选）

- **A（推荐）**：*把你的飞书工作与 AI Agent 会话,沉淀成一份私有、本地的核心记忆 —— 它记得你做了什么决策、为什么,并让任何 Agent 真正懂你。*（现 README 已接近,强化"决策/为什么"与"本地私有"。）
- B（痛点式,投稿标题用）：*你的工作记忆散落在飞书和 AI 会话里,而你的 Agent 一个都够不着。*

---

## 2. 当前问题清单（按对增长的影响排序）

### P0 —— 直接卡住增长，launch 前必须解决

**P0-1　上手摩擦过高（TTV 高）— 最致命**
- 当前：装 Bun → `git clone` → `bun install` → `npm link` → 手写 `memoark.yaml`(飞书还要 lark-cli 用户态登录)。
- **没有** `npx memoark` / `npm i -g` / Docker 一键。涨星高度依赖"3 分钟内出第一份记忆"。
- **修复**：发布 npm,`npx memoark@latest quickstart`,内置样例 + 免 key 路径,先出图谱再配飞书。

**P0-2　没有 "magic moment"（无 demo 视频/GIF）**
- 仅 1 张静态 `web-ui-graph.jpeg`。
- **修复**：录 60–90s demo（B 站 / 微信视频号 / 抖音 + README 顶部 GIF）：飞书里聊了个方案 + Claude Code 里实现 → memoark 自动生成决策图谱 → 在 Claude Code 里问"这功能为什么这么设计?"Agent 从本地记忆作答。

**P0-3　零分发：从未 launch 过**
- 3 star = 没投过 HelloGitHub / 飙升榜 / 掘金 / V2EX / 少数派 / 知乎 / 飞书社群。

**P0-4　定位差异化未讲透**
- README 没正面回答"和飞书 aily / mem0 有什么不同"(本地、私有、跨 Agent、结构化决策)。
- **修复**:README 加"为什么不用飞书 aily / mem0?"对比段(§1.1)。

**P0-5　发现性元数据缺失**
- 无 GitHub topics、About 无 homepage、无 social preview 图、未进任何 awesome-list / MCP registry。

### P1 —— 重要但非阻断

- **P1-1**　包未发布 npm(`bin`/`files` 已配,缺 publish + `npx` 验证)。
- **P1-2**　Web UI 无托管 demo(有 `web/`,没 deploy)。
- **P1-3**　英文 `README.en.md` 虽非首屏仍需保持高质量(吃全球长尾 star),并在中文首屏顶部给醒目语言切换。
- **P1-4**　无中文社媒据点(公众号 / 知乎专栏 / 即刻 / B 站)、无内容引擎。
- **P1-5**　飞书私聊/lark-cli 登录这一步对新人劝退,需做更顺的引导或免登录 demo 路径。

### P2 —— 锦上添花

- CHANGELOG 对外可读化、good-first-issue 标注、贡献者激励、roadmap 公开投票、名字 SEO。

---

## 3. 详细落地方案（分阶段）

### 阶段 A —— 消除摩擦 + 讲透定位（约 2–3 周，launch 前必做）

**A1 一键上手（把 TTV 砍到 < 3 分钟）**
- [ ] `npm publish`,验证 `npx memoark@latest`(全局命令免 `npm link`)。
- [ ] `memoark quickstart`：自动探测 `~/.claude/projects`,用内置样例 + 免 key 路径跑出第一份决策图谱,**先出价值再配飞书**。
- [ ] `Dockerfile` + 一行 `docker run`;`memoark serve --mcp` 复制即用的 MCP 配置块。
- [ ] 飞书路径单独成"进阶"章节,提供更顺的 lark-cli 登录引导(或截图分步)。

**A2 Magic moment 资产**
- [ ] README 顶部 demo GIF + B 站/视频号 90s 视频。
- [ ] GitHub Social preview 图(Settings → Social preview)。

**A3 README/定位重做（保持中文首屏）**
- 结构：头图 GIF → 一句话价值(§1.3 A) → `npx` 3 步上手 → "记住决策与为什么"卖点 → **"为什么不用飞书 aily / mem0"对比** → 飞书 + Agent 双输入流 → MCP 集成块 → 架构图 → roadmap。
- [ ] 顶部语言切换更醒目;`README.en.md` 同步更新吃全球长尾。

**A4 GitHub 元数据**
- [ ] topics：`feishu` `lark` `ai-memory` `mcp` `claude-code` `knowledge-graph` `local-first` `agent-memory` `second-brain` `cursor`。
- [ ] About + homepage 链接;开启 Discussions。

### 阶段 B —— 中文生态协调 launch（launch 周）

**B1 HelloGitHub（中文涨星头号入口）**
- [ ] 到 hellogithub.com **认领/提交** memoark,争取进月刊"AI 项目"栏目;按其格式准备一句话简介 + 截图 + 上手步骤。

**B2 飞书生态(蹭官方 AI 势能,差异化卡位)**
- [ ] 提交到飞书开放平台/应用目录与 **MCP registry**;在飞书开发者社群、飞书开放平台话题发布。
- [ ] 与**飞书 CLI 生态联动**：memoark 已用 lark-cli,可写"基于飞书 CLI 打造你的本地 AI 记忆"——蹭飞书 CLI 的热度与人群。

**B3 中文技术社区同周并发(拉高首日星速 → 上 GitHub 飙升榜)**
- [ ] **掘金**：长文《把飞书工作 + Claude Code 会话变成 AI 能用的本地记忆》。
- [ ] **V2EX**(创意/分享节点)、**少数派**(效率/AI 工具)、**知乎**(自问自答 + 专栏)。
- [ ] **微信公众号 / 视频号 / B 站**：demo 视频 + 图文。
- [ ] **即刻**、AI/Agent 中文社群(Datawhale、各 Claude Code/Cursor 中文群)。
- [ ] 目标:首日多渠道并发,冲上 **OpenGithubs 日/周飙升榜** 与 GitHub Trending(China)。

**B4 全球长尾(辅,不主推)**
- [ ] 英文 Show HN / r/LocalLLaMA / r/ClaudeAI 各发一发,提 PR 进 `awesome-ai-memory` / `awesome-mcp-servers` / `awesome-claude-code` / 官方 `modelcontextprotocol/servers`。

### 阶段 C —— Launch 后 1–3 月（留存 + 持续增长）

- **C1 内容引擎(每周 1 篇,中文为主)**:决策记忆怎么做、pglite WASM 进程内 PG 工程经验、本地优先 vs 云、飞书 + Agent 串联实战、与 aily/mem0 诚实对比。
- **C2 生态深集成(降低采用成本)**:Claude Code plugin / slash command、Cursor & Windsurf 一键 MCP、飞书机器人/多维表格集成、Obsidian 双向同步(已在 roadmap)。
- **C3 信任信号**:自建"决策召回"小 benchmark 或在 LongMemEval/LoCoMo 跑分,打"本地飞书+编程记忆第一"。
- **C4 社区**:开微信群/Discord;标 good-first-issue;公开 roadmap 投票;及时 review PR。
- **C5 竞品监控**:每两周按 §5 扫一遍,反哺 backlog。

### 阶段 D —— 规模化到 5k（3–12 月）

- **更多中文工作源**:微信(已在 roadmap)、企业微信、钉钉、Notion/语雀 —— 打开"飞书之外"的中文知识工作者。
- **可选托管 demo / 团队版**(商业化苗头,OSS 核心永远本地优先)。
- **案例 + 证言 + 集成市场**,把 star 转成留存飞轮。

---

## 4. 关键决策（已拍板 ✅ + 待定）

- ✅ **定位主轴 = 飞书工作记忆为头牌**(本方案据此)。
- ✅ **维持中文 README 首屏**(英文版作全球长尾,非首屏)。
- ⬜ **是否加全球/更多中文数据源**(GitHub/Slack/钉钉/企业微信):建议先加**微信 + GitHub**(中文开发者也大量用 GitHub issues),其余按社区呼声排。
- ⬜ **是否商业化**(托管/团队版):建议暂不,先把 OSS 中文增长跑通。

---

## 5. 指标与里程碑

**北极星 = stars**,但盯**先行指标**:`npx quickstart` 转化率、demo 完成率、MCP 安装数、weekly active `extract`、HelloGitHub/飙升榜曝光、社群人数。

| 阶段 | 时间 | 目标 star | 主要驱动 |
|---|---|---|---|
| Launch 周 | T0 | +300 ~ +1,500 | HelloGitHub + 飙升榜 + 掘金/V2EX/飞书社群并发 |
| 巩固 | T+3 月 | ~1,500 | 内容引擎 + 飞书生态登记 + 集成 |
| 集成铺开 | T+6 月 | ~3,000 | Claude Code/Cursor/飞书集成 + benchmark |
| 数据源 + 内容飞轮 | T+12 月 | **5,000** | 微信/GitHub 源 + 持续内容 + Trending 复利 |

> 中文生态单点(如 HelloGitHub 月刊)可一次带来数百到上千 star;5k 来自 **launch 起爆 + 飞书生态卡位 + 持续内容/集成复利**。飞书 CLI 47 天破万证明上限不低。

---

## 6. 持续竞品监控清单（每 2 周扫一次）

- **记忆层**:mem0、supermemory、cognee、Letta、Zep。
- **飞书生态**:飞书 aily、飞书 CLI、飞书 MCP/开放平台新能力(官方动向 = 势能也是边界)。
- **coding-agent 记忆**:claude-mem、agentmemory、OpenMemory、engram、basic-memory。
- **中文榜单**:HelloGitHub 月刊、OpenGithubs 日/周/月飙升榜、GitHub Trending。
- **关注**:谁 star 暴涨、靠什么(新集成? 新 launch? 蹭了什么热点?),反哺 memoark backlog。

---

## 参考来源

- [HelloGitHub](https://github.com/521xueweihan/HelloGitHub) · [OpenGithubs 飙升榜(周)](https://github.com/OpenGithubs/github-weekly-rank) · [(月)](https://github.com/OpenGithubs/github-monthly-rank)
- [飞书开放平台](https://open.feishu.cn/?lang=zh-CN) · [飞书生态日"AI Friendly"升级(量子位)](https://www.qbitai.com/2026/04/406026.html) · [飞书 CLI 47 天破万 star(知乎)](https://zhuanlan.zhihu.com/p/2038542539108642974) · [飞书 aily 智能伙伴(量子位)](https://www.qbitai.com/2026/03/389311.html)
- [mem0](https://github.com/mem0ai/mem0) · [khoj](https://github.com/khoj-ai/khoj) · [awesome-ai-memory](https://github.com/topoteretes/awesome-ai-memory)
- [AI Coding Assistants That Actually Remember(Medium)](https://medium.com/@code_context_10/ai-coding-assistants-that-actually-remember-recallium-vs-mem0-vs-agentmemory-vs-claude-mem-vs-93578406910f) · [State of AI Agent Memory 2026(mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [Hacker News 发 dev tool(markepear)](https://www.markepear.dev/blog/dev-tool-hacker-news-launch) · [GitHub stars playbook(star-history)](https://www.star-history.com/blog/playbook-for-more-github-stars/)
