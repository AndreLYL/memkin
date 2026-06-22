# Memoark 行动决策记忆头脑风暴总纲

**日期**：2026-06-22
**状态**：头脑风暴完成，进入 Spec 7–11 编写
**背景**：以 gbrain 为对标（见 [gbrain 对比调研](research/2026-06-22-gbrain-comparison-research.md)），在不被指"过度抄袭"的前提下，引入合成层等能力，并为 AI 创意大赛打磨产品特色
**下一步**：先写本总纲 + 调研 + Spec 7（合成底座），定基调后续写 Spec 8–11

---

## 一、产品总纲（原创锚点）

> **Thesis：从"我知道什么"→"我该怎么做"的行动决策记忆，以社会关系为核心。**

- gbrain 回答 *"What do I know about X"*（关于某人/某事我知道的事实）。
- Memoark 回答 *"What should I DO"*：日报告诉你今天该汇报什么；人物画像告诉你该怎么跟人沟通；排查告诉你下一步该敲什么命令。
- 这条 thesis：① 站在"人是一切社会关系的总和"上 ② 解释了为何要做中文职场多渠道抽取（决策发生在飞书里）③ 与 gbrain 划清界限（它服务 agent、给事实；我们服务人、给行动）。

### 防"抄袭"主武器

**借 gbrain 的"读"（合成/自布线），守我们的"写"（中文职场多渠道抽取）。** 每个借用配一个原创扭转（详见调研 doc §四台账）。中文职场多渠道自动提取压缩是 gbrain 完全没有的护城河。

---

## 二、三个应用场景（认知科学三类记忆）

| 场景 | 记忆类型 | 组织维度 | 主线定位 |
|---|---|---|---|
| 1 日报/沟通汇总 | 情景记忆（episodic） | 时间 × 项目 | 第二证据（实用） |
| 2 性格画像 → 沟通策略 | 关系记忆（social） | 人 | **Hero（参赛主打）** |
| 3 智驾排查 playbook | 程序记忆（procedural） | 领域/问题域 | 保留，不进参赛主线 |

### 共同底座：一个合成引擎，三种人格

三个场景共用一条新管线（= P0 / Spec 7）：

```
synthesize(intent, scope)
  ① 检索（复用现有 hybrid + 新增 best-chunk 池化）
  ② 组装上下文（信号 + timeline + 引用来源）
  ③ 按 intent 模板让 LLM 成段输出 + gap 分析
```

对外双层接口：底层通用 `synthesize(intent)` + 上层产品化 `daily_report()` / `prep_for_person()` / `troubleshoot()`。

---

## 三、各场景锁定决策

### 场景 2（Hero）：性格画像 → 沟通策略 → Spec 8

**三层人格模型（原创综合）：**

| 层 | 内容 | 怎么算 | 背书 |
|---|---|---|---|
| ① 行为层（客观） | 响应时长、谁主动、消息长度、活跃时段、@频率 | 纯统计，**零 LLM** | 硬数据 |
| ② 特质层（推断） | 映射到 **DISC 四维**主轴（+ 可选 Big Five 校验） | LLM，喂行为层 + 真实对话片段，带置信度/证据 | 学术框架 |
| ③ 关系层（专属） | 你和 TA 的历史基调、雷区、在意点 | LLM over 共享历史 | — |

- **外壳**：DISC 结果**通俗映射成四色（红/蓝/黄/绿）**给中文用户看，标注"通俗映射，非临床诊断"。
- **原创内核（防抄袭主武器）**：把成熟人格学（DISC/Big Five）用**被动行为数据 + LLM 落到真实职场关系，零问卷**。市面性格测试要做问卷，gbrain 只有 facts，我们两者都不是。天然接"本地优先"（用你自己的真实数据，画像不出本机）。
- **接口**：`prep_for_person(person, goal?)` **目标条件化**（带 goal 给针对性策略）。
- **方法论依据**：computational personality recognition 研究表明 LLM 零样本判人格不可靠，必须"行为特征 + 证据 + 置信度 + 精心 prompt"——反向验证三层模型的正确性。
- **伦理**：逐人 opt-in + 全局开关 + prompt 护栏（只给"沟通建议"不给"操纵话术"）；信息不足时诚实标"不强行画像"。

### 场景 1：日报 → Spec 9

