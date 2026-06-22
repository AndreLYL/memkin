# Spec 9: 日报 + 文档提取 + 「我」身份

**日期**：2026-06-22
**状态**：📝 待审查
**依赖**：**Spec 7（合成底座）必须先完成**；建立在现有飞书文档卡片系统（`src/collectors/feishu/docs/*`，PR #55 已入 main）、人物身份层、pipeline 之上
**定位**：场景1（第二证据）——一句"帮我生成今天的日报"，跨渠道合成今日工作要点，高亮"我的"待办。

> 产品定位见 [总纲](2026-06-22-action-memory-brainstorming.md) §三场景1。

---

## 一、背景与动机

三个真缺口：
1. **跨渠道日报无出口**：信号已分散在邮件/IM/日历/文档，但无"按今天聚合成段"的工具。
2. **文档卡片缺决策与待办**：现有 `FullCard`（`docs/types.ts`）只有 `purpose/topics/entities/overview/toc`，**没有 `decisions` 和带 owner 的 `action_items`**——妙记会议纪要的核心价值（"谁负责什么"）抽不出来。
3. **系统不知道"我"是谁**：无法判定"我的"待办 / "我被"@。

---

## 二、调研依据

- **日报最佳实践**（📗 公开模板，Teamwork/Status.net 等）：日期 → 概览 → 已完成 → 推进中 → 待办 → 卡点 → 提醒；戒律：别含糊、别藏问题、别堆废话。
- **gbrain dream cycle entity sweep**（📰，可信度低）：从当日 session 反扫补实体——仅作灵感，不进本 spec 验收。

---

## 三、文档卡片 schema 扩展（真正的文档工作）

> **不改触发器**（T1/T2/T4/T5 沿用，见 `docs/triggers.ts`）；只扩展**全量卡的抽取内容**。

### 3.1 `FullCard` 增字段（`docs/types.ts`）

```typescript
interface ActionItem {
  text: string;
  owner_raw?: string;      // 文档里写的负责人原文（名字/@）
  owner_slug?: string;     // 身份层解析后的 person slug（§四）
  due?: string;            // ISO8601，可空
  status: "open" | "done";
}
interface DocDecision { text: string; made_by_raw?: string; }

interface FullCard extends DocCandidate {
  // ……既有字段不变……
  decisions: DocDecision[];     // 新增
  action_items: ActionItem[];   // 新增
}
```

### 3.2 抽取 prompt 扩展（`docs/full-builder.ts` `buildPrompt`）

在现有 JSON schema 上追加：
```
"decisions": {text, made_by}[],
"action_items": {text, owner, due(ISO|null)}[]
```
对妙记类纪要尤其要抽全 action_items 的 owner。`source_body_hash` 不变 → 沿用 T5"body 变才重摘要"。

### 3.3 action_items 落地为 task 信号（供日报与既有任务工具复用）

文档卡片写库时（`docs/store-writer.ts`，已核 main 存在、现 `writeCard` 把卡片写成 `feishu-docs/<token>` 页；本 spec 在此**新增** action_items→task 写入逻辑——回应 review S9-P1-4），对每个 `action_items[i]`：
- `owner_slug` 经身份层解析（§四）；
- **生成/更新 `type=task` 页**，slug **`tasks/doc-<doc_token>-<hash8(text)>`**（用 action_item 文本前缀的 sha256 前 8 位，**不用位置索引 `<i>`**——回应 review S9-P0-2，避免文档重抽后顺序变化导致 ID 漂移、旧任务残留/重复），`frontmatter` 带 `owner_slug`/`due`/`status`/`source=doc:<token>`；
- `graph.addLink(taskSlug, owner_slug, "mentions")` 锚定到负责人，`addLink(taskSlug, "entities/me", "mentions")`（当 owner 是我）。

这样日报、`get_session_context`、既有 task 工具都能看到这些待办，不另起数据通道。

---

## 四、`entities/me` 身份页 + self 解析

### 4.1 `entities/me`（借 OpenClaw `user.md`）

特殊页，slug **`entities/me`**，`type=person`，`compiled_truth` = 可手编的自我信息（角色/公司/团队/项目/沟通偏好/各平台 handle）。它既是"我的"待办的锚点，也是合成的个性化底座。

### 4.2 self 身份解析（含 Spike，勿低估）

- **手填**：`config` 写 self handle（open_id/email），身份层把它们登记为 `person_handles`（`canonical_slug = entities/me`，strength=strong）。**确定可用，作默认。**
- **自动解析**：`src/collectors/feishu/self-open-id.ts` 的 `resolveSelfOpenId()`（main 已有）→ `getAuthStatus().userOpenId`。**但依赖 lark-cli 用户级 OAuth 会话（user_access_token，与 bot token 两套体系）**。
- ⚠️ **Spike（落地前必做）**：在真实 lark-cli 环境验证自动解析与 OAuth 授权流程是否可行、稳定。**不可行则以手填为默认**，自动解析作增强。Spike 结论写入本 spec 的 plan。

### 4.3 "我的"判定

`owner_slug`（或消息 sender）经身份层 canonical 化后 `=== "entities/me"` → 属于"我"。被@判定同理（消息 metadata 的 @open_id 解析到 me）。

---

## 五、`daily_report` 意图 + 工具

### 5.1 意图（注册进 Spec 7 框架，`src/synth/intents/daily-report.ts`）

