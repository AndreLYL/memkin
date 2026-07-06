# Memkin — Agent Guide

Memkin is a personal memory layer. It stores and retrieves signals (decisions, tasks, knowledge, preferences, references) as pages anchored to entities (people, projects, tools) via a graph.

## Session Start

At the beginning of every session, call `get_session_context` to load working memory:

```
get_session_context()          # last 7 days (default)
get_session_context(days=14)   # extend window if needed
```

## Tool Priority

Prefer high-level tools first:

| Tool | Use for |
|------|---------|
| `get_session_context` | Session bootstrap — what's active, what's pending |
| `query("...")` | Semantic search — main retrieval entry point |
| `get_entity_profile("entities/alice")` | Full profile: signals + timeline for a person/project |
| `list_signals_by_entity("entities/alice")` | List all signals anchored to an entity |
| `search("exact keyword")` | Keyword / full-text search (use when `query` is too broad) |

Low-level tools (`get_page`, `put_page`, `add_link`, `list_pages`, …) are available for precise CRUD when high-level tools aren't enough.

## Saving Signals

When you make a significant decision or discovery, save it:

```
put_page(
  slug="decisions/<kebab-slug>",
  content="---\ntitle: <title>\ntype: decision\n---\n<reasoning>"
)
```

Signal types: `decision`, `task`, `knowledge`, `preference`, `reference`, `entity`, `person`, `project`, `organization`, `tool`, `concept`.

## Memory Tiers

Pages move through tiers automatically (`hot` → `warm` → `cold`). Query results weight hot pages higher. Use `memkin consolidate --hot` to run tier rotation manually.
