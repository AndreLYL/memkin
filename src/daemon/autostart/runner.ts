import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(argv: string[]): Promise<CommandResult>;
}

export interface FakeRunner extends CommandRunner {
  calls: string[][];
}

export function makeFakeRunner(results: CommandResult[]): FakeRunner {
  const queue = [...results];
  const calls: string[][] = [];
  return {
    calls,
    run(argv) {
      calls.push(argv);
      return Promise.resolve(queue.shift() ?? { code: 0, stdout: "", stderr: "" });
    },
  };
}

export const nodeRunner: CommandRunner = {
  run(argv) {
    return new Promise((resolve) => {
      const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d;
      });
      child.stderr.on("data", (d) => {
        stderr += d;
      });
      child.on("error", (e) => resolve({ code: 1, stdout, stderr: String(e) }));
      child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    });
  },
};
