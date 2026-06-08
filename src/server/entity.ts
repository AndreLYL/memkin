import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TimelineStore } from "../store/timeline.js";

interface EntityStores {
  pages: PageStore;
  graph: GraphStore;
  timeline: TimelineStore;
}

export async function listSignalsByEntity(
  stores: EntityStores,
  entitySlug: string,
  signalTypes?: string[],
  limit = 20,
): Promise<
  Array<{ slug: string; title: string; type: string; frontmatter: Record<string, unknown> }>
> {
  const backlinks = await stores.graph.getBacklinksEnriched(entitySlug);
  let signals = backlinks.map((b) => ({
    slug: b.from_slug,
    title: b.page.title,
    type: b.page.type,
    frontmatter: b.page.frontmatter,
  }));
  if (signalTypes && signalTypes.length > 0) {
    const typeSet = new Set(signalTypes);
    signals = signals.filter((s) => typeSet.has(s.type));
  }
  return signals.slice(0, limit);
}

export async function getEntityProfile(
  stores: EntityStores,
  entitySlug: string,
): Promise<{
  page: Awaited<ReturnType<PageStore["getPage"]>>;
  signals: Record<
    string,
    Array<{ slug: string; title: string; frontmatter: Record<string, unknown> }>
  >;
  timeline: Awaited<ReturnType<TimelineStore["getTimeline"]>>;
}> {
  const [page, backlinks, timeline] = await Promise.all([
    stores.pages.getPage(entitySlug),
    stores.graph.getBacklinksEnriched(entitySlug),
    stores.timeline.getTimeline(entitySlug),
  ]);

  const signals: Record<
    string,
    Array<{ slug: string; title: string; frontmatter: Record<string, unknown> }>
  > = {};
  for (const b of backlinks) {
    const type = b.page.type;
    if (!signals[type]) signals[type] = [];
    signals[type].push({
      slug: b.from_slug,
      title: b.page.title,
      frontmatter: b.page.frontmatter,
    });
  }

  return { page, signals, timeline };
}
