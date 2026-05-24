import type { ExtractionResult, Formatter } from "../core/types.js";

export class MarkdownFormatter implements Formatter {
  id = "markdown";

  format(result: ExtractionResult): string {
    const parts: string[] = [];

    // YAML Frontmatter
    parts.push("---");
    parts.push(`title: Extraction Report`);
    parts.push(`platform: ${result.source.platform}`);
    parts.push(`channel: ${result.source.channel}`);
    parts.push(`extracted_at: ${new Date().toISOString()}`);

    if (result.entities.length > 0) {
      parts.push("entities:");
      for (const entity of result.entities) {
        parts.push(`  - ${entity.slug}`);
      }
    }

    parts.push("---");
    parts.push("");

    // Decisions Section
    parts.push("## Decisions");
    parts.push("");
    if (result.decisions.length === 0) {
      parts.push("No decisions extracted.");
    } else {
      for (const decision of result.decisions) {
        parts.push(`### ${decision.summary}`);
        parts.push("");

        if (decision.reasoning) {
          parts.push(`**Reasoning:** ${decision.reasoning}`);
          parts.push("");
        }

        if (decision.alternatives && decision.alternatives.length > 0) {
          parts.push("**Alternatives:**");
          for (const alt of decision.alternatives) {
            parts.push(`- ${alt}`);
          }
          parts.push("");
        }

        if (decision.entities.length > 0) {
          parts.push(`**Entities:** ${decision.entities.join(", ")}`);
          parts.push("");
        }

        parts.push(`**Date:** ${decision.date} | **Confidence:** ${decision.confidence}`);
        parts.push("");
      }
    }

    // Tasks Section
    parts.push("## Tasks");
    parts.push("");
    if (result.tasks.length === 0) {
      parts.push("No tasks extracted.");
    } else {
      for (const task of result.tasks) {
        const checkbox = task.status === "done" ? "[x]" : "[ ]";
        parts.push(`- ${checkbox} **${task.title}** (${task.status})`);

        if (task.owner) {
          parts.push(`  - Owner: ${task.owner}`);
        }
        if (task.project) {
          parts.push(`  - Project: ${task.project}`);
        }
        if (task.due_date) {
          parts.push(`  - Due: ${task.due_date}`);
        }

        parts.push(`  - Confidence: ${task.confidence}`);
        parts.push("");
      }
    }

    // Timeline Section
    parts.push("## Timeline");
    parts.push("");
    if (result.timeline.length === 0) {
      parts.push("No timeline entries extracted.");
    } else {
      for (const entry of result.timeline) {
        parts.push(`### ${entry.date}`);
        parts.push("");
        parts.push(`${entry.summary}`);
        parts.push("");

        if (entry.entities.length > 0) {
          parts.push(`**Entities:** ${entry.entities.join(", ")}`);
          parts.push("");
        }

        parts.push(`**Confidence:** ${entry.confidence}`);
        parts.push("");
      }
    }

    // Entities Section
    parts.push("## Entities");
    parts.push("");
    if (result.entities.length === 0) {
      parts.push("No entities extracted.");
    } else {
      for (const entity of result.entities) {
        parts.push(`### ${entity.name}`);
        parts.push("");
        parts.push(`**Slug:** ${entity.slug}`);
        parts.push(`**Type:** ${entity.type}`);
        parts.push(`**Context:** ${entity.context}`);
        parts.push(`**Confidence:** ${entity.confidence}`);
        parts.push("");
      }
    }

    // Discoveries Section
    parts.push("## Discoveries");
    parts.push("");
    if (result.discoveries.length === 0) {
      parts.push("No discoveries extracted.");
    } else {
      for (const discovery of result.discoveries) {
        parts.push(`### ${discovery.summary}`);
        parts.push("");

        if (discovery.detail) {
          parts.push(`${discovery.detail}`);
          parts.push("");
        }

        parts.push(`**Type:** ${discovery.type}`);

        if (discovery.entities.length > 0) {
          parts.push(`**Entities:** ${discovery.entities.join(", ")}`);
        }

        parts.push(`**Confidence:** ${discovery.confidence}`);
        parts.push("");
      }
    }

    // Knowledge Section
    parts.push("## Knowledge");
    parts.push("");
    if (result.knowledge.length === 0) {
      parts.push("No knowledge extracted.");
    } else {
      for (const knowledge of result.knowledge) {
        parts.push(`### ${knowledge.topic}`);
        parts.push("");
        parts.push(knowledge.content);
        parts.push("");
        parts.push(`**Source Type:** ${knowledge.source_type} | **Confidence:** ${knowledge.confidence}`);
        parts.push(`**Related Entities:** ${knowledge.related_entities.length > 0 ? knowledge.related_entities.join(", ") : "none"}`);
        parts.push("");
      }
    }

    return parts.join("\n");
  }
}
