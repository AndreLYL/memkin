# Memoark 产品形态调研：README 写法 · 定位 · 图形化配置 · 跨平台打包

> 配套文档：增长方向见 [`GROWTH_PLAN.md`](./GROWTH_PLAN.md)。
> 本文回答四个问题：① 高星项目 README 怎么写；② AI 产品怎么定位抓眼球；③ 怎么做「傻瓜化」图形配置；④ 打包成 Win/Linux/Mac 单可执行文件是否可行（含**本仓库实测结论**）。

---

## 1. 高星项目 README 的写法范式

### 1.1 行业共识结构（来自分析 AFFiNE 60k+、awesome-readme 等）

高转化 README 的"首屏(above the fold)"必须在 5 秒内回答**三问**：*这是什么 / 给谁用 / 凭什么不一样*。标准骨架：

1. **Logo + 项目名**（居中）
2. **一句话价值主张**（tagline，最关键的一行）
3. **徽章(4 个功能性即可)**：License、Build、Version、社群(Discord/微信群)。徽章是信任信号,不是装饰。
4. **Hero 动图 / demo GIF**（首屏之上,展示"它在动")
5. **30 秒上手**(前 200 词内出现,**3 步以内**,复制即用)
6. **Features 表格**(扫读,不堆段落)
7. **"Why / 痛点故事"**(problem → story → 你的解法)
8. **"为什么不用 X"对比表**(消解"我已经有 mem0/aily 了")
9. **文档链接 / 集成(MCP)**
10. **Contributing 邀请 + License**
- **长度**:正文 800–1500 词,< 5 分钟读完。

### 1.2 memoark 专属 README 骨架（中文首屏，按已定方向）

```
[居中] Memoark Logo
[居中] 把你的飞书工作与 AI Agent 会话,沉淀成一份私有、本地的核心记忆 ——
       它记得你做了什么决策、为什么,并让任何 Agent 真正懂你。
[徽章] License Apache-2.0 · CI passing · v0.x · 微信群/Discord · tests 800+
[Hero GIF] 飞书聊方案 + Claude Code 写实现 → 自动决策图谱 → Agent 答"为什么"

## 30 秒上手          ← 必须在首屏附近、3 步
  npx memoark quickstart      # 自动读 ~/.claude,出第一份记忆,免配 key
  npx memoark serve --mcp     # 接入 Claude Code / Cursor

## 它解决什么(痛点故事)  ← 现有 README 的"痛点"段已很好,保留
## 核心特性(表格)
## 为什么不用 飞书 aily / mem0?   ← 新增对比表(本地·私有·跨 Agent·决策图谱)
## 接入你的 Agent(MCP 配置块)
## 架构图 / 数据源 / Roadmap
```

> 现有 README 的"痛点—解决方案—双输入流"叙事其实很强,**主要欠缺**:① 首屏 demo GIF;② 30 秒 `npx` 上手(目前是 clone+link);③ "为什么不用 aily/mem0"对比段;④ 徽章里加社群。

### 1.3 立刻能做的 5 个 README 改进

- [ ] 顶部加 demo GIF(P0,见 §3 的 GUI 也能顺手录)。
- [ ] 把"快速开始"换成 `npx` 3 步(依赖 §4 打包/发布)。
- [ ] 新增"为什么不用飞书 aily / mem0"对比表。
- [ ] 徽章加"微信群/Discord"(社群信号)。
- [ ] 中文首屏顶部放醒目语言切换,`README.en.md` 同步。

---

## 2. AI 产品怎么定位抓眼球

### 2.1 三个原则（2026 定位方法论）

1. **明确命名你的品类**（category designation）。别让人猜。例：把 memoark 命名为 **"本地优先的个人记忆中枢 / AI 记忆系统"**,而不是模糊的"知识管理工具"。
2. **一句话价值 + 证明点(proof point)**。例:WordPress 用"驱动 43% 的网站"。memoark 的证明点候选：*"覆盖飞书 7 个源 + 自动挖 7 类结构化信号 + 800+ 测试,数据 100% 不出本机"*。
3. **让用户"被看见"**:开头直接戳痛点(每次新 Agent 会话都要重讲项目/为什么),而不是先吹功能。

### 2.2 memoark 的定位三件套

- **品类(一词)**：*本地优先的 AI 记忆系统 / 个人记忆中枢*。
- **一句话(tagline)**：*把你的飞书工作与 AI 会话,沉淀成私有、本地的核心记忆 —— 它记得"为什么"。*
- **差异化锚点(对 aily/mem0)**：**本地 · 私有 · 开源 · 跨任意 Agent · 结构化决策图谱(而非黑盒)**。

### 2.3 "傻瓜化"本身就是定位的一部分

你提到要做得"足够傻瓜化、可视化配置" —— 这正是一个**可对外讲的差异点**:mem0/cognee 偏开发者 SDK、aily 偏企业后台,而 memoark 可以打 **"5 分钟图形化装好、本地私有的个人 AI 记忆"** —— 把"易用 + 私有"作为对个人用户的核心卖点。建议把它写进 tagline 的支撑点。

