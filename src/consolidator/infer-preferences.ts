import { stringify as yamlStringify } from "yaml";
import type { LLMProvider } from "../extractors/providers/types.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";

interface InferStores {
  pages: PageStore;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
}

interface InferredPreference {
  summary: string;
  category: string;
  confidence: string;
}

function kebabCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function inferPreferences(stores: InferStores, llm: LLMProvider): Promise<number> {
  // Only infer for person entities (the subject of behavioral patterns)
  const personPages = await stores.pages.listPages({ type: "person" });
  let totalInferred = 0;

  for (const entity of personPages) {
    const timeline = await stores.timeline.getTimeline(entity.slug);
    if (timeline.length < 3) continue; // not enough data for inference

    const timelineSummary = timeline
      .slice(0, 50) // cap to 50 recent entries
      .map((e) => `[${e.date}] ${e.summary}`)
      .join("\n");

    // Ask LLM whether any strong patterns exist
    let rawResponse: string;
    try {
      rawResponse = await llm.chat([
        {
          role: "system",
          content:
            "You infer behavioral preferences from timeline and task patterns. " +
            "If there are clear patterns (80%+ consistency across at least 3 data points), " +
            "output a JSON array of inferred preferences. Otherwise output [].\n" +
            'Each preference: {"summary": "...", "category": "scheduling|workflow|communication", "confidence": "inferred"}\n' +
            "Output ONLY valid JSON, no explanation.",
        },
        {
          role: "user",
          content: `Entity: ${entity.title} (${entity.slug})\n\nTimeline entries:\n${timelineSummary}`,
        },
      ]);
    } catch {
      continue;
    }

    let preferences: InferredPreference[];
    try {
      preferences = JSON.parse(rawResponse.trim()) as InferredPreference[];
      if (!Array.isArray(preferences)) continue;
    } catch {
      continue; // LLM returned non-JSON
    }

    for (const pref of preferences) {
      if (!pref.summary || !pref.category) continue;

      const slug = `preferences/inferred-${entity.slug.replace(/\//g, "-")}-${kebabCase(pref.summary)}`;

      const frontmatter: Record<string, unknown> = {
        title: pref.summary,
        type: "preference",
        category: pref.category,
        confidence: "inferred",
        inferred: true,
        entity: entity.slug,
        created_at: new Date().toISOString(),
      };
      const content = `---\n${yamlStringify(frontmatter).trim()}\n---\n\nInferred from timeline patterns for ${entity.title}.`;

      await stores.pages.putPage(slug, content, { halflife_days: 90 });
      await stores.graph.addLink(slug, entity.slug, "mentions");
      await stores.tags.addTag(slug, "preference");
      await stores.tags.addTag(slug, pref.category);

      totalInferred++;
    }
  }

  return totalInferred;
}
