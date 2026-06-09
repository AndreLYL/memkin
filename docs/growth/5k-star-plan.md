# Memoark 5K Star 增长方案

> 制定日期：2026-06-09 ｜ 起点：3 stars / 1 fork / 0 release（仓库创建于 2026-05-19）
> 目标：GitHub 5,000 stars
> 本文 = 竞品调研 + 现状诊断 + 分阶段实施方案。数据为 2026-06-09 GitHub API 实时查询。

---

## 0. 一句话结论

Memoark 工程质量在同龄项目里属上乘，但**定位被飞书绑死、上手要 `git clone + npm link`、没有可信度资产（benchmark / demo / release）、不在用户搜索的地方出现**。
5K 这个目标是可达的——最接近的同类 `basic-memory` 在 3.2K，而它没有融资、没有 benchmark。要越过它到 5K，必须做三件事：**(1) 把头条叙事从"飞书"换成"本地优先的 AI Agent 记忆层"；(2) 把激活摩擦降到一条 `npx` 命令；(3) 造出 HN/Reddit 能用的发射素材（demo + benchmark）。**

---

## 1. 竞品全景（2026-06-09 实时星数）

| 项目 | Stars | 语言 | 定位 | 增长打法 |
|---|---:|---|---|---|
| mem0ai/mem0 | 58,129 | Python | "AI Agent 的通用记忆层" | YC S24，$24M A 轮，benchmark 营销（LoCoMo/LongMemEval），全框架集成 |
| khoj-ai/khoj | 35,023 | Python | "你的 AI 第二大脑，可自托管" | 消费级 PKM，自托管+免费托管 |
| getzep/graphiti | 27,203 | Python | "为 Agent 构建实时知识图谱" | 时序知识图谱差异化，论文背书 |
| supermemoryai/supermemory | 26,266 | **TS** | "AI 时代的 Memory API" | 19 岁独立创始人 build-in-public，Google/CF/OpenAI 高管投资，**npx 零摩擦激活** |
| letta-ai/letta（原 MemGPT） | 23,224 | Python | "构建有状态、能自我改进的 Agent" | 论文病毒式发射（HN 首页，几天 11K star），伯克利背书 |
| topoteretes/cognee | 17,736 | Python | "Agent 的开源记忆平台" | "5 行代码搞定记忆"，自营 r/AIMemory 子版，6 个一键部署 |
| plastic-labs/honcho | 4,974 | Python | "构建有状态 Agent 的记忆库" | benchmark 屠榜发射（LongMem 90.4%） |
| **basicmachines-co/basic-memory** | **3,171** | Python | "**本地优先 + Markdown + MCP + Obsidian**" | **最接近 Memoark 的对标**，隐私/你拥有文件，15+ MCP 工具，$15/mo 云同步 |
| memodb-io/memobase | 2,747 | Python | "基于用户画像的长期记忆" | 聊天机器人垂直 |

锚点：`modelcontextprotocol/servers` ≈ 82K star；`awesome-mcp-servers` 目录聚合 ~400 个 server、合计 ~110 万 star。MCP SDK 月下载 ~97M——**Memoark 天生在这个生态里，但完全没利用**。

**关键洞察：**
- 你真正的对标是 **basic-memory（3.2K）**，不是 mem0。它证明了"本地优先 + MCP + 隐私"路线无需融资也能上数千 star。
- **memory 赛道几乎全是 Python**——TypeScript/Bun + 单进程内嵌 Postgres 是个干净的差异点，值得当卖点喊出来。
- 第二波项目（honcho/hindsight）几乎**全靠 benchmark 数字发射**。
- supermemory 的招牌增长黑客：`npx` 一条命令 + 免登录免付费的托管 demo，把激活摩擦降到 0。

---

## 2. 现状诊断（代码级体检）

工程底子（保留并放大）：采集器 / 信号提取 Pipeline / PGLite+pgvector / RRF 混合搜索 / MCP / REST / Web UI 全部落地；中英双语 README、CHANGELOG、CONTRIBUTING、SECURITY、PRD 齐全；src ~16.4K LOC。

阻碍上量的 7 个核心问题：

