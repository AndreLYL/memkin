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

**🔒 Private & Local-First**
Your data never leaves your machine. SQLite database, local vector embeddings via Ollama, no cloud dependency. You own your memory.

**🧠 AI-Powered Signal Extraction**
LLM-driven pipeline extracts 6 types of structured signals from raw conversations: entities, timeline events, decisions, tasks, discoveries, and relationships.

**🔍 Semantic Search & Q&A**
Ask questions in natural language: "What did I discuss with Zhang San about the auth module last week?" Powered by full-text search + vector retrieval.

**📊 Knowledge Graph Visualization**
See the connections between people, projects, decisions, and ideas in an interactive graph view.

**📅 Timeline Recall**
Browse your activity history like an auto-written diary — what you did, when, and across which platforms.

**🔌 MCP Server**
Use Memoark as a memory layer for any AI agent that supports MCP — Claude Code, Cursor, Windsurf. Your agent remembers everything you've done.

**🌐 Multi-Platform Collection**
One system, multiple sources. Currently supports AI agent sessions (Claude Code, Codex, Hermes), with Feishu and WeChat coming soon.

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

Edit `dbe.yaml` and set your LLM API key:

```bash
export DBE_API_KEY=your-api-key
```

### Check Environment

```bash
bun src/cli.ts doctor
```

### Run Your First Extraction

```bash
# Extract from Claude Code, output to terminal
bun src/cli.ts extract --source claude-code --format json

# Extract from all sources
bun src/cli.ts extract --source all --adapter file --output ./output

# Dry run (no LLM calls)
bun src/cli.ts extract --source claude-code --dry-run
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
                    │  SQLite + FTS5     │
                    │  + sqlite-vec      │
                    │  (Drizzle ORM)     │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────▼──────┐ ┌─────▼──────┐ ┌──────▼───────┐
     │   CLI          │ │  MCP       │ │  Web UI      │
     │   Management   │ │  Server    │ │  (Hono)      │
     │   & Extraction │ │  for AI    │ │              │
     │                │ │  Agents    │ │  Timeline    │
     │                │ │            │ │  Graph View  │
     └────────────────┘ └────────────┘ └──────────────┘
```

### Signal Extraction Pipeline

| Stage | Description |
|-------|-------------|
| **Collector** | Fetches raw messages from configured data sources |
| **Dedup** | Eliminates duplicates via content hashing |
| **Block Builder** | Groups messages into conversation blocks by time and topic |
| **Noise Filter** | Scores block significance using rules (L1) + LLM (L2) |
| **Signal Extractor** | LLM-powered extraction of entities, decisions, tasks, discoveries, timeline, links |
| **Privacy Processor** | Dual-track redaction — reversible or irreversible |

### Extracted Signal Types

| Signal | Description | Example |
|--------|-------------|---------|
| **Entities** | People, projects, tools, concepts | `project/memoark`, `tool/claude-code` |
| **Timeline** | Key events with timestamps | "2026-05-19: Completed multi-platform collector refactoring" |
| **Decisions** | Technical choices with reasoning | "Chose Apache 2.0 for open-source friendliness + patent protection" |
| **Tasks** | Action items with status | `[open] Implement token auto-refresh` |
| **Discoveries** | Insights, root causes, edge cases | "UUID v4 is not lexicographically sortable" |
| **Links** | Relationships between entities | `project/memoark --[depends_on]--> tool/sqlite` |

## CLI Reference

### `memoark extract`

Extract signals from data sources.

```bash
memoark extract \
  --source <name>              # claude-code, codex, hermes, all
  --format json|markdown       # Output format (default: json)
  --adapter file|gbrain|stdout # Output target (default: stdout)
  --output <dir>               # Output directory for file adapter
  --since <date>               # Process messages after this date (ISO 8601 or relative: 1d, 2h)
  --limit <n>                  # Max messages to process
  --dry-run                    # Test without LLM calls or writes
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

### `dbe.yaml`

```yaml
# Privacy
privacy:
  enabled: true
  mode: reversible           # reversible | irreversible
  redact_phone: true
  redact_id_card: true
  redact_bank_card: true
  replacement: "[REDACTED]"

# LLM
llm:
  provider: openai
  model: gpt-4o-mini
  base_url: https://api.openai.com/v1
  api_key: ${DBE_API_KEY}    # Environment variable interpolation

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

# Adapters
adapters:
  file:
    enabled: false
    output_dir: ./output
  gbrain:
    enabled: false
    output_dir: ./gbrain-output
```

## Roadmap

### ✅ Phase 1 — Signal Extraction (Complete)

- [x] Multi-platform collectors (Claude Code, Codex, Hermes)
- [x] LLM-powered noise filtering and signal extraction
- [x] 6 signal types: entities, timeline, decisions, tasks, discoveries, links
- [x] Dual-track privacy redaction (reversible + irreversible)
- [x] JSON and Markdown output formatters
- [x] File, GBrain, and Stdout adapters
- [x] CLI with extract, doctor, config, sources commands
- [x] 252 tests, Biome linting, GitHub Actions CI

### 🔨 Phase 2 — Storage Layer (Next)

- [ ] SQLite + FTS5 full-text search
- [ ] sqlite-vec vector storage for semantic search
- [ ] Drizzle ORM schema and migrations
- [ ] Embedding provider interface (Ollama local + API)
- [ ] Signal deduplication and merging across sources

### 🔮 Phase 3 — Query & Interface

- [ ] Natural language Q&A over stored memories
- [ ] MCP Server for AI agent integration
- [ ] REST API (Hono)
- [ ] Web UI — Timeline view
- [ ] Web UI — Knowledge graph visualization (D3.js / react-force-graph)

### 🌐 Phase 4 — New Data Sources

- [ ] Feishu (Lark) messages and calendar
- [ ] WeChat chat history
- [ ] More platforms based on community demand

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Runtime | Bun |
| Database | SQLite + FTS5 + sqlite-vec |
| ORM | Drizzle |
| Embeddings | Ollama (local) / OpenAI API |
| Web Framework | Hono |
| MCP | @modelcontextprotocol/sdk |
| Frontend | React + Vite |
| Graph Visualization | D3.js / react-force-graph |
| Linter | Biome |
| Tests | Vitest |

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
