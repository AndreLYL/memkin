<p align="center">
  <h1 align="center">Memoark</h1>
  <p align="center"><em>You are the sum of your working relationships.</em></p>
  <p align="center"><strong>A local-first memory system for your work — turning your DMs, group chats, emails, docs, and meetings into a private personal memory, so your AI agents truly know you.</strong></p>
</p>

<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@andre.li/memoark"><img alt="npm" src="https://img.shields.io/npm/v/@andre.li/memoark?color=cb3837&logo=npm"></a>
  <img alt="Runtime: Bun" src="https://img.shields.io/badge/runtime-Bun-black">
  <img alt="Language: TypeScript" src="https://img.shields.io/badge/lang-TypeScript-3178c6">
  <img alt="Tests: 1000+" src="https://img.shields.io/badge/tests-1000%2B-success">
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

<!-- TODO(demo): replace with an 8-12s demo GIF — ask Memoark a question inside Claude Code
     and watch the agent recall a Feishu meeting decision + linked task over MCP.
     Research shows a GIF of "the product actually working" is the single highest-converting
     element in a README. -->

---

## The Problem

Your work memory has two homes, and your AI agents can't reach either.

- **Feishu (Lark)** holds your working relationships — DMs, group chats, emails, meetings, tasks. This is *what* you work on and *who* you work with.
- **AI agents** (Claude Code, Codex, OpenClaw) hold your building process — the decisions, discoveries, and dead-ends from every coding session.

But every time you open a new agent session, it knows nothing. You re-explain who you are, what the project is, what was decided last week, and why. The context is *somewhere* — buried in chat logs and session transcripts you'll never scroll through again.

**You don't have a memory problem. You have a fragmentation problem — and your agents pay for it every day.**

## The Solution

Memoark is a **local-first personal memory system built for the Chinese workplace**. Work in China happens inside Feishu, DingTalk, and WeCom — Memoark pulls the DMs, group chats, emails, meetings, and docs out of these tools, together with your AI-agent sessions, and extracts them into structured signals (entities, decisions, tasks, discoveries, knowledge, relationships) — into one searchable knowledge graph on your own machine, then serves that memory back to any agent over **MCP**.

> The MVP focuses on full **Feishu** capture; **DingTalk, WeCom**, and more Chinese workplace tools are on the roadmap (below).

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

## Three Pillars

**🔒 Local-first, truly private**
Your data never leaves your machine. PGLite embedded database stores everything, optional local embeddings via Ollama, zero cloud dependency. Dual-track privacy redaction (reversible / irreversible) scrubs sensitive data before it's written.

**🕸️ An entity knowledge graph, not a pile of vector chunks**
Signals are anchored to entities (people, projects, tools) and linked in a directed graph. You get answers *with context* — who, why, and what it relates to — instead of isolated similar-text fragments.

**🤖 MCP-native + Feishu capture**
**29 built-in MCP tools** let any agent both query and write back to your memory. Full Feishu capture (7 sources) turns your real work — requirements, proposals, team decisions — into a first-class data source, something neither pure RAG nor note apps can do.

## Features

**🛰️ Full Feishu (Lark) Capture**
Your work lives in Feishu. Memoark collects across **7 sources** — DMs, group chats, email, calendar, docs, tasks, and message search — turning your working relationships into structured memory. Doc capture produces upgradable "summary cards" (DocSource v2).

**🤖 Agents That Know You (MCP)**
Use Memoark as the memory layer for any MCP agent — Claude Code, Cursor, Claude Desktop, Windsurf. **29 built-in tools** let your agent query your history, read entity pages, and write new knowledge back. Agents are both producers and consumers of your memory.

**🧠 AI-Powered Signal Extraction**
An LLM pipeline extracts 7 types of structured signals from raw conversations: entities, timeline events, decisions, tasks, discoveries, knowledge, and relationships.

