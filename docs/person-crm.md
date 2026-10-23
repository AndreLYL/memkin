# Person CRM

Memkin's person memory lives in its existing PostgreSQL/PGlite database. A person
has a stable page ID, structured profile, source records, interactions, facts,
and relationships. Names alone never identify a person.

## Implementation contract

- Manual recording and organization work without an LLM. Text, dictated text,
  and imported transcripts share the same capture API; audio transcription is an
  upstream responsibility.
- Source text is saved before extraction and remains immutable. `captured_at`
  records when the source was originally captured, `ingested_at` when Memkin
  received it, and event time separately records when something happened.
- Zoned timestamps retain the supplied representation and IANA timezone. Partial
  dates and unknown event times stay partial or unknown. Future plans do not
  silently become current addresses, jobs, or completed interactions.
- AI output is an editable proposal, with source quotes and explicit identity
  choices. Applying a proposal is transactional and idempotent. Corrections keep
  revision history and reject stale writes.
- Person pages are derived searchable views over structured data; CRM data cannot
  be accidentally replaced through the generic page editor or legacy merge.
- The UI provides people, profiles, capture, source review, and separate source
  and event timelines. REST and MCP expose the same validated operations.

This branch is being rebuilt from the agreed product design. Implementation and
validation are recorded in subsequent commits; previous lost-workspace test
results do not constitute validation of this branch.