| # | 问题 | 影响 | 对标做法 |
|---|---|---|---|
| 1 | **上手摩擦极高**：`git clone → bun install → npm link`，强依赖 Bun，**未发 npm、无 `npx`、无 Docker、0 Release** | 90% 潜在 star 者在第一步流失 | mem0 `pip install`，supermemory `npx`，basic-memory "30 秒云 / 2 分钟本地" |
| 2 | **定位被飞书绑死** | 飞书在 HN/r/LocalLLaMA 近乎隐形，全球开发者触达面被锁死 | 把头条换成通用"Agent 记忆层"，飞书降级为连接器之一 |
| 3 | **首次价值前置成本高**：需 LLM key + 飞书 App 凭证 + lark-cli 登录才能见效 | 无"零配置 30 秒看到效果"路径 | cognee 5 行代码；supermemory 无 key demo |
| 4 | **零可信度资产**：无 benchmark、无对比 mem0/basic-memory、无 demo GIF | README 没有 HN/Reddit 能转化的"硬通货" | benchmark 数字 + 论文/方法贴是 table stakes |
| 5 | **不在用户搜索的地方**：不在任何 MCP 目录 / awesome 列表 | 自然发现量 = 0 | 列入 awesome-mcp-servers / glama / mcp.directory |
| 6 | **CI 可靠性**：issue #28 测试 OOM（PGLite 实例未清理）；README "800+ tests" vs 实际 84 测试文件，可信度需核对 | 贡献者信心 / badge 真实性 | 绿 CI 是信任基础 |
| 7 | **无发布节奏**：0 Release / 0 tag / 无 npm 版本 | 缺少"新版本"这种天然二次曝光由头 | 季度 benchmark/feature drop 再次引爆 |

---

## 3. 战略主轴：一次重定位决定成败

**把"飞书工作记忆"重定位为"本地优先的 AI Agent 记忆层（你拥有你的数据）"，飞书降为众多连接器之一。**

理由：给 star 的人群（GitHub/HN/Reddit，以美欧 + Claude/Cursor/OpenCode 用户为主）几乎不用飞书；而你**已经在采集 Claude Code / Codex 会话**——这正是该人群每天产生、且痛点最强的数据源。把它做成主角，飞书作为给中国/企业市场的楔子保留。

新 headline 候选：
> **Memoark — 本地优先的个人记忆层，让你的 AI Agent 永远记得。原生 TypeScript，内嵌 Postgres 知识图谱，无云、无外部数据库、无 Docker。通过 MCP 读写。**

差异化三连（vs 各对标）：
- vs basic-memory（Markdown+SQLite）→ **结构化信号图谱 + pgvector 混合检索**，不只是文件。
- vs mem0/Python 全家桶 → **单进程、内嵌 Postgres、零外部依赖、TS 原生**。
- vs 纯 RAG → **实体 + 关系 + 时间线知识图谱**，有上下文。

---

## 4. 分阶段实施方案

### Phase 0 — 定位与叙事重塑（第 1 周）
- [ ] 改 GitHub 仓库 description 为新 one-liner（与 README 头条逐字一致，全网复用）
- [ ] README 重排：Agent 记忆层叙事置顶，飞书移到"连接器"章节
- [ ] 加 GitHub Topics：`ai-memory` `agent-memory` `mcp` `knowledge-graph` `local-first` `claude-code` `rag` `typescript`
- [ ] 开启 GitHub Discussions（已开）+ 建 Discord
- 产出：定位清晰、可被搜索

### Phase 1 — 消灭上手摩擦（第 1–2 周，最高 ROI）
- [ ] **发布到 npm**，支持 `npx memoark` / `bunx memoark`（当前 bin 已兼容，缺 publish + dist 产物）
- [ ] **一条命令接入 Agent**：`npx memoark mcp install --client claude-code|cursor|codex`，自动写 MCP 配置
- [ ] **`npx memoark demo`：零 API key 本地 demo**——内置 mock extractor + 示例数据，60 秒内让用户在 Claude Code 里"召回上一次会话决策"
- [ ] 提供 **Docker 镜像** + `docker run` 一行启动 serve
- [ ] 打第一个 **Release v0.3.0**（GitHub Release + npm + tag），CHANGELOG 配套
- 产出：从"看到"到"跑起来" < 60 秒

