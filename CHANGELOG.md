# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- SourceRef v2 core and extension fields with schema parity, compact provenance handling, participant metadata, and cross-source source type support.
- Unified MemoryFilter support for MCP `query`, `search`, and `timeline_feed`, including platform, source type, channel, participant, date, type, exclude type, and bounded limit filters.
- Preferred MCP memory tools: `get_page_context`, `timeline_feed`, `explore_graph`, `manage_links`, and `manage_tags`.
- MCP contract tests using the SDK in-memory client transport to verify tool listing, tool descriptions, package version alignment, legacy tool gating, and structured errors.
- MCP Resources for `memoark://health`, `memoark://pages`, page content, page context, and page timeline.
- MCP Prompts for recall, weekly digest, person brief, decision log, and project handoff workflows.
- Structured MCP tool output schemas and `structuredContent` for core read/health tools while preserving stable JSON text responses.
- Streamable HTTP MCP app with origin, host, bearer-token, and read-only tool gating.
- MCP eval fixtures and a contract eval runner covering tool selection constraints, source-specific tool bans, read-only mode, and source-filtered timeline behavior.

### Changed

- MCP tools now register with titles, descriptions, parameter descriptions, stable JSON text responses, recoverable structured errors, and package-version server metadata.
- MCP legacy CRUD/debug tools are hidden by default and can be exposed with `mcp.expose_legacy_tools=true`.
- `put_page` now performs idempotent writes and skips rechunking when content is unchanged.
- Search results now include provenance when page frontmatter contains `source` or `first_seen`.
- Timeline and graph upserts now keep latest provenance/source hash when new provenance is provided, while preserving existing provenance for provenance-less updates.
- Date-only `to` filters now cover the full day, while datetime `to` filters use the exact timestamp bound.
- Hybrid query chunk searches now use parameterized candidate limits instead of hard-coded SQL limits.
- `memoark serve` can run MCP Streamable HTTP via `--mcp-http`, `mcp.http.enabled`, or `server.mcp_transport=streamable_http`; stdio remains the default MCP path.

### Fixed

- Configuration discovery now resolves `memoark.yaml` from `--config`, `MEMOARK_CONFIG`, or parent directories, and state files now anchor to the resolved config root to avoid cross-directory cursor/dedup splits.
- Missing environment variables referenced by `${VAR}` placeholders are preserved and reported per command instead of being silently replaced with empty strings.
- The CLI binary now falls back to the current Node runtime when Bun is unavailable, while `memoark serve` can run through `@hono/node-server`.
- Runtime resource loading for schema and prompt files now reports explicit build asset errors when packaged files are missing.
- Setup command registration now reports `npm link` failures before falling back to a shell alias.
- Store writes for timeline entries, graph links, and tags now fail when target page slugs are missing instead of silently reporting success after zero-row inserts.
- Preferred MCP tools now all declare output schemas, and write tools return structured content on successful calls.
- MCP write tools now validate incoming provenance objects and return recoverable `INVALID_ARGUMENT` errors for invalid SourceRef input.
- MCP Streamable HTTP transport connection failures now return structured JSON errors instead of escaping as raw exceptions.

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
