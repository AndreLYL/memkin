# Memoark → 5K Stars 实现方案

> 目标：让 memoark 成为 GitHub 5,000+ star 的开源项目。
> 现状基线（2026-06）：**3 stars / 1 fork / 1 issue / 212 commits / v0.2.0**。工程扎实（800+ 测试、全栈功能齐备、CI/社区文件完备），但**零流量、定位分裂、上手摩擦高、英文非首屏**。
>
> 本文档是一份持续维护的增长方案 + 竞品监控清单。

---

## 0. 执行摘要（TL;DR）

1. **5k star 不是工程问题。** memoark 的代码和功能已经超过很多 1k+ star 的项目。卡点是**定位、上手摩擦、分发**。
2. **赛道极热但拥挤。** AI memory 被 mem0（~48–55k star）统治，还有 khoj（34k, YC）、supermemory、cognee、Letta，以及一大批 coding-agent memory（agentmemory、OpenMemory、claude-mem、engram…）。直接说"AI 记忆层"是死路——会被 mem0 碾压。
3. **memoark 的唯一可防御楔子**：
   > **本地优先的「决策记忆」——自动从你的 Claude Code / Codex 会话里挖出"做了什么决策、为什么"，存成知识图谱，通过 MCP 读写还给任何 Agent。**
   这恰好命中行业研究验证的开发者三大刚需：**session continuity / preference memory / decision memory**（见 §1）。mem0 偏通用云 API、claude-mem 锁死 Claude、agentmemory 工具面臃肿（43 个）——没人把"本地 + 结构化决策/为什么 + 知识图谱 + 双向 MCP"做成头牌。
4. **飞书是全球 star 的拖累、却是中国市场的差异化。** 决策：**降级为 "also supports"，不做头牌**（详见 §2 P0-1）。
5. **必须做英文首屏 + 一键上手 + 一个"magic moment" demo**，然后**打一场协调的 launch**（Show HN + Reddit + PH + X 同日并发触发 GitHub Trending）。

---

## 1. 竞品全景与定位

### 1.1 头部玩家

| 项目 | 定位 | 量级 | 强 | 弱（=memoark 的机会） |
|---|---|---|---|---|
| **mem0** | 通用 AI Agent 记忆层 | ~48–55k★ | 生态、SDK、benchmark | 偏托管云 API；自托管弱；通用、不懂"软件开发" |
| **khoj** | AI 第二大脑（文档/网页问答） | ~34k★ (YC W24) | 多端、RAG 成熟 | 不懂代码/开发；无 decision/preference 记忆 |
| **supermemory** | AI 上下文层 | 增长快 | benchmark 第一 | 偏 SaaS |
| **cognee** | Agent 记忆控制面（图+向量） | 增长中 | 知识图谱、ECL 管线 | 偏框架、上手重 |
| **Letta / MemGPT** | 有状态 Agent + 记忆 | 大 | 学术血统 | 偏 Agent 框架而非"记忆产品" |
| **agentmemory / OpenMemory / claude-mem / engram** | coding-agent 记忆（MCP） | 中小、增长 | 贴近 Claude Code/Cursor | 工具面臃肿/锁单一客户端/偏手动 |

### 1.2 开发者真正想要的三类记忆（行业研究结论）

1. **Session continuity** —— 隔天回来能接着上次的任务。
2. **Preference memory** —— Agent 记住你的约定（用 PostgreSQL、文件名 kebab-case…），不用反复解释。
3. **Decision memory** —— 不只是"做了什么",而是**"为什么"**（"11 月把 auth 拆成独立服务,因为单体部署太慢"）。

> **memoark 的 7 类信号里,「决策(含 reasoning)」「发现(bug 根因)」「偏好」「知识」正好覆盖这三类刚需** —— 这是现成的、被验证的卖点,却没在 README 里被讲成主线。

### 1.3 推荐定位（一句话 / 英文 tagline 候选）

