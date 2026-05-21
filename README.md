# DigitalBrainExtractor (DBE)

English | [中文](README.zh-CN.md)

CLI tool to extract structured signals from communication platforms and AI agent sessions, converting raw conversations into machine-readable knowledge graphs.

## Overview

DigitalBrainExtractor transforms unstructured conversation data into structured signals—entities, relationships, decisions, tasks, and discoveries—that feed into knowledge management systems like GBrain. Perfect for teams using Claude Code agents or other AI-driven workflows where conversation becomes source material for organizational memory.

## Architecture

```
Collector              Dedup              BlockBuilder           NoiseFilter
(Platform-specific)   (Avoid duplicates)  (Group messages)       (Significance)
     ↓                    ↓                    ↓                      ↓
   Raw                 Deduplicated       Conversation          Filtered
  Messages             Messages            Blocks               Blocks
                                                                    ↓
                                                         ┌──────────┴──────────┐
                                                         ↓                     ↓
                                                  SignalExtractor      Privacy Processor
                                                  (LLM-powered)        (Dual-track)
                                                         ↓                     ↓
                                                   Extraction Result   Redacted Results
                                                         ↓                     ↓
                                                      ┌──┴──────────────────┐
                                                      ↓                     ↓
                                                   Formatters            Adapters
                                                (JSON/Markdown)    (File/GBrain/Stdout)
                                                      ↓                     ↓
                                                   Output              Storage
```

### Pipeline Stages

1. **Collector**: Fetches raw messages from configured sources (Claude Code, Codex, Hermes)
2. **Dedup Store**: Eliminates duplicate messages using content hashing
3. **Block Builder**: Groups chronologically-adjacent messages into conversation blocks
4. **Noise Filter**: Uses LLM to assess block significance
5. **Signal Extractor**: Extracts entities, decisions, tasks, links, and discoveries (LLM-powered)
6. **Privacy Processor**: Dual-track redaction (reversible + irreversible)
7. **Formatter**: Converts extraction results to JSON or Markdown
8. **Adapter**: Pushes to file system, GBrain, or stdout

## Quick Start

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd digitalbrain-extractor

# Install dependencies (requires Bun)
bun install

# Make CLI available
bun link
```

### 1. Initialize Configuration

```bash
dbe config init
```

This creates `dbe.yaml` with sensible defaults. Edit to customize:

```bash
vim dbe.yaml
```

### 2. Check Setup

```bash
dbe doctor
```

Diagnoses configuration, state directory, and LLM connectivity.

### 3. List Available Sources

```bash
dbe sources list
```

### 4. Test Source Connectivity

```bash
dbe sources test claude-code
```

### 5. Run First Extraction

```bash
dbe extract --source claude-code --format json --adapter stdout
```

For dry-run (no output writes):

```bash
dbe extract --source claude-code --dry-run
```

## CLI Commands

### `dbe extract`

Main command: extract signals from a source.

```bash
dbe extract \
  --source <name> \
  --format json|markdown \
  --adapter file|gbrain|stdout \
  --output <dir> \
  --since <ISO-8601-date> \
  --limit <n> \
  --dry-run
```

**Options:**

- `--source <name>` (**required**): Source name (e.g., `claude-code`)
- `--config <path>`: Config file path (default: `dbe.yaml`)
- `--format <type>`: Output format—`json` (structured) or `markdown` (human-readable); default: `json`
- `--adapter <type>`: Where to send results—`file`, `gbrain`, or `stdout`; default: `stdout`
- `--output <dir>`: Output directory for file adapter (default: current working directory)
- `--since <ISO-8601-date>`: Process only messages after this date (e.g., `2025-05-15T10:00:00Z`)
- `--limit <n>`: Maximum messages to process (useful for testing)
- `--dry-run`: Test pipeline without writing outputs

**Examples:**

```bash
# Extract and print to stdout (preview)
dbe extract --source claude-code --format markdown

# Extract and save to JSON files
dbe extract --source claude-code --format json --adapter file --output ./exports

