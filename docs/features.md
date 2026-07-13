# 功能清单

> [← 返回 README](../README.md) · 完整的能力清单（均已实现并随包发布）。

## 📥 数据采集

- 飞书群聊（OpenAPI chat/message）
- 飞书私信 / 最近会话（lark-cli `message_search`，user 态）
- 飞书邮件
- 飞书日历事件
- 飞书任务
- 飞书文档摘要卡片（DocSource v2：pointer 卡 → 触发后升级完整卡）
- Claude Code 会话（`~/.claude/projects/`）
- Codex CLI 会话（`~/.codex/`）
- OpenClaw Hermes 多 Agent 会话（`~/.openclaw/agents/`，自动发现子 Agent）
- 增量采集：按源 cursor + 内容 hash 去重
- 历史回填（backfill）：覆盖范围统计、启动 / 取消 / 重置

## 🧠 信号提取 Pipeline

- 采集 → 去重 → 分块（Block Builder）→ 噪声过滤 → 信号提取 → 隐私脱敏
- 双层噪声过滤：L1 规则 + L2 LLM 打分
- 7 类结构化信号：实体、时间线、决策、任务、发现、知识、关系
- LLM 提供方：OpenAI / Anthropic 及 OpenAI 兼容代理（含 mock，便于测试）
- 信号打分（signal scoring）与实体抽取
- JSON / Markdown 两种输出格式
- 输出适配器：store（PGLite）/ file / gbrain / stdout
- 来源溯源（provenance）：每条信号可追溯到原始消息

## 🔒 隐私与安全

- 写入前脱敏，数据全程本地
- 双轨模式：可逆（reversible）/ 不可逆（irreversible）
- 内置脱敏：手机号、身份证、银行卡，可自定义替换符
- 配置中心 API key 全程掩码显示
- HTTP 服务默认只绑定 `127.0.0.1`；对外暴露强制要求鉴权令牌

## 🗄️ 存储与检索

- PGLite 嵌入式 PostgreSQL（进程内，零外部依赖）
- 自管理本地 Postgres 引擎（`store.engine: managed`，更快，可选）：macOS（arm64 / x64）+ Linux（x64 / arm64）
- pgvector 向量检索
- tsvector 全文检索（simple 分词器，支持中文）
- RRF 混合搜索（全文 + 向量融合排序），compiled_truth / backlink 加权
- 递归文本分块（300 词 / 50 词重叠），嵌入复用与过期检测
- 向量嵌入：OpenAI / Ollama（本地）

## 🕸️ 知识图谱

- 有向链接图，带链接类型与上下文
- BFS 图遍历（可控深度 / 方向）
- 反向链接（backlinks）
- 实体锚定：信号挂到人 / 项目 / 工具
- 实体画像聚合（profile：信号 + 时间线）
- 写入时零-LLM 自布线（`[[slug]]` / `[[rel:slug]]` 自动建图边）

## 👤 人物身份管理

- 身份解析与规范化（canonicalize）
- 别名 / handle 绑定（飞书 open_id、邮箱、姓名、昵称、slug）
- 强 / 弱绑定强度
- 人物合并（merge，自动重指向链接 / 时间线 / 标签 / 别名）
- 重命名规范 slug（修正错误规范化）

## ♻️ 记忆生命周期 & 常驻服务

- 记忆巩固（Memory Consolidation）：hot → warm → cold 分层轮转
- 死链修复
- 偏好推断（从历史中归纳 preference）
- 常驻 Daemon：按源定时采集、调度、运行历史、告警
- 后台服务生命周期：`memkin up` / `down` / `status` / `autostart`（launchd / systemd 开机自启）

## 🔗 同步与互通

- Obsidian 双向同步（导出 vault / 导入回库）
- MCP 服务器（stdio + Streamable HTTP）：默认 15 个高意图工具 + 会话 / 实体 / 身份工具，含 legacy 共 36 个
- REST API（Hono，覆盖页面 / 搜索 / 图谱 / 标签 / 时间线 / 嵌入 / 提取 / 溯源 / 事件流）

## 🖥️ Web UI（React + Vite）

- Dashboard 概览
- 时间线视图（feed）
- 力导向知识图谱
- 搜索界面
- 实体 / 页面详情
- 浏览器内配置编辑 + 引导式 setup 向导

## ⚙️ 配置与上手

- 一键安装脚本（curl | sh）：装运行时 → 全局安装 → 向导 → 后台服务 + agent 接线
- 交互式配置中心（全屏 TUI，React + ink）
- 浏览器 setup 向导（`memkin init --web`），支持 express 快速路径
- 线性问答向导 fallback（`--no-tui`）/ 全自动（`--auto`）
- 自动检测：运行时、API key、已有数据源
- 硬件评估 → 推荐本地 / 远程 Embedding
- 实时连接测试（LLM / Embedding API key 与连通性）
- `memkin doctor` 环境诊断