**🔍 Hybrid Semantic Search**
Full-text search (tsvector, multilingual) + vector retrieval fused with Reciprocal Rank Fusion (RRF). Ask in natural language — powered by PGLite FTS + pgvector.

**♻️ Memory Consolidation (Dream Cycle)**
A background consolidator automatically runs tier rotation (hot → warm → cold), repairs dead links, and infers preferences — so your memory organizes itself over time.

**⏰ Resident Daemon + Scheduled Capture**
A built-in daemon collects from your sources on a schedule, with run history and alerts, keeping your memory continuously fresh.

**🔗 Obsidian Bidirectional Sync**
Export your memory pages to an Obsidian vault (Markdown), edit them, and import them back.

**🕸️ Knowledge Graph + Web UI**
See the connections between people, projects, and decisions. Browse a built-in web UI with dashboard, timeline, force-directed graph, and search.

**🔌 REST API**
Full Hono-powered HTTP API for all store operations. Integrate with any client.

## Works With

Memoark is a standard MCP stdio server and plugs into any MCP client:

**Claude Code** · **Cursor** · **Claude Desktop** · **Windsurf** · and any MCP-compatible agent.

## Feature Inventory

The full capability list (✅ = shipped and included in the package).

### 📥 Data Collection
- ✅ Feishu group chats (OpenAPI chat/message)
- ✅ Feishu DMs / recent chats (lark-cli `message_search`, user mode)
- ✅ Feishu email
- ✅ Feishu calendar events
- ✅ Feishu tasks
- ✅ Feishu doc summary cards (DocSource v2: pointer card → upgraded full card on trigger)
- ✅ Claude Code sessions (`~/.claude/projects/`)
- ✅ Codex CLI sessions (`~/.codex/`)
- ✅ OpenClaw Hermes multi-agent sessions (`~/.openclaw/agents/`, auto sub-agent discovery)
- ✅ Incremental collection: per-source cursor + content-hash dedup
- ✅ Historical backfill: coverage stats, start / cancel / reset

### 🧠 Signal Extraction Pipeline
- ✅ Collect → Dedup → Block Builder → Noise Filter → Signal Extractor → Privacy
- ✅ Two-layer noise filtering: L1 rules + L2 LLM scoring
- ✅ 7 structured signal types: entities, timeline, decisions, tasks, discoveries, knowledge, relationships
- ✅ LLM providers: OpenAI / Anthropic (plus a mock for testing)
- ✅ Signal scoring and entity extraction
- ✅ JSON / Markdown output formats
- ✅ Output adapters: store (PGLite) / file / gbrain / stdout
- ✅ Provenance: every signal traces back to its source message

### 🔒 Privacy & Security
- ✅ Redaction before write; data stays fully local
- ✅ Dual-track modes: reversible / irreversible
- ✅ Built-in redaction: phone, ID card, bank card, with custom replacement token
- ✅ API keys always masked in the config center

### 🗄️ Storage & Retrieval
- ✅ PGLite embedded PostgreSQL (in-process, zero external deps)
- ✅ pgvector vector search
- ✅ tsvector full-text search (simple tokenizer, multilingual)
- ✅ RRF hybrid search (FTS + vector fusion) with compiled_truth / backlink boosts
- ✅ Recursive chunking (300 words / 50-word overlap), embedding reuse + stale detection
- ✅ Embeddings: OpenAI / Ollama (local)

### 🕸️ Knowledge Graph
- ✅ Directed link graph with link types and context
- ✅ BFS traversal (controllable depth / direction)
- ✅ Backlinks
- ✅ Entity anchoring: signals attach to people / projects / tools
- ✅ Entity profile aggregation (signals + timeline)

### 👤 Person Identity
- ✅ Identity resolution and canonicalization
- ✅ Alias / handle linking (Feishu open_id, email, name, nickname, slug)
- ✅ Strong / weak link strength
- ✅ Person merge (re-points links / timeline / tags / aliases)
- ✅ Recanonicalize slug (fix a wrong canonicalization)

