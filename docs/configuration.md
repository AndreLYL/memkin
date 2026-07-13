# 配置参考

> [← 返回 README](../README.md) · 配置文件为 `memkin.yaml`，推荐用 `memkin init` 生成，无需手写。

## `memkin.yaml` 示例

```yaml
# 隐私配置
privacy:
  enabled: true
  mode: reversible           # reversible（可逆）| irreversible（不可逆）
  redact_phone: true
  redact_id_card: true
  redact_bank_card: true
  replacement: "[REDACTED]"

# LLM（信号提取用）
llm:
  provider: openai           # openai | anthropic | custom（OpenAI 兼容代理）
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}

# 分块配置
block_builder:
  block_gap_minutes: 30
  max_block_tokens: 4000
  max_block_messages: 100

# 数据源
sources:
  claude-code:
    enabled: true
  codex:
    enabled: true
  hermes:
    enabled: true

# 存储
store:
  engine: pglite             # pglite（默认，零依赖）| managed（自管理本地 Postgres，更快）
  data_dir: ~/.memkin/data

# 嵌入
embedding:
  provider: openai           # openai | ollama
  model: text-embedding-3-large
  dimensions: 1536
  api_key: ${OPENAI_API_KEY}

# 服务器
server:
  http_port: 3927
```

> `store.engine: managed` 会自动下载并管理一个本地 Postgres 运行时（校验和固定），支持 macOS（arm64 / x64）与 Linux（x64 / arm64）；默认的 `pglite` 全平台开箱即用。

## 端口一览

| 服务 | 默认端口 | 地址 |
|------|---------|------|
| HTTP API + Web UI | `3927` | `http://localhost:3927` |
| MCP Streamable HTTP（`--mcp-http`） | `3928` | `http://localhost:3928/mcp` |

## 对外暴露与鉴权

服务默认只绑定 `127.0.0.1`（仅本机）。要在局域网暴露，用 `memkin serve --host 0.0.0.0`（或在 `memkin.yaml` 里设 `server.host`）——这会**强制要求配置鉴权令牌**，否则拒绝启动。

令牌来自 `server.auth_token`（config）或 `MEMKIN_AUTH_TOKEN`（env）；配置后，所有 API 请求都需带 `Authorization: Bearer <token>` 请求头。

```yaml
# memkin.yaml
server:
  host: 0.0.0.0
  auth_token: <你的令牌>   # 或 export MEMKIN_AUTH_TOKEN=<你的令牌>
```

## 数据与运行状态的存放位置

- **数据库**：默认在 `~/.memkin/data`，保存提取后的页面、chunk、关系和时间线。
- **运行状态**：运行目录下的 `.memkin/`（`cursors.yaml` 保存各源增量 cursor，`dedup.jsonl` 保存消息去重 hash）。后台服务（`memkin up`）有自己的固定运行目录。

正常增量运行**不要手动删**这些文件——删掉 cursor 会导致重复采集,删掉 dedup 会导致重复信号。

## 环境诊断

```bash
memkin doctor     # 检查配置、运行时、API 连通性
```
