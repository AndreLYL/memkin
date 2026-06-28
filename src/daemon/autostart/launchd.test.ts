import { describe, expect, it } from "vitest";
import { renderLaunchdPlist } from "./launchd.js";

const plist = renderLaunchdPlist({
  label: "com.memoark.daemon",
  argv: ["/abs/node", "/abs/dist/cli.js", "serve", "--mcp-http"],
  stdoutPath: "/abs/logs/out.log",
  stderrPath: "/abs/logs/err.log",
  env: { DATABASE_URL: "postgres://x?a=1&b=2" },
});

describe("renderLaunchdPlist", () => {
  it("RunAtLoad + KeepAlive true", () => {
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
  });
  it("each argv item is its own <string>", () => {
    expect(plist).toContain("<string>/abs/dist/cli.js</string>");
    expect(plist).toContain("<string>serve</string>");
  });
  it("XML-escapes env values (& → &amp;)", () => {
    expect(plist).toContain("postgres://x?a=1&amp;b=2");
  });
});