### ♻️ Memory Lifecycle & Daemon
- ✅ Memory consolidation (dream cycle): hot → warm → cold tier rotation
- ✅ Dead-link repair
- ✅ Preference inference (learns preferences from history)
- ✅ Resident daemon: scheduled per-source capture, scheduling, run history, alerts

### 🔗 Sync & Interop
- ✅ Obsidian bidirectional sync (export vault / import back)
- ✅ MCP stdio server (29 tools)
- ✅ REST API (Hono — pages / search / graph / tags / timeline / embed / extract / provenance / event stream)

### 🖥️ Web UI (React + Vite)
- ✅ Dashboard overview
- ✅ Timeline view (feed)
- ✅ Force-directed knowledge graph
- ✅ Search interface
- ✅ Entity / page detail
- ✅ In-browser config editing + guided setup wizard

### ⚙️ Configuration & Onboarding
- ✅ Interactive config center (full-screen TUI, React + ink)
- ✅ Linear Q&A wizard fallback (`--no-tui`) / fully automatic (`--auto`)
- ✅ Auto-detection: runtime, API keys, existing data sources
- ✅ Hardware assessment → recommends local / remote embeddings
- ✅ Live connection checks (LLM / embedding API key and connectivity)
- ✅ `memoark doctor` environment diagnostics

## Use Cases

> Memoark answers not "what do I know" but "**what should I do**" — every scenario returns a cited, traceable action, not a pile of chunks.

**🌟 Know how to talk to someone before you meet them (Hero)**
*"I'm meeting Director Zhang tomorrow to negotiate a renewal price increase — what should I keep in mind?"* — `prep_for_person` **passively infers** a communication profile from your real interactions (direct vs. indirect, data-driven vs. relationship-driven, landmines), tailors advice to this goal, and flags gaps (*"nothing new about Zhang in 18 days — the profile may be stale"*). Zero questionnaire; the profile never leaves your machine.

**📋 Generate a cross-channel daily report in one line**
*"Help me write today's daily report"* — `daily_report` aggregates today's signals scattered across DMs, group chats, email, Feishu Minutes notes, and calendar into 7 sections: decisions / in-progress / my tasks / awaiting-reply·@mentions / relationship updates / tomorrow's reminders. Action items in meeting notes that name you land in "my tasks" automatically.

**🔧 Troubleshoot by the playbook**
*"Why won't the ADAS engage?"* — `troubleshoot` walks the playbook's diagnostic chain (`precedes`) to give ordered steps and explain what each result means. Playbooks can be authored by hand or auto-extracted (as drafts) from your troubleshooting conversations.

**⚡ Onboard your agent to a project in seconds**
*"What's the current state of the memoark project?"* — `get_session_context` pulls the aggregated decisions, open tasks, and recent timeline straight from memory, no re-explaining.

**🔎 Recall a person or a thread**
*"What did I discuss with this colleague last week?"* — stitches Feishu DMs, the meeting, and the follow-up task into one cited answer.

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
| Memory consolidation + scheduled-capture daemon | ✅ | ❌ | ❌ | partial | partial |