# Extract and push to GBrain
dbe extract --source claude-code --adapter gbrain

# Extract with filters
dbe extract --source claude-code --since 2025-05-01 --limit 1000 --dry-run
```

### `dbe doctor`

Diagnose configuration and setup issues.

```bash
dbe doctor [--config <path>]
```

Checks:

- Configuration file exists and parses correctly
- State directory (`.dbe/`) is accessible
- LLM provider and API keys are configured
- Environment variables are set

Output example:

```
=== DBE Diagnostic Report ===

✓ OK:
  Configuration file found: dbe.yaml
  Configuration loaded successfully
  LLM provider configured: openai / gpt-4o-mini
  OpenAI API key configured

No critical issues found.
```

### `dbe config init`

Generate a `dbe.yaml` template in the current directory.

```bash
dbe config init
```

Creates a fully-commented template with sensible defaults. Adjust for your environment.

### `dbe sources list`

List all available data sources.

```bash
dbe sources list
```

Output:

```
Available sources:

  claude-code
    Description: Claude Code agent conversation transcripts
    Default location: ~/.claude/projects/
```

### `dbe sources test <name>`

Test connectivity and health of a source.

```bash
dbe sources test claude-code
```

Verifies the source is accessible and responding correctly.

## Configuration

### `dbe.yaml` Structure

```yaml
# Privacy configuration
privacy:
  enabled: true                    # Enable/disable privacy processing
  mode: reversible                 # reversible or irreversible
  redact_phone: true               # Mask phone numbers
  redact_id_card: true             # Mask ID card numbers
  redact_bank_card: true           # Mask bank card numbers
  redact_email: false              # Mask email addresses
  redact_url: false                # Mask URLs
  blocked_words: []                # Additional words to redact (array)
  replacement: "[REDACTED]"        # String to replace redacted content

# LLM provider configuration
llm:
  provider: openai                 # openai or mock
  model: gpt-4o-mini               # Model name
  base_url: https://api.openai.com/v1  # Optional: custom endpoint
  api_key: ${OPENAI_API_KEY}       # Optional: can use env var interpolation

# Block builder settings
block_builder:
  block_gap_minutes: 30            # Time gap to start a new block (minutes)
  max_block_tokens: 4000           # Max tokens per block
  max_block_messages: 100          # Max messages per block

# Adapter configuration
adapters:
  file:
    enabled: false
    output_dir: ./output
  gbrain:
    enabled: false
    output_dir: ./gbrain-output
```

### Environment Variable Interpolation

Config values can reference environment variables using `${VAR_NAME}` syntax:

```yaml
llm:
  api_key: ${OPENAI_API_KEY}       # Will use process.env.OPENAI_API_KEY
```

### Privacy Configuration

#### Reversible Mode

Preserves the original content in a mapping file, allowing recovery later:

```yaml
privacy:
  mode: reversible
  redact_phone: true
  redact_email: true
```

Outputs both:
- **Redacted content** for processing
- **Reversibility map** (encrypted or protected) for authorized recovery

#### Irreversible Mode

Permanently removes sensitive content:

```yaml
privacy:
  mode: irreversible
  redact_bank_card: true
  blocked_words: [proprietary, secret, internal]
```

Once redacted, data cannot be recovered.

### LLM Provider Configuration

#### OpenAI

```yaml
llm:
  provider: openai
  model: gpt-4o-mini
  base_url: https://api.openai.com/v1  # Optional, for proxies
  api_key: ${OPENAI_API_KEY}           # Via env var or direct
```

Set API key via environment:

```bash
export OPENAI_API_KEY=sk-...
dbe extract --source claude-code
```

Or in config:

```yaml
llm:
  api_key: sk-...  # Not recommended; use env var instead
```

#### Mock Provider (Testing)

```yaml
llm:
  provider: mock
  model: fake-model
