# Spec 5 — Web 配置向导 & 设置中心

## 目标

为 Memoark 提供一套基于浏览器的配置 UI，作为现有 TUI 的并列选项，让不熟悉终端的用户也能无缝完成初始化和后续配置修改。

---

## 背景

Memoark 当前配置体验：
- `memoark init` — 启动 Ink/React 全屏 TUI 向导（首选路径）
- `memoark init --no-tui` — 文本行提示（回退路径）
- `src/config-center/` — 独立 TUI 配置中心，40+ 字段，8 个分区

TUI 保留不动。Web UI 是第三条路径，用户自行选择。

---

## 架构

### 入口

```
memoark init --web
  └─ 启动 SetupServer（独立轻量 HTTP server，仅用于配置向导）
     ├─ 监听 127.0.0.1:3927（或随机可用端口）
     ├─ 自动 open http://localhost:{PORT}/setup
     ├─ 向导完成 → 写入 memoark.yaml → 发送 POST /api/setup/complete
     └─ SetupServer 优雅关闭，提示用户运行 memoark serve

memoark config --web
  └─ 启动 ConfigServer（同一套静态资产，/config 路由）
     └─ 自动 open http://localhost:{PORT}/config

memoark serve（无 memoark.yaml）
  └─ 不自动启动，仅打印提示：
     "未找到配置文件，请运行 memoark init 或 memoark init --web"
```

### 前端技术栈

- React + TypeScript，与现有 Ink 保持一致
- 两个独立 SPA：`setup`（分步向导）和 `config`（单页设置）
- 用 Bun 构建，产物为静态 HTML/JS/CSS，内嵌到项目 `src/web-dist/`
- 构建命令：`bun run build:web`

### 安全

- SetupServer / ConfigServer 只绑定 `127.0.0.1`，不对外暴露
- API Key 在所有日志和响应里掩码处理（仅显示末 4 位）

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
  └─ [测试连接] → 实时显示 ✓ 成功 / ✗ 失败 + 延迟

Step 3 — Embedding 配置
  ├─ Provider（OpenAI / Ollama）
  ├─ Model、Dimensions
  ├─ OpenAI → API Key；Ollama → Base URL（http://localhost:11434）
  └─ [测试连接]

Step 4 — 飞书配置（可跳过）
  ├─ "我使用飞书" 开关（关闭则跳至 Step 7）
  ├─ App ID / App Secret
  └─ [测试连接]

Step 5 — 飞书数据源开关（仅飞书开启时）
  ├─ 私聊 DM        [开/关]
  ├─ 群聊消息        [开/关]  ← 开启时 Step 6 出现
  ├─ 邮件 Mail      [开/关]
  ├─ 云文档 Docs    [开/关]
  ├─ 任务 Task      [开/关]
  └─ 日历 Calendar  [开/关]

Step 6 — 群聊选择（仅群聊开关开启时）
  ├─ [获取我的群聊列表] → 调用 GET /api/feishu/groups
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

`memoark config --web` 触发，单页分区视图，可折叠展开。

分区：
1. **LLM** — 同向导 Step 2 字段
2. **Embedding** — 同向导 Step 3 字段
3. **飞书** — 飞书开关 + App ID/Secret + 数据源开关 + 群聊管理
4. **存储路径** — Database 路径 + 导出目录

每个分区右上角有 [保存此分区] 按钮，调用 `POST /api/config`（合并写入，不覆盖其他分区）。连接测试按钮内联在各字段旁。

---

## API 层

SetupServer 和 ConfigServer 共享同一套路由处理器（`src/server/config-routes.ts`）：

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/config` | 返回当前 memoark.yaml 解析为 JSON |
| POST | `/api/config` | 写入 memoark.yaml（完整替换或分区合并） |
| POST | `/api/test/llm` | 测试 LLM 连接，返回 `{ ok, latency_ms, error? }` |
| POST | `/api/test/embedding` | 测试 Embedding 连接，返回 `{ ok, error? }` |
| POST | `/api/test/feishu` | 测试飞书 App ID/Secret，返回 `{ ok, error? }` |
| GET | `/api/feishu/groups` | 用当前 app_id/app_secret 拉取群聊列表，返回 `{ groups: [{id, name}] }` |
| POST | `/api/setup/complete` | 向导完成信号，SetupServer 优雅关闭（仅 SetupServer） |

---

## 文件结构

### 新增

```
src/
  web/
    setup/
      App.tsx                 # 向导主组件，管理步骤状态
      steps/
        Welcome.tsx
        LLMConfig.tsx
        EmbeddingConfig.tsx
        FeishuConfig.tsx
        FeishuSources.tsx
        GroupSelection.tsx
        StoragePaths.tsx
        Review.tsx
      api.ts                  # /api/* 调用封装
      types.ts                # 前端 Config 类型

    config/
      App.tsx                 # 设置页主组件
      sections/
        LLMSection.tsx
        EmbeddingSection.tsx
        FeishuSection.tsx
        StorageSection.tsx
      api.ts

    shared/
      ConnectionTest.tsx      # 测试连接按钮 + 状态
      ToggleSwitch.tsx
      SecretInput.tsx         # API Key 输入（带显示/隐藏）
      PathInput.tsx           # 路径输入（带默认值灰色提示）

  server/
    setup-server.ts           # SetupServer 类
    config-routes.ts          # 所有 /api/* 路由处理器
    feishu-proxy.ts           # /api/feishu/groups 飞书 API 调用

  web-dist/                   # 构建产物（.gitignore）
    setup/index.html
    config/index.html
```

### 修改

```
src/cli.ts
  ├─ memoark init：新增 --web 标志
  ├─ memoark config：新增命令（--web 标志启动 ConfigServer，无标志时打印用法提示）
  └─ memoark serve：无配置文件时打印提示

package.json
  └─ 新增 "build:web" script
```

### 不动

```
src/config-center/            # TUI 配置中心，完整保留
src/setup/                    # 文本行向导，完整保留
```

---

## 范围外（Spec 6）

- 历史回溯时间轴（后台任务队列、进度追踪、完成通知）
- Web UI 的深色模式 / 主题
- 多语言 i18n
