import { exec } from "node:child_process";

export function resolveOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "darwin") return `open "${url}"`;
  if (platform === "win32") return `start "" "${url}"`;
  return `xdg-open "${url}"`;
}

export function openBrowser(url: string): void {
  exec(resolveOpenCommand(url));
}
