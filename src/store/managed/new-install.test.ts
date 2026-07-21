import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasExistingPgliteData, resolveDefaultEngineForNewInstall } from "./new-install.js";

describe("hasExistingPgliteData", () => {
  it("returns false when ~/.memkin/data does not exist", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-test-"));
    expect(hasExistingPgliteData(home)).toBe(false);
  });

  it("returns false when ~/.memkin/data exists but is empty", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-test-"));
    mkdirSync(join(home, ".memkin", "data"), { recursive: true });
    expect(hasExistingPgliteData(home)).toBe(false);
  });

  it("returns true when ~/.memkin/data exists and has files", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-test-"));
    const dataDir = join(home, ".memkin", "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "base.tar.gz"), "fake-pglite-data");
    expect(hasExistingPgliteData(home)).toBe(true);
  });
});

describe("resolveDefaultEngineForNewInstall", () => {
  it("returns 'managed' on darwin with no existing PGLite data", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-test-"));
    expect(resolveDefaultEngineForNewInstall({ platform: "darwin", arch: "arm64", home })).toBe(
      "managed",
    );
    expect(resolveDefaultEngineForNewInstall({ platform: "darwin", arch: "x64", home })).toBe(
      "managed",
    );
  });

  it("returns 'managed' on linux with no existing PGLite data (runtime tarballs ship for linux)", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-test-"));
    expect(resolveDefaultEngineForNewInstall({ platform: "linux", arch: "x64", home })).toBe(
      "managed",
    );
    expect(resolveDefaultEngineForNewInstall({ platform: "linux", arch: "arm64", home })).toBe(
      "managed",
    );
  });

  it("returns 'pglite' when existing PGLite data is present (P1-5 guard), on every platform", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-test-"));
    const dataDir = join(home, ".memkin", "data");
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, "base.tar.gz"), "fake-pglite-data");
    expect(resolveDefaultEngineForNewInstall({ platform: "darwin", arch: "arm64", home })).toBe(
      "pglite",
    );
    expect(resolveDefaultEngineForNewInstall({ platform: "linux", arch: "x64", home })).toBe(
      "pglite",
    );
  });

  it("returns 'pglite' on platforms without a managed runtime tarball", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-test-"));
    expect(resolveDefaultEngineForNewInstall({ platform: "win32", arch: "x64", home })).toBe(
      "pglite",
    );
    expect(resolveDefaultEngineForNewInstall({ platform: "linux", arch: "ia32", home })).toBe(
      "pglite",
    );
  });
});
