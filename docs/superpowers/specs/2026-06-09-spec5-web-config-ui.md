# Spec 5 — Web 配置向导 & 设置中心

## 目标

为 Memoark 提供一套基于浏览器的配置 UI，作为现有 TUI 的并列选项，让用户无需手写 YAML 即可完成初始化和后续配置修改。

---

## 背景

Memoark 当前配置体验：
- `memoark init` — 启动 Ink/React 全屏 TUI 向导（首选路径）
- `memoark init --no-tui` — 文本行提示（回退路径）
- `src/config-center/` — 独立 TUI 配置中心，40+ 字段，8 个分区

TUI 保留不动。Web UI 是第三条路径，用户自行选择。

### 飞书认证的终端前置依赖

**重要限制：** Memoark 访问飞书数据通过本地 `lark` CLI 二进制（`~/.local/bin/lark`），
所有 API 调用走 `lark --as user`，依赖 lark CLI 内存储的用户授权 token，
**不是** 直接用 app_id/secret 换 tenant token。

这意味着：
- 用户在使用飞书功能前，必须先在终端运行 `lark CLI 的登录命令（见 lark-cli 文档）` 完成登录
- Web 向导无法替代这一步
- 飞书连通测试的本质是 `lark auth status`（`LarkCliHttpClient.healthCheck()` 已实现），而不是测试 app_id/secret
- 群聊列表通过 `lark --as user api GET /open-apis/im/v1/chats` 拉取，走用户授权，不走 app 凭证

Web 向导中的飞书步骤需明确告知用户此前置依赖，并提供 `lark auth status` 检测按钮。

---

## 架构

### 入口

```
memoark init --web
  └─ 启动 SetupServer（独立轻量 Hono server，仅用于配置向导，不依赖 memoark.yaml）
     ├─ 随机选取可用端口（避免与 memoark serve 的 3927 端口冲突）
     ├─ 监听 127.0.0.1:{PORT}
     ├─ 自动 open http://localhost:{PORT}/setup
     ├─ 向导完成 → 写入 memoark.yaml → POST /api/setup/complete
     └─ SetupServer 优雅关闭，提示用户运行 memoark serve

memoark config edit --web
  └─ 要求 memoark serve 已运行（端口 3927），或自启动临时 ConfigServer
     └─ 自动 open http://localhost:3927/config

memoark serve（无 memoark.yaml）
  └─ 不自动启动，仅打印提示：
     "未找到配置文件，请运行 memoark init 或 memoark init --web"
```

**注意：** `memoark config` 已存在（`cli.ts:404`），下挂 `config init` 子命令。
新增的是 `memoark config edit --web`，在已有 `configCmd` 下加 `edit` 子命令。

### 前端技术栈

- 扩展现有顶层 `web/` Vite 应用（React 19 + Tailwind CSS + react-router v7 + TanStack Query）
- 新增两个路由页面：`/setup`（分步向导）和 `/config`（单页设置）
- 构建命令沿用现有：`bun run web:build`
- 产物集成进现有 `web/` 构建产物，由主 server 或 SetupServer 提供服务

### HTTP Server 策略

- **`memoark init --web`**：SetupServer 独立启动（`src/server/setup-server.ts`，基于 Hono），
  无需 StoreContext，挂载 config-routes 和静态文件服务
- **`memoark config edit --web`**：config 路由挂载到现有 `createApiApp()`（`src/server/api.ts`），
  不新建 server
- 两条路径共享同一套路由处理器（`src/server/config-routes.ts`）

### 复用现有逻辑

不重写以下已有实现，直接调用：
- `src/setup/connection-tests.ts` — `testLLMConnection()`, `testEmbeddingConnection()`
- `src/config-center/secrets.ts` — `maskSecret()`（API Key 末 4 位掩码）
- `src/config-center/validation.ts` — `validateDraft()`（返回 `ConfigDiagnostic[]`，三级 severity：error/warning/info；API 层需据此区分响应）
- `src/collectors/feishu/lark-cli-client.ts` — `LarkCliHttpClient.healthCheck()`（飞书 auth 检测）

### 安全

- SetupServer 只绑定 `127.0.0.1`，不对外暴露
- API Key 在所有日志和响应里经 `maskSecret()` 处理

---

## 向导流程（Init Wizard）

`memoark init --web` 触发，共 8 步线性流程，支持 Back/Next 导航。

