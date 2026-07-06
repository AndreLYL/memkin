import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadResource } from "../../src/core/resource-loader.js";

describe("loadResource", () => {
  let tempDir: string;
  let moduleUrl: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "memkin-resource-"));
    moduleUrl = pathToFileURL(join(tempDir, "module.js")).href;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads resources relative to the caller module URL", () => {
    writeFileSync(join(tempDir, "schema.sql"), "SELECT 1;");

    expect(loadResource(moduleUrl, "schema.sql")).toBe("SELECT 1;");
  });

  it("throws a clear build asset error when a resource is missing", () => {
    expect(() => loadResource(moduleUrl, "missing.sql")).toThrow(/Resource not found/);
    expect(() => loadResource(moduleUrl, "missing.sql")).toThrow(/npm run build/);
  });
});
