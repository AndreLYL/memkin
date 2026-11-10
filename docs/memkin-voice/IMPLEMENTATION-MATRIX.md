# 当前实现、目标与兼容性矩阵

版本：2026-11-10；配套 [SPEC](SPEC.md) 与 [Mac 交接](MAC-HANDOFF.md)。

本表基于 Core main `195d5398dece493e0eb65181994f2f44ce5e6ee4`、Voice PR #141 `c458aedf33b5971bd948f714f11fb6f91fb8a9ae` 以及独立 Sites 原型 `0c110f7f7b9f7e294e9342cf14588c0b4a8ca40b`。Mac 未提交工作区不在本次检查范围。表中“已实现”指代码核对，不等于本次重新运行验证。

## 1. 能力矩阵

| 能力 | Core main | Voice PR #141（未合并） | 当前 Sites 原型 | 集成结论 |
| --- | --- | --- | --- | --- |
| 来源原文 | immutable CRM record | 保存带分段/时间戳的原文，hash 校验 | 导入后 UI 只读；存储本身可被本地工具修改 | 正式证据依赖 Core/Voice 校验，不依赖 UI 只读 |
| 原始录音 | 不处理 ASR | 普通本地文件归档，保留原始字节 | IndexedDB 本地文件，可关联与播放 | 原型播放器不等于 Core 音频管理 |
| 离线 ASR | 上游责任 | Python faster-whisper，显式模型目录 | 无 ASR 引擎，用户导入结果 | 复用 Voice，不在 hosted 服务端加转写 |
| 摘要/提取 | 人工 proposal 或配置的通用模型 | 显式本地 Ollama/人工 JSON；summary.txt 从提案导出 | 按句拆分最多 16 句，取前两句为摘要；可编辑 | 不宣称原型具备语义提取准确率 |
| diarization | 无音频分离 | schema 预留标签，默认 none/null；无自动分离处理器 | 手动把 speaker_id 关联人物 | 标签不是人物身份，需 canonical 适配 |
| 声纹 | 无 | 尚未实现 | 无 | 后续独立研究与评测 |
| 人物身份 | 稳定正整数 ID、profile revision | 显式 identities 选择 | 随机字符串/示例 p1 等，本地独立人物卡 | 迁移需逐个映射，不按名字归并 |
| 人工审核 | editable proposal + apply | review.json；覆盖全部 session records | 四类逐事实状态、确认人/备注/操作日志 | 逐条筛选后端尚不支持，混合状态要阻断整份 apply |
| 写入长期记忆 | Core apply 产生正式 entries、派生人物页/图 | CLI apply；每个 proposal 事务和幂等 | 仅将 fact ID 加入 memory[] | 原型“已写入”不是 Core 已保存 |
| 来源时间 | 完整 offset、时区，区分 capture/ingestion/event | 原录音时间进入 source | date 仅 YYYY-MM-DD，可手动修改 | 缺失信息不能自动补成精确时间 |
| 关系时间线 | typed relationship/interaction/fact | 复用 Core | 自由文本时间线，来源可选 | 正式化时补来源、身份、语义和时间精度 |
| 周度回顾 | 有 timeline 查询基础 | 未提供独立周报命令 | 按日期用户点击生成，包含 confirmed 但未必 memory[] | 集成版正式回顾用 applied entries；草稿另标 |
| 待办 | CRM entries 没有 actions[] | 未新增待办模型 | 本地行动、日期、完成/重开、导出 | 与既有任务模型映射需单独评审 |
| 隐私级别 | 被核对 CRM schema 无对应字段 | 无 voice privacy 字段 | 一般/私密/高度敏感，仅标签 | 不是权限/加密；不可假称 Core 全量隐私筛选 |
| 组合筛选 | timeline 支持人物/轴/时间/主题/角色 | 没有 Voice Web 筛选服务 | 日期、人物、类型、状态、隐私、关键词 | 服务化需全量/分页正确性，不能仅筛当前页 |
| 重试/去重 | 来源 external_id、proposal apply 幂等 | hash session、单 writer、恢复步骤 | 重复文件可生成不同本地 record | 正式迁移使用 canonical IDs，不复用原型去重假设 |
| 内容修订 | entry correction 保留 revision/reason | 已捕获 transcript 不覆盖 | 修订事实后回待确认，移除本地 memory 标记 | 不等于撤回已应用 Core 条目 |
| 正式撤回/删除 | 被核对接口没有 retract/delete；原文不可变 | 没有完整删除流程 | 可清空浏览器记录/音频 | 不能把清空浏览器解释为删除 Mac 数据 |
| 审核溯源 | entry/profile 修订历史 | review 文件与 session 状态 | locale 时间、自由文本操作者和 action | 原型日志不具不可篡改性；统一结构待设计 |
| 备份 | 完整 DB 才含结构化 CRM | archive 与 DB 成套 | JSON 含原文人物审核，音频不包含 | 三者明确区分；不上传 Git |
| Watch/iPhone App | 无本次已核对原生工程 | 无本次已核对原生工程 | 网站窄屏，不是原生 App | Mac 当前在做的实际工程需补充 commit/路径 |
| 跨端同步 | 未由此 SPEC 验证 | 文件入口 | 无 | 登录同一 Sites 账号不会同步本地数据 |

## 2. 字段级冲突与处理