```
Step 1 — 欢迎
  └─ 简短介绍 Memoark 用途，确认开始配置

Step 2 — LLM 配置
  ├─ Provider（OpenAI / Anthropic / 自定义）
  ├─ Model（文本输入，展示常用型号提示）
  ├─ Base URL（仅自定义 Provider 时显示）
  ├─ API Key（SecretInput 组件）
  └─ [测试连接] → 调用 POST /api/test/llm，实时显示 ✓ 成功 / ✗ 失败 + 延迟

Step 3 — Embedding 配置
  ├─ Provider（OpenAI / Ollama）
  ├─ Model、Dimensions
  ├─ OpenAI → API Key；Ollama → Base URL（http://localhost:11434）
  └─ [测试连接] → 调用 POST /api/test/embedding

Step 4 — 飞书配置（可跳过）
  ├─ "我使用飞书" 开关（关闭则跳至 Step 7）
  ├─ ⚠️ 前置提醒："飞书功能需先在终端运行 lark CLI 的登录命令（见 lark-cli 文档） 完成登录"
  ├─ App ID / App Secret（存入 memoark.yaml 供 lark CLI 配置参考）
  └─ [检测 lark auth 状态] → 调用 GET /api/feishu/health（执行 lark auth status）
       ✓ 已登录 → 可继续
       ✗ 未登录 → 显示提示："请先在终端执行 lark CLI 的登录命令（见 lark-cli 文档），完成后再点击检测"

Step 5 — 飞书数据源开关（仅飞书开启时）
  ├─ 私聊 DM        [开/关]
  ├─ 群聊消息        [开/关]  ← 开启时 Step 6 出现
  ├─ 邮件 Mail      [开/关]
  ├─ 云文档 Docs    [开/关]
  ├─ 任务 Task      [开/关]
  └─ 日历 Calendar  [开/关]

Step 6 — 群聊选择（仅群聊开关开启时）
  ├─ [获取我的群聊列表] → 调用 GET /api/feishu/groups
  │    （后端执行 lark --as user api GET /open-apis/im/v1/chats）
  ├─ 成功 → 渲染可多选的群聊列表（显示群名 + Group ID）
  └─ 失败 → 自动降级：显示手动输入 Group ID 文本框（支持多行）

Step 7 — 存储路径
  ├─ Database 路径（默认 ~/.memoark/data，PathInput 组件）
  └─ Markdown 导出目录（可选，空则沿用默认值，灰色占位提示）

Step 8 — 确认 & 保存
  ├─ 展示生成的 YAML 预览（语法高亮，只读）
  ├─ [保存配置] → POST /api/config 写入 memoark.yaml
  └─ 成功后显示完成页：提示运行 memoark serve 启动
```

---

## 设置页（Settings Page）

`memoark config edit --web` 触发，单页分区视图，可折叠展开。

分区：
1. **LLM** — 同向导 Step 2 字段
2. **Embedding** — 同向导 Step 3 字段
3. **飞书** — 飞书开关 + App ID/Secret + lark auth 状态检测 + 数据源开关 + 群聊管理
4. **存储路径** — Database 路径 + 导出目录

每个分区右上角有 [保存此分区] 按钮，调用 `POST /api/config`（合并写入，不覆盖其他分区）。连接测试按钮内联在各字段旁。

---

## API 层

SetupServer 和主 server 共享同一套路由处理器（`src/server/config-routes.ts`）：

| Method | Path | 说明 | 复用 |
|--------|------|------|------|
| GET | `/api/config` | 返回当前 memoark.yaml 解析为 JSON | — |
| POST | `/api/config` | 写入 memoark.yaml；调 `validateDraft()` 返回诊断，error 级拒绝写入 | `validateDraft()` |
| POST | `/api/test/llm` | 测试 LLM 连接，返回 `{ ok, latency_ms, error? }` | `testLLMConnection()` |
| POST | `/api/test/embedding` | 测试 Embedding 连接，返回 `{ ok, error? }` | `testEmbeddingConnection()` |
| GET | `/api/feishu/health` | 检测 lark auth 状态，返回 `{ ok, message }` | `LarkCliHttpClient.healthCheck()` |
| GET | `/api/feishu/groups` | 拉取群聊列表，返回 `{ groups: [{id, name}] }` | `lark --as user api` |
| POST | `/api/setup/complete` | 向导完成，SetupServer 优雅关闭（仅 SetupServer） | — |

**移除原 `POST /api/test/feishu`（app_id/secret 测试）**：与真实 lark-cli 认证模型不符。

---

## 文件结构

### 新增

```
web/src/pages/
  setup/
    index.tsx               # 向导主组件，管理步骤状态
    steps/
      Welcome.tsx
      LLMConfig.tsx
      EmbeddingConfig.tsx
      FeishuConfig.tsx      # 含 lark auth status 检测
      FeishuSources.tsx
      GroupSelection.tsx
      StoragePaths.tsx
      Review.tsx
  config/
    index.tsx               # 设置页主组件
    sections/
      LLMSection.tsx
      EmbeddingSection.tsx
      FeishuSection.tsx
      StorageSection.tsx

web/src/components/config/
  ConnectionTest.tsx        # 测试连接按钮 + 状态显示
  ToggleSwitch.tsx
  SecretInput.tsx           # API Key 输入（带显示/隐藏）
  PathInput.tsx             # 路径输入（带默认值灰色提示）

web/src/api/
  config.ts                 # /api/config 读写
  tests.ts                  # /api/test/* 调用封装

src/server/
  setup-server.ts           # SetupServer（独立 Hono server，用于 memoark init --web）
  config-routes.ts          # /api/config、/api/test/*、/api/feishu/* 路由处理器
```

### 修改

```
web/src/router.tsx
  └─ 新增 /setup 和 /config 路由

src/server/api.ts
  └─ 挂载 config-routes（供 memoark config edit --web 使用）

src/cli.ts
  ├─ memoark init：新增 --web 标志
  ├─ configCmd（已有）：新增 edit 子命令，--web 标志启动浏览器
  └─ memoark serve：无配置文件时打印提示
```

### 不动

```
src/config-center/          # TUI 配置中心，完整保留
src/setup/                  # 文本行向导，完整保留
web/src/pages/              # 现有知识图谱页面，完整保留
```

---

## 范围外（Spec 6）

- 历史回溯时间轴（后台任务队列、进度追踪、完成通知）
- Web UI 的深色模式 / 主题
- 多语言 i18n
