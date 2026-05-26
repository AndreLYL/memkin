<p align="center">
  <h1 align="center">Memoark</h1>
  <p align="center"><strong>Turn your scattered conversations into one private, searchable memory. Local-first, AI-powered.</strong></p>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#cli-reference">CLI Reference</a> •
  <a href="#roadmap">Roadmap</a>
</p>

---

## The Problem

Your conversations are everywhere — Claude Code, Feishu, WeChat, meetings, emails. Every day, you make decisions, discover insights, and discuss ideas across a dozen platforms. But when you need to recall what was said, where it was decided, or why you chose that approach — it's gone. Buried in chat logs you'll never scroll through again.

**You don't have a memory problem. You have a fragmentation problem.**

## The Solution

Memoark is a **local-first personal memory system** that collects your conversations from multiple platforms, extracts structured signals (entities, decisions, tasks, discoveries, relationships), and stores them in a unified, searchable knowledge graph — all on your own machine.

```
   WeChat          Feishu         Claude Code        Codex          Hermes
     │               │                │                │               │
     └───────────────┴────────────────┴────────────────┴───────────────┘
                                      │
                                      ▼
                            ┌───────────────────┐
                            │     Memoark        │
                            │                   │
                            │  Extract → Store  │
                            │  Search  → Query  │
                            │                   │
                            └───────────────────┘
                                      │
                      ┌───────────────┼───────────────┐
                      ▼               ▼               ▼
                   Timeline      Knowledge        Natural
                   Recall        Graph             Language Q&A
```

> "I discussed a technical proposal with a colleague on WeChat yesterday, implemented part of it in Claude Code today, and have a Feishu review meeting next week."
>
> Memoark connects these three events automatically — across platforms, across time.

## Features

**Private & Local-First**
Your data never leaves your machine. PGLite embedded database, local vector embeddings via Ollama, no cloud dependency. You own your memory.

**AI-Powered Signal Extraction**
LLM-driven pipeline extracts 7 types of structured signals from raw conversations: entities, timeline events, decisions, tasks, discoveries, knowledge, and relationships.

**Hybrid Semantic Search**
Full-text search + vector retrieval with Reciprocal Rank Fusion (RRF). Ask questions in natural language — powered by PGLite FTS + pgvector embeddings.

**Knowledge Graph**
See the connections between people, projects, decisions, and ideas. Graph traversal with BFS, backlink tracking, and link-type filtering.

**Timeline Recall**
Browse your activity history like an auto-written diary — what you did, when, and across which platforms.

**MCP Server**
Use Memoark as a memory layer for any AI agent that supports MCP — Claude Code, Cursor, Windsurf. 17 built-in tools for pages, search, graph, tags, timeline, and embeddings.

**REST API**
Full Hono-powered HTTP API for all store operations. Integrate with any client.

