/**
 * State directory management for DigitalBrainExtractor
 * Ensures .dbe/ directory exists and provides path utilities
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Ensure state directory exists (creates .dbe/ in base directory)
 * Uses mkdir -p equivalent to create all intermediate directories
 *
 * @param base - Base directory path (default: current working directory)
 * @returns Full path to the state directory
 */
export function ensureStateDir(base?: string): string {
  const baseDir = base || process.cwd();
  const stateDir = resolve(baseDir, '.dbe');

  mkdirSync(stateDir, { recursive: true });

  return stateDir;
}

/**
 * Get full path for a state file
 * Returns .dbe/{filename} path without creating directories
 * Call ensureStateDir() first to ensure the directory exists
 *
 * @param filename - Name of the state file (e.g., 'cursors.yaml', 'checkpoints.jsonl')
 * @returns Full path to the state file
 */
export function statePath(filename: string): string {
  const stateDir = resolve(process.cwd(), '.dbe');
  return resolve(stateDir, filename);
}