```

Useful for dry-runs and testing without API costs.

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
- **Data**: Multi-agent sessions with automatic sub-agent discovery (main, coder, writer, etc.)

### Extract from all sources

```bash
dbe extract --source all --adapter file --output ./exports
```

## Output Formats

### JSON Format

Structured extraction results—ideal for programmatic processing:

```json
{
  "source": {
    "platform": "claude-code",
    "channel": "project/my-feature",
    "timestamp": "2025-05-19T10:30:00Z",
    "raw_hash": "abc123..."
  },
  "entities": [
    {
      "slug": "auth-middleware",
      "name": "Authentication Middleware",
      "type": "concept",
      "context": "JWT token validation",
      "confidence": "direct"
    }
  ],
  "timeline": [
    {
      "date": "2025-05-19",
      "summary": "Implemented JWT refresh token rotation",
      "entities": ["auth-middleware"],
      "confidence": "direct"
    }
  ],
  "links": [
    {
      "from": "auth-middleware",
      "to": "security-audit",
      "type": "mentions",
      "context": "Part of security review",
      "confidence": "direct"
    }
  ],
  "decisions": [
    {
      "summary": "Use httpOnly cookies for JWT storage",
      "reasoning": "Prevents XSS token theft",
      "entities": ["auth-middleware"],
      "date": "2025-05-19",
      "confidence": "direct"
    }
  ],
  "tasks": [
    {
      "title": "Write unit tests for token rotation",
      "status": "in_progress",
      "owner": "engineering",
      "due_date": "2025-05-25",
      "confidence": "direct"
    }
  ],
  "discoveries": [
    {
      "summary": "Refresh tokens need separate rotation logic",
      "type": "pattern",
      "entities": ["auth-middleware"],
      "confidence": "inferred"
    }
  ]
}
```

### Markdown Format

Human-readable summary format—ideal for review and documentation:

```markdown
# Extraction Summary

**Source**: claude-code / project/my-feature  
**Date**: 2025-05-19 10:30:00 UTC  
**Confidence**: direct

## Entities

- **Authentication Middleware** (concept)
  - Context: JWT token validation

## Timeline

- **2025-05-19**: Implemented JWT refresh token rotation

## Decisions

- **Use httpOnly cookies for JWT storage**
  - Reasoning: Prevents XSS token theft

## Tasks

- [ ] Write unit tests for token rotation (in_progress, due 2025-05-25)

## Discoveries

- Refresh tokens need separate rotation logic (pattern)
```

## Adapters

### File Adapter

Writes extraction results to disk:

```bash
dbe extract --source claude-code --format json --adapter file --output ./exports
```

Creates:
- `exports/extraction-{timestamp}.json`
- One file per extraction for easy organization

### GBrain Adapter

Pushes results directly to your GBrain knowledge graph:

```bash
dbe extract --source claude-code --adapter gbrain
```

Creates or updates GBrain pages for:
- **Entities** → `claude/{platform}/{entity-slug}`
- **Timeline entries** → appended to entity pages
- **Decisions** → `claude/decisions/{topic}`
- **Tasks** → `claude/tasks/{task-slug}`
- **Discoveries** → `claude/discoveries/{type}/{topic}`

Requires GBrain to be accessible at default location or configured in `dbe.yaml`.

### Stdout Adapter

Prints results directly to terminal (useful for testing):

```bash
dbe extract --source claude-code --format markdown --adapter stdout
```

## Privacy & Dual-Track Redaction

DBE supports **dual-track redaction** to balance privacy with recoverability:

### Reversible Mode (Default)

Original content is preserved in an encrypted or protected reversibility map, allowing authorized personnel to recover redacted values.

**Use case**: Internal company communications where privacy is important but recovery may be needed for audits or investigations.

```yaml
privacy:
  enabled: true
  mode: reversible
  redact_phone: true
  redact_email: true
  replacement: "[REDACTED]"
