# 行动决策记忆 — 实施进度（Spec 7–11）

**日期**：2026-06-22 实施 / 2026-06-23 全部合入
**状态**：✅ **五份 spec 全部经深度 review、修复、测试绿、已合入 main**(PR #62–#66)；README 三大 Hero 场景 showcase 也已合入(#67)。

## 合入记录

| PR | Spec / 内容 | 状态 |
|----|------|------|
| #62 | Spec 7 合成底座(synthesize/recall + 意图框架 + 引用 + gap + best-chunk 池化) | ✅ 已合 main |
| #63 | Spec 8 人物沟通画像(Hero,三层人格 + 四色 + prep_for_person) | ✅ 已合 main |
| #64 | Spec 9 日报 + 文档提取 + entities/me(daily_report) | ✅ 已合 main |
| #65 | Spec 10 检索质量(best-chunk 池化 + 零-LLM wikilink 边 + query 改写) | ✅ 已合 main |
| #66 | Spec 11 playbook(分层树 + troubleshoot) | ✅ 已合 main |
| #67 | README 三大 Hero 场景 showcase + daily_report/troubleshoot | ✅ 已合 main |

MCP 工具:26 → **31**(synthesize / recall / prep_for_person / daily_report / troubleshoot)。

### 合入前深度 review 修复的真问题(测试都侥幸过了,是 review 挡下的)
- 缓存写回污染实体页 recency + re-embed(Spec 7);夜间画像同类污染(Spec 8)
- 无 LLM 时静默返回假答案 → 改结构化错误(全部合成工具)
- 空候选不短路、LLM 失败不结构化(Spec 7)
- entity-scope timeline 被 slug-only 去重折叠(Spec 9)
- action_items→task 是暗代码、未接真实文档管线(Spec 9)
- wikilink.ts 被写成二进制(裸 NUL 字节)(Spec 10)
- wikilink 白名单回退导致 playbook 自布线失效(Spec 11)
- 多处堆叠分支语义合并冲突(createMockProvider 残留、migrations 版本断言、契约工具清单)

### 待跟踪(后续 issue,不阻塞)
- 群聊行为累加未排除"自己"(待与 isMe 配套)
- 日报跨日时区边界;isMe 串行查询;query 改写作用于向量腿;MCP 手动 ingest 未接 action_items
- 缓存/画像仍存于 frontmatter(大库可考虑独立表)

---

## 一、分支结构（历史记录 · 堆叠实现）

实现采**堆叠式 feature 分支**，每个从上一个切出（满足依赖；main 受保护，逐个 PR 合入,合入前各自 merge main + 线性化）：

```
main
 └─ claude/spec7-synthesis-engine          (合成底座)
     └─ claude/spec8-person-communication-profile   (Hero 人物画像)
         └─ claude/spec9-daily-report-and-doc-extraction  (日报+文档+entities/me)
             └─ claude/spec10-retrieval-quality    (best-chunk池化/零-LLM边/query改写)
                 └─ claude/spec11-playbook         (分支runbook+分层树+troubleshoot)
```

**建议合并顺序**：7 → 8 → 9 → 10 → 11（按 PR 依次合入 main）。每个分支独立测试绿。

> 文档（spec/plan/research/review）都在 `docs/specs-and-research`，已与 main 同步代码。

---

## 二、各 spec 实现摘要

| Spec | 交付（新增 MCP 工具/能力） | 测试 |
|---|---|---|
| **7 合成底座** | `synthesize`/`recall` 工具；意图框架+钩子(buildPinnedContext/sortCandidates)；引用[n]+gap；best-chunk 池化(opt-in)；逐 scope 缓存 | synth 全绿 |
| **8 人物画像(Hero)** | `prep_for_person(person,goal?)`；三层人格(行为层 person_behavior 表 M005 / DISC 特质层 / 关系层)+四色；夜间预合成；伦理 gating | profile+synth 全绿 |
| **9 日报+文档** | `daily_report(date?)`；FullCard 加 decisions/action_items→task；`entities/me`+isMe(self_open_id Spike) | 全绿 |
| **10 检索质量** | best-chunk 池化默认开(sum→max)；写入时零-LLM wikilink 边；规则式 query 改写 | store+synth 全绿 |
| **11 playbook** | `troubleshoot(query)`；playbook/problem-class/category 类型+part_of/precedes 边；getSubtree/getOrderedSequence；playbook-aware extractor | 全绿 |

MCP 工具数：26 → **31**（+synthesize/recall/prep_for_person/daily_report/troubleshoot）。
README.md / README.en.md 已随各 spec 同步更新（功能清单/工具表/路线图）。

---

## 三、最终测试状态（spec11 tip = 全部 5 份堆叠）

- `bun run typecheck`：通过
- 全量：**1313 passed / 1 failed / 2 skipped（174 文件）**
- 唯一失败：`tests/adapters/adapters.test.ts` "push reports errors when write fails" —— **环境性**：本容器以 root 运行，测试假设 `/invalid/path` 不可写、实则可写。**在 main 上同样失败，与本次改动无关。**

---

## 四、实施中发现并修复的问题（自主把关）

1. **Spec 8 漏更 migrations.test.ts**：M005 加了但版本断言仍 `[1,2,3,4]` → 修为 `[1,2,3,4,5]`，从 spec8 修起并传播到 9/10/11。
2. **Spec 8 漏更 mcp-contract 工具清单**：新增 `prep_for_person` 未同步契约 → 已补（后续每加工具均同步）。
3. **Spec 10 与 Obsidian 同步冲突**（全量回归才暴露）：putPage 自布线把 `[[...]]` 建成 `mentions`，与 Obsidian 的 `obsidian` 边冲突 → 新增 `PutPageOptions.autoWikilink`(默认 true)，Obsidian 导入传 false 自管语义；从 spec10 修起传播到 spec11。
4. spec/plan 实施前自查：把"hybridSearch"更正为真实方法 `query()`、池化语义更正为 sum→max（非去重）。

---

## 五、待人工跟进
- 按 7→8→9→10→11 顺序 review/合并到 main。
- self_open_id 自动解析的真实 lark-cli OAuth Spike（Spec 9，已留手填兜底，测试只覆盖手填）。
- 合入 main 后可做"参赛 showcase"刷新（三场景 demo / GIF / hero 强化）。
