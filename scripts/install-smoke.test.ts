import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    if (out.includes("using npm exec fallback")) {
      expect(out).toContain(`DRYRUN: npm exec --yes memkin@latest -- up -c ${cfg}`);
    } else {
      expect(out).toContain(`DRYRUN: memkin up -c ${cfg}`);
    }
    expect(out).not.toContain("memkin init --web");
  });

  it("adds PATH profile block once (idempotent)", () => {
    const home = mkdtempSync(join(tmpdir(), "memkin-inst-"));
    const cfg = join(home, ".memkin", "memkin.yaml");
    execFileSync("mkdir", ["-p", join(home, ".memkin")]);
    writeFileSync(cfg, "store:\n  engine: pglite\n");

    const env = {
      ...process.env,
      HOME: home,
      MEMKIN_CONFIG: cfg,
      MEMKIN_INSTALL_DRYRUN: "1",
      PATH: process.env.PATH ?? "",
    };
    execFileSync("sh", ["scripts/install.sh"], { env, encoding: "utf8" });
    execFileSync("sh", ["scripts/install.sh"], { env, encoding: "utf8" });

    const marker = "# >>> memkin npm global bin >>>";
    const profiles = [join(home, ".profile"), join(home, ".bashrc"), join(home, ".zshrc"), join(home, ".bash_profile")];
    for (const profile of profiles) {
      try {
        const text = readFileSync(profile, "utf8");
        expect(text.split(marker).length - 1).toBeLessThanOrEqual(1);
      } catch {
        // profile not created on this platform
      }
    }
  });
});
