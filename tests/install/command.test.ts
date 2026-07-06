import { describe, expect, it } from "vitest";
import { resolveLaunchCmd } from "../../src/install/command.js";

describe("resolveLaunchCmd", () => {
  it("uses the memkin binary when on PATH (stdio default)", () => {
    expect(resolveLaunchCmd({ onPath: () => true })).toEqual({
      command: "memkin",
      args: ["serve", "--mcp"],
    });
  });

  it("falls back to npx when memkin is not on PATH", () => {
    expect(resolveLaunchCmd({ onPath: () => false })).toEqual({
      command: "npx",
      args: ["-y", "memkin", "serve", "--mcp"],
    });
  });

  it("uses --mcp-http when http requested", () => {
    expect(resolveLaunchCmd({ onPath: () => true, http: true }).args).toEqual([
      "serve",
      "--mcp-http",
    ]);
    expect(resolveLaunchCmd({ onPath: () => false, http: true }).args).toContain("--mcp-http");
  });
});