- **文档压缩**：沿用现有 T1/T2/T4/T5 触发设计（`docs/triggers.ts`，不改）；**真正缺口是抽取 schema**——扩展卡片加 `decisions[]` / `action_items[]{owner, due}`，owner = 我的 → 进日报。
- **"我"身份**：借 OpenClaw `user.md` 概念，做成特殊页 `entities/me`（compiled_truth = 可手编的自我信息：角色/公司/团队/项目/沟通偏好/各平台 handle），身份层把所有 self-handle 归并到它；self_open_id **优先自动解析**（`self-open-id.ts` 走用户 OAuth `getAuthStatus().userOpenId`），手填仅兜底。机器人 token 只代表应用自己，不等于"你"。
- **日报模板（7 段，第 6 段原创、在主线上）**：
  1. 今日概览（一句话 + 关键数字）
  2. 今日完成（达成的决策 + 完成的任务）
  3. 推进中（按项目分组的话题）
  4. 我的待办（新增/完成/逾期）
  5. 待我回复 / 被 @ 未回（私聊群聊捞——沟通卡点）
  6. 🌟 人脉/客户动态（今天和谁有重要互动、关系进展）← 原创
  7. 明日会议 / 到期提醒（日历 + 任务）
- **聚合**：`daily_report(date)` 跨渠道捞当天信号 → 去重 → 按项目实体分组 → 套模板合成 + gap。

### 场景 3：playbook → Spec 11

- **存储结构**：B（markdown 约定）起步，关键 playbook 后续可升级成结构化。
- **知识来源**：手动录入（语音 → Agent → `put_page`，现在即可用）+ 自动提取（从排查文档/对话复用现有抽取管线，加 playbook-aware extractor）双支持。
- **使用形态**：一次性起步（`troubleshoot(query)` 直接吐步骤+分支），交互式逐步引导作 demo 增强。
- **长远蓝图——分层树状结构（落在现有图模型上，零新存储原语）**：
  ```
  category(问题大类:智驾)
    └─ problem-class(无法激活类 ← 可含 100 个原因)
         └─ playbook(具体排查手册:步骤+分支, markdown)
  ```
  层级 = `part_of`；先后顺序 = `precedes`/`next`；关联 = `relates_to`/`escalates_to`。AI 沿边走即理解"先做什么、再做什么、关联问题怎么查"。gbrain 自布线可从 markdown wikilink 自动建这些边。需要的只是：新增 `playbook`(+可选 `problem-class`/`category`) 类型 + 一组 playbook 专用边类型。

---

## 四、完整锁定清单

| 项 | 锁定结论 |
|---|---|
| 总纲 thesis | 从"我知道什么"→"我该怎么做"的行动决策记忆，以社会关系为核心 |
| 防抄袭主武器 | 借 gbrain 的"读"，守我们的"写"；每个借用配原创扭转 |
| 合成底座 | 一引擎多意图（混合预合成）；双层接口（通用 synthesize + 产品化三工具） |
| Hero 场景 2 | 三层人格（行为层零-LLM + DISC 主轴 + 关系层）+ 四色外壳；被动推断零问卷；目标条件化；逐人 opt-in 伦理护栏 |
| 场景 1 日报 | 沿用现有文档触发压缩；卡片 schema 加 decisions/action_items；7 段模板（含原创"人脉动态"）；entities/me 身份页 + 自动解析 self_open_id |
| 场景 3 playbook | markdown 起步；手动+自动双来源；一次性使用；分层树状 = 图 + 类型化边 |

---

## 五、Spec 拆分蓝图

| 编号 | 文件 | 交付 | 依赖 |
|---|---|---|---|
| 调研 | `research/2026-06-22-gbrain-comparison-research.md` | gbrain 细致对比 | — |
| 总纲 | 本文件 | 头脑风暴总纲 | — |
| **Spec 7** | `2026-06-22-spec7-synthesis-engine.md` | 合成底座（引擎+意图框架+引用+gap+best-chunk 池化） | — |
| **Spec 8** | `2026-06-22-spec8-person-communication-profile.md` | 人物沟通画像（Hero） | 7 |
| **Spec 9** | `2026-06-22-spec9-daily-report-and-doc-extraction.md` | 日报 + 文档 action_items + entities/me | 7 |
| **Spec 10** | `2026-06-22-spec10-retrieval-quality.md` | best-chunk 池化 / 零-LLM 边 / query 改写 | 较独立 |
| **Spec 11** | `2026-06-22-spec11-playbook.md` | playbook（场景 3） | 7 |

实现 plan（`specs/plans/`）在各 spec 评审定稿后再写，避免返工。

---

## 六、参赛叙事要点

- **一句话差异化**：gbrain 是"给 AI 的世界知识库"，Memoark 是"给人的职场行动决策记忆"——以社会关系为核心。
- **Hero demo**：现场输入"我明天要见张总，谈续约涨价，该注意什么？" → 系统用你飞书里沉淀的真实关系给出带引用的沟通策略 + gap（"你已 18 天没有张总的新信息"）。既有爆点，又天然展示 vs gbrain 的差异（它没有中文渠道真实数据，我们有）。
- **隐私叙事**：本地优先 = 性格画像永不出本机，把"敏感"反转为杀手级卖点。
- **技术亮点**：被动行为数据 + LLM 的双通道人格识别，区别于"又一个性格测试问卷"。