| 项目 | 网站原型现在怎样 | Voice/Core 合同怎样 | 必须采取的适配 |
| --- | --- | --- | --- |
| transcript 对象 | 仅要求 segments 数组，额外字段基本忽略 | strict schema_version=1、audio_sha256、duration_ms、language、asr、diarization、segments | 读取并验证完整对象；不能把“能打开 JSON”当作兼容 |
| 说话人键 | segments[].speaker_id，缺失变 unknown | segments[].speaker nullable；none 时必须 null | 明确迁移映射并保留原值；null 不自动指本人 |
| segment 身份 | 未保存 canonical segment ID | `s000001` 等唯一 ID | 保留原 IDs，修订另存，不按当前数组下标生成证据 |
| 音频关联 | 用户可把任意音频附加到本地 record | transcript 与原件 hash 一致 | 提交前校验，错配阻断 |
| 转写原件 | JSON 被重排为原文字符串，丢失部分元数据 | transcript JSON/渲染源内容及哈希绑定 | 保留完整原件及固定渲染；逐字 quote 针对实际保存源 |
| 原始时间 | captured_at 截取日期，缺失默认为导入当天 | capture timestamp 原表示 + IANA timezone，入库时间独立 | 旧数据标记时间缺失，用户补全；不强行推导 |
| 日期修改 | 可直接改 rec.date | 已 capture source 时间不可修改；换时间上下文会产生新 session | 集成 UI 分开展示描述性日期和不可变 source time |
| 人物 ID | p1/UUID 等字符串 | Core 正整数 person_id | 显式映射表，绝不 parse/猜测 UI ID |
| fact | `{text,status,person,at}` | typed interaction/fact/relationship + literal evidence | 人工/本地提取转换，补 quote 与 source/ref；at 字符串不足 |
| 审核 vs 语义 | 单一中文 status | proposal 应用状态 + entry 语义状态 | 分轴保存，confirmed 不等于 current/happened |
| 逐条批准 | 可任意确认/排除一条 | ApplySchema 只有 identities，整份应用 | 不能传入伪造 selected_entries；混合状态不提交 |
| 写入结果 | 本地 memory[] | session records/proposal result、真实 entry IDs | 以 Core 成功结果为准；原型标记重新审核 |
| 原型导出 | facts[] + write_policy + destination | CaptureSchema / ProposalSchema / review.json | 不能直接导入 CLI；尚无转换器 |
| 人物背景/关系 | 任意人工文字、来源可空 | 正式关系条目需 source/quote/身份/时间 | 先做 manual source 与 reviewed proposal，或明确仅草稿 |
| 审核时间 | `toLocaleString('zh-CN')` | 后端历史 recorded_at 和 revision | 新合同用带 offset 的时间与操作 ID；旧日志显示为不可规范化历史 |
| privacy | 字符串标签 | 当前 strict CRM 无字段 | UI 标签保留本地；后续侧车/schema PR，不能当授权控制 |
| 多端存储 | 每浏览器独立状态 | 一个本地 Core 数据权威 | 集成后缓存不得成为另一份正式数据库 |
| 音频格式 | 浏览器导入允许 webm 等 | Voice import 受限 `.m4a/.wav/.mp3/.aac/.flac/.aiff/.caf/.ogg` | 非共同支持格式显示不兼容；若需转换，保留原件并记录派生关系 |

## 3. 当前网站交互复用清单

可优先复用的信息架构和交互：

- 侧栏六区：概览、语音记录、人物关系、周度回顾、待办清单、本地与隐私。
- 记录详情四标签：事实确认、原文对照、人物与行动、审核记录。
- 导入弹窗：音频/TXT/Markdown/JSON 或粘贴文字；明确本地读取、无在线转写。
- 原文只读与摘要草稿并列；逐事实状态与人物选择；正式提交前展示清单。
- 人物卡片的长期背景、待核实信息、近期事件与人工关系时间线。
- 周回顾来源跳转、Markdown 导出、待办完成/重开、本机备份范围说明。
- 暖白与绿系、克制的留白、窄屏底部导航。

不应直接复用为生产合同的部分：本地字符串 ID、中文持久化枚举、按句索引推算音频位置、缺失 hash 的音频附加、locale 时间日志、浏览器 memory[]、未校验的备份恢复、自由文本事实到 Core 的“直接写入”假设。

原型源码使用 `app/page.tsx`、`app/globals.css`、`app/layout.tsx`、`public/favicon.svg`；位于独立 Sites 仓库。当前 SPEC PR 没有将整个页面代码复制到主仓库，避免把演示数据结构变成公共契约。若后续迁移 UI，应在单独实现 PR 中拆出组件、接入本仓库既有 Web 层并更新验证。

## 4. 验证证据与限制

| 范围 | 已有证据 | 不可推断的结果 |
| --- | --- | --- |
| Sites 原型 | 本会话构建与 TypeScript 检查通过；浏览器验证事件类型筛选、事实确认、人工写入本机、改回待确认后本机标记撤去、原文对照和周回顾排除待确认内容；私人发布成功 | 没有 Core 互通、原生 App、真实 ASR/声纹、完整移动设备测试的结论 |
| Core main | 已阅读 CRM schemas/store/routes/documentation | 本次未重新执行全套回归，不能把过去的通过数当作今天的测试报告 |
| Voice PR #141 | PR 描述报告 14 Voice + 25 CRM 针对测试通过、CLI 合成 smoke 等 | PR 明示真实 ASR/Ollama 质量未完成验证；全套 Test 曾超时，绿色状态不能证明全套完成 |
| Mac/Watch | 用户报告开发活动，Voice 文档有真机准备表 | 未核对 Xcode 工程、签名、配对传输、后台录音、真实电量与私有数据 |
| 本 SPEC PR | 仅设计文档、合同样例；内容、链接与样例 schema 核对见 PR 描述 | 文档提交不等于上述待办已经实现 |

## 5. 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-11-10 | 首次逐项核对 main、Voice PR #141、Sites 实现；显式记录 source/time/identity/apply 兼容性缺口。 |
