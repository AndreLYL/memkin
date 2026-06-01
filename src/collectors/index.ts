import type { Collector } from "../core/types.js";

const collectors = new Map<string, Collector>();

export function registerCollector(c: Collector): void {
  collectors.set(c.id, c);
}

export function getCollector(id: string): Collector | undefined {
  return collectors.get(id);
}

export function getAllCollectors(): Collector[] {
  return Array.from(collectors.values());
}

export function resetRegistry(): void {
  collectors.clear();
}

export { createClaudeCodeCollector } from "./agent/claude-code.js";
export { createCodexCollector } from "./agent/codex.js";
export { createHermesCollector } from "./agent/hermes.js";
export { createFeishuCollector, FeishuCollector } from "./feishu/index.js";
