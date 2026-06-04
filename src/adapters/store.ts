import { createHash } from "node:crypto";
import { stringify as yamlStringify } from "yaml";
import { compactSourceRef } from "../core/source-ref.js";
import type {
  Adapter,
  AdapterPushResult,
  Decision,
  Discovery,
  Entity,
  ExtractionResult,
  Knowledge,
  Link,
  SourceRef,
  TaskSignal,
  TimelineEntry,
} from "../core/types.js";
import type { ChunkStore } from "../store/chunks.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";

export interface StoreAdapterContext {
  pages: PageStore;
  chunks: ChunkStore;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
}

export interface StoreAdapterOpts {
  onPageWritten?: (info: { slug: string; type: string; title: string; summary: string }) => void;
}

export class StoreAdapter implements Adapter {
  id = "store";
  name = "Memoark Store Adapter";
  description = "Writes extraction results directly to PGLite stores";

  private stores: StoreAdapterContext;
  private onPageWritten?: StoreAdapterOpts["onPageWritten"];

  constructor(stores: StoreAdapterContext, opts?: StoreAdapterOpts) {
    this.stores = stores;
    this.onPageWritten = opts?.onPageWritten;
  }

  private notifyPageWritten(page: {
    slug: string;
    type: string;
    title: string;
    compiled_truth: string;
  }): void {
    if (!this.onPageWritten) return;
    this.onPageWritten({
      slug: page.slug,
      type: page.type,
      title: page.title,
      summary: page.compiled_truth.slice(0, 100),
    });
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      // Simple check - try to list pages
      await this.stores.pages.listPages({ limit: 1 });
      return { ok: true, message: "Store adapter is ready" };
    } catch (error) {
      return {
        ok: false,
        message: `Store adapter health check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async push(results: ExtractionResult[]): Promise<AdapterPushResult> {
    const pushResult: AdapterPushResult = {
      written: 0,
      skipped: 0,
      errors: [],
    };

    for (const result of results) {
      // Process Entities
      for (const entity of result.entities) {
        const writeResult = await this.writeEntity(
          entity,
          result.source.raw_hash,
          result.source,
          result.personAliases,
        );
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Decisions
      for (const decision of result.decisions) {
        const writeResult = await this.writeDecision(decision);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Tasks
      for (const task of result.tasks) {
        const writeResult = await this.writeTask(task);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Discoveries
      for (const discovery of result.discoveries) {
        const writeResult = await this.writeDiscovery(discovery);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Knowledge
      for (const knowledge of result.knowledge) {
        const writeResult = await this.writeKnowledge(knowledge);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Timeline Entries
      for (const entry of result.timeline) {
        const writeResult = await this.appendTimelineEntry(entry);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Links
      for (const link of result.links) {
        const writeResult = await this.appendLink(link);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }
    }

    return pushResult;
  }

  private async writeEntity(
    entity: Entity,
    sourceHash: string,
    source?: SourceRef,
    personAliases?: Record<string, string[]>,
  ): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const existingPage = await this.stores.pages.getPage(entity.slug);
      if (existingPage && existingPage.frontmatter.source_hash === sourceHash) {
        result.skipped += 1;
        return result;
      }

      const frontmatter: Record<string, unknown> = {
        title: entity.name,
        type: entity.type,
        confidence: entity.confidence,
        source_hash: sourceHash,
        created_at: existingPage?.frontmatter.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (source) {
        if (!existingPage?.frontmatter.first_seen) {
          frontmatter.first_seen = compactSourceRef(source);
        } else {
          frontmatter.first_seen = existingPage.frontmatter.first_seen;
        }
      }

      // Handle person aliases
      if (entity.type === "person" && personAliases?.[entity.slug]) {
        const newAliases = personAliases[entity.slug];
        const existingAliases = (existingPage?.frontmatter.aliases as string[]) ?? [];

        // Merge and deduplicate aliases
        const mergedAliases = Array.from(new Set([...existingAliases, ...newAliases]));

        frontmatter.aliases = mergedAliases;
      }

      const bodyParts = [`## Context\n\n${entity.context}`];

      // Add aliases section to body for person entities
      if (entity.type === "person" && frontmatter.aliases) {
        const aliasesList = (frontmatter.aliases as string[])
          .map((alias) => `- ${alias}`)
          .join("\n");
        bodyParts.unshift(`## Aliases\n\n${aliasesList}`);
      }

      const content = `---
${yamlStringify(frontmatter).trimEnd()}
---

${bodyParts.join("\n\n")}
`;

      // Write page
      const page = await this.stores.pages.putPage(entity.slug, content);

      // Notify callback
      this.notifyPageWritten(page);

      // Rechunk
      await this.stores.chunks.rechunk(page.id, page.compiled_truth);

      // Add entity tag
      await this.stores.tags.addTag(entity.slug, "entity");

      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `entity:${entity.slug}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async writeDecision(decision: Decision): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const slug = `decisions/${this.kebabCase(decision.summary)}`;
      const sourceHash = decision.source.raw_hash;

      // Check for duplicate
      const existingPage = await this.stores.pages.getPage(slug);
      if (existingPage && existingPage.frontmatter.source_hash === sourceHash) {
        result.skipped += 1;
        return result;
      }

      // Build markdown with frontmatter
      const frontmatter = {
        title: decision.summary,
        type: "decision",
        date: decision.date,
        entities: decision.entities,
        confidence: decision.confidence,
        source_hash: sourceHash,
        source: compactSourceRef(decision.source),
        created_at: new Date().toISOString(),
      };

      const parts: string[] = [];
      parts.push(`# ${decision.summary}`);
      parts.push("");

      if (decision.reasoning) {
        parts.push("## Reasoning");
        parts.push("");
        parts.push(decision.reasoning);
        parts.push("");
      }

      if (decision.alternatives && decision.alternatives.length > 0) {
        parts.push("## Alternatives");
        parts.push("");
        for (const alt of decision.alternatives) {
          parts.push(`- ${alt}`);
        }
        parts.push("");
      }

      const content = `---
${yamlStringify(frontmatter).trimEnd()}
---

${parts.join("\n")}`;

      // Write page
      const page = await this.stores.pages.putPage(slug, content);

      // Notify callback
      this.notifyPageWritten(page);

      // Rechunk
      await this.stores.chunks.rechunk(page.id, page.compiled_truth);

      // Add tags
      await this.stores.tags.addTag(slug, "decision");

      // Create links to entities
      for (const entitySlug of decision.entities) {
        await this.stores.graph.addLink(
          slug,
          entitySlug,
          "mentions",
          "Referenced in decision",
          decision.source,
          sourceHash,
        );
      }

      for (const entitySlug of decision.entities) {
        try {
          await this.stores.timeline.addEntry(entitySlug, {
            date: decision.date,
            summary: `Decision: ${decision.summary}`,
            detail: decision.reasoning ?? "",
            source: decision.source.platform,
            provenance: decision.source,
          });
        } catch {
          // Entity page might not exist yet, skip
        }
      }

      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `decision:${decision.summary}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async writeTask(task: TaskSignal): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const slug = `tasks/${this.kebabCase(task.title)}`;
      const sourceHash = task.source.raw_hash;

      // Check for duplicate
      const existingPage = await this.stores.pages.getPage(slug);
      if (existingPage && existingPage.frontmatter.source_hash === sourceHash) {
        result.skipped += 1;
        return result;
      }

      // Build markdown with frontmatter
      const frontmatter: Record<string, unknown> = {
        title: task.title,
        type: "task",
        status: task.status,
        confidence: task.confidence,
        source_hash: sourceHash,
        source: compactSourceRef(task.source),
        created_at: new Date().toISOString(),
      };

      if (task.owner) frontmatter.owner = task.owner;
      if (task.project) frontmatter.project = task.project;
      if (task.due_date) frontmatter.due_date = task.due_date;

      const content = `---
${yamlStringify(frontmatter).trimEnd()}
---

# ${task.title}
`;

      // Write page
      const page = await this.stores.pages.putPage(slug, content);

      // Notify callback
      this.notifyPageWritten(page);

      // Rechunk
      await this.stores.chunks.rechunk(page.id, page.compiled_truth);

      // Add tags
      await this.stores.tags.addTag(slug, "task");

      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `task:${task.title}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async writeDiscovery(discovery: Discovery): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const slug = `discoveries/${this.kebabCase(discovery.summary)}`;
      const sourceHash = discovery.source.raw_hash;

      // Check for duplicate
      const existingPage = await this.stores.pages.getPage(slug);
      if (existingPage && existingPage.frontmatter.source_hash === sourceHash) {
        result.skipped += 1;
        return result;
      }

      // Build markdown with frontmatter
      const frontmatter = {
        title: discovery.summary,
        type: `discovery-${discovery.type}`,
        entities: discovery.entities,
        confidence: discovery.confidence,
        source_hash: sourceHash,
        source: compactSourceRef(discovery.source),
        created_at: new Date().toISOString(),
      };

      const parts: string[] = [];
      parts.push(`# ${discovery.summary}`);
      parts.push("");

      if (discovery.detail) {
        parts.push("## Detail");
        parts.push("");
        parts.push(discovery.detail);
        parts.push("");
      }

      const content = `---
${yamlStringify(frontmatter).trimEnd()}
---

${parts.join("\n")}`;

      // Write page
      const page = await this.stores.pages.putPage(slug, content);

      // Notify callback
      this.notifyPageWritten(page);

      // Rechunk
      await this.stores.chunks.rechunk(page.id, page.compiled_truth);

      // Add tags
      await this.stores.tags.addTag(slug, "discovery");
      await this.stores.tags.addTag(slug, discovery.type);

      // Create links to entities
      for (const entitySlug of discovery.entities) {
        await this.stores.graph.addLink(
          slug,
          entitySlug,
          "mentions",
          "Referenced in discovery",
          discovery.source,
          sourceHash,
        );
      }

      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `discovery:${discovery.summary}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async writeKnowledge(knowledge: Knowledge): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      // Skip speculative knowledge
      if (knowledge.confidence === "speculative") {
        result.skipped += 1;
        return result;
      }

      // Build slug: knowledge/{topic}/{content-hash-12}
      const contentHash = this.contentHash(knowledge.content);
      const contentHash12 = contentHash.slice(0, 12);
      const slug = `knowledge/${knowledge.topic}/${contentHash12}`;
      const sourceHash = knowledge.source.raw_hash;

      // Check for duplicate
      const existingPage = await this.stores.pages.getPage(slug);
      if (existingPage && existingPage.frontmatter.source_hash === sourceHash) {
        result.skipped += 1;
        return result;
      }

      // Build markdown with frontmatter
      const frontmatter: Record<string, unknown> = {
        title: knowledge.content.slice(0, 80),
        type: "knowledge",
        topic: knowledge.topic,
        source_type: knowledge.source_type,
        confidence: knowledge.confidence,
        source_hash: sourceHash,
        source: compactSourceRef(knowledge.source),
        created_at: new Date().toISOString(),
      };

      if (knowledge.valid_at) frontmatter.valid_at = knowledge.valid_at;
      if (knowledge.invalid_at) frontmatter.invalid_at = knowledge.invalid_at;

      const parts: string[] = [];
      parts.push(`# ${knowledge.content}`);
      parts.push("");
      parts.push("## Related Entities");
      parts.push("");
      if (knowledge.related_entities.length > 0) {
        for (const entity of knowledge.related_entities) {
          parts.push(`- ${entity}`);
        }
      } else {
        parts.push("- (none)");
      }
      parts.push("");

      const content = `---
${yamlStringify(frontmatter).trimEnd()}
---

${parts.join("\n")}`;

      // Write page
      const page = await this.stores.pages.putPage(slug, content);

      // Notify callback
      this.notifyPageWritten(page);

      // Rechunk
      await this.stores.chunks.rechunk(page.id, page.compiled_truth);

      // Add tags
      await this.stores.tags.addTag(slug, "knowledge");
      await this.stores.tags.addTag(slug, knowledge.topic);

      // Create links to related entities
      for (const entitySlug of knowledge.related_entities) {
        await this.stores.graph.addLink(
          slug,
          entitySlug,
          "mentions",
          "Referenced in knowledge",
          knowledge.source,
          sourceHash,
        );
      }

      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `knowledge:${knowledge.topic}/${knowledge.content.slice(0, 30)}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async appendTimelineEntry(entry: TimelineEntry): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    // Add timeline entry to all related entity pages
    for (const entitySlug of entry.entities) {
      try {
        await this.stores.timeline.addEntry(entitySlug, {
          date: entry.date,
          summary: entry.summary,
          source: entry.source.platform,
          provenance: entry.source,
        });

        result.written += 1;
      } catch (error) {
        // Entity page might not exist yet, skip
        result.errors.push({
          signal: `timeline:${entitySlug}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async appendLink(link: Link): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      await this.stores.graph.addLink(
        link.from,
        link.to,
        link.type,
        link.context,
        link.source,
        link.source.raw_hash,
      );
      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `link:${link.from}-${link.to}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private kebabCase(str: string): string {
    const ascii = str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (ascii.length >= 3) return ascii;
    const hash = createHash("sha256").update(str).digest("hex").slice(0, 12);
    return ascii ? `${ascii}-${hash}` : hash;
  }

  private contentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}