### Phase 2 — 可信度资产（第 2–4 周）
- [ ] **Demo GIF/短视频**置顶：Agent 跨会话召回一条历史决策（README above the fold）
- [ ] **Benchmark**：在 LoCoMo / LongMemEval（或自建 agent-session 召回集）上对比 mem0 / basic-memory，给出召回率 + token + 延迟数字，写一篇方法贴
- [ ] **三栏对比表**：Library（本地）vs Self-host vs（未来）Cloud，并对比 mem0/basic-memory
- [ ] **Badge 墙**：npm 下载量、CI 通过、Discord、license（移除/核实 "800+ tests" 等不可验证声明）
- [ ] **5 行代码片段**：展示 `query()` / `put_page()` 的极简用法
- [ ] 修 issue #28（PGLite afterAll 清理），让 CI 稳定全绿
- 产出：README 具备 HN/Reddit 发射所需的全部"硬通货"

### Phase 3 — 分发发射（第 4–6 周）
- [ ] **列入所有 MCP 目录**：punkpeye/awesome-mcp-servers、glama、mcp.directory、mcpservers.org、best-of-mcp-servers（memory 分类，低成本高触达）
- [ ] **Show HN**：角度 = "本地优先、内嵌 Postgres 知识图谱、把你的 Agent 会话变成记忆、无云" + benchmark。准备好落地素材（HN 流量半衰期 ~24h，必须即时转化）
- [ ] **Reddit**：r/LocalLLaMA + r/selfhosted（强调本地/隐私/Ollama），r/AIMemory，r/ClaudeAI
- [ ] **X/Twitter build-in-public**：发射线程 + benchmark 图
- [ ] **卫星仓库**：`memoark-claude-code` / `memoark-codex` 各自独立 repo，回流主仓（supermemory/letta 都靠这招，各 1–3K star）
- 产出：一次发射尖峰建立基本盘（目标单次 +500~2000）

### Phase 4 — 持续累积（第 6 周起）
- [ ] **框架集成**做反链/发现面：LangChain/LangGraph、Vercel AI SDK、LlamaIndex、Cursor/Windsurf/OpenCode skins
- [ ] **季度再发射**：新 benchmark drop / 新连接器（Slack、Obsidian 双向、Notion、邮件）当由头再引爆（mem0 的"新记忆算法"就是 re-launch 战术）
- [ ] **社区运营**：Discord 答疑、good-first-issue、快速 merge PR
- [ ] **发布节奏**：每 2–4 周一个 Release，保持 npm 下载曲线和 changelog 活性
- 产出：尖峰之后稳定爬坡到 5K

---

## 5. 里程碑（量化）

| 阶段 | 时间 | Star 目标 | 关键交付 |
|---|---|---:|---|
| 重定位 + 降摩擦 | 第 1–2 周 | 50 | npm 发布、`npx` 接入、定位重写 |
| 可信度 | 第 3–4 周 | 200 | demo GIF、benchmark、对比表、CI 全绿 |
| 首次发射 | 第 5–6 周 | 1,200 | Show HN + Reddit + MCP 目录 |
| 集成 + 卫星仓 | 第 2–3 月 | 2,500 | 框架集成、per-agent 仓库 |
| 再发射循环 | 第 4–6 月 | 5,000 | 季度 benchmark/连接器 drop |

> 现实校准：basic-memory（最近对标）在 3.2K 且无融资。越过它到 5K 的关键变量是**发射素材质量（demo+benchmark）**与**激活摩擦**，而非更多功能。功能已经够了。

---

## 6. 立即可做的 Quick Wins（本周内）

1. 改仓库 description + 加 Topics（10 分钟，立刻改善搜索可见性）
2. 修 issue #28，让 CI 全绿（信任基础）
3. `npm publish` + 打 v0.3.0 Release（解锁 `npx`，最高 ROI 单点）
4. 录一个 60 秒 demo GIF 放 README 顶部
5. 提 PR 把 Memoark 加进 `awesome-mcp-servers` 的 memory 分类

---

## 参考来源

mem0 / khoj / graphiti / supermemory / letta / cognee / honcho / basic-memory / memobase 的 GitHub 仓库与融资公告；MemGPT→Letta 博客；supermemory TechCrunch 报道；HN→GitHub 扩散研究（arXiv 2511.04453）；awesome-mcp-servers 与 best-of-mcp-servers 目录分析。
