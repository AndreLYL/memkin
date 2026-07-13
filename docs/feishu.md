# 飞书采集指南

> [← 返回 README](../README.md) · 飞书是 Memkin 的核心工作数据源，覆盖 7 个源：私信、群聊、邮件、日历、文档、任务、消息搜索。

## 消息的两条采集路径

飞书消息有两条不同路径，按需启用：

- **`sources.feishu.sources.messages`** —— 使用 OpenAPI chat/message 接口，适合明确群聊 `chat_id` 或自动发现到的群聊。
- **`sources.feishu.sources.message_search`** —— 使用 [lark-cli](https://github.com/larksuite/cli) 的 `im +messages-search`（user 态），适合搜索最近私聊和群聊。**私聊对话通常需要这条路径**，否则最近几天的数据会明显偏少。

`message_search` 需要先完成 lark-cli 的飞书用户态登录（setup 向导里可直接完成网页授权），再在 `memkin.yaml` 打开：

```yaml
sources:
  feishu:
    enabled: true
    auth_mode: user
    app_id: ${FEISHU_APP_ID}
    app_secret: ${FEISHU_APP_SECRET}
    sources:
      messages:
        enabled: true
        chat_ids: []
        lookback_days: 3
      message_search:
        enabled: true
        chat_types:
          - p2p
          # - group
        lookback_days: 3
        page_size: 50
```

## 运行提取

```bash
# 最近三天的飞书消息（写入本地库）
memkin extract --source feishu --since 3d

# 干跑：只验证采集数量，不调 LLM、不写库、不提交 cursor
memkin extract --source feishu --since 3d --dry-run
```

后台服务（`memkin up`）启动后，daemon 会按计划自动增量采集，无需手动跑。

## 飞书文档摘要卡片（DocSource v2）

Memkin 把飞书文档采集为可升级的"摘要卡片"：先建立轻量的 pointer 卡，被触发后再升级为完整摘要卡。

```bash
memkin docs sync                  # 扫描文档，建 pointer 卡并升级触发的文档
memkin docs status                # 查看各类文档卡片数量
memkin docs retry <doc_token>     # 重试某个失败文档（--all-failed 重试全部）
```

Agent 也可以通过 MCP 工具 `ingest_feishu_doc`（传入文档 URL 或 token）直接采集单篇文档。

## 增量状态

Memkin 的增量状态分两层：

- **数据库**：默认 `~/.memkin/data`，保存提取后的页面、chunk、关系和时间线。
- **运行状态**：运行目录的 `.memkin/cursors.yaml`（各源增量 cursor）和 `.memkin/dedup.jsonl`（消息去重 hash）。

正常增量运行**不要手动删**这些文件：删 cursor 会重复采集、删 dedup 会产生重复信号。如需重建某个源的数据，请先在 issue 区咨询或备份 `~/.memkin` 后操作。