**Multi-Platform Collection**
One system, multiple sources. Currently supports AI agent sessions (Claude Code, Codex, Hermes) and Feishu (Lark).

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.0.0
- (Optional) [Ollama](https://ollama.ai) for local embeddings

### Installation

```bash
git clone https://github.com/AndreLYL/memoark.git
cd memoark
bun install
```

### Initialize Configuration

```bash
bun src/cli.ts config init
```

Edit `memoark.yaml` and set your LLM API key:

```bash
export OPENAI_API_KEY=your-api-key
```

### Check Environment

```bash
bun src/cli.ts doctor
```

### Run Your First Extraction

```bash
# Extract from Claude Code and store directly to PGLite
bun src/cli.ts extract --source claude-code

# Extract from all sources
bun src/cli.ts extract --source all

# Dry run (no LLM calls)
bun src/cli.ts extract --source claude-code --dry-run
```

### Search Your Memory

```bash
# Hybrid search (FTS + vector)
bun src/cli.ts search "auth middleware decision"

# FTS-only search
bun src/cli.ts search "JWT token" --mode fts
```

### Start the Server

```bash
# HTTP API
bun src/cli.ts serve

# MCP stdio (for AI agent integration)
bun src/cli.ts serve --mcp
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Data Sources                             │
│  Claude Code  │  Codex  │  Hermes  │  Feishu  │  WeChat        │
└───────┬───────┴────┬────┴────┬─────┴────┬─────┴────┬───────────┘
        └────────────┴────────┴──────────┴──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Signal Extraction │
                    │   Pipeline          │
                    │                    │
                    │  Collector          │
                    │  → Dedup            │
                    │  → Block Builder    │
                    │  → Noise Filter     │
                    │  → Signal Extractor │
                    │  → Privacy          │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │   Storage Layer     │
                    │                    │
                    │  PGLite + pgvector │
                    │  (Embedded PG)     │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
     │   CLI          │ │  MCP       │ │  REST API    │
     │   Management   │ │  Server    │ │  (Hono)      │
     │   & Extraction │ │  (stdio)   │ │              │
     └────────────────┘ └────────────┘ └──────────────┘
```

### Signal Extraction Pipeline

| Stage | Description |
|-------|-------------|
| **Collector** | Fetches raw messages from configured data sources |
| **Dedup** | Eliminates duplicates via content hashing |
| **Block Builder** | Groups messages into conversation blocks by time and topic |
| **Noise Filter** | Scores block significance using rules (L1) + LLM (L2) |
| **Signal Extractor** | LLM-powered extraction of entities, decisions, tasks, discoveries, knowledge, timeline, links |
| **Privacy Processor** | Dual-track redaction — reversible or irreversible |

### Extracted Signal Types

| Signal | Description | Example |
|--------|-------------|---------|
| **Entities** | People, projects, tools, concepts | `project/memoark`, `tool/claude-code` |
| **Timeline** | Key events with timestamps | "2026-05-19: Completed multi-platform collector refactoring" |
| **Decisions** | Technical choices with reasoning | "Chose PGLite for embedded PostgreSQL with vector support" |
| **Tasks** | Action items with status | `[open] Implement token auto-refresh` |
| **Discoveries** | Insights, root causes, edge cases | "UUID v4 is not lexicographically sortable" |
| **Knowledge** | Reusable facts with provenance | "PGLite runs full Postgres in-process via WASM" |
| **Links** | Relationships between entities | `project/memoark --[depends_on]--> tool/pglite` |

### Storage Layer

| Component | Description |
|-----------|-------------|
| **PageStore** | CRUD for wiki-style pages with YAML frontmatter |
| **ChunkStore** | Recursive text chunking (300 words, 50-word overlap) with embedding reuse |
| **SearchEngine** | FTS via `tsvector` + vector cosine via `pgvector`, fused with RRF scoring |
| **GraphStore** | Directed link graph with BFS traversal, link types, backlinks |
| **TagStore** | Page tagging with conflict-safe upserts |
| **TimelineStore** | Chronological entries per page with dedup |
| **EmbeddingService** | Batch embedding via OpenAI or Ollama, stale-chunk detection |

## CLI Reference

### `memoark extract`

Extract signals from data sources.

```bash
memoark extract \
  --source <name>              # claude-code, codex, hermes, feishu, all
  --format json|markdown       # Output format (default: json)
  --adapter store|file|gbrain|stdout  # Output target (default: store)
  --output <dir>               # Output directory for file adapter
  --since <date>               # Process messages after this date (ISO 8601 or relative: 1d, 2h)
  --limit <n>                  # Max messages to process
  --dry-run                    # Test without LLM calls or writes
```

### `memoark serve`

Start the Memoark server.

```bash
# HTTP API (default port from config)
memoark serve

# MCP stdio transport (for AI agent integration)
memoark serve --mcp
```

### `memoark search <query>`

Search your stored memory.

```bash
# Hybrid search (FTS + vector, default)
memoark search "authentication middleware"

# FTS-only search
memoark search "JWT token" --mode fts

# Limit results
memoark search "deployment" --limit 5
```

### `memoark embed`

Generate embeddings for unembedded chunks.

```bash
# Embed all stale chunks
memoark embed

# Limit batch size
memoark embed --limit 100
```

### `memoark doctor`

Diagnose configuration and environment.

```bash
memoark doctor
```

### `memoark config init`

Generate a configuration template.

```bash
memoark config init
```

### `memoark sources list`

List available data sources.

```bash
memoark sources list
```

### `memoark sources test <name>`

Test data source connectivity.

```bash
memoark sources test claude-code
```

## Configuration

### `memoark.yaml`

```yaml
# Privacy
privacy:
  enabled: true
  mode: reversible           # reversible | irreversible
  redact_phone: true
  redact_id_card: true
  redact_bank_card: true
  replacement: "[REDACTED]"

# LLM (for signal extraction)
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}

# Block Builder
block_builder:
  block_gap_minutes: 30
  max_block_tokens: 4000
  max_block_messages: 100

# Data Sources
sources:
  claude-code:
    enabled: true
  codex:
    enabled: true
  hermes:
    enabled: true

# Store (PGLite)
store:
  data_dir: ~/.memoark/data

# Embeddings
embedding:
  provider: openai           # openai | ollama
  model: text-embedding-3-large
  dimensions: 1536
  api_key: ${OPENAI_API_KEY}

# Server
server:
  http_port: 3927
```

## Supported Sources

### Claude Code

Extracts conversation transcripts from Claude Code agent sessions.

- **Location**: `~/.claude/projects/`
- **Data**: Agent conversations, decisions, discoveries, session logs

### Codex

Extracts session data from OpenAI Codex CLI.

- **Location**: `~/.codex/`
- **Data**: User/assistant messages with system-injection filtering

### Hermes

Extracts session data from OpenClaw Hermes agents.

- **Location**: `~/.openclaw/agents/`
- **Data**: Multi-agent sessions with automatic sub-agent discovery

### Feishu (Lark)

Extracts messages from Feishu/Lark workplace platform.

- **Data**: Group messages, DMs, calendar events, docs, tasks

## Roadmap

### Phase 1 — Signal Extraction (Complete)

- [x] Multi-platform collectors (Claude Code, Codex, Hermes, Feishu)
- [x] LLM-powered noise filtering and signal extraction
- [x] 7 signal types: entities, timeline, decisions, tasks, discoveries, knowledge, links
- [x] Dual-track privacy redaction (reversible + irreversible)
- [x] JSON and Markdown output formatters
- [x] File, GBrain, and Stdout adapters
- [x] CLI with extract, doctor, config, sources commands

### Phase 2 — Storage & Server (Complete)

- [x] PGLite embedded PostgreSQL with pgvector
- [x] PageStore, ChunkStore, TagStore, TimelineStore, GraphStore
- [x] Full-text search with `tsvector` (simple tokenizer for multilingual)
- [x] Vector search with `pgvector` cosine similarity
- [x] Hybrid RRF search fusing FTS + vector results
- [x] EmbeddingService (OpenAI / Ollama)
- [x] StoreAdapter — pipeline writes directly to PGLite
- [x] Hono REST API
- [x] MCP Server with 17 stdio tools
- [x] CLI serve, search, embed commands

### Phase 3 — Query & Interface (Next)

- [ ] Natural language Q&A over stored memories
- [ ] Web UI — Timeline view
- [ ] Web UI — Knowledge graph visualization

### Phase 4 — New Data Sources

- [ ] WeChat chat history
- [ ] More platforms based on community demand

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Runtime | Bun |
| Database | PGLite (embedded PostgreSQL) |
| Vector Search | pgvector |
| Embeddings | OpenAI / Ollama |
| Web Framework | Hono |
| MCP | @modelcontextprotocol/sdk |
| Linter | Biome |
| Tests | Vitest (800+ tests) |

## Development

```bash
# Run tests
bun run test

# Watch mode
bun run test:watch

# Lint
bun run lint

# Auto-fix lint issues
bun run lint:fix
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and guidelines.

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
