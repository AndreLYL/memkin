import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DetectedApiKeys {
  openai?: string;
  anthropic?: string;
  source: string;
}

interface DetectApiKeysOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

function findExport(content: string, name: string): string | undefined {
  const match = content.match(new RegExp(`(?:export\\s+)?${name}=["']?([^"'\\n]+)["']?`));
  return match?.[1]?.trim();
}

export function detectApiKeys(options: DetectApiKeysOptions = {}): DetectedApiKeys {
  const env = options.env ?? process.env;
  const keys: DetectedApiKeys = {
    openai: env.OPENAI_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    source: "none",
  };

  if (keys.openai || keys.anthropic) {
    keys.source = "environment";
    return keys;
  }

  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return { source: "none" };
  }

  const home = options.homeDir ?? homedir();
  const shellFiles = [".zshrc", ".bashrc", ".bash_profile", ".profile"];

  for (const file of shellFiles) {
    const shellPath = join(home, file);
    if (!existsSync(shellPath)) continue;

    try {
      const content = readFileSync(shellPath, "utf-8");
      const openai = findExport(content, "OPENAI_API_KEY");
      const anthropic = findExport(content, "ANTHROPIC_API_KEY");
      if (openai || anthropic) {
        return { openai, anthropic, source: file };
      }
    } catch {}
  }

  return { source: "none" };
}
