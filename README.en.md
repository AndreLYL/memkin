<p align="center">
  <img src="docs/assets/memkin-cover.png" alt="Memkin — an AI that finally knows you" width="100%">
</p>

<h1 align="center">An AI that finally knows you</h1>

<p align="center"><strong>Your AI agents forget everything between sessions. Memkin turns your Claude Code / Codex sessions — and your work chats, meetings, and email — into a private, local-first memory graph that any agent can tap over MCP.</strong></p>

<p align="center">
  <a href="README.md">简体中文</a> | English
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <a href="https://www.npmjs.com/package/memkin"><img alt="npm" src="https://img.shields.io/npm/v/memkin?color=cb3837&logo=npm"></a>
  <img alt="Language: TypeScript" src="https://img.shields.io/badge/lang-TypeScript-3178c6">
  <img alt="Tests: 2000+" src="https://img.shields.io/badge/tests-2000%2B-success">
  <a href="https://glama.ai/mcp/servers/AndreLYL/memkin"><img alt="MCP Score" src="https://glama.ai/mcp/servers/AndreLYL/memkin/badges/score.svg"></a>
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="Asking Memkin inside Claude Code: what did I discuss with Alice about the launch last week? — answered with [n] citations" width="850">
  <br>
  <em>Ask inside Claude Code — Memkin answers over MCP, with citations back to the source.</em>
</p>

---

