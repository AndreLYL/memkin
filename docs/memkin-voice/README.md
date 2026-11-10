# MemKin Voice 共享设计

这组文档用于让 Mac mini 上的手机/手表开发与网站交互设计共享同一份可核对的方案。版本为 2026-11-10 的 **RFC 0.1**：其中用户明确约束始终生效，新增目标和接口扩展仍需评审与实现。

| 文件 | 阅读目的 |
| --- | --- |
| [SPEC.md](SPEC.md) | 完整产品与技术方案：跨端职责、P0、合同、人工确认、证据、回顾、隐私、失败恢复、24 项验收场景 |
| [IMPLEMENTATION-MATRIX.md](IMPLEMENTATION-MATRIX.md) | Core main、未合并的 Voice PR #141、Sites 原型的能力与字段差异，区分已实现和待实现 |
| [MAC-HANDOFF.md](MAC-HANDOFF.md) | 本机读取方案的命令、需回填的工程信息、协作边界及可复制的交接任务 |
| [fixtures/README.md](fixtures/README.md) | 纯虚构合同样例的用途、限制与校验方式 |

先前网站已发布为独立私人原型，尚未连接 Core 或原生端。浏览器内“确认写入”不代表已写入 Mac 数据库；其导出格式也没有已验证的 Core 导入器。

本次核对发现 GitHub 中已有 [Voice P0 PR #141](https://github.com/AndreLYL/memkin/pull/141)，因此共享方案以它和 main CRM 的真实合同为基础，明确记录网页的 `speaker_id`、日期和逐条审核等不兼容处，不另设一套正式协议。Mac 当前工作区及原生工程尚未由本会话读取，需要按交接表补充。

本目录只包含设计和虚构样例，不包含私人录音、转写、数据库、声纹、密钥或模型权重。没有因此合并代码、迁移数据、修改 Mac 工作区或建立跨端同步。
