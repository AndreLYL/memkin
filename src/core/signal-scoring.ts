import { estimateTokens } from "./block-builder.js";
import { extractQuickEntities } from "./entity-extract.js";
import type { CanonicalisedBlock, InteractionTag, SignalScore, SourceType } from "./types.js";

const SOURCE_WEIGHTS: Partial<Record<SourceType, number>> = {
  email: 0.9,
  document: 0.9,
  calendar: 0.8,
  task: 0.8,
  structured: 0.8,
  dm: 0.7,
  group: 0.6,
  agent_session: 0.6,
  chat: 0.5,
};

const TAG_SCORES: Record<InteractionTag, number> = {
  sent: 0.6,
  reply: 0.5,
  dm: 0.6,
};

const WEIGHTS = {
  token: 1.0,
  unique_words: 1.0,
  source: 1.5,
  interaction: 3.0,
  entity_density: 1.0,
};

const TOTAL_WEIGHT =
  WEIGHTS.token +
  WEIGHTS.unique_words +
  WEIGHTS.source +
  WEIGHTS.interaction +
  WEIGHTS.entity_density; // 7.5

export function scoreBlock(cb: CanonicalisedBlock): SignalScore {
  const text = cb.canonical_markdown;
  const tokens = estimateTokens(text);
  const entities = extractQuickEntities(text);

  const token_score = scoreTokens(tokens);
  const unique_words_score = scoreTTR(text);
  const source_score = SOURCE_WEIGHTS[cb.source_type] ?? 0.5;
  const interaction_score = scoreInteraction(cb.interaction_tags);
  const entity_density_score = tokens === 0 ? 0 : Math.min(1.0, entities.length / (tokens / 100));

  const combined =
    (token_score * WEIGHTS.token +
      unique_words_score * WEIGHTS.unique_words +
      source_score * WEIGHTS.source +
      interaction_score * WEIGHTS.interaction +
      entity_density_score * WEIGHTS.entity_density) /
    TOTAL_WEIGHT;

  let decision: SignalScore["decision"];
  let drop_reason: string | undefined;

  // Extra guard: extremely short, no entities, no interaction, AND low-value source → force drop
  // Email/document/structured sources get protection (never force-dropped by extra guard)
  if (
    tokens < 20 &&
    entities.length === 0 &&
    cb.interaction_tags.length === 0 &&
    cb.source_type !== "email" &&
    cb.source_type !== "document" &&
    cb.source_type !== "structured"
  ) {
    decision = "drop";
    drop_reason = "extra_guard:short_no_signal";
  } else if (combined >= 0.85) {
    decision = "admit";
  } else if (combined <= 0.15) {
    decision = "drop";
    drop_reason = "score_below_threshold";
  } else {
    decision = "evaluate";
  }

  return {
    token_score,
    unique_words_score,
    source_score,
    interaction_score,
    entity_density_score,
    combined,
    decision,
    drop_reason,
  };
}

function scoreTokens(tokens: number): number {
  if (tokens < 50) return tokens / 50;
  if (tokens <= 500) return 1.0;
  if (tokens <= 3000) return 1.0 - (tokens - 500) / 5000;
  return 0.5;
}

function scoreInteraction(tags: InteractionTag[]): number {
  if (tags.length === 0) return 0.5;
  const sum = tags.reduce((acc, tag) => acc + TAG_SCORES[tag], 0);
  return Math.min(1.0, sum);
}

function scoreTTR(text: string): number {
  if (!text.trim()) return 0;

  const words: string[] = [];
  const tokens = text.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    let hasOther = false;
    for (let i = 0; i < token.length; i++) {
      const code = token.charCodeAt(i);
      const isCJK = (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
      if (isCJK) {
        words.push(token[i]);
      } else {
        hasOther = true;
      }
    }
    if (hasOther) {
      const nonCjk = token.replace(/[一-鿿㐀-䶿]/g, "");
      if (nonCjk) words.push(nonCjk.toLowerCase());
    }
  }

  if (words.length === 0) return 0;

  const unique = new Set(words).size;
  const ttr = unique / words.length;

  if (ttr > 0.6) return 1.0;
  if (ttr < 0.2) return 0.1;
  return (ttr - 0.2) / 0.4;
}