- **A（推荐）**：*"Local-first memory for your coding agents — automatically captures the decisions and the **why** from your Claude Code & Codex sessions, into a private knowledge graph your agents read & write over MCP."*
- B：*"Your coding agent's long-term memory. Local. Structured. It remembers why."*
- C：*"Stop re-explaining your project to every new agent session."*（痛点式,适合 Show HN 标题）

---

## 2. 当前问题清单（按对增长的影响排序）

### P0 —— 直接卡住增长，launch 前必须解决

**P0-1　定位分裂 + 中文/飞书首屏 → 全球受众误判为 "China-only"**
- `README.md` 是中文,英文是 `README.en.md`(次屏)。GitHub star 受众以英文/全球为主,默认中文首屏 = 自我设限。
- 飞书(Lark)是中国/企业工具,全球开发者不用 → 把它和 agent 会话并列为"两条同等输入流",稀释了全球最有吸引力的那条线。
- **修复**：英文 README 设为默认首屏;主线讲 coding-agent decision memory;飞书降级为"Enterprise / 也支持飞书"一节。保留中文版 `README.zh-CN.md`。

**P0-2　上手摩擦过高(TTV 高)**
- 当前安装 = 装 Bun → `git clone` → `bun install` → `npm link` → 手写 `memoark.yaml` → (飞书还要 lark-cli 用户态登录)。
- **没有** `npx memoark` / `npm i -g` / `brew` / Docker 一键。
- **修复**：发布到 npm,提供 `npx memoark@latest quickstart`,2 分钟内出第一份记忆。

**P0-3　没有 "magic moment"（无 demo GIF / 视频 / 在线 playground）**
- 仅 1 张静态 `web-ui-graph.jpeg`。star 转化高度依赖前 5 秒的"哇"。
- **修复**：录 60–90s demo —— 从一段 Claude Code 会话 → 自动生成决策/知识图谱 → 在 Claude Code 里问"这项目为什么这么设计?"Agent 从本地记忆作答。README 顶部放 GIF。

**P0-4　零分发：从未 launch 过**
- 3 star = 没做过 Show HN / Reddit / PH / Trending。再好的项目没人看见 = 0。
- **修复**：见 §3 阶段 B。

**P0-5　发现性元数据缺失**
- 无 GitHub topics、无 About 里的 homepage、无 social preview 图、未进任何 awesome-list / MCP registry。

### P1 —— 重要但非阻断

- **P1-1**　包未发布 npm(`package.json` 已配 `bin`/`files`,但没 publish)。
- **P1-2**　Web UI 无托管 demo(有 `web/` 但没 deploy 到 Vercel/Netlify)。
- **P1-3**　无对比页 / 无 benchmark 数字("为什么不用 mem0?"无答案页)。
- **P1-4**　无社媒据点(X、Discord)、无内容引擎。
- **P1-5**　CI 里 `feishu-notify.yml` 等细节透露"中国内部项目"气质,需中性化对外形象。

### P2 —— 锦上添花

- 名字 SEO、CHANGELOG 对外可读化、good-first-issue 标注、贡献者激励、roadmap 公开投票。

---

## 3. 详细落地方案（分阶段）

### 阶段 A —— 重新定位 + 消除摩擦（约 2–3 周，launch 前必做）

**A1 信息架构与定位**
- [ ] 英文 README 设为 `README.md`(首屏),中文移到 `README.zh-CN.md`,顶部互链。
- [ ] 主线改为 §1.3 的 tagline A;开头 3 行讲清"给谁、解决什么、凭什么不同"。
- [ ] 飞书收进 "Sources → Enterprise (Feishu/Lark)" 一节,不在 hero 区。
- [ ] 新增 "Why memoark (vs mem0 / khoj / claude-mem)" 对比表(基于 §1.1)。

