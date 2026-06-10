<p align="center">
  <h1 align="center">Memoark</h1>
  <p align="center"><strong>Turn your Feishu work and AI-agent sessions into one private memory your agents can actually use. Local-first, you own it.</strong></p>
</p>

<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <img alt="Runtime: Bun" src="https://img.shields.io/badge/runtime-Bun-black">
  <img alt="Language: TypeScript" src="https://img.shields.io/badge/lang-TypeScript-3178c6">
  <img alt="Tests: 800+" src="https://img.shields.io/badge/tests-800%2B-success">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#use-cases">Use Cases</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#cli-reference">CLI Reference</a> •
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <img src="docs/assets/web-ui-graph.jpeg" alt="Memoark knowledge graph — entities, decisions, tasks, and knowledge connected across your work" width="850">
  <br>
  <em>Your work, as a living knowledge graph — people, decisions, tasks, and knowledge, connected.</em>
</p>

---

## The Problem

Your work memory has two homes, and your AI agents can't reach either.

- **Feishu (Lark)** holds your working relationships — DMs, group chats, emails, meetings, tasks. This is *what* you work on and *who* you work with.
- **AI agents** (Claude Code, Codex, OpenClaw) hold your building process — the decisions, discoveries, and dead-ends from every coding session.

But every time you open a new agent session, it knows nothing. You re-explain who you are, what the project is, what was decided last week, and why. The context is *somewhere* — buried in chat logs and session transcripts you'll never scroll through again.

**You don't have a memory problem. You have a fragmentation problem — and your agents pay for it every day.**

## The Solution

Memoark is a **local-first personal memory system** built on two equal input streams — your **Feishu work** and your **AI-agent sessions**. It extracts structured signals (entities, decisions, tasks, discoveries, knowledge, relationships) into one searchable knowledge graph on your own machine, then serves that memory back to any agent over **MCP**.

The result: your agents both **write to** and **read from** the same memory — so Claude Code, Codex, and any MCP client finally *know you and your work*.

```
        Feishu work                 AI-agent sessions
   (DMs / groups / email           (Claude Code / Codex
    meetings / tasks)                / OpenClaw)
           │                               │
           └───────────────┬───────────────┘
                           ▼   collect + extract (local)
                  ┌──────────────────┐
                  │  Your core memory │  entities · decisions · tasks
                  │   (PGLite, local) │  knowledge · timeline · graph
                  └────────┬─────────┘
                           ▼  MCP
                  Your agents know you
                           │
                           └──── the more agents work, the better it knows you ───┘
```

> "I discussed a proposal with a colleague on Feishu yesterday, implemented part of it in Claude Code today, and have a review meeting next week."
>
> Memoark connects these three events automatically — across platforms, across time — and hands the whole thread to your agent on demand.

## Features

**🛰️ Full Feishu (Lark) Capture**
Your work lives in Feishu. Memoark collects across **7 sources** — DMs, group chats, email, calendar, docs, tasks, and message search — turning your working relationships into structured memory.

**🤖 Agents That Know You (MCP)**
Use Memoark as the memory layer for any MCP agent — Claude Code, Cursor, Windsurf. **17 built-in tools** let your agent query your history, read entity pages, and write new knowledge back. Agents are both producers and consumers of your memory.

**🔒 Private & Local-First**
Your data never leaves your machine. PGLite embedded database, optional local embeddings via Ollama, no cloud dependency. You own your memory.

**🧠 AI-Powered Signal Extraction**
An LLM pipeline extracts 7 types of structured signals from raw conversations: entities, timeline events, decisions, tasks, discoveries, knowledge, and relationships.

**🔍 Hybrid Semantic Search**
Full-text search + vector retrieval fused with Reciprocal Rank Fusion (RRF). Ask in natural language — powered by PGLite FTS + pgvector.

**🕸️ Knowledge Graph + Web UI**
See the connections between people, projects, and decisions. Browse a built-in web UI with dashboard, timeline, force-directed graph, and search.

**🔌 REST API**
Full Hono-powered HTTP API for all store operations. Integrate with any client.

## Use Cases

**Onboard your agent to a project in seconds**
Start a Claude Code session and ask *"what's the current state of the memoark project?"* — your agent pulls the aggregated decisions, open tasks, and recent timeline straight from your memory, no re-explaining.

**Recall a person or a thread**
*"What did I discuss with my colleague last week?"* — Memoark stitches together the Feishu DMs, the meeting, and the follow-up task into one answer.

