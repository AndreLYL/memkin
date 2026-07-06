import { describe, expect, it } from "vitest";
import { renderSystemdUnit } from "./systemd.js";

const unit = renderSystemdUnit({
  description: "Memkin daemon",
  argv: ["/abs/node", "/abs/dist/cli.js", "serve", "--mcp-http"],
  env: { DATABASE_URL: "postgres://x?a=1" },
});

describe("renderSystemdUnit", () => {
  it("ExecStart joins argv; Restart=on-failure; WantedBy=default.target", () => {
    expect(unit).toContain("ExecStart=/abs/node /abs/dist/cli.js serve --mcp-http");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
  });
  it("one Environment= line per env var", () => {
    expect(unit).toContain('Environment="DATABASE_URL=postgres://x?a=1"');
  });
});