---

## 3. 「傻瓜化」图形配置方案

### 3.1 现状盘点

memoark 已经有两套"配置 UI"基础:
- **ink 全屏 TUI 配置中心**(`memoark init`)—— 终端里的图形化,但仍是"终端"，对非技术用户门槛高。
- **React Web UI**(`web/`,Dashboard/时间线/图谱/搜索)—— 已有完整前端,但**没有"配置/Setup"页**,且要 `cd web && bun run dev` 手动起。

### 3.2 三条路线对比

| 方案 | 形态 | 工作量 | 体验 | 适合 |
|---|---|---|---|---|
| **A. Web UI 加 Setup 向导** | 本地网页(`memoark ui` 自动开浏览器) | **低**(复用现有 React + 配置 schema) | 好,跨平台一致 | **推荐首选** |
| **B. Tauri 桌面壳** | 双击 .exe/.dmg/.AppImage,原生窗口+托盘 | 中(引入 Rust/Tauri,复用 React UI) | 最"傻瓜"(双击即用) | 推荐中期 |
| C. Electron 桌面壳 | 同上 | 中高(80–150MB,200–300MB 内存) | 一致但重 | 不推荐 |

### 3.3 推荐路线（分两步）

**第一步(短期,低成本)：在现有 React Web UI 里加图形化 Setup 向导**
- 新增 `/setup` 页:表单式配置 LLM/Embedding(带**实时连接测试**,这套逻辑 TUI 里已有,可复用)、数据源开关、隐私脱敏、飞书登录引导(分步截图)。
- 新增 CLI 命令 `memoark ui` / `memoark setup`:启动 Hono 服务 + **自动打开浏览器**到配置页。把 `bun run dev` 这一步对用户隐藏。
- 配置写回 `memoark.yaml`,与现有 schema 复用。
- **效果**:非技术用户全程鼠标点击,零 YAML、零终端命令记忆。

**第二步(中期,真"傻瓜")：Tauri 桌面应用**
- 用 **Tauri**(3–10MB 安装包、~30–40MB 内存、原生 WebView + Rust 核)把 React UI 包成桌面 App:双击打开、系统托盘常驻、原生菜单。
- Tauri 对比 Electron:体积小 96%、内存约 1/6,**更适合本地优先/隐私定位**(权限最小化,审计友好)。
- 注意:Tauri 各 OS 用不同 WebView,需测 UI 一致性;Rust 工具链 + 各平台分别打包。
- memoark 的 Bun 后端(CLI/pglite/MCP)可作为 Tauri 的 **sidecar 二进制**(见 §4 的单文件打包),Tauri 前端只管 UI。

> 结论:**先做 A(网页向导,几天到一两周即可显著降门槛),再视反馈做 B(Tauri 桌面 App)**。不建议 Electron。

---

## 4. 跨平台单可执行文件：可行性（含本仓库实测）

### 4.1 结论：✅ 可行，用 Bun 的 `bun build --compile`

Bun 原生支持把"代码 + Bun 运行时"打成**单个可执行文件**,无需用户装 Bun,且支持**交叉编译**到各平台:

```bash
bun build --compile --target=bun-linux-x64    src/cli.ts --outfile memoark-linux
bun build --compile --target=bun-windows-x64  src/cli.ts --outfile memoark.exe
bun build --compile --target=bun-darwin-arm64 src/cli.ts --outfile memoark-mac-arm
bun build --compile --target=bun-darwin-x64   src/cli.ts --outfile memoark-mac-x64
bun build --compile --target=bun-linux-arm64  src/cli.ts --outfile memoark-linux-arm
# 老 CPU(无 AVX2)用 -baseline 变体,如 bun-linux-x64-baseline
```

**额外利好**:Bun ≥ 1.2.17 可把 **server + 前端资产(HTML/JS/CSS)一并打进单文件**(当 server 代码 import HTML 时自动打包前端)。意味着 **memoark 的 React Web UI 也能塞进同一个二进制**,实现"一个文件 = CLI + MCP + Web 配置界面"。

### 4.2 本仓库实测结果（2026-06，Bun 1.3.11）

| 项 | 结果 |
|---|---|
| 编译能否完成 | ✅ 成功,打包 1164 模块,产物 **~99MB** |
| 直接 `bun build --compile src/cli.ts` | ⚠️ 失败:`ink` 急切 import 可选依赖 `react-devtools-core` |
| 装上 `react-devtools-core` 后 | ✅ 编译通过、二进制可启动 |
| 运行 `search`(触发存储) | ⚠️ 失败:`ENOENT 001_lifecycle_columns.sql` —— **`.sql` 迁移文件没被嵌入**(`readFileSync(__dirname,...)` 在虚拟文件系统找不到) |

### 4.3 实测发现的两个必改工程点（都可解）

