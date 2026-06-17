import { describe, expect, it } from "vitest";
import { shouldOpenBrowserOnServe } from "../../src/cli-helpers.js";

describe("shouldOpenBrowserOnServe", () => {
  it("opens for plain HTTP serve by default", () => {
    expect(shouldOpenBrowserOnServe({ open: true, mcp: false, mcpHttp: false })).toBe(true);
  });
  it("does NOT open when --no-open", () => {
    expect(shouldOpenBrowserOnServe({ open: false, mcp: false, mcpHttp: false })).toBe(false);
  });
  it("does NOT open in MCP stdio mode", () => {
    expect(shouldOpenBrowserOnServe({ open: true, mcp: true, mcpHttp: false })).toBe(false);
  });
  it("does NOT open in MCP HTTP mode", () => {
    expect(shouldOpenBrowserOnServe({ open: true, mcp: false, mcpHttp: true })).toBe(false);
  });
});
