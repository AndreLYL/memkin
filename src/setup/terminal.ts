import type { Readable, Writable } from "node:stream";

export interface SelectOption {
  value: string;
  label: string;
}

export interface Prompt {
  ask(question: string, defaultValue?: string): Promise<string>;
  secret(question: string): Promise<string>;
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  select(question: string, options: SelectOption[], defaultIndex?: number): Promise<string>;
  close(): void;
}

interface ColorOptions {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  platform?: NodeJS.Platform;
}

const ANSI = {
  green: "32",
  yellow: "33",
  red: "31",
  cyan: "36",
};

export function supportsColor(options: ColorOptions = {}): boolean {
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? process.stdout.isTTY === true;
  const platform = options.platform ?? process.platform;

  if (!isTTY) return false;
  if (env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined) return true;
  if (platform !== "win32") return true;
  return Boolean(env.WT_SESSION || env.TERM_PROGRAM);
}

export function color(text: string, ansiCode: string): string {
  if (!supportsColor()) return text;
  return `\x1b[${ansiCode}m${text}\x1b[0m`;
}

function writeLine(message = ""): void {
  process.stdout.write(`${message}\n`);
}

export function success(msg: string): void {
  writeLine(color(`[ok] ${msg}`, ANSI.green));
}

export function warn(msg: string): void {
  writeLine(color(`[!!] ${msg}`, ANSI.yellow));
}

export function fail(msg: string): void {
  writeLine(color(`[xx] ${msg}`, ANSI.red));
}

export function section(title: string): void {
  writeLine("");
  writeLine(color(`--- ${title} ---`, ANSI.cyan));
}

export function createPrompt(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Prompt {
  const lines: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let buffer = "";
  let closed = false;

  const flush = (): void => {
    while (lines.length > 0 && waiters.length > 0) {
      const waiter = waiters.shift();
      const line = lines.shift();
      if (waiter && line !== undefined) {
        waiter(line);
      }
    }
  };

  const onData = (chunk: Buffer | string): void => {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      lines.push(part.trim());
    }
    flush();
  };

  const onEnd = (): void => {
    if (buffer) {
      lines.push(buffer.trim());
      buffer = "";
    }
    closed = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter?.("");
    }
  };

  input.on("data", onData);
  input.once("end", onEnd);
  input.resume();

  const question = (promptText: string): Promise<string> =>
    new Promise((resolve) => {
      output.write(promptText);
      if (lines.length > 0) {
        resolve(lines.shift() ?? "");
        return;
      }
      if (closed) {
        resolve("");
        return;
      }
      waiters.push(resolve);
    });

  const ask = async (label: string, defaultValue?: string): Promise<string> => {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = await question(`${label}${suffix}: `);
    return answer || defaultValue || "";
  };

  const confirm = async (label: string, defaultYes = true): Promise<boolean> => {
    const suffix = defaultYes ? "Y/n" : "y/N";

    while (true) {
      const answer = (await question(`${label} [${suffix}]: `)).toLowerCase();
      if (!answer) return defaultYes;
      if (answer === "y" || answer === "yes") return true;
      if (answer === "n" || answer === "no") return false;
      output.write("Please answer y or n.\n");
    }
  };

  const selectWithArrows = (
    label: string,
    options: SelectOption[],
    defaultIndex: number,
  ): Promise<string> =>
    new Promise((resolve) => {
      let idx = defaultIndex;
      const stdin = input as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };

      const clearLines = (n: number) => {
        for (let i = 0; i < n; i++) {
          output.write("\x1b[1A\x1b[2K"); // up + clear line
        }
      };

      const render = () => {
        output.write(`${label}:\n`);
        for (let i = 0; i < options.length; i++) {
          const cursor = i === idx ? "❯ " : "  ";
          const text =
            i === idx
              ? `\x1b[36m${cursor}${options[i].label}\x1b[0m`
              : `${cursor}${options[i].label}`;
          output.write(`  ${text}\n`);
        }
      };

      // Remove line-mode listener temporarily
      input.off("data", onData);
      stdin.setRawMode?.(true);

      render();

      const onKey = (buf: Buffer | string) => {
        const key = buf.toString();

        if (key === "\x1b[A" || key === "\x1b[D") {
          // up / left
          idx = idx > 0 ? idx - 1 : options.length - 1;
          clearLines(options.length + 1);
          render();
        } else if (key === "\x1b[B" || key === "\x1b[C") {
          // down / right
          idx = idx < options.length - 1 ? idx + 1 : 0;
          clearLines(options.length + 1);
          render();
        } else if (key === "\r" || key === "\n") {
          stdin.setRawMode?.(false);
          input.off("data", onKey);
          input.on("data", onData); // restore line-mode listener
          output.write("\n");
          resolve(options[idx].value);
        } else if (key === "\x03") {
          // Ctrl+C
          stdin.setRawMode?.(false);
          process.exit(0);
        }
      };

      input.on("data", onKey);
    });

  const select = async (
    label: string,
    options: SelectOption[],
    defaultIndex = 0,
  ): Promise<string> => {
    if (options.length === 0) throw new Error("select requires at least one option");
    if (defaultIndex < 0 || defaultIndex >= options.length)
      throw new Error("defaultIndex is out of range");

    const stdin = input as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };

    // Use arrow keys when raw mode is available (TTY), fall back to numbers
    if (typeof stdin.setRawMode === "function") {
      return selectWithArrows(label, options, defaultIndex);
    }

    // Fallback: numbered selection (non-TTY / Windows cmd)
    output.write(`${label}:\n`);
    for (let i = 0; i < options.length; i++) {
      output.write(`  ${i + 1}) ${options[i].label}\n`);
    }
    while (true) {
      const answer = await question(`Choice [${defaultIndex + 1}]: `);
      if (!answer) return options[defaultIndex].value;
      const choice = Number.parseInt(answer, 10);
      if (Number.isInteger(choice) && choice >= 1 && choice <= options.length) {
        return options[choice - 1].value;
      }
      output.write(`Please enter a number from 1 to ${options.length}.\n`);
    }
  };

  const secret = (label: string): Promise<string> =>
    new Promise((resolve) => {
      const stdin = input as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
      const hasRawMode = typeof stdin.setRawMode === "function";

      output.write(`${label}: `);

      if (!hasRawMode) {
        // Non-TTY fallback: use normal ask (no masking possible)
        question("").then(resolve);
        return;
      }

      // Temporarily disable line-mode listener
      input.off("data", onData);
      stdin.setRawMode(true);

      let value = "";

      const onChar = (buf: Buffer | string) => {
        const ch = buf.toString();
        const code = ch.charCodeAt(0);

        if (ch === "\r" || ch === "\n") {
          // Enter — done
          stdin.setRawMode(false);
          input.off("data", onChar);
          input.on("data", onData); // restore line-mode listener
          output.write("\n");
          resolve(value);
        } else if (code === 127 || code === 8) {
          // Backspace
          if (value.length > 0) value = value.slice(0, -1);
        } else if (code === 3) {
          // Ctrl+C
          stdin.setRawMode(false);
          process.exit(0);
        } else if (code >= 32) {
          // Printable character — collect but don't echo
          value += ch;
        }
      };

      input.on("data", onChar);
    });

  return {
    ask,
    secret,
    confirm,
    select,
    close: () => {
      input.off("data", onData);
      input.off("end", onEnd);
      closed = true;
      input.pause();
      if (input === process.stdin && typeof process.stdin.unref === "function") {
        process.stdin.unref();
      }
    },
  };
}