**Auto-written work log**
Browse your timeline like a diary that writes itself — what you decided, what you shipped, and across which platforms.

## Why Memoark

| | Memoark | Pure RAG / vector search | Note apps (Obsidian / Notion) | GBrain | OpenHuman |
|---|:---:|:---:|:---:|:---:|:---:|
| Local-first & private | ✅ | depends | depends | ✅ | ✅ |
| Open source | ✅ | varies | partial | partial | ✅ |
| Feishu work capture (DM/group/email/meeting/task) | ✅ | ❌ | manual | ❌ | ❌ |
| AI-agent sessions as a source | ✅ | ❌ | ❌ | ✅ | ✅ |
| Agent-native: read **and** write over MCP | ✅ | ❌ | ❌ | ✅ | partial |
| Entity + relationship knowledge graph | ✅ | ❌ | manual | ✅ | partial |
| Structured signal extraction (not just chunks) | ✅ | ❌ | ❌ | ✅ | ✅ |
| Focused MCP surface (17 tools, not 40+) | ✅ | n/a | n/a | ❌ (40+) | varies |

> Pure RAG gives you vectors but no entities or relationships, so answers lack context. Note apps are powerful but rely on manual upkeep. GBrain is capable but heavy, with a sprawling MCP surface. Memoark keeps it local, focused, and agent-native — with Feishu work as a first-class source.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) >= 18 (for the `npx` / `npm` install)
- (Optional) [Ollama](https://ollama.ai) for local embeddings

### Install (recommended: npm)

```bash
# Run without installing
npx @andre.li/memoark --help

# Or install globally to get the `memoark` command
npm install -g @andre.li/memoark
```

> The npm package is `@andre.li/memoark` (scoped), but the command is still `memoark`.

### Install from source (development)

```bash
git clone https://github.com/AndreLYL/memoark.git
cd memoark
bun install
npm link          # registers the `memoark` command globally
```

### Initialize Configuration

`memoark init` launches an **interactive configuration center** — a full-screen TUI (built with React + ink) that lets you generate and edit `memoark.yaml` without hand-writing YAML:

```bash
memoark init
```

**Config center features:**
- 📋 **Sectioned editing**: Overview, LLM, Embedding, Sources, Privacy, Block Builder, and more
- ⌨️ **Keyboard-driven**: ↑/↓ or Tab to move between fields, Enter to edit, Ctrl+S to save, q / Esc to quit (auto-saves if dirty)
- 🔌 **Live connection checks**: validates your LLM / embedding API key and connectivity as you edit
- 💡 **Smart recommendations**: suggests local (Ollama) vs remote (OpenAI) embedding based on your hardware
- 🔒 **Secret masking**: API keys are always shown masked
- 🧭 **Auto-detection**: finds existing data sources (Claude Code, Codex, Hermes) and registers the `memoark` command

**Run modes:**

| Command / environment | Behavior |
|---|---|
| `memoark init` (in a TTY) | Full-screen TUI config center |
| `memoark init --no-tui` | Linear question-and-answer wizard (fallback) |
| `memoark init --auto` | Fully automatic, no prompts, uses detected defaults |
| `memoark init --force` | Overwrite an existing configuration |
| `MEMOARK_NO_TUI=1` | Force-disable the TUI (also auto-falls back in non-TTY environments) |

> `memoark config init` is equivalent to `memoark init`. A few advanced settings (e.g. Feishu) currently need to be edited directly in `memoark.yaml` (see [Configuration](#configuration)).

### Check Environment

```bash
memoark doctor
```

### Run Your First Extraction

```bash
# Extract from Feishu (your work source)
memoark extract --source feishu --since 3d

# Extract from Claude Code
memoark extract --source claude-code

# Extract from all enabled sources
memoark extract --source all

# Dry run (no LLM calls, just scan data volume)
memoark extract --source claude-code --dry-run
```

> Feishu requires a one-time `lark-cli` user login and a `feishu` block in `memoark.yaml`. See [Configuration](#configuration) for the full Feishu setup, including DM vs. group capture paths.

### Search Your Memory

```bash
# Hybrid search (FTS + vector)
memoark search "auth middleware decision"

# FTS-only search
memoark search "JWT token" --mode fts
```

### Start the Server

```bash
# HTTP API (default port 3927)
memoark serve

# MCP stdio (for AI agent integration — Claude Code, Cursor, etc.)
memoark serve --mcp
```

### Connect Your Agent (MCP)

Point any MCP client at Memoark so it can read and write your memory. For Claude Code:

```json
{
  "mcpServers": {
    "memoark": {
      "command": "memoark",
      "args": ["serve", "--mcp"]
    }
  }
}
```

Then ask your agent things like *"search my memory for the auth refactor decision"* or *"what tasks are still open on project X?"* — it answers from your local memory.

### Browse the Web UI

```bash
cd web
bun install
bun run dev        # dashboard, timeline, knowledge graph, search
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Data Sources                             │
│   Feishu (DMs · groups · email · calendar · docs · tasks)       │
│   AI Agents (Claude Code · Codex · Hermes)                      │
└───────────────────────────────┬─────────────────────────────────┘
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
                      │  PGLite + pgvector │
                      │  (Embedded PG)     │
                      └─────────┬──────────┘
                                │
            ┌───────────────────┼───────────────────┐
            │           │               │           │
   ┌────────▼─────┐ ┌───▼────┐ ┌────────▼───┐ ┌─────▼──────┐
   │     CLI       │ │  MCP   │ │  REST API  │ │  Web UI    │
   │  Management   │ │ Server │ │   (Hono)   │ │  (React)   │
   │  & Extraction │ │(stdio) │ │            │ │            │
   └───────────────┘ └────────┘ └────────────┘ └────────────┘
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
  --source <name>              # feishu, claude-code, codex, hermes, all
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

Equivalent to `memoark init` — launches the interactive configuration center to generate / edit `memoark.yaml` (supports `--auto` / `--no-tui` / `--force`).

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
  # Feishu (Lark) — your primary work source
  feishu:
    enabled: true
    auth_mode: user            # user mode enables DM + message search
    app_id: ${FEISHU_APP_ID}
    app_secret: ${FEISHU_APP_SECRET}
    sources:
      messages:                # group chats via OpenAPI
        enabled: true
        chat_ids: []
        lookback_days: 3
      message_search:          # DMs + recent chats via lark-cli
        enabled: true
        chat_types: [p2p]      # add `group` to include groups
        lookback_days: 3
      calendar: { enabled: true }
      docs: { enabled: true }
      tasks: { enabled: true }
  # AI agent sessions
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

> **Feishu DM vs. group capture:** `messages` uses the OpenAPI chat/message endpoints (best for known group `chat_id`s), while `message_search` uses `lark-cli im messages-search` in user mode (required for recent DMs and 1:1 bot chats). Enable both for full coverage, and complete the `lark-cli` user login first.

## Supported Sources

### Feishu (Lark)

Your primary work source — group messages, DMs, email, calendar events, docs, and tasks.

- **Auth**: `lark-cli` user-mode login (for DMs / message search) + app credentials
- **Data**: 7 sources — group chats, DMs, email, calendar, docs, tasks, message search
- **Why first**: Feishu carries the work itself — requirements, technical proposals, team decisions

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

### Phase 3 — Web UI (Complete)

- [x] Dashboard
- [x] Timeline view
- [x] Knowledge graph visualization (force-directed)
- [x] Search interface
- [x] Entity / page detail views

### Phase 4 — Context-Aware Extraction (Planned)

- [ ] ContextBuffer — share context across conversation blocks
- [ ] Weighted admission scoring (replaces binary noise filter)
- [ ] Narrative assembler — aggregate signals into per-entity narratives

### Phase 5 — Consolidation & Daemon (Planned)

- [ ] Memory consolidation ("dream cycle"): entity merge, link repair, pattern discovery
- [ ] Resident background service with scheduled extraction
- [ ] Natural language Q&A over stored memories

### Phase 6 — Sync & New Sources (Planned)

- [ ] Obsidian bidirectional sync
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
| Web UI | React + Vite |
| MCP | @modelcontextprotocol/sdk |
| Linter | Biome |
| Tests | Vitest (800+ tests) |

## Development

```bash
# Run tests
bun run test

# Watch mode
bun run test:watch

# Type-check
bun run typecheck

# Lint
bun run lint

# Auto-fix lint issues
bun run lint:fix
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow and guidelines.

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

## Community & Support

- 🐛 Found a bug or have a feature request? [Open an issue](https://github.com/AndreLYL/memoark/issues).
- 💡 Questions and ideas are welcome in the issue tracker.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
