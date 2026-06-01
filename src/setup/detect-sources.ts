import { existsSync, readdirSync, type Stats, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DetectedSource {
  id: "claude-code" | "codex" | "hermes";
  name: string;
  detected: boolean;
  path?: string;
  message: string;
}

interface DetectSourcesOptions {
  homeDir?: string;
  maxDepth?: number;
}

function hasJsonlFile(dir: string, maxDepth: number): boolean {
  if (maxDepth < 0) return false;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    throw new Error("Cannot read directory");
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat: Stats;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isFile() && entry.endsWith(".jsonl")) {
      return true;
    }
    if (stat.isDirectory() && hasJsonlFile(fullPath, maxDepth - 1)) {
      return true;
    }
  }

  return false;
}

export function detectSources(options: DetectSourcesOptions = {}): DetectedSource[] {
  const home = options.homeDir ?? homedir();
  const maxDepth = options.maxDepth ?? 4;
  const sources: DetectedSource[] = [
    {
      id: "claude-code",
      name: "Claude Code",
      detected: false,
      path: join(home, ".claude", "projects"),
      message: "Not found",
    },
    {
      id: "codex",
      name: "Codex",
      detected: false,
      path: join(home, ".codex"),
      message: "Not found",
    },
    {
      id: "hermes",
      name: "Hermes",
      detected: false,
      path: join(home, ".openclaw", "agents"),
      message: "Not found",
    },
  ];

  for (const source of sources) {
    if (!source.path || !existsSync(source.path)) {
      continue;
    }

    try {
      source.detected = hasJsonlFile(source.path, maxDepth);
      source.message = source.detected
        ? `Found sessions at ${source.path}`
        : "Directory exists but no sessions";
    } catch {
      source.detected = false;
      source.message = "Cannot read directory";
    }
  }

  return sources;
}
