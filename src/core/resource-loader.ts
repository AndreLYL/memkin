import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadResource(relativeTo: string, filename: string): string {
  const fullPath = join(dirname(fileURLToPath(relativeTo)), filename);
  if (!existsSync(fullPath)) {
    throw new Error(
      `Resource not found: ${fullPath}\n` +
        `If running from dist/, ensure "npm run build" completed successfully.`,
    );
  }
  return readFileSync(fullPath, "utf-8");
}