> Pure RAG gives you vectors but no entities or relationships, so answers lack context. Note apps are powerful but rely on manual upkeep. Memoark keeps it local and agent-native — with Feishu work as a first-class source.

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) >= 18 (for the `npx` / `npm` install)
- (Optional) [Ollama](https://ollama.ai) for local embeddings

### One-step launch (recommended)

```bash
# Run without installing — no config? it auto-launches the setup wizard,
# then starts the server and opens your browser
npx @andre.li/memoark start

# Running with no subcommand is equivalent to `start`
npx @andre.li/memoark
```

`memoark start` is the single-step path: if there's no `memoark.yaml`, it opens the browser setup wizard first, then starts the HTTP server and auto-opens your browser.

> The npm package is `@andre.li/memoark` (scoped), but the command is still `memoark`.

### Ports at a glance

| Service | Default port | Address |
|---------|--------------|---------|
| HTTP API + Web UI | `3927` | `http://localhost:3927` |
| MCP Streamable HTTP (`--mcp-http`) | `3928` | `http://localhost:3928/mcp` |

### Install (recommended: npm)

```bash
# Run without installing
npx @andre.li/memoark --help

# Or install globally to get the `memoark` command
npm install -g @andre.li/memoark
```

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
# HTTP API + Web UI (default http://localhost:3927) — auto-opens your browser
memoark serve

# Skip the auto-open (e.g. on a remote/headless host)
memoark serve --no-open

# MCP stdio (local direct connect for AI agents — Claude Code, Cursor, etc.; no browser)
memoark serve --mcp

# MCP Streamable HTTP (remote / multi-client, default http://localhost:3928/mcp; no browser)
memoark serve --mcp-http
```

> Without a `memoark.yaml`, `serve` tells you to run `memoark start` for one-step setup + launch, or `memoark init --web` to configure first.

### Connect Your Agent (MCP)

**One command (recommended)**: `memoark install` writes the MCP config plus a tiny memory directive into your AI client (**global by default**, across all projects). Supports **Claude Code · Claude Desktop · Cursor · Codex · Windsurf**:

```bash
memoark install                      # detect installed clients and wire them up
memoark install --agent claude-code  # target a single client
memoark install --dry-run            # preview file changes, write nothing
memoark uninstall                    # clean removal (idempotent)
```

Reopen the client and you're set — ask "what did X tell me last week?" or "where is this project at?" and the agent will **proactively query Memoark** per the injected directive (cheap-first: `search` keyword lookup at zero cost, escalating to `query`/`recall` only if thin) instead of guessing.

> Claude Desktop has no rules file, so it relies on the MCP server's `instructions` field. You can also configure things manually below.

**Automatic recall on Claude Code (optional · hooks)**: go further on Claude Code so memory arrives with zero effort:

```bash
memoark hooks install               # SessionStart + UserPromptSubmit read hooks (on by default)
memoark hooks install --write-back  # also enable end-of-session auto write-back (opt-in)
memoark hooks uninstall             # remove
```

- **SessionStart**: injects an "active projects / decisions / open tasks / key people" digest at the start of each session (the always-on core).
- **UserPromptSubmit**: a **zero-cost FTS** probe before each prompt; injects only on a hit (≤3 items, ≤3000 chars, appended after the user message to preserve prompt cache).
- **SessionEnd** (`--write-back`, off by default): asynchronous incremental extraction back into memory, so it compounds.

> Read hooks default on (local, cheap); write-back is explicit `--write-back` (cost + privacy, opt-in). Other clients have no lifecycle hooks and rely on the instruction layer above for model-initiated recall.

**Let the agent install itself**: for agents that can read a URL, just say "onboard me to Memoark following [`MEMOARK_FOR_AGENTS.md`](MEMOARK_FOR_AGENTS.md)" and it runs the commands above and self-checks. For **OpenClaw / Hermes**, use `memoark install --agent hermes` (writes `mcp_servers` into `config.yaml` + drops the `memoark` skill; run `/reload-mcp` in-session to apply); or scaffold the skill alone with `memoark skill scaffold --dir ~/.hermes/skills`.

Memoark offers two MCP transports — pick by scenario:

- **stdio (`--mcp`)** — local direct connect; the agent spawns `memoark` as a subprocess. Zero network setup; best for a single client on one machine.
- **Streamable HTTP (`--mcp-http`)** — over HTTP (default `3928`); use it for remote access or sharing one memory across multiple clients.

Point any MCP client at Memoark so it can read and write your memory. For Claude Code (stdio, local direct connect):

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

Memoark is **5 vertical data-flow layers + 3 cross-cutting concerns**. Data flows top-down: sources are collected, extracted into signals, stored as local memory, then read/written through the bottom interfaces. **Person identity**, **consolidation**, and **scheduling** cut across the stack.

<p align="center">
  <img src="docs/assets/architecture.png" alt="Memoark architecture — 5 vertical layers + 3 cross-cutting concerns" width="920">
</p>

<details>
<summary>📐 View the editable Mermaid source</summary>

```mermaid
flowchart TB
  subgraph L1["① Config & Onboarding"]
    cfg["TUI config center · Web UI config · memoark.yaml<br/>auto-detect · hardware assessment · connection checks"]
  end
  subgraph L2["② Collection"]
    feishu["Feishu: DMs · groups · email · calendar · tasks · message search · docs"]
    agent["AI-agent sessions: Claude Code · Codex · Hermes"]
    inc["Incremental (cursor + dedup) · historical Backfill"]
    planned1["Planned: DingTalk · WeCom · local documents"]:::planned
  end
  subgraph L3["③ Extraction Pipeline"]
    pipe["Block Builder → Noise Filter (rules+LLM) → Signal Extractor (OpenAI/Anthropic)<br/>→ entity extraction → scoring → privacy redaction → 7 signal types"]
  end
  subgraph L4["④ Memory Store"]
    store["PGLite + pgvector<br/>Page · Chunk · Tag · Timeline · Graph<br/>hybrid search (FTS + vector + RRF)"]
  end
  subgraph L5["⑤ Interfaces & Consumption"]
    cli["CLI"]
    mcp["MCP (29 tools)"]
    rest["REST API"]
    web["Web UI (read-only)"]
    obs["Obsidian bidirectional sync"]
  end

  L1 --> L2 --> L3 --> L4 --> L5

  subgraph X["Cross-cutting concerns"]
    id["🧬 Person Identity<br/>merge same person across platforms"]
    cons["♻️ Consolidation / Dream Cycle<br/>tier rotation · dead-link repair · preference inference"]
    sched["⏰ Scheduling / AutoFetch<br/>scheduled capture · run history · alerts"]
  end

  id -.-> L2
  id -.-> L4
  cons -.-> L4
  sched -.-> L2

  classDef planned stroke-dasharray: 5 5,fill:#f6f6f6,color:#888;
```

</details>

### Layer Breakdown

| Layer | Responsibility |
|-------|----------------|
| **① Config & Onboarding** | TUI config center (React + ink), Web UI config, hand-edited `memoark.yaml`; auto-detect runtime / API keys / sources, hardware-aware embedding recommendation, live connection checks |
| **② Collection** | Feishu (DMs / groups / email / calendar / tasks / message search / docs), AI-agent sessions (Claude Code / Codex / Hermes); incremental capture (per-source cursor + content dedup), historical Backfill. **Planned**: DingTalk, WeCom, local documents |
| **③ Extraction Pipeline** | Block Builder → Noise Filter (L1 rules + L2 LLM) → Signal Extractor (OpenAI / Anthropic) → entity extraction → scoring → privacy redaction; emits 7 signal types via output adapters (store / file / gbrain / stdout) |
| **④ Memory Store** | PGLite (in-process embedded PostgreSQL) + pgvector; Page / Chunk / Tag / Timeline / Graph stores; hybrid search (tsvector FTS + vector + RRF) |
| **⑤ Interfaces & Consumption** | CLI, MCP Server (29 tools — agent read / write / maintain), REST API (Hono), Web UI (search / view / graph / timeline, **read-only today**), Obsidian bidirectional sync |

**Cross-cutting concerns (span layers, not standalone pipeline stages):**

- **🧬 Person Identity** — spans Collection ↔ Store: recognize and merge the same person across platforms (Feishu open_id, email, nickname), alias linking, canonicalization. The foundation of "the sum of your social relations".
- **♻️ Consolidation (Dream Cycle)** — background pass over the store: hot → warm → cold rotation, dead-link repair, preference inference.
- **⏰ Scheduling / AutoFetch** — background driver of Collection: scheduled capture, run history, alerts. *(Runs inside `serve` today; standalone daemon + autostart is on the roadmap.)*

> Runs on macOS / Linux / Windows · one-command install (npm / npx) · local-first, self-hosted, zero cloud dependency.

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

## MCP Tools

Memoark's MCP server exposes **29 tools** spanning retrieval, synthesis, page CRUD, graph, tags, timeline, identity, and Feishu doc ingestion. Prefer the high-level tools first:

| Category | Tools |
|----------|-------|
| **Retrieval (high-level)** | `query`, `get_session_context`, `get_entity_profile`, `list_signals_by_entity` |
| **Synthesis** | `synthesize`, `recall` (cited, gap-aware composed answers with inline `[n]`), `prep_for_person` (person communication profile → goal-conditioned strategy; passively inferred, no questionnaire, local-first, ethics-guardrailed), `daily_report` (cross-channel 7-section daily report), `troubleshoot` (one-shot diagnosis along a playbook chain) |
| **Search** | `search` |
| **Pages / content** | `get_page`, `put_page`, `list_pages`, `get_chunks` |
| **Graph** | `add_link`, `remove_link`, `get_links`, `get_backlinks`, `traverse_graph` |
| **Tags** | `add_tag`, `remove_tag`, `get_tags` |
| **Timeline** | `add_timeline_entry`, `get_timeline` |
| **Identity (people)** | `link_person_alias`, `list_person_handles`, `remove_person_alias`, `merge_persons`, `recanonicalize_person` |
| **Feishu docs** | `ingest_feishu_doc` |
| **Health** | `get_health` |

## CLI Reference

| Command | Description |
|---------|-------------|
| `memoark start` | One-step launch: setup if needed, then serve + auto-open browser (bare `memoark` is equivalent) |
| `memoark init` | Interactive config center to generate / edit `memoark.yaml` (`--auto` / `--no-tui` / `--force` / `--web`) |
| `memoark extract` | Extract signals from a data source |
| `memoark search <query>` | Search memory (hybrid / `--mode fts`) |
| `memoark embed` | Generate embeddings for stale chunks |
| `memoark serve` | Start HTTP API (auto-opens browser, `--no-open` to skip) / `--mcp` stdio / `--mcp-http` |
| `memoark consolidate` | Run memory consolidation (tier rotation hot→warm / warm→cold) |
| `memoark export` | Export memory pages to an Obsidian vault (Markdown) |
| `memoark import` | Import an Obsidian vault back into Memoark |
| `memoark docs` | Feishu doc summary cards: `sync` / `status` / `retry` |
| `memoark identity` | Person identity: aliases, merge, rename |
| `memoark sources` | `list` sources / `test <name>` connectivity |
| `memoark doctor` | Diagnose configuration and connectivity |
| `memoark config` | `init` (alias of `memoark init`) / `edit` (browser UI) |

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

### `memoark start`

One-step launch. If no `memoark.yaml` exists, it opens the browser setup wizard first; once configured, it starts the HTTP server and auto-opens your browser. Running `memoark` with no subcommand does the same thing.

```bash
memoark start
memoark              # equivalent
```

### `memoark serve`

Start the Memoark server.

```bash
# HTTP API + Web UI (default http://localhost:3927) — auto-opens the browser
memoark serve

# Skip the auto-open
memoark serve --no-open

# MCP stdio transport (local direct connect for AI agents)
memoark serve --mcp

# MCP Streamable HTTP transport (remote / multi-client, default http://localhost:3928/mcp)
memoark serve --mcp-http
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

### `memoark consolidate`

Run memory lifecycle tier rotation (the "dream cycle").

```bash
memoark consolidate          # hot→warm and/or warm→cold rotation
```

### `memoark export` / `memoark import`

Bidirectional Obsidian sync.

```bash
memoark export   # memory pages → Obsidian vault (Markdown)
memoark import   # Obsidian vault → Memoark
```

### `memoark docs`

Feishu doc summary cards (DocSource v2) — build lightweight pointer cards first, then upgrade triggered docs to full summary cards.

```bash
memoark docs sync                # scan docs, build pointer cards, upgrade triggered docs
memoark docs status              # show card counts by type
memoark docs retry <doc_token>   # retry a failed full-card extraction
memoark docs retry --all-failed  # retry every failed doc
```

Agents can also ingest a single doc directly via the MCP tool `ingest_feishu_doc` (pass a doc URL or token).

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
- [x] MCP Server with 29 stdio tools
- [x] CLI serve, search, embed commands

### Phase 3 — Web UI (Complete)

- [x] Dashboard
- [x] Timeline view
- [x] Knowledge graph visualization (force-directed)
- [x] Search interface
- [x] Entity / page detail views

### Phase 4 — Consolidation & Daemon (Complete)

- [x] Memory consolidation ("dream cycle"): tier rotation, dead-link repair, preference inference
- [x] Resident daemon with scheduled extraction (scheduler, run history, alerts)
- [x] Person identity management (aliases, merge, rename)
- [x] Feishu doc summary cards (DocSource v2)
- [x] Obsidian bidirectional sync (export / import)

### Phase 5 — Self-Hosted Always-On (In Progress · MVP)

- [ ] Standalone daemon service + autostart (systemd / launchd / Windows service) — "configure once, runs maintenance-free"
- [ ] Agent Hook: auto read/write memory on session end / key decisions

### Phase 6 — More Chinese Workplace Sources (Planned)

- [ ] DingTalk
- [ ] WeCom (WeChat Work)
- [ ] WeChat chat history
- [ ] Local document source (scan local files, community-driven · low priority)

### Phase 7 — Context-Aware Extraction & Q&A (In Progress)

- [x] Synthesis layer (basic): `synthesize` / `recall` — cited composed answers with inline `[n]` + gap analysis, intent-template framework, per-scope caching
- [x] **Person communication profile (Hero)**: `prep_for_person(person, goal?)` — passively infers a communication profile from real interactions (zero-LLM behavior layer + behavior-quadrant trait layer + relation layer + four-color shell) and gives goal-conditioned, `[n]`-cited communication strategy. No questionnaire, local-first, ethics-guardrailed (suggestions, not manipulation); disabled by default, per-person opt-in
- [x] **Cross-channel daily report**: `daily_report(date?)` — aggregates today's signals across DMs/group/email/Feishu Minutes/calendar into 7 sections; meeting notes yield `decisions` and owner-tagged `action_items` (yours land in "my tasks")
- [x] **Troubleshooting Playbooks**: `troubleshoot(query)` — ordered steps along the playbook `precedes` chain with per-result meaning; hierarchical tree (`part_of`) organizes problem domains; playbooks authored by hand or auto-extracted (draft) from conversations
- [x] **Retrieval quality**: best-chunk-per-page pooling (surface on strongest evidence), zero-LLM self-wiring (`[[slug]]`/`[[rel:slug]]` graph edges on write), rule-based query rewrite
- [ ] ContextBuffer — share context across conversation blocks
- [ ] Weighted admission scoring (replaces binary noise filter)
- [ ] Narrative assembler — aggregate signals into per-entity narratives
- [ ] Natural language Q&A over stored memories

### Phase 8 — Web UI Enhancements (Planned)

- [ ] Memory editing (read-only today)
- [ ] Audit view (signal provenance visualization)

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
| Tests | Vitest (1000+ tests) |

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
- ⭐ If Memoark helps you, give it a Star — it's the best way to support the project.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
