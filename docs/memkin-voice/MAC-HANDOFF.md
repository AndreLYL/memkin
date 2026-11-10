# 给 Mac mini 开发会话的交接

本目录提供共享设计，避免网站、手机和手表分别形成互不兼容的数据体系。**先读真实工作区，再判断设计是否需要修改；不要按文档想象覆盖已有实现。**

## 1. 先读什么

1. [SPEC.md](SPEC.md)：产品目标、约束、当前合同、各端角色及验收。
2. [IMPLEMENTATION-MATRIX.md](IMPLEMENTATION-MATRIX.md)：网站与 Core/Voice 的字段和行为差异。
3. 本机对应 commit 的 `docs/person-crm.md`、`src/crm/schemas.ts`、`src/crm/store.ts`。
4. 若已检出 Voice 分支，再读 `docs/memkin-voice-p0.md`、`src/voice/transcript.ts`、`src/voice/pipeline.ts`、`src/voice/cli.ts` 及 Mac 准备文档。
5. 本机 AGENTS.md / CLAUDE.md 与实际 iPhone/Watch 工程；它们在本次云端会话未被读取。

已核对基线：

| 部分 | 分支/位置 | commit |
| --- | --- | --- |
| Core | main | `195d5398dece493e0eb65181994f2f44ce5e6ee4` |
| Voice CLI | feat/memkin-voice-p0，PR #141 尚未合并 | `c458aedf33b5971bd948f714f11fb6f91fb8a9ae` |
| 网站 | 独立 Sites 源码仓库；[私人原型](https://memkin-voice-lyl.lylandre2017.chatgpt.site/) | `0c110f7f7b9f7e294e9342cf14588c0b4a8ca40b`，不是本仓库 commit |
| 原生端 | 用户报告 Mac mini 上正在开发 | **本会话未知，需本机填入** |

## 2. 如何先读取共享方案而不切换工作区

本 SPEC 在 `docs/memkin-voice-shared-spec` 分支，通过独立文档 PR 提交到 main。Mac 会话可在自己的仓库中：

```sh
git status --short
git branch --show-current
git rev-parse HEAD
git fetch origin
git show origin/docs/memkin-voice-shared-spec:docs/memkin-voice/SPEC.md
git show origin/docs/memkin-voice-shared-spec:docs/memkin-voice/IMPLEMENTATION-MATRIX.md
```

这些命令不切换分支、不覆盖本机未提交文件。确认真实远程/分支后，再按正常评审流程决定合并哪些变更。不要直接 checkout 文档分支并继续原生开发，也不要自动 stash、reset、clean 或强推来取得“干净状态”。

文档 PR 合并后从 main 读取即可。若本机不是该仓库，先用 PR 页面读文档，记录真实工程仓库，不要把当前工程替换成这里的仓库。

## 3. 当前需要回填的最小信息

只需同步代码和设计元数据，**不要把私人音频、转写、数据库、声纹或密钥放到 GitHub**。本地绝对路径若包含隐私可只保留工程相对目录。

| 字段 | Mac 会话填写 |
| --- | --- |
| 实际仓库与 remote | 待核对 |
| 当前 branch、HEAD、工作区是否有未提交改动 | 待核对，不覆盖 |
| iPhone 工程位置、target、实现状态 | 待核对 |
| Watch 工程位置、target、实现状态 | 待核对 |
| 录音/片段/传输 metadata 合同 | 待核对，含 capture time、时区、hash、重试与 ACK |
| 当前本地音频管线是否基于 PR #141 | 待核对 |
| 实际 DB 类型、谁持有写入进程 | 仅报告架构，不上报 DB 内容、凭证或隐私路径 |
| 已验证能力与未验证能力 | 分别记录，附非敏感测试摘要 |
| 与 SPEC 的差异/更好的既有实现 | 列条目与源码位置，不照抄 RFC 覆盖实现 |

## 4. 建议的开发边界

这是供确认的分工，不代表已向另一个会话发送指令或已修改其权限。

| 工作区/角色 | 范围 | 公共变更怎么做 |
| --- | --- | --- |
| Mac 原生会话 | iPhone、Watch、采集与真机传输 | 先提交真实 metadata 合同与虚构 fixture；不更改 Core 人物身份语义 |
| Voice/Core 实现会话 | transcript/session、proposal/apply、归档、恢复、统一数据服务 | 作为公共合同实现维护方；schema 变更附兼容迁移与验证 |
| 网站会话 | 信息架构、页面和交互、适配 Core 数据 | 原型结构服从真实合同；不另建正式人物数据库，不暗接云模型 |
| 公共 SPEC | 本目录、验收与差异矩阵 | 独立 docs PR；写清“用户约束 / 已实现 / 设计提案” |

每个实现任务使用独立 branch/worktree，避免同目录并行写。公共 schema 一次由一个任务维护。PR 描述写明 base commit、改动范围、接口变化、验证、阻塞；合并前检查 HEAD 是否变化和现有 PR #141 的进展。冲突出现时读取双方变更，不能强推覆盖。

## 5. 优先解决的兼容性事项

1. 原型 `speaker_id` 与 Voice `speaker` 不同；必须验证 canonical transcript，保留 null 与 segment ID。
2. 原型 YYYY-MM-DD 日期与 Core 带 offset 的 captured_at/时区不同；不能凭日期补造时间。
3. 原型 p1/UUID 与 CRM 正整数 ID 不同；手动选择稳定身份，同名不合并。
4. 原型逐条状态与 CLI 整 proposal/session apply 不同；有待确认/排除项时先阻断，不能整份误写。
5. 原型 memory[] 和导出的 facts JSON 没有 Core 导入器；“已写入本机”不等于数据库成功。
6. 现有 Voice CLI 直接打开本地 DB；PGlite 不能被 CLI 与 Web 服务同时打开。服务化必须保留单 writer/本地模型边界。
7. 浏览器撤去标记不会撤回 Core entries；撤回、删除、隐私和任务持久化尚需真实协议。

## 6. 第一轮联调建议

- 先使用本目录合成 fixture 检查字段和 schema，**它不绑定真实音频，不可直接执行真实导入**。
- 在隔离本地测试 DB 中，用本机生成的合成音频计算真实 hash，再形成有效 transcript。
- 走通真实 CLI 的 import → propose → 人工 review → apply → status，记录返回的 IDs。
- 在本地 UI 查看同一来源/人物，不新建第二份身份；重复执行检查幂等。
- 接网站前先设计只读 canonical session/转写预览和格式校验。审核内容/身份/版本确认完备后才开放真实提交。
- 最后独立做真实 ASR 与原生真机质量测试；不要把合成转写测试当作模型准确率或后台录音证明。

命令与环境安装沿用实际 Voice 分支的 `docs/memkin-voice-p0.md`，不在这里重复维护第二套命令参数。

## 7. 可直接交给本机开发会话的任务

> 请先读取仓库中的 `docs/memkin-voice/SPEC.md`、`IMPLEMENTATION-MATRIX.md`、`MAC-HANDOFF.md`；若尚未合并，从 `origin/docs/memkin-voice-shared-spec` 用 git show 读取，不切换或覆盖当前工作区。核对你正在开发的 iPhone/Watch 工程、当前分支和未提交范围，并把真实实现与本 SPEC 的差异反馈到一个单独 docs PR。重点核对 transcript/session、capture time、说话人身份、hash、CRM IDs、人工 review 和整份 apply 限制。保留本地离线处理，未经确认不写长期记忆，不上传私人数据，不联系任何人。先完成兼容性报告，再在明确边界的实现分支中联调；不要为了匹配网页原型而改坏现有后端合同。

## 8. 本次提交实际做了什么

只增加本目录设计文档及合成合同样例。没有修改 main 代码、Voice 开发分支、数据库、Mac 工程、录音设置、自动任务或已发布网站。没有合并/发布原生 App，没有给另一个会话发送消息，也没有建立跨设备数据连接。
