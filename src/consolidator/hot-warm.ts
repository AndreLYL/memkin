import { stringify as yamlStringify } from "yaml";
import type { GraphStore } from "../store/graph.js";
import type { Page, PageStore } from "../store/pages.js";
import { canCompress } from "./rules.js";

interface HotWarmStores {
  pages: PageStore;
  graph: GraphStore;
}

export async function consolidateHotToWarm(stores: HotWarmStores, dryRun = false): Promise<number> {
  const expired = await stores.pages.listExpiredHot();
  if (expired.length === 0) return 0;

  // Separate: pages whose content can be merged vs. those that only advance tier
  const compressible = expired.filter(
    (p) => canCompress(p.type) && p.frontmatter.user_edited !== true,
  );
  const nonCompressible = expired.filter(
    (p) => !canCompress(p.type) || p.frontmatter.user_edited === true,
  );

  if (dryRun) {
    return expired.length;
  }

  // Non-compressible: just advance tier to 'warm', content untouched
  for (const page of nonCompressible) {
    await stores.pages.updatePageTier(page.id, "warm");
  }

  // Compressible: batch-load their outgoing links, then group by (entitySlug, type)
  const slugs = compressible.map((p) => p.slug);
  const linksMap = await stores.graph.getLinksForSlugs(slugs);

  // Group pages: key = "entitySlug::type" | "__none__::type" (for pages with no entity link)
  type GroupKey = string;
  const groups = new Map<GroupKey, Page[]>();

  for (const page of compressible) {
    const links = (linksMap.get(page.slug) ?? []).sort((a, b) =>
      a.to_slug.localeCompare(b.to_slug),
    );
    // Primary entity: first mention alphabetically by to_slug. Pages mentioning
    // multiple entities are anchored to one; all are recorded in mentioned_entities.
    const entityLink = links.find((l) => l.link_type === "mentions");
    const entitySlug = entityLink?.to_slug ?? "__none__";
    const key: GroupKey = `${entitySlug}::${page.type}`;
    const existing = groups.get(key) ?? [];
    existing.push(page);
    groups.set(key, existing);
  }

  // For each group: create one warm aggregate page, point originals to it
  for (const [key, pages] of groups) {
    const [entitySlug, type] = key.split("::");

    // Build merged content: concatenate compiled_truth of all pages
    const mergedContent = pages
      .map((p) => `### ${p.title}\n\n${p.compiled_truth}`)
      .join("\n\n---\n\n");

    // Determine a stable slug for this warm aggregate
    const entityPart = entitySlug === "__none__" ? "unanchored" : entitySlug.replace(/\//g, "-");
    const warmSlug = `warm/${entityPart}/${type}-consolidated`;

    // Write the warm aggregate page (upsert — idempotency: if it already exists, append)
    const existingWarm = await stores.pages.getPage(warmSlug);
    const existingContent = existingWarm ? `${existingWarm.compiled_truth}\n\n---\n\n` : "";
    const combinedContent = existingContent + mergedContent;

    // Collect all mentioned entities across all pages in this group
    const allLinks = pages.flatMap((p) => linksMap.get(p.slug) ?? []);
    const mentionedEntities = [
      ...new Set(allLinks.filter((l) => l.link_type === "mentions").map((l) => l.to_slug)),
    ].sort();

    const frontmatter: Record<string, unknown> = {
      title: `Consolidated ${type} (${entitySlug === "__none__" ? "unanchored" : entitySlug})`,
      type,
      consolidated: true,
      source_slugs: [
        ...((existingWarm?.frontmatter.source_slugs as string[]) ?? []),
        ...pages.map((p) => p.slug),
      ],
      mentioned_entities: [
        ...new Set([
          ...((existingWarm?.frontmatter.mentioned_entities as string[]) ?? []),
          ...mentionedEntities,
        ]),
      ].sort(),
      created_at:
        existingWarm?.frontmatter.created_at ??
        pages.reduce((min, p) => (p.created_at < min ? p.created_at : min), pages[0].created_at),
    };

    const warmPageContent = `---\n${yamlStringify(frontmatter).trim()}\n---\n\n${combinedContent}`;
    const warmPage = await stores.pages.putPage(warmSlug, warmPageContent, {
      halflife_days: null,
    });

    // Override tier to 'warm' (putPage defaults to 'hot')
    await stores.pages.updatePageTier(warmPage.id, "warm");

    // If entity exists, link the warm page to it
    if (entitySlug !== "__none__") {
      const entityPage = await stores.pages.getPage(entitySlug);
      if (entityPage) {
        await stores.graph.addLink(warmSlug, entitySlug, "mentions");
      }
    }

    // Point originals to the warm aggregate
    for (const page of pages) {
      await stores.pages.updatePageTier(page.id, "warm", warmPage.id);
    }
  }

  return expired.length;
}