```

Outputs:
- **Scrubbed data** for processing and storage
- **Reversibility map** (stored separately or encrypted) for authorized recovery

### Irreversible Mode

Redactions are permanent—no recovery possible.

**Use case**: GDPR-compliant processing, public datasets, maximum privacy.

```yaml
privacy:
  enabled: true
  mode: irreversible
  redact_email: true
  redact_phone: true
  blocked_words: [proprietary, confidential]
  replacement: "[REDACTED]"
```

Once applied, redacted values cannot be recovered.

## Development

### Project Structure

```
digitalbrain-extractor/
├── src/
│   ├── cli.ts                     # CLI entry point (Commander.js)
│   ├── core/
│   │   ├── types.ts               # Core TypeScript interfaces
│   │   ├── config.ts              # Configuration loader
│   │   ├── pipeline.ts            # Pipeline orchestration
│   │   ├── state.ts               # State directory management
│   │   ├── dedup.ts               # Deduplication store
│   │   ├── cursors.ts             # Pagination cursors
│   │   ├── block-builder.ts        # Message blocking logic
│   │   └── schemas.ts             # Zod validation schemas
│   ├── collectors/
│   │   ├── index.ts               # Collector registry
│   │   └── agent/
│   │       ├── claude-code.ts      # Claude Code collector
│   │       ├── codex.ts            # Codex collector
│   │       └── hermes.ts           # Hermes collector
│   ├── extractors/
│   │   ├── signal-extractor.ts     # LLM-powered extraction
│   │   ├── noise-filter.ts         # Significance filtering
│   │   └── providers/
│   │       ├── types.ts            # LLM provider interface
│   │       └── index.ts            # Provider factory
│   ├── processors/
│   │   └── privacy.ts              # Privacy processor
│   ├── formatters/
│   │   ├── index.ts                # Formatter registry
│   │   ├── json.ts                 # JSON formatter
│   │   └── markdown.ts             # Markdown formatter
│   └── adapters/
│       ├── index.ts                # Adapter registry
│       ├── file.ts                 # File adapter
│       ├── gbrain.ts               # GBrain adapter
│       └── stdout.ts               # Stdout adapter
├── tests/                          # Test files
│   ├── cli.test.ts
│   ├── fixtures/                   # Test data
│   └── golden/                     # Expected outputs
├── dbe.yaml                        # Configuration template
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### Running Tests

```bash
# Run all tests
bun run test

# Watch mode (re-run on file changes)
bun run test:watch

# Run specific test file
bun run test -- path/to/test.ts
```

Tests use Vitest and include:
- Unit tests for core components (dedup, block builder, privacy)
- Integration tests for pipeline
- CLI argument parsing tests
- Golden output validation tests

### Building

```bash
# Build to standalone executable
bun run build

# Output: dist/cli.js (can be run directly with `bun dist/cli.js`)
```

### Development Workflow

1. **Modify code** in `src/`
2. **Run tests** to verify: `bun run test:watch`
3. **Test CLI** locally: `bun src/cli.ts extract --source claude-code --dry-run`
4. **Commit changes**: Use conventional commits

## Troubleshooting

### No data being extracted

```bash
dbe doctor
```

Check:
- Configuration file syntax (YAML must be valid)
- LLM provider and API key are set
- Source is accessible (`dbe sources test claude-code`)

### "Configuration loading failed"

Validate YAML syntax:

```bash
cat dbe.yaml | yq .
```

Or check for common issues:
- Missing colons after keys
- Inconsistent indentation (use 2 spaces, not tabs)
- Unclosed quotes

### LLM API errors

Check API key is set:

```bash
# OpenAI
echo $OPENAI_API_KEY

# Or verify in config
grep api_key dbe.yaml
```

### Pipeline hangs or times out

Reduce load:

```bash
# Process fewer messages
dbe extract --source claude-code --limit 100 --dry-run

# Check block builder settings
vim dbe.yaml  # Increase block_gap_minutes or reduce max_block_messages
```

## Contributing

Contributions welcome! Ensure:

- Code passes `bun run test`
- CLI changes are documented in help text
- New extractors follow the `Collector` interface
- New adapters follow the `Adapter` interface

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
