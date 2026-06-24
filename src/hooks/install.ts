import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseJsonConfig, stringifyJsonConfig } from "../install/json-config.js";
import { type HookSpec, removeHooks, upsertHooks } from "./settings-edit.js";

const READ_HOOKS: HookSpec[] = [
  { event: "SessionStart", matcher: "startup|resume", command: "memoark hook session-start" },
  { event: "UserPromptSubmit", command: "memoark hook user-prompt" },
];
const WRITE_HOOK: HookSpec = { event: "SessionEnd", command: "memoark hook session-end" };

export interface HooksInstallOptions {
  writeBack?: boolean;
  project?: boolean;
  dryRun?: boolean;
  home?: string;
  cwd?: string;
}

export interface HooksResult {
  path: string;
  events: string[];
}

function settingsPath(opts: HooksInstallOptions): string {
  const root = opts.project ? (opts.cwd ?? process.cwd()) : (opts.home ?? homedir());
  return join(root, ".claude", "settings.json");
}

export function hooksInstall(opts: HooksInstallOptions = {}): HooksResult {
  const specs = opts.writeBack ? [...READ_HOOKS, WRITE_HOOK] : [...READ_HOOKS];
  const path = settingsPath(opts);
  if (!opts.dryRun) {
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    const next = upsertHooks(parseJsonConfig(text, path), specs);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringifyJsonConfig(next));
  }
  return { path, events: specs.map((s) => s.event) };
}

export function hooksUninstall(opts: HooksInstallOptions = {}): HooksResult {
  const path = settingsPath(opts);
  if (!opts.dryRun && existsSync(path)) {
    const next = removeHooks(parseJsonConfig(readFileSync(path, "utf8"), path));
    writeFileSync(path, stringifyJsonConfig(next));
  }
  return { path, events: [READ_HOOKS[0].event, READ_HOOKS[1].event, WRITE_HOOK.event] };
}
