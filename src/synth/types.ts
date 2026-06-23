import type { StoreContext } from "../server/api.js";

// —— 检索范围 ——
export interface SynthScope {
  /** 围绕某实体（如 person/zhang-san）→ backlinks + timeline */
  entity?: string;
  /** 时间窗 → 跨渠道按 date 过滤 */
  time?: { from: string; to: string };
  /** 自由语义检索 → hybrid search */
  query?: string;
  /** 限定信号类型（透传到 search 的 `p.type = ANY(...)` 过滤） */
  types?: string[];
  /** 限定来源渠道，合法值与 timeline_entries.source 对齐 */
  channels?: string[];
  /** 候选上限（默认 30） */
  limit?: number;
}

/**
 * 合成调用选项：意图专属参数（如 daily_report 的 date、person_strategy 的 goal）经 extra 透传到 compose。
 */
export interface SynthOpts {
  /** 透传给意图的 systemPrompt 拼装 */
  extra?: Record<string, unknown>;
  noCache?: boolean;
}

// —— 组装上下文 ——
export interface AssembledCandidate {
  /** 引用编号，从 1 起，对应 answer 里的 [n] */
  ref: number;
  slug: string;
  title: string;
  type: string;
  /** 喂给 LLM 的正文片段 */
  text: string;
  /** 信号日期（gap 计算用） */
  date?: string;
  /** provenance（frontmatter.source / links.provenance / timeline.provenance） */
  source?: string;
}

export interface AssembledContext {
  scope: SynthScope;
  candidates: AssembledCandidate[];
  /** candidates 中 max(date)，供 stale gap 用 */
  latestDate?: string;
  /**
   * 非可引用的前置框架文本（如人物画像摘要）；由意图的 buildPinnedContext 钩子产出，
   * 置于候选之前喂 LLM。不分配 ref，引用仍指向 candidates。
   */
  pinnedContext?: string;
}

// —— LLM 产出（compose 阶段原始输出，未做引用校验/gap）——
export interface ComposeOutput {
  /** 含 inline [n] 标记的 markdown */
  answer: string;
}

// —— 引用 ——
export interface Citation {
  /** 与 answer 里的 [n] 一一对应 */
  ref: number;
  slug: string;
  title: string;
  source?: string;
  date?: string;
}

// —— gap ——
export interface Gap {
  type: "stale" | "missing_field" | "contradiction";
  message: string;
  meta?: Record<string, unknown>;
}

export interface GapRule {
  id: Gap["type"];
  evaluate(ctx: AssembledContext, raw: ComposeOutput, intent: IntentTemplate): Gap[];
}

// —— 最终结果 ——
export interface SynthesisResult {
  intent: string;
  /** 始终非空 */
  answer: string;
  /** 仅 format="sections" 的意图产出 */
  sections?: { title: string; body: string }[];
  /** 仅保留被 answer 引用过的候选 */
  citations: Citation[];
  gaps: Gap[];
  meta: { model: string; generated_at: string; scope: SynthScope; cached: boolean };
}

// —— 意图模板 ——
export interface IntentTemplate {
  id: string;
  format: "single" | "sections";
  buildScope(args: Record<string, unknown>): SynthScope;
  systemPrompt: string;
  /** missing_field gap：期望 answer 覆盖的要点 */
  expects?: string[];
  /** stale gap 阈值（缺省 14） */
  staleDays?: number;
  gapRules: GapRule[];
  /** format="sections" 必填 */
  parseSections?(answer: string): { title: string; body: string }[];
  /**
   * 可选钩子：产出 AssembledContext.pinnedContext（如 Spec 8 读 frontmatter.profile）。
   * 通用层只调用、不感知具体意图。
   */
  buildPinnedContext?(scope: SynthScope, stores: StoreContext): Promise<string | undefined>;
  /**
   * 可选钩子：重排候选（如 Spec 11 沿 precedes 链）。
   * 通用层只调用、不感知具体意图。
   */
  sortCandidates?(
    candidates: AssembledCandidate[],
    stores: StoreContext,
  ): Promise<AssembledCandidate[]>;
}
