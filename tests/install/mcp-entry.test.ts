import { describe, expect, it } from "vitest";
import { httpEntry, type McpEntry, stdioEntry } from "../../src/install/mcp-entry.js";

describe("McpEntry", () => {
  it("stdioEntry builds a stdio-kind entry", () => {
    const e = stdioEntry("memkin", ["serve", "--mcp"]);
    expect(e).toEqual({ kind: "stdio", command: "memkin", args: ["serve", "--mcp"] });
  });
  it("httpEntry builds an http-kind entry", () => {
    const e: McpEntry = httpEntry("http://127.0.0.1:3928/mcp");
    expect(e).toEqual({ kind: "http", url: "http://127.0.0.1:3928/mcp" });
  });
});
