# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-26

### Added

- **Storage Layer**: PGLite embedded PostgreSQL with pgvector for local-first storage
  - PageStore: Wiki-style pages with YAML frontmatter, CRUD, content hashing
  - ChunkStore: Recursive text chunking (300 words, 50-word overlap) with embedding reuse
  - SearchEngine: Full-text search (`tsvector` with `simple` tokenizer) + vector cosine search
  - Hybrid Search: Reciprocal Rank Fusion (RRF) combining FTS + vector results, compiled_truth boost (2.0x), backlink boost
  - GraphStore: Directed link graph with BFS traversal, link types, backlinks
  - TagStore: Page tagging with conflict-safe upserts
  - TimelineStore: Chronological entries per page with dedup
  - EmbeddingService: Batch embedding via OpenAI or Ollama, stale-chunk detection
- **Server**: Hono REST API exposing all store operations
- **MCP Server**: 17 stdio tools for pages, search, graph, tags, timeline, embeddings, and health
- **StoreAdapter**: Extraction pipeline writes signals directly to PGLite (replaces file-based output)
- **CLI Commands**: `memoark serve` (HTTP + MCP), `memoark search`, `memoark embed`
- **Config**: Store, embedding, and server configuration sections with env var interpolation
- Knowledge signal type (7th signal type): reusable facts with provenance and confidence

### Changed

- Renamed CLI from `dbe` to `memoark`
- Default adapter changed from `stdout` to `store`
- Package description updated to "Local-first personal memory extraction and storage"

## [0.1.0] - 2026-05-18

### Added

- Core extraction pipeline: Collector → BlockBuilder → NoiseFilter → SignalExtractor → Privacy → Formatter → Adapter
- Three platform collectors: Claude Code, Codex, Hermes
- Six signal types: entities, timeline, decisions, tasks, discoveries, links
- LLM-powered noise filtering (L1 rules + L2 LLM scoring)
- LLM-powered signal extraction with structured JSON output
- Privacy processor with reversible and irreversible redaction modes
- JSON and Markdown output formatters
- File, GBrain, and Stdout output adapters
- CLI with `extract`, `doctor`, `config init`, `sources list`, `sources test` commands
- Dedup store for message deduplication
- Configuration via `dbe.yaml` with environment variable interpolation
- 252 tests covering core components, pipeline integration, CLI, and golden output
- Apache 2.0 license
- English and Chinese documentation