```typescript
import { missingFieldRule } from "../../synth/gaps.js";   // 回应 CROSS-1/S9-P2-1

// 回应 S9-P1-2：返回本地时区 YYYY-MM-DD
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 回应 S9-P0-1：LLM 按约定输出 "## <段标题>\n<正文>"，按 H2 标题切段
function parseSections(answer: string): { title: string; body: string }[] {
  const parts = answer.split(/^##\s+/m).filter((s) => s.trim());
  return parts.map((p) => {
    const nl = p.indexOf("\n");
    return nl === -1
      ? { title: p.trim(), body: "" }
      : { title: p.slice(0, nl).trim(), body: p.slice(nl + 1).trim() };
  });
}

export const dailyReportIntent: IntentTemplate = {
  id: "daily_report",
  format: "sections",                    // 见 Spec 7 §3.4
  staleDays: 0,                          // 日报不判过期
  buildScope: (args) => {
    const day = (args.date as string) ?? today();
    // limit:200 仅为检索上限；context.ts 再按 token budget 截断（见 §六）
    return { time: { from: `${day}T00:00:00`, to: `${day}T23:59:59` }, limit: 200 };
  },
  systemPrompt: /* §5.3：要求 LLM 用 "## 段标题" 输出 7 段 */,
  expects: ["今日完成", "我的待办", "明日提醒"],
  gapRules: [missingFieldRule],
  parseSections,
};
```

### 5.2 工具（本 spec 注册）

```typescript
server.tool("daily_report", { date: z.string().optional() },
  ({ date }) => synthesize("daily_report", dailyReportIntent.buildScope({ date })));
```

时间窗缓存 → `reports/daily/<date>` 页（Spec 7 §九 time-scope 载体）。该页 **`type="knowledge"` + `frontmatter.is_report=true`**（沿用 Spec 7 §九 / review CROSS-2 决定，不扩展 type union）。

### 5.3 七段模板（systemPrompt 约束 LLM 产出这些 section）

1. 今日概览（一句话 + 关键数字）
2. 今日完成（达成的决策 + 完成的任务）
3. 推进中（按项目实体分组的话题）
4. 我的待办（新增 / 完成 / 逾期）
5. 待我回复 / 被 @ 未回（私聊群聊）
6. 🌟 人脉/客户动态（今天和谁有重要互动、关系进展）← 原创，呼应主线
7. 明日会议 / 到期提醒（日历 + 任务）

---

## 六、跨渠道聚合

`daily_report` 的检索（Spec 7 `scope.retrieve` time 模式）：捞当天 `date` 落在窗口内的信号（timeline_entries + tasks + decisions + 文档卡片衍生 task），按**项目实体**（backlinks）分组；"我的待办"经 §四 判定；第 6 段从当天有互动的 person 信号汇集。

**去重策略（回应 review S9-P1-3）**：两级——① 主键去重：相同 page `slug` 只留一条；② 内容去重：相同 `frontmatter.source_hash`（同一源 block 抽出的信号）视为重复，留信息最全的一条。**不做 LLM 语义去重**（成本高、起步不需要）。

**token budget（回应 review S9-P1-5）**：`limit:200` 只是检索上限；`context.ts` 组装时按**总 token 预算**（如 12k）截断候选——按 tier/freshness 排序后累加，超预算即停。即"先检索 200，再截断到预算内 N 条"，不会把 200 条全塞给 LLM。

---

## 七、模块布局

```
src/collectors/feishu/docs/
  types.ts          # FullCard 增 decisions/action_items（+ ActionItem/DocDecision）
  full-builder.ts   # buildPrompt 扩展抽取 decisions/action_items
  store-writer.ts   # action_items → task 信号 + 锚定链接
src/core/person-identity.ts   # 扩展(不另建目录，回应 S9-P1-1)：
                              #   ensureEntitiesMe() / registerSelfHandle() / isMe(slug)
src/synth/intents/
  daily-report.ts   # daily_report 意图（注册进 Spec 7）
```

---

## 八、范围边界（Out of Scope）

- 合成引擎/意图框架/time-scope 缓存机制 → **Spec 7**
- 人物画像/沟通策略 → **Spec 8**
- 文档触发器调整（全压 vs 放宽）→ 不在范围（沿用现有 T1/T2/T4/T5）
- 自动 entity sweep（dream cycle 式）→ 后续

---

## 九、验收标准

1. `bun test` 通过（FullCard 扩展、action_items→task、isMe 判定、daily_report 意图、7 段切分单测）。
2. `full-builder` 对构造妙记纪要抽出 `decisions[]` 与 `action_items[]{owner,due}`；body 未变不重摘要（T5 不变）。
3. `action_items` 写库后生成 `type=task` 页并锚定到 `owner_slug`；owner 是我时额外锚定 `entities/me`。
4. `entities/me` 可创建/手编；手填 self handle 登记为 `person_handles(canonical=entities/me, strong)`。
5. `isMe()`：sender/owner canonical 化后 `=== entities/me` 判真；他人判假。
6. self 自动解析 **Spike** 完成并记录结论；不可行时手填路径全程可用（测试覆盖手填路径）。
7. `daily_report("2026-06-22")` 返回 7 段 `sections` + `answer`（拼接）+ `missing_field` gap（缺段时）；时间窗缓存写 `reports/daily/<date>`。
8. 跨渠道聚合：构造邮件+IM+日历+文档当日信号，断言分别落入正确 section、"我的待办"判定正确。
