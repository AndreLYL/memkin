import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  rawYamlHash,
  readDaemonState,
  servingSubsetHash,
  writeDaemonState,
} from "./daemon-state.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memoark-dstate-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const state = {
  instance_id: "n1",
  config_path: "/c/memoark.yaml",
  raw_yaml_hash: "h",
  serving_subset_hash: "s",
  url: "http://127.0.0.1:3928/mcp",
  argv: ["/n", "serve"],
};

describe("daemon-state", () => {
  it("write→read round-trips; file has no pid", () => {
    writeDaemonState(dir, state);
    expect(readDaemonState(dir)).toEqual(state);
    expect(JSON.parse(readFileSync(join(dir, "daemon.json"), "utf8"))).not.toHaveProperty("pid");
  });
  it("readDaemonState returns null when absent", () => {
    expect(readDaemonState(dir)).toBeNull();
  });
  it("rawYamlHash hashes file text WITHOUT interpolating ${VAR}", () => {
    const p = join(dir, "memoark.yaml");
    writeFileSync(p, "store:\n  database_url: ${DATABASE_URL}\n");
    const h1 = rawYamlHash(p);
    expect(typeof h1).toBe("string");
    expect(rawYamlHash(p)).toBe(h1); // stable, no env needed
  });
  it("servingSubsetHash is stable for equal subsets", () => {
    const a = servingSubsetHash({
      bind: "127.0.0.1",
      port: 3928,
      readOnly: false,
      hosts: ["127.0.0.1:3928"],
    });
    const b = servingSubsetHash({
      bind: "127.0.0.1",
      port: 3928,
      readOnly: false,
      hosts: ["127.0.0.1:3928"],
    });
    expect(a).toBe(b);
    expect(a).not.toBe(
      servingSubsetHash({ bind: "127.0.0.1", port: 4000, readOnly: false, hosts: [] }),
    );
  });
  it("servingSubsetHash is order-robust: reversed hosts produce same hash", () => {
    const a = servingSubsetHash({
      bind: "127.0.0.1",
      port: 3928,
      readOnly: false,
      hosts: ["127.0.0.1:3928", "localhost:3928"],
    });
    const b = servingSubsetHash({
      bind: "127.0.0.1",
      port: 3928,
      readOnly: false,
      hosts: ["localhost:3928", "127.0.0.1:3928"],
    });
    expect(a).toBe(b);
  });
});
