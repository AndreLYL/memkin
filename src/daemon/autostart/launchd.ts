import type { CommandRunner } from "./runner.js";

export interface LaunchdPlistOptions {
  label: string;
  argv: string[];
  stdoutPath: string;
  stderrPath: string;
  env?: Record<string, string>;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderLaunchdPlist(opts: LaunchdPlistOptions): string {
  const argStrings = opts.argv.map((a) => `        <string>${xmlEscape(a)}</string>`).join("\n");

  const envDict =
    opts.env && Object.keys(opts.env).length > 0
      ? [
          "    <key>EnvironmentVariables</key>",
          "    <dict>",
          ...Object.entries(opts.env).map(
            ([k, v]) =>
              `        <key>${xmlEscape(k)}</key>\n        <string>${xmlEscape(v)}</string>`,
          ),
          "    </dict>",
        ].join("\n")
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(opts.label)}</string>
    <key>ProgramArguments</key>
    <array>
${argStrings}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xmlEscape(opts.stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(opts.stderrPath)}</string>
${envDict}
</dict>
</plist>
`;
}

export function launchdLoad(
  runner: CommandRunner,
  plistPath: string,
  uid: number,
): Promise<import("./runner.js").CommandResult> {
  return runner.run(["launchctl", "bootstrap", `gui/${uid}`, plistPath]);
}

export function launchdBootout(
  runner: CommandRunner,
  label: string,
  uid: number,
): Promise<import("./runner.js").CommandResult> {
  return runner.run(["launchctl", "bootout", `gui/${uid}/${label}`]);
}

export function launchdStatus(
  runner: CommandRunner,
  label: string,
  uid: number,
): Promise<import("./runner.js").CommandResult> {
  return runner.run(["launchctl", "print", `gui/${uid}/${label}`]);
}