1. **TUI 依赖问题**:`ink` 会 import `react-devtools-core`。
   - 方案:把它列为正式 dependency 一起打包(简单),**或更优**:把 ink/TUI 配置中心改成**动态 `import()` 懒加载**(只有 `memoark init` TUI 路径才加载),这样普通命令和二进制更轻、不被 ink 拖累。
2. **运行时资产未嵌入**(`.sql` 迁移,以及任何 `readFileSync(__dirname, ...)` 读的 `.wasm`/模板):
   - 方案:改成 Bun 嵌入式资产 —— 用 `import sql from "./001.sql" with { type: "text" }`,或 `import wasm from "...wasm" with { type: "file" }`,让它们被编译进二进制;迁移加载器从"读文件"改为"读嵌入字符串"。
   - pglite 的 WASM 通常由其自身打包机制处理(99MB 体积也暗示已包含),但**任何项目自有的 `__dirname` 资产读取都要逐一改为嵌入**。

### 4.4 落地步骤（建议)

- [ ] **资产嵌入重构**:迁移 SQL、任何模板/wasm 改 `with { type: ... }` 嵌入;迁移加载器改读嵌入内容。(P0,否则二进制不能用)
- [ ] **TUI 懒加载**:`cli.ts` 动态 import 配置中心,去掉 ink 对核心路径的拖累。
- [ ] **构建矩阵 + CI 发布**:GitHub Actions 在 push tag 时交叉编译 5 个目标,产物挂到 Release;mac/win 需**代码签名/公证**(否则用户被系统拦截,这是分发的真实成本)。
- [ ] **体积优化**:~99MB 偏大(含 Bun 运行时 + wasm)。可接受(同类桌面工具量级),但可在文案里说明;或对纯 CLI 提供更精简变体。
- [ ] **三种分发并存**:`npx memoark`(开发者)+ 单文件下载(进阶用户)+ Tauri 桌面 App(非技术用户)。

### 4.5 安装/分发矩阵(最终形态)

| 用户类型 | 安装方式 | 摩擦 |
|---|---|---|
| 开发者 | `npx memoark@latest` / `npm i -g` | 最低 |
| 进阶用户 | 下载对应平台单文件,`chmod +x` 直接跑 | 低 |
| 非技术用户 | 下载 Tauri 桌面 App,双击安装,图形化配置 | **最低(傻瓜式)** |

---

## 5. 小结与优先级

1. **README**:补 demo GIF + `npx` 3 步上手 + "为什么不用 aily/mem0"对比 + 社群徽章。(地基,见 GROWTH_PLAN §3-A)
2. **定位**:明确品类("本地优先 AI 记忆系统")+ 一句话讲"记得为什么" + 把"傻瓜化/私有"作为对个人用户的卖点。
3. **图形配置**:先做 React Web UI 的 `/setup` 向导 + `memoark ui` 自动开浏览器(短期、低成本);中期上 Tauri 桌面 App。
4. **单文件打包**:✅ 可行(Bun `--compile`,跨 Win/Linux/Mac),但**必须先做两件事**:资产嵌入重构 + TUI 懒加载;再配 CI 交叉编译 + mac/win 签名。

> 这四件事和 GROWTH_PLAN 的 P0("消除上手摩擦 + magic moment")完全咬合:**图形配置 + 单文件 + npx 三管齐下,正是把 TTV 砍到最低、把"傻瓜化"变成对外可讲的差异点。**

---

## 参考来源

- [GitHub README 模板与最佳实践(gingiris)](https://gingiris.tools/blog/2026/04/02/github-readme-template-guide/) · [README 8 条规则/60k stars(dev.to)](https://dev.to/iris1031/github-readme-best-practices-how-to-write-a-readme-that-gets-stars-2gb2) · [awesome-readme](https://github.com/matiassingers/awesome-readme) · [README 徽章实践(daily.dev)](https://daily.dev/blog/readme-badges-github-best-practices/)
- [Bun 单文件可执行(官方文档)](https://bun.com/docs/bundler/executables) · [Bun 交叉编译(Mamezou)](https://developer.mamezou-tech.com/en/blogs/2024/05/20/bun-cross-compile/) · [Bun CLI 应用构建](https://oneuptime.com/blog/post/2026-01-31-bun-cli-applications/view)
- [Tauri vs Electron 2026(tech-insider)](https://tech-insider.org/tauri-vs-electron-2026/) · [Electron vs Tauri:体积/内存/安全(PkgPulse)](https://www.pkgpulse.com/guides/electron-vs-tauri-2026) · [Tauri in 2026(dev.to)](https://dev.to/ottoaria/tauri-in-2026-build-cross-platform-desktop-apps-with-web-technologies-better-than-electron-11mo)
- [AI 产品定位与一句话信息(kedraco)](https://www.kedraco.com/blogs/messaging-framework) · [品类命名定位(M1-Project)](https://www.m1-project.com/blog/the-best-ai-tools-for-product-positioning)
