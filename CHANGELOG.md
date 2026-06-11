# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-06-10

### Changed

- Published under the scoped name **`@andre.li/memoark`** — npm blocks the unscoped `memoark` as too similar to the existing `remark` package. Install with `npx @andre.li/memoark` / `npm i -g @andre.li/memoark`; the command is still `memoark`. (0.3.0 was never published.)

## [0.3.0] - 2026-06-09

### Added

- **npm distribution**: published to npm — install with `npx memoark` or `npm i -g memoark` (no clone/`npm link` needed). Requires Node.js >= 18.
- **Automated releases**: `.github/workflows/release.yml` publishes to npm (with provenance) and creates a GitHub Release on a `v*` tag; includes a `node dist/cli.js --help` smoke gate. See `RELEASING.md`.

### Fixed

- **Packaging**: the built `dist/` (and a future `bun --compile` binary) now run on plain Node. Migrations are inlined as constants instead of read from `.sql` files that were never shipped (fixed `ENOENT 001_lifecycle_columns.sql`), and 14 relative imports got explicit `.js` extensions (fixed `ERR_MODULE_NOT_FOUND` under Node ESM). The previously failing `cli.test` now passes.

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
