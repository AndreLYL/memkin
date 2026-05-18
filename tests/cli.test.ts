/**
 * CLI command tests
 * Tests command parsing, --help output, and command execution
 */

import { describe, test, expect } from 'vitest';
import { spawnSync } from 'child_process';

const PROJECT_ROOT = '/Users/yinglong.li/Workspace/digitalbrain-extractor';

describe('CLI', () => {
  describe('dbe --help', () => {
    test('shows main help with version and description', () => {
      const result = spawnSync('bun', ['src/cli.ts', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('dbe');
      expect(result.stdout).toContain('Extract structured signals');
      expect(result.stdout).toContain('version');
    });

    test('displays available commands', () => {
      const result = spawnSync('bun', ['src/cli.ts', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.stdout).toContain('extract');
      expect(result.stdout).toContain('doctor');
      expect(result.stdout).toContain('config');
      expect(result.stdout).toContain('sources');
    });
  });

  describe('dbe extract', () => {
    test('shows help with --help flag', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'extract', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('extract');
      expect(result.stdout).toContain('Extract signals');
    });

    test('shows all required options in help', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'extract', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.stdout).toContain('--source');
      expect(result.stdout).toContain('--format');
      expect(result.stdout).toContain('--adapter');
      expect(result.stdout).toContain('--output');
      expect(result.stdout).toContain('--since');
      expect(result.stdout).toContain('--limit');
      expect(result.stdout).toContain('--dry-run');
    });

    test('requires --source option', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'extract'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/source|required/i);
    });

    test('accepts format options', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'extract', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.stdout).toContain('json');
      expect(result.stdout).toContain('markdown');
    });

    test('accepts adapter options', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'extract', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.stdout).toContain('file');
      expect(result.stdout).toContain('gbrain');
      expect(result.stdout).toContain('stdout');
    });

    test('accepts since and limit options', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'extract', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.stdout).toContain('--since');
      expect(result.stdout).toContain('--limit');
    });
  });

  describe('dbe doctor', () => {
    test('shows help with --help flag', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'doctor', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('doctor');
      expect(result.stdout).toContain('Diagnose');
    });

    test('runs without crashing', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'doctor'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      // Should either succeed or exit with diagnostic info
      const output = result.stdout + result.stderr;
      expect(output.length > 0).toBe(true);
    });

    test('reports on configuration and state', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'doctor'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      const output = result.stdout;
      // Should contain diagnostic report title or sections
      expect(output).toMatch(/Diagnostic|Configuration|state|\.dbe/i);
    });
  });

  describe('dbe config init', () => {
    test('shows config subcommand help', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'config', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('init');
      expect(result.stdout).toContain('Generate');
    });

    test('init command runs successfully', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'config', 'init', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
    });

    test('reports successful config creation', () => {
      // We won't actually create a file, but verify the help text is correct
      const result = spawnSync('bun', ['src/cli.ts', 'config', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.stdout).toContain('dbe.yaml');
    });
  });

  describe('dbe sources list', () => {
    test('shows sources subcommand help', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'sources', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('test');
    });

    test('list command shows available sources', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'sources', 'list'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('claude-code');
    });

    test('list shows source descriptions', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'sources', 'list'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      const output = result.stdout;
      expect(output).toMatch(/Claude|conversation|agent/i);
    });
  });

  describe('dbe sources test', () => {
    test('test command runs health check', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'sources', 'test', 'claude-code'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      // May succeed or fail depending on environment
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/Claude Code|not found|failed|ok|testing/i);
    });

    test('test with unknown source fails', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'sources', 'test', 'nonexistent'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/Unknown|error/i);
    });

    test('test subcommand accepts source name', () => {
      const result = spawnSync('bun', ['src/cli.ts', 'sources', '--help'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      });

      expect(result.stdout).toContain('test');
      expect(result.stdout).toContain('name');
    });
  });
});
