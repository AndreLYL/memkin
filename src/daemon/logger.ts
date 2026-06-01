import { appendFileSync, existsSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_BACKUPS = 3;

export class DaemonLogger {
  private readonly logPath: string;
  private readonly maxBytes: number;

  constructor(stateDir: string, maxBytes = DEFAULT_MAX_BYTES) {
    this.logPath = join(stateDir, "daemon.log");
    this.maxBytes = maxBytes;
  }

  log(level: "info" | "warn" | "error", source: string, message: string): void {
    const line = `${new Date().toISOString()} [${level}] [${source}] ${message}`;
    console.log(line);
    appendFileSync(this.logPath, line + "\n");
    this.rotateIfNeeded();
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.logPath)) return;
    const size = statSync(this.logPath).size;
    if (size <= this.maxBytes) return;

    for (let i = MAX_BACKUPS; i >= 1; i--) {
      const src = i === 1 ? this.logPath : `${this.logPath}.${i - 1}`;
      const dst = `${this.logPath}.${i}`;
      if (i === MAX_BACKUPS && existsSync(dst)) unlinkSync(dst);
      if (existsSync(src)) renameSync(src, dst);
    }
    writeFileSync(this.logPath, "");
  }
}
