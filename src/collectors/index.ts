import type { Collector } from "../core/types";

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

export { createClaudeCodeCollector } from "./agent/claude-code";
export { createCodexCollector } from "./agent/codex";
export { createHermesCollector } from "./agent/hermes";
export { createFeishuCollector, FeishuCollector } from "./feishu";
