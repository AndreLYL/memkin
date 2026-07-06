import type { CommandResult, CommandRunner } from "./runner.js";

export interface SystemdUnitOptions {
  description: string;
  argv: string[];
  env?: Record<string, string>;
}

function quoteArg(arg: string): string {
  return arg.includes(" ") ? `"${arg}"` : arg;
}

function escapeSystemdValue(value: string): string {
  // Escape % → %% in systemd environment values
  return value.replace(/%/g, "%%");
}

export function renderSystemdUnit(opts: SystemdUnitOptions): string {
  const execStart = `ExecStart=${opts.argv.map(quoteArg).join(" ")}`;

  const envLines =
    opts.env && Object.keys(opts.env).length > 0
      ? Object.entries(opts.env)
          .map(([k, v]) => `Environment="${k}=${escapeSystemdValue(v)}"`)
          .join("\n")
      : "";

  return `[Unit]
Description=${opts.description}
After=network.target

[Service]
Type=simple
${execStart}
${envLines ? `${envLines}\n` : ""}Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
}

export function systemdEnable(runner: CommandRunner): Promise<CommandResult> {
  return runner
    .run(["systemctl", "--user", "daemon-reload"])
    .then(() => runner.run(["systemctl", "--user", "enable", "--now", "memkin.service"]));
}

export function systemdDisable(runner: CommandRunner): Promise<CommandResult> {
  return runner.run(["systemctl", "--user", "disable", "--now", "memkin.service"]);
}

export function systemdStatus(runner: CommandRunner): Promise<CommandResult> {
  return runner.run(["systemctl", "--user", "is-active", "memkin.service"]);
}
