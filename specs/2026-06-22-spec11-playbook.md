# Spec 11: Playbook（分支 runbook + 分层树）

**日期**：2026-06-22
**状态**：📝 待审查
**依赖**：**Spec 7（合成底座）**；自布线复用 **Spec 10**（wikilink 零-LLM 边）；建立在 `pages` / `graph` / `traverse_graph` / pipeline 之上
**定位**：程序记忆（procedural）——把"某类问题怎么排查"沉淀为带分支的手册，并组织成分层树供 AI 沿边导航。**不进参赛主线**，作为"记忆系统也能装领域知识"的补充。

> 长远蓝图见 [总纲](2026-06-22-action-memory-brainstorming.md) §三场景3。智驾排查为示例域。

---

## 一、背景与动机

排查类知识是"应用场景 + 有序步骤 + 条件分支（命令结果命中 X → 含义/下一步）"。它比扁平 `knowledge` 复杂（含分支），且天然分层：

```
category(智驾)
  └─ problem-class(无法激活类 ← 可含上百原因)
       └─ playbook(具体排查手册：步骤+分支)
```

AI 沿边走即理解"先做什么、再做什么、关联问题怎么查"。

---

## 二、调研依据

- **gbrain 自布线**（📗，未核源码）：从 markdown wikilink 自动建 typed edges。我们用它（经 Spec 10）把 playbook 的层级/顺序边自动建起来。

---

## 三、类型与图扩展（精确工作量，不低估也不虚报）

> 已核 main@eebb1b6：page `type` 与 DB `links.link_type` **均为自由 TEXT，无 DB 枚举约束** → **不需要 DB migration**。真实工作在 **TS 类型/校验/遍历层**（修正总纲早期"migration SQL"的措辞）。

1. **页类型**：新增 `playbook` / `problem-class` / `category`（扩展 `src/core/types.ts` 信号类型 union + slug 约定 `playbook/<kebab>` 等）。DB 列无需改。
2. **边类型**：扩展 `LinkType` union（`core/types.ts:109`）增 `part_of` / `precedes` / `next` / `escalates_to`。DB `link_type` 自由 TEXT，无需改列；但需更新校验与（Spec 10 的）wikilink rel 白名单。
3. **遍历接口**：复用现有 `traverse_graph` MCP 工具 + `graph` store；新增"取子树 / 沿 `precedes` 排序"的便捷查询（`src/store/graph.ts` 加方法）。

---

## 四、Playbook 内容结构（markdown 约定，B 起步）

页 `compiled_truth` 用自然 markdown 表达分支（不强制结构化 JSON）：

```markdown
---
title: 智驾无法激活排查
type: playbook
---
## 适用场景
系统未进入 active 状态。

## 步骤
1. 去 `/xxx/log`，执行 `cat xxx | grep "deact"`
2. 看 grep 结果：
   - 命中 `deact by driver press brake pedal` → 驾驶员踩刹车退出（正常）
   - 命中 `sensor timeout` → 传感器超时，转 [[playbook/sensor-timeout]]
   - 无命中 → 转步骤 3

## 关联
part_of:: [[problem-class/activation-failure]]
precedes:: [[playbook/sensor-timeout]]
```

- 分支靠"命中 X → 含义/下一步"的 markdown 约定，LLM 在 `troubleshoot` 时理解。
- 层级/顺序边用 Spec 10 的 wikilink/typed-link 语法 `[[rel:slug]]` 自动建（零 LLM）。
- 关键 playbook 后续可升级为结构化 JSON（留待迭代，不在本 spec）。

---

## 五、知识来源（手动 + 自动，双支持）

- **手动录入**：Agent 调现有 `put_page`（slug `playbook/...`）。"语音录入"是客户端的事（用户对 Claude/Cursor 口述 → Agent 写页），**现在即可用**，本 spec 只需保证 playbook 类型与约定成立。
- **自动提取**：从排查类文档/对话沉淀。新增 **playbook-aware extractor**（复用现有抽取管线，加一个识别"这是排查流程"的 prompt 分支），把对话/文档中的步骤+分支抽成 playbook 页草稿（标 `confidence: inferred`，待人确认）。

---

## 六、`troubleshoot` 意图 + 工具（一次性）

### 6.1 意图（注册进 Spec 7，`src/synth/intents/troubleshoot.ts`）

```typescript
export const troubleshootIntent: IntentTemplate = {
  id: "troubleshoot",
  format: "single",
  staleDays: 0,
  buildScope: (args) => ({ query: args.query as string, types: ["playbook"], limit: 10 }),
  systemPrompt:
    "你是排查助手。基于下列 playbook 片段，给出按序的排查步骤，并解释每步不同结果的含义。" +
    "用 [n] 标注来源 playbook。沿 part_of/precedes 关系组织顺序。信息不足时直说。",
  expects: ["排查步骤"],
  gapRules: [missingFieldRule],
};
```

### 6.2 工具（本 spec 注册）

```typescript
server.tool("troubleshoot", { query: z.string() },
  ({ query }) => synthesize("troubleshoot", { query, types: ["playbook"] }));
```

**一次性**：直接吐完整步骤+分支说明。交互式逐步引导（贴命令结果→判分支→下一步）作 demo 增强，**不在本 spec**。

---

## 七、模块布局

```
src/core/types.ts            # 页类型 union + LinkType union 扩展
src/store/graph.ts           # 取子树 / precedes 排序 便捷查询
src/extractors/              # playbook-aware extractor（自动提取，复用管线）
src/synth/intents/
  troubleshoot.ts            # troubleshoot 意图（注册进 Spec 7）
```

---

## 八、范围边界（Out of Scope）

- 合成引擎/意图框架 → **Spec 7**
- wikilink 零-LLM 自布线 → **Spec 10**（本 spec 复用）
- 结构化 JSON 分支（A 方案）→ 后续迭代
- 交互式逐步排查（多轮 + 工具调用）→ demo 增强，后续
- 团队共享 playbook 库 → 后续

---

## 九、验收标准

1. `bun test` 通过（类型/边校验、子树遍历、playbook-aware extractor、troubleshoot 意图单测）。
2. 新增 `playbook`/`problem-class`/`category` 页类型可创建（slug 约定生效）；**确认无需 DB migration**（type 自由 TEXT）。
3. `LinkType` 增 `part_of`/`precedes`/`next`/`escalates_to`；Spec 10 wikilink 能识别这些 rel；未知 rel 归 `custom`。
4. 含 `[[rel:slug]]` 的 playbook 写入后自动建对应层级/顺序边（经 Spec 10）。
5. 取子树查询：给 category 返回其 problem-class/playbook；沿 `precedes` 可得排查顺序。
6. playbook-aware extractor 对构造排查对话抽出 playbook 草稿（标 inferred）。
7. `troubleshoot("智驾无法激活")` 返回按序步骤 + 分支含义 + `[n]` 引用（命中构造的 playbook）。
