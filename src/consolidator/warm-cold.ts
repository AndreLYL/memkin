import { stringify as yamlStringify } from "yaml";
import type { LLMProvider } from "../extractors/providers/types.js";
import type { GraphStore } from "../store/graph.js";
import type { Page, PageStore } from "../store/pages.js";
import { canCompress, WARM_TO_COLD_DAYS } from "./rules.js";

interface WarmColdStores {
  pages: PageStore;
  graph: GraphStore;
}

export interface WarmColdResult {
  warmToCold: number;
}

export async function consolidateWarmToCold(
  stores: WarmColdStores,
  llm: LLMProvider,
  dryRun = false,
): Promise<WarmColdResult> {
  // Find all entity pages to use as grouping anchors
  const entityTypes = ["person", "project", "organization", "tool", "concept", "entity"];
  let entityPages: Page[] = [];
  for (const type of entityTypes) {
    const pages = await stores.pages.listPages({ type });
    entityPages = entityPages.concat(pages);
  }

  let warmToCold = 0;

  for (const entity of entityPages) {
    // Get warm pages linked to this entity
    const backlinks = await stores.graph.getBacklinksEnriched(entity.slug);
    const mentionBacklinks = backlinks.filter((b) => b.link_type === "mentions");

    const warmPages: Page[] = [];
    for (const backlink of mentionBacklinks) {
      const page = await stores.pages.getPage(backlink.from_slug);
      if (!page || page.tier !== "warm") continue;
      if (!canCompress(page.type)) continue;
      if (page.frontmatter.user_edited === true) continue;

      // Check age threshold
      const thresholdDays = WARM_TO_COLD_DAYS[page.type] ?? null;
      if (thresholdDays === null) continue;

      const createdAtRaw = (page.frontmatter.created_at as string | undefined) ?? page.created_at;
      const ageMs = Date.now() - new Date(createdAtRaw).getTime();
      const ageDays = ageMs / 86_400_000;
      if (ageDays < thresholdDays) continue;

      warmPages.push(page);
    }

    if (warmPages.length === 0) continue;

    if (dryRun) {
      warmToCold += warmPages.length;
      continue;
    }

    // LLM: generate entity summary from warm page content
    const candidateText = warmPages
      .map((p) => `## ${p.title}\n\n${p.compiled_truth}`)
      .join("\n\n---\n\n");

    let summary: string;
    try {
      summary = await llm.chat([
        {
          role: "system",
          content:
            "You are summarizing memory signals about a person, project, or concept. " +
            "Write a concise narrative (under 400 words) capturing: key decisions, " +
            "current state, important preferences and patterns, and key knowledge. " +
            "Plain prose, no headers, no bullet points.",
        },
        {
          role: "user",
          content: `Entity: ${entity.title} (${entity.slug})\n\nSource signals:\n\n${candidateText}`,
        },
      ]);
    } catch (err) {
      console.warn(`warm-cold: LLM failed for entity ${entity.slug}:`, err);
      continue;
    }

    // Create or update cold page at cold/<entity.slug>
    const coldSlug = `cold/${entity.slug}`;
    const frontmatter: Record<string, unknown> = {
      title: `${entity.title} — cold summary`,
      type: "knowledge",
      consolidated: true,
      consolidated_from: warmPages.map((p) => p.slug),
      entity: entity.slug,
      created_at: new Date().toISOString(),
    };
    const coldContent = `---\n${yamlStringify(frontmatter).trim()}\n---\n\n${summary}`;
    const coldPage = await stores.pages.putPage(coldSlug, coldContent, { halflife_days: null });
    await stores.pages.updatePageTier(coldPage.id, "cold");

    // Link cold page to entity
    await stores.graph.addLink(coldSlug, entity.slug, "mentions");

    // Mark warm pages as consolidated into the cold page
    for (const page of warmPages) {
      await stores.pages.updatePageTier(page.id, "cold", coldPage.id);
    }

    warmToCold += warmPages.length;
  }

  return { warmToCold };
}