## ⚡ 30-Second Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/AndreLYL/memkin/main/scripts/install.sh | sh
```

One command does it all: installs the runtime → installs `memkin` globally → opens the setup wizard in your browser (just paste an LLM API key) → registers Memkin as an **auto-starting background service**, and wires memory into the AI agents already on your machine (Claude Code, Codex, Hermes/OpenClaw).

Just want to try it without a background service?

```bash
npx memkin start     # no config? it walks you through setup, then serves + opens the Web UI
```

Day-to-day management and full uninstall:

```bash
memkin status        # background service status
memkin down          # stop the service and disable autostart
memkin down && memkin uninstall && npm rm -g memkin    # remove everything
```

> Prerequisite: [Node.js](https://nodejs.org) >= 18 (the install script handles it). More commands in the [📘 CLI reference](docs/cli.md) *(Chinese)*.

## Three Pillars

**🕸️ You are the sum of your relationships**
Memory is not a pile of vector chunks. Signals are anchored to entities (people, projects, tools) and linked in a directed graph — you get answers *with context*: who, why, and what it relates to.

**🔒 Your data never leaves your machine**
Everything lives in an embedded PGLite database on your disk, with optional local embeddings via Ollama — zero cloud dependency. Dual-track privacy redaction (reversible / irreversible) scrubs sensitive data before anything is written.

**🤖 Agents read *and* write**
Built around **15 high-intent MCP tools** (`query` / `recall` / `synthesize` / `prep_for_person` / `daily_report` …), any agent can query your history and write new decisions and discoveries back. The more your agents work, the better your memory knows you.

## Why

Your working memory lives in two places, and your AI agents can't reach either: **work chat** (Feishu/Lark: DMs, group chats, email, meetings, docs, tasks) holds what you're doing and with whom; **AI agents** (Claude Code, Codex, OpenClaw) hold how you build — every decision, discovery, and dead-end from your coding sessions. Yet every new session starts from zero, and you re-explain who you are, what the project is, and what was decided last week.

**You don't have a bad memory. Your information is fragmented — and your agents pay for it every day.**

Memkin extracts those conversations into structured signals (entities, decisions, tasks, discoveries, knowledge, relations), folds them into one searchable knowledge graph on your own machine, and feeds that memory back to any agent over **MCP**:

> "Yesterday I discussed a proposal with a colleague on Feishu, today I implemented part of it in Claude Code, and there's a review meeting next week."
>
> Memkin connects all three — across platforms and time — and hands the full thread to your agent when you need it.

<p align="center">
  <img src="docs/assets/web-ui-graph.jpeg" alt="Memkin knowledge graph — entities, decisions, tasks, and knowledge interconnected across your work" width="850">
  <br>
  <em>Your work as a living knowledge graph — people, decisions, tasks, knowledge, all connected.</em>
</p>

## What You Can Ask

> Memkin doesn't just answer "what do I know" — it answers "**what should I do**", with `[n]` citations back to the source.

**🌟 Prep before you meet someone**
*"I'm meeting Mr. Zhang tomorrow to discuss a renewal price increase — what should I watch out for?"* — `prep_for_person` **passively infers** a communication profile from your real interactions (direct or diplomatic? data-driven or relationship-driven? any landmines?), conditions it on your goal, and flags gaps (*"no new signal from him in 18 days — the profile may be stale"*). No questionnaires; the profile never leaves your machine.

**📋 One-line cross-channel daily report**
*"Generate today's report"* — `daily_report` gathers today's signals scattered across DMs, group chats, email, meeting minutes, and calendar into 7 sections: decisions / in progress / my todos / needs-reply & mentions / people updates / tomorrow's reminders.

**🔧 Troubleshoot by playbook**
*"Why won't the driving assistant activate?"* — `troubleshoot` walks the playbook's diagnostic chain in order and explains what each outcome means. Playbooks can be curated by hand or auto-drafted from past troubleshooting conversations.

**⚡ Hand a project to an agent in seconds**
*"Where does the memkin project stand?"* — `get_session_context` pulls aggregated decisions, open tasks, and the recent timeline. No re-explaining.

**🔎 Recall a person or a thread**
*"What did I discuss with this colleague last week?"* — DMs, meetings, and follow-up tasks, stitched into one cited answer.

## Only Using Claude Code / Codex?

You don't need Feishu at all — turn your AI coding sessions into persistent, cross-project memory:

```bash
npx memkin start                          # enable only the claude-code / codex sources in the wizard
npx memkin extract --source claude-code   # extract session history into memory
npx memkin install --agent claude-code    # wire up the agent (MCP config + memory instructions)
npx memkin hooks install                  # (optional) auto-inject recent decisions into new sessions
```

Reopen your client and ask *"what did we decide on this project last week?"* — the agent answers from your local memory.

## Core Features

| | |
|---|---|
| 🛰️ **Full Feishu/Lark capture** | 7 sources: DMs, group chats, email, calendar, docs, tasks, message search → [📘 Feishu guide](docs/feishu.md) *(Chinese)* |
| 🤖 **Agent-native (MCP)** | 15 high-intent tools (36 total), stdio + Streamable HTTP, one-command install into popular clients → [📘 MCP guide](docs/mcp.md) *(Chinese)* |
| 🧠 **AI signal extraction** | LLM pipeline distills 7 signal types from raw conversations, two-layer noise filtering, full provenance |
| 🔍 **Hybrid semantic search** | Full-text (tsvector, CJK-friendly) + vectors (pgvector), fused with RRF |
| ♻️ **Memory consolidation** | hot → warm → cold tier rotation, dead-link repair, preference inference |
| ⏰ **Always-on background service** | `memkin up` registers a boot-time daemon: scheduled capture, run history, alerts |
| 🔗 **Obsidian two-way sync** | Export memory as a Markdown vault, edit, import back |
| 🕸️ **Knowledge graph + Web UI** | Dashboard, timeline, force-directed graph, search — all in the browser |

Full capability inventory: [📘 Features](docs/features.md) *(Chinese)* · Configuration: [📘 Config reference](docs/configuration.md) *(Chinese)*.

## Architecture

Memkin is **5 vertical layers + 3 cross-cutting concerns**: sources are captured, distilled into signals, stored locally, and served back out; person identity, memory consolidation, and scheduling cut across.

<p align="center">
  <img src="docs/assets/architecture.png" alt="Memkin architecture — 5-layer vertical data flow + 3 cross-cutting concerns" width="920">
</p>

| Layer | In one line |
|-------|-------------|
| ① Setup & config | TUI config center / browser wizard, auto-detection, live connection tests |
| ② Capture | 7 Feishu sources + Claude Code / Codex / Hermes, incremental + backfill |
| ③ Signal extraction | Chunking → two-layer noise filter → LLM extraction → scoring → privacy redaction |
| ④ Memory store | PGLite + pgvector, hybrid retrieval (FTS + vectors + RRF) |
| ⑤ Interfaces | CLI · MCP · REST API · Web UI · Obsidian |

> Platforms: macOS / Linux / Windows (embedded PGLite by default — zero setup). The optional self-managed local Postgres engine (faster) supports macOS (arm64/x64) and Linux (x64/arm64). Layer details, signal types, MCP tool list, and store internals: [📘 Architecture](docs/architecture.md) / [📘 MCP guide](docs/mcp.md) *(Chinese)*.

## 🙏 Standing on Shoulders — and Where We Differ

Memkin didn't appear out of thin air. It stands on some excellent projects:

- **[lark-cli](https://github.com/larksuite/cli)** — the official CLI for the Feishu/Lark open platform. Memkin's user-mode Feishu capture (DMs / message search) is built directly on top of it. Literal bedrock.
- **[GBrain](https://github.com/garrytan/gbrain)** — Garry Tan's agent memory system. Its brain-first retrieval conventions, self-wiring knowledge graph, cited synthesis, and gap analysis deeply influenced Memkin's design.
- **[OpenHuman](https://github.com/tinyhumansai/openhuman)** — a local-first personal AI. Its Memory Tree hierarchical compression and Obsidian vault interop shaped much of our thinking.
- **[mem0](https://github.com/mem0ai/mem0)** — the pioneer of the agent memory layer, which proved to the whole field that giving agents memory is worth doing.

On those foundations, Memkin takes its own path: **Chinese workplace tools (Feishu/Lark) are first-class citizens** (DMs, group chats, email, meetings, docs, tasks — full capture); **local-first with zero cloud dependencies** (your data never leaves your machine); **agents read *and* write over MCP** (memory grows as it's used).

## Common Commands

| Command | What it does |
|---------|--------------|
| `memkin start` | One-shot start (auto-runs setup if unconfigured) |
| `memkin up` / `down` / `status` | Background service: register autostart / stop / status |
| `memkin install` | Wire MCP config + memory instructions into AI clients |
| `memkin extract --source <name>` | Extract signals from a source |
| `memkin search <query>` | Search your memory |
| `memkin doctor` | Diagnose environment & connectivity |

Full command reference: [📘 CLI](docs/cli.md) *(Chinese)*.

## Roadmap

- [ ] **More workplace sources**: DingTalk, WeCom (enterprise WeChat), WeChat history, local documents
- [ ] **Extraction quality**: cross-block shared context (ContextBuffer), weighted admission scoring, entity-centric narratives
- [ ] **Natural-language Q&A** over the memory store
- [ ] **Web UI**: memory editing (currently read-only), provenance audit view

## Community & Support

- 🐛 Found a bug or have a feature request? [Open an issue](https://github.com/AndreLYL/memkin/issues).
- 💡 Questions and ideas are welcome in the issue tracker.
- ⭐ If Memkin helps you, give it a star — it's the best way to support the project.

Development guide: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
