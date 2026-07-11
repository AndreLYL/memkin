import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("install.sh orchestration (dryrun)", () => {
  it("runs node→install→up in order and pins the config path", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-inst-"));
    const cfg = join(home, ".memkin", "memkin.yaml");
    execFileSync("mkdir", ["-p", join(home, ".memkin")]);
    writeFileSync(cfg, "store:\n  engine: pglite\n");

    const out = execFileSync("sh", ["scripts/install.sh"], {
      env: {
        ...process.env,
        HOME: home,
        MEMKIN_CONFIG: cfg,
        MEMKIN_INSTALL_DRYRUN: "1",
        PATH: process.env.PATH ?? "",
      },
      encoding: "utf8",
    });

    expect(out).toContain("DRYRUN: npm install -g memkin@latest");
    expect(out).toContain(`DRYRUN: memkin up -c ${cfg}`);
    expect(out).not.toContain("memkin init --web");
  });
});
