import { describe, expect, it } from "vitest";
import { planInstall } from "../../src/install/index.js";

describe("planInstall --http", () => {
  it("supportsHttp adapter gets http entry at the given url", () => {
    const [plan] = planInstall(
      {
        agent: ["claude-code"],
        http: true,
        url: "http://127.0.0.1:4000/mcp",
        home: "/h",
        cwd: "/c",
      },
      "upsert",
    );
    const mcpOp = plan.ops.find((o) => o.kind === "json-mcp");
    expect(mcpOp?.entry).toEqual({ kind: "http", url: "http://127.0.0.1:4000/mcp" });
  });
  it("a non-supportsHttp adapter falls back to stdio even with --http", () => {
    const [plan] = planInstall({ agent: ["cursor"], http: true, home: "/h", cwd: "/c" }, "upsert");
    const mcpOp = plan.ops.find(
      (o) => o.kind === "json-mcp" || o.kind === "toml-mcp" || o.kind === "yaml-mcp",
    );
    expect(mcpOp?.entry?.kind).toBe("stdio");
  });
  it("default port 3928 when --port omitted", () => {
    const [plan] = planInstall(
      { agent: ["claude-code"], http: true, home: "/h", cwd: "/c" },
      "upsert",
    );
    const mcpOp = plan.ops.find((o) => o.kind === "json-mcp");
    expect(mcpOp?.entry).toEqual({ kind: "http", url: "http://127.0.0.1:3928/mcp" });
  });
});
