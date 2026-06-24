import type { ClientAdapter } from "../types.js";
import { claudeCode } from "./claude-code.js";
import { claudeDesktop } from "./claude-desktop.js";
import { codex } from "./codex.js";
import { cursor } from "./cursor.js";
import { windsurf } from "./windsurf.js";

export const ADAPTERS: ClientAdapter[] = [claudeCode, claudeDesktop, cursor, codex, windsurf];

export function getAdapter(id: string): ClientAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
