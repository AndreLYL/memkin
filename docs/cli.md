# CLI 命令参考

> [← 返回 README](../README.md) · `memkin --help` 查看内置帮助。

## 命令总表

| 命令 | 说明 |
|------|------|
| `memkin start` | 一键启动：无配置自动引导 setup，完成后 serve + 自动开浏览器（裸跑 `memkin` 等效） |
| `memkin up` | 注册为开机自启的后台常驻服务（daemon）并立即启动 |
| `memkin down` | 停止后台服务并取消开机自启 |
| `memkin status` | 查看后台服务状态 |
| `memkin autostart <action>` | 单独管理开机自启（enable / disable / status） |
| `memkin init` | 交互式配置中心，生成 / 编辑 `memkin.yaml`（`--auto` / `--no-tui` / `--force` / `--web`） |
| `memkin extract` | 从数据源提取信号（见下方选项） |
| `memkin search <query>` | 搜索记忆（混合 / `--mode fts`） |
| `memkin embed` | 为未嵌入的 chunk 生成向量 |
| `memkin serve` | 启动 HTTP API（自动开浏览器，`--no-open` 关闭）/ `--mcp` stdio / `--mcp-http` |
| `memkin install` | 一键把 MCP 配置 + 记忆指令写入 AI 客户端（`--agent` 指定 / `--dry-run` 预览） |
| `memkin uninstall` | 干净移除 agent 接入（幂等） |
| `memkin hooks` | Claude Code 自动召回 hooks：`install`（`--write-back` 可选）/ `uninstall` |
| `memkin skill scaffold` | 为 Hermes / OpenClaw 铺 memkin skill（`--dir` 指定 skills 目录） |
| `memkin consolidate` | 运行记忆巩固（分层轮转 hot→warm / warm→cold） |
| `memkin export` | 把记忆页面导出为 Obsidian vault（Markdown） |
| `memkin import` | 把 Obsidian vault 导回 Memkin |
| `memkin docs` | 飞书文档摘要卡片：`sync` / `status` / `retry` |
| `memkin identity` | 人物身份管理：`alias` / `handles` / `merge` / `rename` |
| `memkin sessions` | Agent 会话台账：`ls` / `inspect` / `retry` / `purge` |
| `memkin sources` | `list` 列出 / `test <name>` 测试数据源 |
| `memkin doctor` | 诊断配置和连通性 |
| `memkin config` | `init`（等价 `memkin init`）/ `edit`（浏览器 UI 编辑） |

## `memkin extract` 选项

```bash
memkin extract \
  --source <name>              # claude-code, codex, hermes, feishu, all
  --format json|markdown       # 输出格式，默认 json
  --adapter store|file|gbrain|stdout  # 输出目标，默认 store
  --since <date>               # 只处理此日期之后的消息（如 3d / 2026-07-01）
  --limit <n>                  # 限制消息数
  --dry-run                    # 测试模式（不调 LLM、不写库、不提交 cursor）
```

## `memkin init` 运行模式

`memkin init` 启动一个交互式配置中心，零手写生成 / 编辑 `memkin.yaml`：

| 命令 / 环境 | 行为 |
|---|---|
| `memkin init`（TTY 终端下） | 全屏 TUI 配置中心（React + ink） |
| `memkin init --web` | 浏览器 setup 向导 |
| `memkin init --no-tui` | 逐项问答式向导（线性 fallback） |
| `memkin init --auto` | 全自动，无提示，用检测到的默认值生成 |
| `memkin init --force` | 覆盖已有配置 |
| `MEMKIN_NO_TUI=1` | 强制禁用 TUI（非 TTY 环境也会自动 fallback） |

配置中心特性：分区编辑（LLM / Embedding / 数据源 / 隐私 / 分块）、实时连接测试、按硬件推荐 Embedding、API key 掩码、自动检测已有数据源。

## 从源码安装（开发）

```bash
git clone https://github.com/AndreLYL/memkin.git
cd memkin
bun install
npm link          # 注册 memkin 全局命令
```

开发工作流见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