**A2 一键上手(把 TTV 砍到 < 2 分钟)**
- [ ] `npm publish`(scoped 或 `memoark`),验证 `npx memoark@latest`。
- [ ] 新增 `memoark quickstart`：自动探测 `~/.claude/projects`,用一个内置样例会话 + 免 key 的 mock/本地小模型,跑出第一份决策图谱,无需先配 LLM key。
- [ ] 提供 `Dockerfile` + `docker run` 一行;`memoark serve --mcp` 的复制即用 MCP 配置块。
- [ ] `memoark doctor` 输出"下一步该做什么"的引导。

**A3 Magic moment 资产**
- [ ] 录 demo GIF(README 顶部)+ 90s YouTube/Loom(Show HN/PH 用)。
- [ ] 1 张 social preview 图(GitHub Settings → Social preview)。

**A4 README 重做(参考 mem0 / khoj 范式)**
- 结构：Hero GIF → 一句话价值 → `npx` 30 秒上手 → "remembers the why" 卖点 → 对比表 → MCP 集成块 → 架构图 → roadmap。

**A5 GitHub 元数据**
- [ ] topics：`ai-memory` `mcp` `claude-code` `knowledge-graph` `local-first` `coding-agent` `second-brain` `cursor` `agent-memory`。
- [ ] About + homepage 链接;开启 Discussions。

### 阶段 B —— Launch 周（多渠道协调发射）

**B1 Show HN**
- 标题候选：`Show HN: Memoark – local-first memory for coding agents that remembers the "why"`。
- 择时：美西周二/周三 08:00–09:00 PT。首 60 分钟是生死线(需 ~30–50 赞冲首页)——提前准备好正文、FAQ、能立刻回评。
- 正文模板：痛点(每次新会话都要重讲项目)→ 方案(本地挖决策/为什么 + MCP)→ 30 秒 `npx` 上手 → 技术亮点(pglite/WASM 进程内 PG、RRF 混合搜索、知识图谱)→ 坦诚 limitations。

**B2 同日并发渠道**
- Reddit：r/LocalLLaMA、r/ClaudeAI、r/selfhosted、r/ObsidianMD(同步插件角度)。
- Product Hunt(配 demo 视频)。
- X/Twitter：thread + demo GIF;@ 相关 KOL / Claude Code 社区。
- dev.to / Hashnode：长文《Giving my coding agents memory that remembers *why*》。
- 多渠道同时拉高首日 star 速度 → 触发 **GitHub Trending**(进了榜算法替你免费分发)。

**B3 生态登记(持续吃长尾流量)**
- 提 PR 进：`topoteretes/awesome-ai-memory`、`punkpeye/awesome-mcp-servers`、`hesreallyhim/awesome-claude-code`、官方 `modelcontextprotocol/servers`、MCP registry、Smithery。

### 阶段 C —— Launch 后 1–3 月（留存 + 持续增长）

- **C1 内容引擎(每周 1 篇)**：decision memory 怎么做、pglite WASM 进程内 PG 的工程经验、本地优先 vs 云、与 mem0/khoj 的诚实对比、知识图谱可视化。
- **C2 Benchmark(强信任信号)**：在 LongMemEval / LoCoMo 上跑,或自建"coding decision recall"小 benchmark,打出"#1 *local* coding-agent memory"。
- **C3 生态深集成(降低别人采用成本)**：Claude Code plugin / slash command、Cursor & Windsurf 一键 MCP、Obsidian 双向同步插件(已在 roadmap)、VS Code 扩展。
- **C4 社区**：开 Discord;标 good-first-issue;公开 roadmap 投票;及时 review PR。
- **C5 竞品监控机制**:每两周按 §5 扫一遍,把新功能/新对手纳入 backlog。

### 阶段 D —— 规模化到 5k（3–12 月）

- **全球数据源**(关键):加 Slack / Discord / Notion / GitHub(issues/PR)——这些才是全球开发者真正用的,把"只支持飞书"的天花板打掉。
- **可选托管 demo / 云同步**(商业化苗头,但 OSS 核心永远本地优先)。
- **集成市场 + 案例 + 证言**,把 star 转成留存与口碑飞轮。

---

## 4. 需要你拍板的关键决策

