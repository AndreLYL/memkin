import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";

/**
 * Spec 11 Task 1: playbook hierarchy traversal.
 *
 * Tree (built via Spec 10 zero-LLM wikilink auto-wiring):
 *   category/adas
 *     <- part_of <- problem-class/activation-failure
 *                     <- part_of <- playbook/activation-step-1
 *                     <- part_of <- playbook/activation-step-2
 *   playbook/activation-step-1 -> precedes -> playbook/activation-step-2 -> precedes -> playbook/activation-step-3
 */
describe("GraphStore playbook traversal", () => {
  let db: Database;
  let pages: PageStore;
  let graph: GraphStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.pg);
    graph = new GraphStore(db.pg);

    await pages.putPage("category/adas", "---\ntitle: 智驾\ntype: category\n---\n智能驾驶。");
    await pages.putPage(
      "problem-class/activation-failure",
      "---\ntitle: 无法激活类\ntype: problem-class\n---\n无法激活。\n[[part_of:category/adas]]",
    );
    // Insert in reverse-chain order so precedes targets pre-exist when each page
    // is written (Spec 10 auto-wiring no-ops on missing targets).
    await pages.putPage(
      "playbook/activation-step-3",
      "---\ntitle: 激活排查步骤3\ntype: playbook\n---\n步骤3。\n[[part_of:problem-class/activation-failure]]",
    );
    await pages.putPage(
      "playbook/activation-step-2",
      "---\ntitle: 激活排查步骤2\ntype: playbook\n---\n步骤2。\n[[part_of:problem-class/activation-failure]]\n[[precedes:playbook/activation-step-3]]",
    );
    await pages.putPage(
      "playbook/activation-step-1",
      "---\ntitle: 激活排查步骤1\ntype: playbook\n---\n步骤1。\n[[part_of:problem-class/activation-failure]]\n[[precedes:playbook/activation-step-2]]",
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it("auto-wires part_of / precedes edges from wikilinks (Spec 10 reuse)", async () => {
    const backlinks = await graph.getBacklinks("category/adas");
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].from_slug).toBe("problem-class/activation-failure");
    expect(backlinks[0].link_type).toBe("part_of");

    const step1Links = await graph.getLinks("playbook/activation-step-1");
    const precedes = step1Links.find((l) => l.link_type === "precedes");
    expect(precedes?.to_slug).toBe("playbook/activation-step-2");
  });

  it("getSubtree returns all descendants along a relation", async () => {
    const subtree = await graph.getSubtree("category/adas", "part_of");
    const slugs = subtree.map((n) => n.slug);
    expect(slugs).toContain("problem-class/activation-failure");
    expect(slugs).toContain("playbook/activation-step-1");
    expect(slugs).toContain("playbook/activation-step-2");
    expect(slugs).toContain("playbook/activation-step-3");
    expect(slugs).not.toContain("category/adas");
    const pc = subtree.find((n) => n.slug === "problem-class/activation-failure");
    expect(pc?.title).toBe("无法激活类");
  });

  it("getSubtree respects depth limit", async () => {
    const subtree = await graph.getSubtree("category/adas", "part_of", 1);
    const slugs = subtree.map((n) => n.slug);
    expect(slugs).toContain("problem-class/activation-failure");
    expect(slugs).not.toContain("playbook/activation-step-1");
  });

  it("getOrderedSequence follows the precedes chain", async () => {
    const seq = await graph.getOrderedSequence("playbook/activation-step-1");
    expect(seq.map((n) => n.slug)).toEqual([
      "playbook/activation-step-1",
      "playbook/activation-step-2",
      "playbook/activation-step-3",
    ]);
    expect(seq[0].title).toBe("激活排查步骤1");
  });

  it("getOrderedSequence on a non-existent start returns empty", async () => {
    const seq = await graph.getOrderedSequence("playbook/missing");
    expect(seq).toEqual([]);
  });
});
