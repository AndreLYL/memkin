# Session Distillation Criteria

You are distilling an ENTIRE agent work session into the few signals worth
remembering. Write for the retriever 30 days from now: a colleague (or the same
user) who needs to reconstruct what was decided, what remains open, and why —
without rereading the transcript.

## The core question

For every candidate signal ask: "If someone searches for this in 30 days, does
finding it change what they do?" If the answer is no, do not record it.

## Authority — who actually said it (be strict)

Label every signal with exactly one authority level:

- `user_confirmed` — the USER decided, approved, or explicitly agreed.
  "yes, do that", "we'll go with Bun", "approved". A user instruction counts.
- `assistant_proposed` — the assistant suggested it and the user did NOT
  clearly confirm. Proposals are not decisions. When in doubt between
  confirmed and proposed, choose proposed.
- `assistant_claimed` — the assistant asserts a fact or outcome from its own
  work ("tests pass", "the bug was in X"). This is self-reported and NOT
  verified by any tool result — never upgrade it to user_confirmed.

## What to record

- **decision** — a resolved choice with lasting effect (architecture, tooling,
  convention, scope). Include the WHY. If it replaces an earlier decision, set
  `supersedes_topic`.
- **task** — a concrete commitment someone must act on later, with `status`
  (`open` / `in_progress` / `done` / `cancelled`). Unresolved questions that
  block future work are open tasks.
- **reference** — a URL that was actually shared in the conversation and will
  be needed again. The `url` MUST appear verbatim in the messages you cite as
  evidence — never invent or normalize a URL.
- **preference** — a durable user preference (tooling, workflow, communication,
  coding style), not a one-off request.
- **knowledge** — a fact about the world or the codebase that stays true beyond
  this session ("the API rate limit is 100/min", "module X owns retries").
- **discovery** — a non-obvious insight, pattern, risk, or procedure learned
  the hard way (root causes, gotchas, edge cases).

## What NOT to record

- Transient debugging back-and-forth: failed attempts, intermediate states,
  "let me try again" loops. Only the final outcome and its root cause matter.
- Anything overturned later in the session. If segment 5 abandons what
  segment 2 proposed, the proposal must NOT appear as a signal.
- Routine mechanics: file reads, obvious commands, formatting runs, progress
  narration ("now I'll edit the file").
- Restatements of what already exists in code or docs.
- Pleasantries, meta-chatter about the conversation itself.

## Writing the fields

- `topic`: short, searchable, stable — the retriever's query, not a sentence.
- `what`: one or two sentences, self-contained (no "it/this" referring to
  transcript context the reader cannot see).
- `why`: the motivation or constraint that produced it, when stated.
- `entities`: natural-language names of people / projects / tools involved.
  Names only — never invent identifiers or slugs.
- `evidence`: cite the exact `msg_id` ranges (only ids you were given) that
  support the signal. Every signal needs at least one range.
- `persistence_reason`: one line — why this deserves to outlive the session.

Prefer FEWER, denser signals. An empty result is acceptable for a session that
was pure mechanics; a noisy result is not.
