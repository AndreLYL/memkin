# Golden Dataset Annotation Guide

This guide explains how to build the **golden dataset** used by the extraction quality
gate (spec §10, extraction-quality-redesign). The dataset is annotated **by a human**
(you), lives in `eval-data/` at the repo root, and is **gitignored** — it contains real
session content and must never be committed. Only the sanitized synthetic fixtures under
`tests/fixtures/eval/` ship in the repo.

## Layout

```
eval-data/
├── sessions/           # real session transcripts (one .jsonl per session)
│   ├── <session-id>.jsonl
│   └── ...
├── golden/             # your annotations (one .json per session, same basename)
│   ├── <session-id>.json
│   └── ...
└── manifest.json       # versioned manifest: session list + split + annotation hashes
```

Target size: **20–30 real sessions**, mixed sources (claude-code / codex / hermes),
mixed content (decision-heavy, task-heavy, knowledge/reference, and several
**noise-only** sessions where nothing should be recorded).

## Step 1 — Pick sessions

Copy real transcripts into `eval-data/sessions/`. Pick sessions you remember well enough
to judge what *should* have been remembered. Include:

- sessions where a real decision was made and confirmed by you
- sessions where the assistant did work and reported it (tasks)
- sessions with useful discoveries / root causes (knowledge) and shared links (reference)
- at least 3–5 pure debugging/chatter sessions where the correct extraction is **nothing**

## Step 2 — Annotate each session

For each `eval-data/sessions/<session-id>.jsonl`, create
`eval-data/golden/<session-id>.json` following this template
(schema: `src/eval/golden.ts`, validated by `loadGolden`):

```json
{
  "session_ref": "<source>:<session-id>",
  "should_record": [
    {
      "type": "decision",
      "authority": "user_confirmed",
      "topic": "short-kebab-case-topic",
      "what": "One sentence describing the fact/decision/task as it should be remembered."
    }
  ],
  "should_not_record": [
    {
      "what": "A concrete thing the pipeline might wrongly extract from this session.",
      "reason": "Why it should NOT be recorded (e.g. assistant_proposed, transient chatter)."
    }
  ]
}
```

Field rules:

- `type` — one of `decision | task | reference | preference | knowledge | discovery`
- `authority` — who backs the signal (spec §5 admission matrix):
  - `user_confirmed` — you explicitly decided/confirmed it in the conversation
  - `assistant_claimed` — the assistant states it did/found something, you did not confirm
  - `assistant_proposed` — the assistant suggested it and you never confirmed
    (proposals generally belong in `should_not_record` — they must not become
    canonical memory; `decision`/`preference` require `user_confirmed`)
- `topic` — short stable kebab-case key; used for grouping, not for matching
- `what` — one self-contained sentence; the judge compares this text semantically
  against pipeline output, so write what a good memory entry *should say*
- `should_not_record` — concrete negative examples with reasons; these document the
  noise you're trying to eliminate (they are not used for automatic matching, but they
  calibrate expectations and future prompt work)

A noise-only session is annotated with `"should_record": []` and one or more
`should_not_record` entries. See `tests/fixtures/eval/ci-golden/ci-session-4.json`.

## Step 3 — Build the manifest (and lock the holdout)

Create `eval-data/manifest.json` (schema: `src/eval/manifest.ts`):

```json
{
  "version": 1,
  "sessions": [
    {
      "session_ref": "claude-code:<session-id>",
      "split": "tune",
      "annotation_hash": "<sha256 of eval-data/golden/<session-id>.json>"
    }
  ],
  "created_at": "2026-07-07T00:00:00.000Z"
}
```

- Assign **~70% to `"tune"` and ~30% to `"holdout"`**, randomly (e.g. shuffle, take
  every third session as holdout). With 20–30 sessions that's a 6–9 session holdout.
- Compute each annotation hash with:

  ```bash
  shasum -a 256 eval-data/golden/<session-id>.json
  ```

- **The holdout is locked once assigned.** Never move sessions between splits after
  you start iterating on prompts — pass/fail is judged on the holdout only, and
  reshuffling after seeing results is leakage. If the holdout turns out too small to
  call a result, **annotate more sessions** and extend both splits; do not fall back
  to judging on the full set.
- Bump `version` and refresh `annotation_hash` whenever you edit an annotation, so
  every evaluation report can state exactly which annotation state it measured.

## Step 4 — Run the evaluation (local quality gate)

The eval building blocks live in `src/eval/`:

- `loadManifest` / `splitSessions` (`manifest.ts`) — load the dataset definition
- `loadGolden` (`golden.ts`) — load your annotations
- `createLLMJudgeClient` + `judge` (`judge.ts`) — LLM semantic matching
  (uses the existing `LLMProvider` from your `memkin.yaml` LLM config); run
  `calibrateJudge` first and require ≥4/5 on the built-in calibration examples
- `evaluate` + `report` (`metrics.ts`) — 3 runs, mean ± variance, holdout-only verdict

Acceptance (directional, spec §10): on the **holdout**, the new pipeline's noise rate
drops **≥80%** vs. legacy and the miss rate does not increase. Tune-split numbers are
descriptive only — use them to iterate, never to declare success.