1. **定位主轴**:把 **coding-agent decision memory** 当头牌(推荐),还是坚持飞书工作记忆为头牌,还是真双轨?——这决定 README、demo、launch 文案全部走向。
2. **英文首屏**:是否接受英文 `README.md` + 中文次屏?(全球 star 几乎必须)
3. **全球数据源**:是否愿意投入做 Slack/Discord/Notion/GitHub 采集器,打开非中国市场?
4. **商业化**:是否接受未来做托管/云同步来资助增长(同时坚持 OSS 本地核心)?

> 我的建议:1=coding-agent 头牌,2=是,3=是(至少先加 GitHub + Slack),4=暂不做、先把 OSS 增长跑通。

---

## 5. 指标与里程碑

**北极星 = stars**,但盯**先行指标**(它们才可被运营):
- README → `npx quickstart` 转化率;demo 完成率;MCP 安装数;weekly active `extract`;Discord 人数;外链/Trending 曝光。

**里程碑节奏**(假设按本方案执行):
| 阶段 | 时间 | 目标 star |
|---|---|---|
| Launch 周 | T0 | +500 ~ +2,000(取决于是否上 HN 首页/Trending) |
| 巩固 | T+3 月 | ~2,000 |
| 集成铺开 | T+6 月 | ~3,500 |
| 全球数据源 + 内容飞轮 | T+12 月 | **5,000** |

> 单次 launch 难破 5k(HN 平均一周 ~289 star);5k 来自 **launch 起爆 + 持续内容/集成/Trending 复利**。

---

## 6. 持续竞品监控清单（每 2 周扫一次）

- **记忆层**:mem0、supermemory、cognee、Letta、Zep、honcho。
- **第二大脑/PKM**:khoj、quivr、reor、basic-memory。
- **coding-agent 记忆**:agentmemory、OpenMemory、claude-mem、engram、ogham、Recallium。
- **榜单**:GitHub Trending(topic: `mcp` / `ai-memory` / `knowledge-graph`)、`awesome-ai-memory`、`awesome-mcp-servers`。
- **关注**:谁拿了 star 暴涨、靠什么(新 benchmark? 新集成? 新 launch?),反哺 memoark backlog。

---

## 参考来源

- [mem0 (GitHub)](https://github.com/mem0ai/mem0) · [khoj (GitHub)](https://github.com/khoj-ai/khoj) · [supermemory](https://github.com/supermemoryai/supermemory) · [cognee](https://github.com/topoteretes/cognee)
- [awesome-ai-memory](https://github.com/topoteretes/awesome-ai-memory)
- [agentmemory](https://github.com/rohitg00/agentmemory) · [OpenMemory](https://github.com/CaviraOSS/OpenMemory) · [engram](https://github.com/Gentleman-Programming/engram)
- [Best AI Agent Memory Frameworks 2026 (Atlan)](https://atlan.com/know/best-ai-agent-memory-frameworks-2026/) · [State of AI Agent Memory 2026 (mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- [AI Coding Assistants That Actually Remember (Medium)](https://medium.com/@code_context_10/ai-coding-assistants-that-actually-remember-recallium-vs-mem0-vs-agentmemory-vs-claude-mem-vs-93578406910f)
- [Hacker News Marketing for Dev Tools (daily.dev)](https://business.daily.dev/resources/hacker-news-marketing-developer-tools-show-hn-launch-day-sustained-coverage/) · [Launch-Day Diffusion: HN → GitHub stars (arXiv)](https://arxiv.org/abs/2511.04453) · [How to launch a dev tool on HN (markepear)](https://www.markepear.dev/blog/dev-tool-hacker-news-launch)
- [AFFiNE 33K stars playbook (dev.to)](https://dev.to/iris1031/how-to-get-more-github-stars-the-definitive-guide-33k-stars-case-study-2kjo) · [Playbook for more GitHub stars (star-history)](https://www.star-history.com/blog/playbook-for-more-github-stars/)
