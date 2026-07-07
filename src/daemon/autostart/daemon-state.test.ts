import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  rawYamlHash,
  readDaemonState,
  recoverServeConfigPath,
  servingSubsetHash,
  writeDaemonState,
} from "./daemon-state.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memkin-dstate-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const state = {
  instance_id: "n1",
  config_path: "/c/memkin.yaml",
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
    const p = join(dir, "memkin.yaml");
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

describe("recoverServeConfigPath (F1 serve self-heal)", () => {
  /** A daemon.json whose config_path points at a file that may or may not exist. */
  function seedState(configPath: string): void {
    writeDaemonState(dir, { ...state, config_path: configPath });
  }
  function seedRealConfig(name: string): string {
    const p = join(dir, name);
    writeFileSync(p, "llm: {}\n");
    return p;
  }

  it("returns null when neither daemon state nor discovery finds an existing config", () => {
    const result = recoverServeConfigPath({
      requestedPath: join(dir, "gone.yaml"),
      stateDir: dir,
      trustDaemonState: true,
      discover: () => join(dir, "also-gone.yaml"),
    });
    expect(result).toBeNull();
  });

  it("daemon-launched serve falls back to daemon.json's config_path when it exists", () => {
    // The frozen plist/unit argv may carry a stale --config forever; daemon.json
    // is rewritten by migration, so it is the authoritative recovery source.
    const real = seedRealConfig("memkin.yaml");
    seedState(real);

    const result = recoverServeConfigPath({
      requestedPath: join(dir, "stale", "memoark.yaml"),
      stateDir: dir,
      trustDaemonState: true,
      discover: () => join(dir, "not-used.yaml"),
    });

    expect(result).toEqual({ configPath: real, source: "daemon-state", healedDaemonState: false });
  });

  it("does NOT consult daemon.json for a non-daemon serve (interactive --config typo)", () => {
    const real = seedRealConfig("memkin.yaml");
    seedState(real);

    const result = recoverServeConfigPath({
      requestedPath: join(dir, "typo.yaml"),
      stateDir: dir,
      trustDaemonState: false,
      discover: () => join(dir, "nothing-here.yaml"),
    });

    expect(result).toBeNull();
  });

  it("falls back to discovery and heals a stale daemon.json config_path (test B)", () => {
    const discovered = seedRealConfig("memkin.yaml");
    seedState(join(dir, ".memoark", "memoark.yaml")); // stale: file does not exist

    const result = recoverServeConfigPath({
      requestedPath: join(dir, ".memoark", "memoark.yaml"),
      stateDir: dir,
      trustDaemonState: true,
      discover: () => discovered,
    });

    expect(result).toEqual({
      configPath: discovered,
      source: "discovered",
      healedDaemonState: true,
    });
    // the corrected value was written back to daemon.json, other fields intact
    const healed = readDaemonState(dir);
    expect(healed?.config_path).toBe(discovered);
    expect(healed?.instance_id).toBe(state.instance_id);
    expect(healed?.url).toBe(state.url);
  });

  it("uses discovery WITHOUT touching a daemon.json whose config_path is still valid", () => {
    const daemonConfig = seedRealConfig("daemon-memkin.yaml");
    seedState(daemonConfig);
    const discovered = seedRealConfig("memkin.yaml");

    const result = recoverServeConfigPath({
      requestedPath: join(dir, "typo.yaml"),
      stateDir: dir,
      trustDaemonState: false,
      discover: () => discovered,
    });

    expect(result).toEqual({
      configPath: discovered,
      source: "discovered",
      healedDaemonState: false,
    });
    expect(readDaemonState(dir)?.config_path).toBe(daemonConfig);
  });

  it("works when no daemon.json exists at all (discovery only)", () => {
    const discovered = seedRealConfig("memkin.yaml");

    const result = recoverServeConfigPath({
      requestedPath: join(dir, "gone.yaml"),
      stateDir: dir,
      trustDaemonState: true,
      discover: () => discovered,
    });

    expect(result).toEqual({
      configPath: discovered,
      source: "discovered",
      healedDaemonState: false,
    });
    expect(readDaemonState(dir)).toBeNull();
  });

  it("returns null when discovery returns a nonexistent path", () => {
    const result = recoverServeConfigPath({
      requestedPath: join(dir, "gone.yaml"),
      stateDir: dir,
      trustDaemonState: false,
      discover: () => join(dir, "still-gone.yaml"),
    });
    expect(result).toBeNull();
  });
});
