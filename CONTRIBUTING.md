# Contributing to Memkin

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/AndreLYL/memkin.git
cd memkin

# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Run tests
bun run test

# Run linter
bun run lint
```

## Project Structure

See [README.md](README.md) for the full architecture and directory layout.

## Workflow

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run `bun run lint` and fix any issues
4. Run `bun run test` and ensure all tests pass
5. Commit using [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`)
6. Open a Pull Request against `main`

## Adding a New Collector

1. Create a parser in `src/collectors/agent/` implementing the `SessionParser` interface
2. Register it in `src/collectors/index.ts`
3. Add configuration in `memkin.yaml` under `sources:`
4. Add tests covering parsing and edge cases
5. Update `sources list` and `sources test` CLI output

## Adding a New Adapter

1. Create a file in `src/adapters/` implementing the `Adapter` interface (healthCheck + push)
2. Wire it into the CLI `--adapter` option in `src/cli.ts`
3. Add tests for push and healthCheck
4. Document configuration in README

## Code Style

- Biome handles linting and formatting — run `bun run lint:fix` before committing
- TypeScript strict mode
- ESM imports (`import`/`export`, no `require`)
- Use `node:` prefix for Node.js built-in modules

## Tests

```bash
bun run test              # Run all tests
bun run test:watch        # Watch mode
bun run test -- path/to   # Run specific test file
```

## Reporting Issues

Use [GitHub Issues](https://github.com/AndreLYL/memkin/issues). Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Bun version, Node version)
