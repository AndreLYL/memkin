/**
 * Integration tests for Obsidian sync: roundtrip + end-to-end scenarios.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";
import {
  exportToVault,
  importFromVault,
  loadManifest,
  type SyncStores,
} from "../../src/sync/obsidian.js";

async function makeStores(): Promise<SyncStores> {
  const db = await Database.create();
  return {
    db,
    pages: new PageStore(db.pg),
    chunks: new ChunkStore(db.pg),
    graph: new GraphStore(db.pg),
    tags: new TagStore(db.pg),
    timeline: new TimelineStore(db.pg),
  };
}

async function seedSimplePage(stores: SyncStores, slug: string, title: string) {
  await stores.pages.putPage(
    slug,
    `---\ntitle: ${title}\ntype: person\n---\n\n## Context\n\n${title} is awesome.`,
  );
}

describe("Obsidian sync — roundtrip integration", () => {
  let stores: SyncStores;
  let vault: string;

  beforeEach(async () => {
    stores = await makeStores();
    vault = await mkdtemp(join(tmpdir(), "vault-test-"));
  });

  afterEach(async () => {
    await stores.db.close();
    await rm(vault, { recursive: true, force: true });
  });

  it("empty DB → export produces empty vault + manifest", async () => {
    const result = await exportToVault(stores, vault);
    expect(result.written).toBe(0);
    expect(result.errors).toEqual([]);
    const manifest = await loadManifest(vault);
    expect(manifest?.version).toBe(2);
    expect(Object.keys(manifest?.pages ?? {})).toHaveLength(0);
  });

  it("seed DB → export → files exist with expected slug paths", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await seedSimplePage(stores, "person/bob", "Bob");
    await stores.tags.addTag("person/alice", "entity");

    const result = await exportToVault(stores, vault);

    expect(result.written).toBe(2);
    const aliceContent = await readFile(join(vault, "person/alice.md"), "utf-8");
    expect(aliceContent).toContain("title: Alice");
    expect(aliceContent).toContain("- entity"); // tag
  });

  it("export → unchanged DB → export skips all", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await exportToVault(stores, vault);
    const result2 = await exportToVault(stores, vault);
    expect(result2.written).toBe(0);
    expect(result2.skipped).toBe(1);
  });

  it("roundtrip stability: export → import → export → file content stable", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await exportToVault(stores, vault);

    await importFromVault(stores, vault);
    await exportToVault(stores, vault);
    const afterContent = await readFile(join(vault, "person/alice.md"), "utf-8");

    // The file may differ slightly due to user_edited flag being set on import,
    // but a SECOND export should be a fixed point.
    await exportToVault(stores, vault);
    const finalContent = await readFile(join(vault, "person/alice.md"), "utf-8");
    expect(finalContent).toBe(afterContent);
  });

  it("vault file modified → import updates DB", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await exportToVault(stores, vault);

    // User edits the file
    const filePath = join(vault, "person/alice.md");
    const original = await readFile(filePath, "utf-8");
    const edited = original.replace("Alice is awesome.", "Alice is the best engineer.");
    await writeFile(filePath, edited, "utf-8");

    const result = await importFromVault(stores, vault);
    expect(result.imported).toBe(1);

    const updatedPage = await stores.pages.getPage("person/alice");
    expect(updatedPage?.compiled_truth).toContain("the best engineer");
  });

  it("H4 verification: imported page is locked from pipeline overwrites", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await exportToVault(stores, vault);

    // User edits + import
    const filePath = join(vault, "person/alice.md");
    const original = await readFile(filePath, "utf-8");
    await writeFile(filePath, original.replace("Alice is awesome.", "Edited."), "utf-8");
    await importFromVault(stores, vault);

    // Verify user_edited flag is set
    const page = await stores.pages.getPage("person/alice");
    expect(page?.frontmatter.user_edited).toBe(true);
  });

  it("H2-incomplete: pipeline link survives roundtrip without being duplicated", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await seedSimplePage(stores, "project/auth", "Auth");
    await stores.graph.addLink("person/alice", "project/auth", "works_on", "lead");

    await exportToVault(stores, vault);

    // Simulate user touching the file (any modification triggers import processing)
    const filePath = join(vault, "person/alice.md");
    const content = await readFile(filePath, "utf-8");
    await writeFile(filePath, `${content}\n\nExtra note.`, "utf-8");

    await importFromVault(stores, vault);

    const links = await stores.graph.getLinks("person/alice");
    // Should still have exactly one link: the original works_on (no obsidian duplicate)
    const linksToAuth = links.filter((l) => l.to_slug === "project/auth");
    expect(linksToAuth).toHaveLength(1);
    expect(linksToAuth[0].link_type).toBe("works_on");
  });

  it("user adds [[wikilink]] in body → import creates obsidian-typed link", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await seedSimplePage(stores, "person/bob", "Bob");
    await exportToVault(stores, vault);

    // User edits to add a wikilink
    const filePath = join(vault, "person/alice.md");
    const content = await readFile(filePath, "utf-8");
    await writeFile(
      filePath,
      content.replace("Alice is awesome.", "Alice is awesome. See [[person/bob]]."),
      "utf-8",
    );

    await importFromVault(stores, vault);

    const links = await stores.graph.getLinks("person/alice");
    const obsidianLink = links.find((l) => l.to_slug === "person/bob");
    expect(obsidianLink?.link_type).toBe("obsidian");
  });

  it("L8 verification: symlinks are not followed", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await exportToVault(stores, vault);

    // Create a symlink inside vault pointing outside
    const { symlink } = await import("node:fs/promises");
    const outsideDir = await mkdtemp(join(tmpdir(), "outside-"));
    const outsideFile = join(outsideDir, "evil.md");
    await writeFile(outsideFile, "---\ntitle: Evil\ntype: x\nslug: evil\n---\nbad", "utf-8");
    try {
      await symlink(outsideFile, join(vault, "linked.md"));
    } catch {
      // Some filesystems may not support symlinks — skip
      return;
    }

    const result = await importFromVault(stores, vault);
    expect(result.errors).toEqual([]);
    // The symlinked file should NOT have been imported
    const evil = await stores.pages.getPage("evil");
    expect(evil).toBeNull();

    await rm(outsideDir, { recursive: true, force: true });
  });

  it("dry-run mode does not write files or update DB", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");

    const exportResult = await exportToVault(stores, vault, { dryRun: true });
    expect(exportResult.written).toBe(1);
    // No manifest should be created in dry-run
    const manifest = await loadManifest(vault);
    expect(manifest).toBeNull();

    // No actual file either
    const files = await readdir(vault);
    expect(files).toHaveLength(0);
  });

  it("Unicode slug roundtrip", async () => {
    await stores.pages.putPage(
      "person/王志冲",
      "---\ntitle: 王志冲\ntype: person\n---\n\nContext.",
    );

    await exportToVault(stores, vault);
    const content = await readFile(join(vault, "person/王志冲.md"), "utf-8");
    expect(content).toContain("title: 王志冲");

    // Re-import roundtrip
    await importFromVault(stores, vault);
    const reimported = await stores.pages.getPage("person/王志冲");
    expect(reimported?.title).toBe("王志冲");
  });

  it("M3: file with reversed markers is reported as error", async () => {
    const filePath = join(vault, "broken.md");
    await writeFile(
      filePath,
      `---
title: B
type: x
slug: broken
---

body

<!-- memoark:timeline -->

- e

<!-- memoark:related -->

- [[x]]
`,
      "utf-8",
    );

    const result = await importFromVault(stores, vault);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].reason).toMatch(/marker order/i);
  });

  it("H5: warning emitted when DB changed since last sync", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await exportToVault(stores, vault);

    // Simulate pipeline update to DB between syncs
    await stores.pages.putPage(
      "person/alice",
      `---\ntitle: Alice\ntype: person\n---\n\n## Context\n\nDB-side edit.`,
    );

    // User also edits vault file
    const filePath = join(vault, "person/alice.md");
    const content = await readFile(filePath, "utf-8");
    await writeFile(filePath, `${content}\n\nUser edit.`, "utf-8");

    const result = await importFromVault(stores, vault);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].reason).toMatch(/DB content changed/i);
    // Default behavior: still import (last-writer-wins)
    expect(result.imported).toBe(1);
  });

  it("H5 strict mode: skip the file instead of overwriting", async () => {
    await seedSimplePage(stores, "person/alice", "Alice");
    await exportToVault(stores, vault);

    await stores.pages.putPage(
      "person/alice",
      `---\ntitle: Alice\ntype: person\n---\n\n## Context\n\nDB-side edit.`,
    );
    const filePath = join(vault, "person/alice.md");
    const content = await readFile(filePath, "utf-8");
    await writeFile(filePath, `${content}\n\nUser edit.`, "utf-8");

    const result = await importFromVault(stores, vault, { strictConflict: true });
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
