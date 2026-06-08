# Sprint 1: Cost Reduction — Fast Score + Entity Pre-filter

> **STATUS: SUPERSEDED** — The goals of this sprint were implemented via a different (better) approach in PRs #11 and #12. See below.

---

## What Was Planned vs What Was Actually Built

### Planned (this document)
- Keyword-based 0–100 fast score
- Regex entity extractor for LLM prompt hints

### Actually Implemented (PR #11: `feat/signal-extraction-redesign`)

**`src/core/signal-scoring.ts`** — 5-dimension weighted scorer (replaces both L1 keyword escalation and L2 LLM filter):

| Dimension | Weight | Notes |
|-----------|--------|-------|
| token_count | 1.0 | Linear ramp, plateau at 50–500 tokens |
| unique_words (TTR) | 1.0 | Type-token ratio, CJK-aware |
| source_type | 1.5 | email/doc=0.9, dm=0.7, chat=0.5 |
| interaction_tags | 3.0 | sent/reply/dm stack |
| entity_density | 1.0 | quick entities / tokens |

Three named thresholds: `admit` (≥0.85) / `evaluate` (0.15–0.85) / `drop` (≤0.15)
Pipeline gate is **binary** — `evaluate` and `admit` both map to `pass` in `mapScoreDecision()`.
`evaluate` is preserved in `SignalScore` for future per-tier handling (e.g. lighter extraction).

**`src/core/canonicalize.ts`** — Source-type detection + interaction tagging + format normalization:
- Infers `SourceType` from channel prefix (`mail/`, `dm/`, `docs/`, `calendar/`)
- Tags `interaction_tags`: `sent`, `reply`, `dm`
- Email adapter: strips reply chains, footers, quoted blocks

**`src/core/entity-extract.ts`** — Regex quick entity extractor (used for `entity_density_score`):
- Extracts: URL, email, @handle, #hashtag, phone, ticket_id
- Used for scoring, **not** yet injected as LLM prompt hints (→ Sprint 2 Task 1)

**`src/extractors/noise-filter.ts`** — L2 LLM filter completely removed:
- L1 now source-aware (email/doc/chat/calendar paths)
- `mapScoreDecision()` bridges 5-dim score to pipeline verdict

**New pipeline flow (Stage A→D in `src/core/pipeline.ts`):**
```
Stage A: filterNoiseL1()     — rule-based skip (system msgs, red packets, emoji)
Stage B: canonicalize()      — source cleaning + interaction tagging
Stage C: scoreBlock()        — 5-dim heuristic score, no LLM
         mapScoreDecision()  — drop → skip; admit/evaluate → pass
         (L1 "escalate" bypasses Stage C gate entirely — always reaches Stage D)
Stage D: extractor.extract() — LLM extraction (only surviving blocks)
```

## Remaining Gap from Original Plan

**Entity prompt hints** (originally Task 4) — `extractQuickEntities()` results are used for scoring but **not** injected into the LLM extraction prompt. This is deferred to Sprint 2 Task 1.

---

*Sprint 2 plan: `docs/superpowers/plans/2026-06-02-sprint2-entity-hints-freshness.md`*
