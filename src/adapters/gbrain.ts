import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify as yamlStringify } from "yaml";
import type {
  Adapter,
  AdapterPushResult,
  Decision,
  Discovery,
  Entity,
  ExtractionResult,
  Knowledge,
  Link,
  TaskSignal,
  TimelineEntry,
} from "../core/types.js";

export interface GBrainAdapterConfig {
  output_dir: string;
}

interface PageFrontmatter {
  title: string;
  type: string;
  slug: string;
  created_at?: string;
  updated_at?: string;
  confidence?: string;
  entities?: string[];
  date?: string;
  status?: string;
  owner?: string;
  project?: string;
}

interface ParsedPage {
  frontmatter: PageFrontmatter;
  sections: Map<string, string[]>; // section name -> lines
}

export class GBrainAdapter implements Adapter {
  id = "gbrain";
  name = "GBrain Adapter";
  description = "Writes extraction results to GBrain page files";

  private config: GBrainAdapterConfig;

  constructor(config: GBrainAdapterConfig) {
    this.config = config;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!existsSync(this.config.output_dir)) {
      return { ok: false, message: `Output directory does not exist: ${this.config.output_dir}` };
    }

    return { ok: true, message: "GBrain adapter is ready" };
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
        const writeResult = await this.writeEntity(entity, result.source.raw_hash);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Decisions
      for (const decision of result.decisions) {
        const writeResult = await this.writeDecision(decision, result.source.raw_hash);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Tasks
      for (const task of result.tasks) {
        const writeResult = await this.writeTask(task, result.source.raw_hash);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Discoveries
      for (const discovery of result.discoveries) {
        const writeResult = await this.writeDiscovery(discovery, result.source.raw_hash);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Timeline Entries
      for (const entry of result.timeline) {
        const writeResult = await this.appendTimelineEntry(entry, result.source.raw_hash);
        pushResult.written += writeResult.written;
        pushResult.skipped += writeResult.skipped;
        pushResult.errors.push(...writeResult.errors);
      }

      // Process Links
      for (const link of result.links) {
        const writeResult = await this.appendLink(link, result.source.raw_hash);
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
    }

    return pushResult;
  }

  private async writeEntity(entity: Entity, _sourceHash: string): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const filepath = join(this.config.output_dir, `${entity.slug}.md`);
      const dirPath = dirname(filepath);

      // Ensure directory exists
      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }

      let content: string;
      if (existsSync(filepath)) {
        // Merge with existing page
        const existingContent = await readFile(filepath, "utf-8");
        const parsed = this.parsePage(existingContent);

        // Update frontmatter
        parsed.frontmatter.updated_at = new Date().toISOString();
        parsed.frontmatter.confidence = entity.confidence;

        // Update context section
        parsed.sections.set("Context", [entity.context]);

        content = this.serializePage(parsed);
        result.written += 1;
      } else {
        // Create new page
        const frontmatter: PageFrontmatter = {
          title: entity.name,
          type: entity.type,
          slug: entity.slug,
          created_at: new Date().toISOString(),
          confidence: entity.confidence,
        };

        content = this.createEntityPage(frontmatter, entity.context);
        result.written += 1;
      }

      await writeFile(filepath, content, "utf-8");
    } catch (error) {
      result.errors.push({
        signal: `entity:${entity.slug}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async writeDecision(decision: Decision, sourceHash: string): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const slug = this.kebabCase(decision.summary);
      const filepath = join(this.config.output_dir, "decisions", `${slug}.md`);
      const dirPath = dirname(filepath);

      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }

      // Check if same decision already exists with same hash
      if (existsSync(filepath)) {
        const existingContent = await readFile(filepath, "utf-8");
        if (existingContent.includes(`source_hash: ${sourceHash}`)) {
          result.skipped += 1;
          return result;
        }
      }

      const frontmatter: PageFrontmatter = {
        title: decision.summary,
        type: "decision",
        slug: `decisions/${slug}`,
        date: decision.date,
        entities: decision.entities,
        created_at: new Date().toISOString(),
      };

      const parts: string[] = [];

      // Frontmatter
      parts.push("---");
      parts.push(`title: ${frontmatter.title}`);
      parts.push(`type: ${frontmatter.type}`);
      parts.push(`slug: ${frontmatter.slug}`);
      parts.push(`date: ${frontmatter.date}`);
      if (decision.entities.length > 0) {
        parts.push("entities:");
        for (const entity of decision.entities) {
          parts.push(`  - ${entity}`);
        }
      }
      parts.push(`confidence: ${decision.confidence}`);
      parts.push(`source_hash: ${sourceHash}`);
      parts.push(`created_at: ${frontmatter.created_at}`);
      parts.push("---");
      parts.push("");

      // Summary
      parts.push(`# ${decision.summary}`);
      parts.push("");

      // Reasoning
      if (decision.reasoning) {
        parts.push("## Reasoning");
        parts.push("");
        parts.push(decision.reasoning);
        parts.push("");
      }

      // Alternatives
      if (decision.alternatives && decision.alternatives.length > 0) {
        parts.push("## Alternatives");
        parts.push("");
        for (const alt of decision.alternatives) {
          parts.push(`- ${alt}`);
        }
        parts.push("");
      }

      await writeFile(filepath, parts.join("\n"), "utf-8");
      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `decision:${decision.summary}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async writeTask(task: TaskSignal, sourceHash: string): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const slug = this.kebabCase(task.title);
      const filepath = join(this.config.output_dir, "tasks", `${slug}.md`);
      const dirPath = dirname(filepath);

      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }

      // Check for duplicate
      if (existsSync(filepath)) {
        const existingContent = await readFile(filepath, "utf-8");
        if (existingContent.includes(`source_hash: ${sourceHash}`)) {
          result.skipped += 1;
          return result;
        }
      }

      const frontmatter: PageFrontmatter = {
        title: task.title,
        type: "task",
        slug: `tasks/${slug}`,
        status: task.status,
        owner: task.owner,
        project: task.project,
        created_at: new Date().toISOString(),
      };

      const parts: string[] = [];

      // Frontmatter
      parts.push("---");
      parts.push(`title: ${frontmatter.title}`);
      parts.push(`type: ${frontmatter.type}`);
      parts.push(`slug: ${frontmatter.slug}`);
      parts.push(`status: ${frontmatter.status}`);
      if (task.owner) parts.push(`owner: ${task.owner}`);
      if (task.project) parts.push(`project: ${task.project}`);
      if (task.due_date) parts.push(`due_date: ${task.due_date}`);
      parts.push(`confidence: ${task.confidence}`);
      parts.push(`source_hash: ${sourceHash}`);
      parts.push(`created_at: ${frontmatter.created_at}`);
      parts.push("---");
      parts.push("");

      // Title
      parts.push(`# ${task.title}`);
      parts.push("");

      await writeFile(filepath, parts.join("\n"), "utf-8");
      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `task:${task.title}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async writeDiscovery(
    discovery: Discovery,
    sourceHash: string,
  ): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const slug = this.kebabCase(discovery.summary);
      const filepath = join(this.config.output_dir, "discoveries", `${slug}.md`);
      const dirPath = dirname(filepath);

      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }

      // Check for duplicate
      if (existsSync(filepath)) {
        const existingContent = await readFile(filepath, "utf-8");
        if (existingContent.includes(`source_hash: ${sourceHash}`)) {
          result.skipped += 1;
          return result;
        }
      }

      const frontmatter: PageFrontmatter = {
        title: discovery.summary,
        type: `discovery-${discovery.type}`,
        slug: `discoveries/${slug}`,
        entities: discovery.entities,
        created_at: new Date().toISOString(),
      };

      const parts: string[] = [];

      // Frontmatter
      parts.push("---");
      parts.push(`title: ${frontmatter.title}`);
      parts.push(`type: ${frontmatter.type}`);
      parts.push(`slug: ${frontmatter.slug}`);
      if (discovery.entities.length > 0) {
        parts.push("entities:");
        for (const entity of discovery.entities) {
          parts.push(`  - ${entity}`);
        }
      }
      parts.push(`confidence: ${discovery.confidence}`);
      parts.push(`source_hash: ${sourceHash}`);
      parts.push(`created_at: ${frontmatter.created_at}`);
      parts.push("---");
      parts.push("");

      // Summary
      parts.push(`# ${discovery.summary}`);
      parts.push("");

      // Detail
      if (discovery.detail) {
        parts.push("## Detail");
        parts.push("");
        parts.push(discovery.detail);
        parts.push("");
      }

      await writeFile(filepath, parts.join("\n"), "utf-8");
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
        console.warn(
          `Skipping speculative knowledge: ${knowledge.topic}/${knowledge.content.slice(0, 30)}`,
        );
        result.skipped += 1;
        return result;
      }

      // Resolve source_hash (fallback to content hash if empty)
      const sourceHash = knowledge.source.raw_hash || this.contentHash(knowledge.content);

      // Build path: knowledge/{topic}/{content-hash-12}-{content-slug}.md
      const contentHash12 = this.contentHash(knowledge.content).slice(0, 12);
      const contentSlug = this.kebabCase(knowledge.content.slice(0, 50));
      const filename = `${contentHash12}-${contentSlug}.md`;
      const filepath = join(this.config.output_dir, "knowledge", knowledge.topic, filename);
      const dirPath = dirname(filepath);

      if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
      }

      if (existsSync(filepath)) {
        const existingContent = await readFile(filepath, "utf-8");

        // Case 2: Same source_hash → skip (exact duplicate)
        if (
          existingContent.includes(`source_hash: ${sourceHash}`) ||
          existingContent.includes(`source_hash: "${sourceHash}"`) ||
          existingContent.includes(`source_hash: '${sourceHash}'`)
        ) {
          result.skipped += 1;
          return result;
        }

        // Case 3: Different source_hash → append provenance
        const provenanceEntry = [
          "",
          `> ${knowledge.source.quote}`,
          "",
          `**Platform:** ${knowledge.source.platform} | **Channel:** ${knowledge.source.channel} | **Time:** ${knowledge.source.timestamp}`,
          "",
        ].join("\n");

        // Update updated_at in frontmatter
        let updatedContent = existingContent.replace(
          /^(---\n[\s\S]*?)(---)/m,
          (_match, front, closing) => {
            const now = new Date().toISOString();
            if (front.includes("updated_at:")) {
              return front.replace(/updated_at:.*/, `updated_at: "${now}"`) + closing;
            }
            return `${front}updated_at: "${now}"\n${closing}`;
          },
        );

        // Insert before "## Related Entities" section
        const relatedIdx = updatedContent.indexOf("## Related Entities");
        if (relatedIdx !== -1) {
          updatedContent =
            updatedContent.slice(0, relatedIdx) +
            provenanceEntry +
            updatedContent.slice(relatedIdx);
        } else {
          updatedContent = `${updatedContent}\n${provenanceEntry}`;
        }

        await writeFile(filepath, updatedContent, "utf-8");
        result.written += 1;
        return result;
      }

      // Case 1: New file — create with YAML serializer
      const frontmatter: Record<string, unknown> = {
        title: knowledge.content.slice(0, 80),
        type: "knowledge",
        slug: `knowledge/${knowledge.topic}/${contentHash12}-${contentSlug}`,
        topic: knowledge.topic,
        source_type: knowledge.source_type,
        confidence: knowledge.confidence,
        source_hash: sourceHash,
        source_platform: knowledge.source.platform,
        source_channel: knowledge.source.channel,
        source_timestamp: knowledge.source.timestamp,
        created_at: new Date().toISOString(),
      };

      if (knowledge.valid_at) frontmatter.valid_at = knowledge.valid_at;
      if (knowledge.invalid_at) frontmatter.invalid_at = knowledge.invalid_at;

      const parts: string[] = [];

      // YAML serializer for safe frontmatter
      parts.push("---");
      parts.push(yamlStringify(frontmatter).trimEnd());
      parts.push("---");
      parts.push("");

      // Content
      parts.push(`# ${knowledge.content}`);
      parts.push("");

      // Provenance
      parts.push("## Provenance");
      parts.push("");
      parts.push(`> ${knowledge.source.quote}`);
      parts.push("");
      parts.push(
        `**Platform:** ${knowledge.source.platform} | **Channel:** ${knowledge.source.channel} | **Time:** ${knowledge.source.timestamp}`,
      );
      parts.push("");

      // Related Entities
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

      await writeFile(filepath, parts.join("\n"), "utf-8");
      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `knowledge:${knowledge.topic}/${knowledge.content.slice(0, 30)}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private async appendTimelineEntry(
    entry: TimelineEntry,
    sourceHash: string,
  ): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    // Append timeline entry to all related entity pages
    for (const entitySlug of entry.entities) {
      try {
        const filepath = join(this.config.output_dir, `${entitySlug}.md`);

        if (!existsSync(filepath)) {
          // Entity page doesn't exist yet, skip
          continue;
        }

        const existingContent = await readFile(filepath, "utf-8");

        // Check for duplicate
        if (
          existingContent.includes(`source_hash: ${sourceHash}`) &&
          existingContent.includes(entry.summary)
        ) {
          result.skipped += 1;
          continue;
        }

        const parsed = this.parsePage(existingContent);

        // Get or create Timeline section
        const timelineLines = parsed.sections.get("Timeline") || [];

        // Add new entry
        timelineLines.push(`### ${entry.date}`);
        timelineLines.push("");
        timelineLines.push(entry.summary);
        timelineLines.push("");
        timelineLines.push(`**Confidence:** ${entry.confidence}`);
        timelineLines.push(`**Source Hash:** ${sourceHash}`);
        timelineLines.push("");

        parsed.sections.set("Timeline", timelineLines);

        const newContent = this.serializePage(parsed);
        await writeFile(filepath, newContent, "utf-8");

        result.written += 1;
      } catch (error) {
        result.errors.push({
          signal: `timeline:${entitySlug}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }

  private async appendLink(link: Link, sourceHash: string): Promise<AdapterPushResult> {
    const result: AdapterPushResult = { written: 0, skipped: 0, errors: [] };

    try {
      const filepath = join(this.config.output_dir, `${link.from}.md`);

      if (!existsSync(filepath)) {
        // From entity page doesn't exist yet, skip
        return result;
      }

      const existingContent = await readFile(filepath, "utf-8");

      // Check for duplicate
      if (
        existingContent.includes(`${link.type}: ${link.to}`) &&
        existingContent.includes(`source_hash: ${sourceHash}`)
      ) {
        result.skipped += 1;
        return result;
      }

      const parsed = this.parsePage(existingContent);

      // Get or create Links section
      const linksLines = parsed.sections.get("Links") || [];

      // Add new link
      linksLines.push(`- **${link.type}**: ${link.to}`);
      linksLines.push(`  - Context: ${link.context}`);
      linksLines.push(`  - Confidence: ${link.confidence}`);
      linksLines.push(`  - Source Hash: ${sourceHash}`);
      linksLines.push("");

      parsed.sections.set("Links", linksLines);

      const newContent = this.serializePage(parsed);
      await writeFile(filepath, newContent, "utf-8");

      result.written += 1;
    } catch (error) {
      result.errors.push({
        signal: `link:${link.from}-${link.to}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return result;
  }

  private parsePage(content: string): ParsedPage {
    const lines = content.split("\n");
    const frontmatter: Partial<PageFrontmatter> = {};
    const sections = new Map<string, string[]>();

    let inFrontmatter = false;
    let currentSection = "";
    let currentSectionLines: string[] = [];

    for (const line of lines) {
      if (line.trim() === "---") {
        if (!inFrontmatter) {
          inFrontmatter = true;
        } else {
          inFrontmatter = false;
        }
        continue;
      }

      if (inFrontmatter) {
        // Parse frontmatter
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          (frontmatter as Record<string, string>)[key] = value;
        }
      } else if (line.startsWith("## ")) {
        // Save previous section
        if (currentSection) {
          sections.set(currentSection, currentSectionLines);
        }

        // Start new section
        currentSection = line.substring(3).trim();
        currentSectionLines = [];
      } else if (currentSection) {
        currentSectionLines.push(line);
      }
    }

    // Save last section
    if (currentSection) {
      sections.set(currentSection, currentSectionLines);
    }

    return {
      frontmatter: frontmatter as PageFrontmatter,
      sections,
    };
  }

  private serializePage(parsed: ParsedPage): string {
    const parts: string[] = [];

    // Frontmatter
    parts.push("---");
    for (const [key, value] of Object.entries(parsed.frontmatter)) {
      if (Array.isArray(value)) {
        parts.push(`${key}:`);
        for (const item of value) {
          parts.push(`  - ${item}`);
        }
      } else {
        parts.push(`${key}: ${value}`);
      }
    }
    parts.push("---");
    parts.push("");

    // Sections
    for (const [sectionName, sectionLines] of parsed.sections.entries()) {
      parts.push(`## ${sectionName}`);
      parts.push("");
      parts.push(...sectionLines);
    }

    return parts.join("\n");
  }

  private createEntityPage(frontmatter: PageFrontmatter, context: string): string {
    const parts: string[] = [];

    // Frontmatter
    parts.push("---");
    parts.push(`title: ${frontmatter.title}`);
    parts.push(`type: ${frontmatter.type}`);
    parts.push(`slug: ${frontmatter.slug}`);
    parts.push(`created_at: ${frontmatter.created_at}`);
    parts.push(`confidence: ${frontmatter.confidence}`);
    parts.push("---");
    parts.push("");

    // Context section
    parts.push("## Context");
    parts.push("");
    parts.push(context);
    parts.push("");

    // Timeline section (empty)
    parts.push("## Timeline");
    parts.push("");

    // Links section (empty)
    parts.push("## Links");
    parts.push("");

    return parts.join("\n");
  }

  private kebabCase(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  private contentHash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}
