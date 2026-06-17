import { describe, expect, it } from "vitest";
import { resolveOpenCommand } from "../../src/server/open-browser.js";

describe("resolveOpenCommand", () => {
  it("uses 'open' on macOS", () => {
    expect(resolveOpenCommand("http://localhost:3927", "darwin")).toBe(
      'open "http://localhost:3927"',
    );
  });
  it("uses 'start' on Windows", () => {
    expect(resolveOpenCommand("http://localhost:3927", "win32")).toBe(
      'start "" "http://localhost:3927"',
    );
  });
  it("uses 'xdg-open' on Linux/other", () => {
    expect(resolveOpenCommand("http://localhost:3927", "linux")).toBe(
      'xdg-open "http://localhost:3927"',
    );
  });
});
