/**
 * Demo dataset seeder (launch sprint Task D1).
 *
 * Loads the synthetic English demo pages from `demo/seed/pages/**.md` into a
 * dedicated demo library (see `demo/demo.config.yaml`) using the regular store
 * APIs, then lays down a "last week" timeline computed relative to now — the
 * dataset must never contain hardcoded calendar dates.
 *
 * Idempotent: pages upsert by slug, wikilink edges upsert by (from,to,type),
 * and timeline entries for seeded pages are replaced wholesale on each run.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Database } from "../store/database.js";
import { PageStore } from "../store/pages.js";
import { TimelineStore } from "../store/timeline.js";

/** Repo-relative location of the demo page markdown files. */
export const DEMO_PAGES_DIR = "demo/seed/pages";

export interface SeedSummary {
  pages: number;
  links: number;
  timelineEntries: number;
}

export interface SeedOptions {
  /** Absolute path to the directory holding `<slug>.md` files. */
  pagesDir: string;
  /** Injectable clock for tests; defaults to `new Date()`. */
  now?: Date;
}

interface TimelineSpec {
  slug: string;
  daysAgo: number;
  hour: number;
  minute?: number;
  summary: string;
  detail: string;
}

/**
 * The demo "last week": every entry is an offset from now, so the dataset
 * stays fresh no matter when the seed runs (no time bombs).
 */
const TIMELINE: TimelineSpec[] = [
  {
    slug: "entities/alice-chen",
    daysAgo: 6,
    hour: 10,
    summary: "Launch scope review with Alice",
    detail:
      "Walked the full Phoenix launch scope with Alice Chen; she pushed to protect the Friday date over feature completeness.",
  },
  {
    slug: "decisions/phoenix-launch-friday",
    daysAgo: 6,
    hour: 11,
    minute: 30,
    summary: "Decided: ship Phoenix on Friday, cut the onboarding tour from v1",
    detail:
      "Alice made the call in the scope review — smaller launch on time beats a bigger launch two weeks late.",
  },
  {
    slug: "entities/project-phoenix",
    daysAgo: 5,
    hour: 9,
    summary: "Onboarding tour removed from the launch branch",
    detail:
      "Feature-flagged code deleted from the v1 branch; backlog item created for post-launch.",
  },
  {
    slug: "tasks/send-alice-pricing-copy",
    daysAgo: 5,
    hour: 15,
    summary: "Alice asked for the final pricing page copy by Wednesday",
    detail:
      "She wants a doc (not a Slack thread) so she can lock the pricing page layout before Friday.",
  },
  {
    slug: "entities/bob-martinez",
    daysAgo: 4,
    hour: 11,
    summary: "Bob finished the staging Terraform changes",
    detail:
      "Staging now mirrors production topology; PR open and waiting for review before the launch rehearsal.",
  },
  {
    slug: "knowledge/alice-prefers-async-loom",
    daysAgo: 4,
    hour: 16,
    summary: "Noted: Alice prefers async Loom reviews over live design crits",
    detail:
      "After canceling the standing crit, Alice said Loom links with specific questions get her fastest feedback.",
  },
  {
    slug: "tasks/qa-signup-flow",
    daysAgo: 3,
    hour: 10,
    summary: "QA pass on the self-serve signup flow",
    detail:
      "Happy path and invalid-card cases green; found the mobile nav overlap on the pricing page.",
  },
  {
    slug: "tasks/fix-mobile-nav-overlap",
    daysAgo: 3,
    hour: 14,
    summary: "Mobile nav overlap filed as launch blocker",
    detail: "Alice flagged it as embarrassing-if-shipped; fix assigned before the Friday launch.",
  },
  {
    slug: "decisions/pricing-three-tiers",
    daysAgo: 2,
    hour: 11,
    summary: "Pricing locked: Free, Pro, Team",
    detail:
      "Carol's three-tier proposal approved; pricing page copy updates to match the new tier names.",
  },
  {
    slug: "entities/alice-chen",
    daysAgo: 2,
    hour: 17,
    summary: "Reviewed Alice's Loom walkthrough of the final launch designs",
    detail:
      "Pricing page and signup flow look ready; two copy nits sent back, no structural changes.",
  },
  {
    slug: "references/phoenix-launch-checklist",
    daysAgo: 1,
    hour: 9,
    minute: 30,
    summary: "Launch checklist review: most gates green",
    detail:
      "Remaining items: pricing copy handoff to Alice, mobile nav fix merge, on-call briefing.",
  },
  {
    slug: "tasks/write-launch-announcement",
    daysAgo: 1,
    hour: 15,
    summary: "Launch announcement drafted",
    detail: "First full draft done; Carol reviews next, Alice supplies hero art from Figma.",
  },
  {
    slug: "entities/project-phoenix",
    daysAgo: 0,
    hour: 9,
    summary: "Final go/no-go: GO for the Friday launch",
    detail: "All launch-blocking items closed or owned; team confirmed the Friday ship date.",
  },
];

function walkMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out.sort();
}

/** `<pagesDir>/entities/alice-chen.md` → slug `entities/alice-chen`. */
function fileToSlug(pagesDir: string, file: string): string {
  return relative(pagesDir, file).replace(/\.md$/, "").split(sep).join("/");
}

function timelineDate(now: Date, spec: TimelineSpec): string {
  const d = new Date(now);
  d.setDate(d.getDate() - spec.daysAgo);
  d.setHours(spec.hour, spec.minute ?? 0, 0, 0);
  // Same-day entries scheduled after "now" would live in the future — clamp back.
  return (d > now ? now : d).toISOString();
}

/**
 * Seed the demo dataset into the given database. Safe to re-run: page and
 * link writes are upserts, and timeline entries for the seeded slugs are
 * replaced (relative dates would otherwise duplicate across days).
 */
export async function seedDemo(db: Database, opts: SeedOptions): Promise<SeedSummary> {
  const now = opts.now ?? new Date();
  const pages = new PageStore(db.executor);
  const timeline = new TimelineStore(db.executor);

  const files = walkMarkdownFiles(opts.pagesDir);
  const docs = files.map((file) => ({
    slug: fileToSlug(opts.pagesDir, file),
    content: readFileSync(file, "utf-8"),
  }));

  // Pass 1: create every page (chunked for FTS). Wikilinks pointing at pages
  // that appear later in the seed order cannot resolve yet.
  for (const doc of docs) {
    await pages.putPageWithChunks(db.executor, doc.slug, doc.content, { autoWikilink: false });
  }
  // Pass 2: now that all targets exist, wire every [[wikilink]] into edges.
  for (const doc of docs) {
    await pages.putPageWithChunks(db.executor, doc.slug, doc.content);
  }

  // Timeline: replace entries for seeded pages, then insert the relative feed.
  const slugs = docs.map((d) => d.slug);
  await db.executor.query(
    `DELETE FROM timeline_entries
     WHERE page_id IN (SELECT id FROM pages WHERE slug = ANY($1::text[]))`,
    [slugs],
  );
  for (const spec of TIMELINE) {
    await timeline.addEntry(spec.slug, {
      date: timelineDate(now, spec),
      summary: spec.summary,
      detail: spec.detail,
      source: "demo-seed",
    });
  }

  const [pageCount, linkCount, timelineCount] = await Promise.all([
    db.executor.query<{ cnt: string | number }>("SELECT COUNT(*) AS cnt FROM pages"),
    db.executor.query<{ cnt: string | number }>("SELECT COUNT(*) AS cnt FROM links"),
    db.executor.query<{ cnt: string | number }>("SELECT COUNT(*) AS cnt FROM timeline_entries"),
  ]);

  return {
    pages: Number(pageCount.rows[0].cnt),
    links: Number(linkCount.rows[0].cnt),
    timelineEntries: Number(timelineCount.rows[0].cnt),
  };
}
