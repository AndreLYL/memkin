import { beforeEach, describe, expect, it } from "vitest";
import type {
  Decision,
  Entity,
  ExtractionResult,
  Knowledge,
  SourceRef,
  TaskSignal,
} from "../../src/core/types";
import { JSONFormatter } from "../../src/formatters/json";
import { MarkdownFormatter } from "../../src/formatters/markdown";

// Test fixture: Create a realistic ExtractionResult for testing
function createSourceRef(timestamp: string = "2024-01-15T10:30:00Z"): SourceRef {
  return {
    platform: "slack",
    channel: "engineering",
    timestamp,
    message_id: "msg_12345",
    thread_id: "thread_67890",
    raw_hash: "hash_abc123",
    quote: "We need to refactor the auth system",
  };
}

function createTestResult(): ExtractionResult {
  const sourceRef = createSourceRef();

  return {
    source: sourceRef,
    entities: [
      {
        slug: "alice-engineer",
        name: "Alice",
        type: "person",
        context: "Senior engineer on the backend team",
        confidence: "direct",
      },
      {
        slug: "auth-system",
        name: "Auth System",
        type: "project",
        context: "OAuth2 implementation for API",
        confidence: "direct",
      },
      {
        slug: "backend-team",
        name: "Backend Team",
        type: "organization",
        context: "Team responsible for API services",
        confidence: "paraphrased",
      },
    ],
    decisions: [
      {
        summary: "Use JWT tokens instead of session-based auth",
        reasoning: "Better scalability for microservices architecture",
        alternatives: ["Keep session-based auth", "Use OAuth2 with third-party provider"],
        entities: ["auth-system", "alice-engineer"],
        date: "2024-01-15",
        confidence: "direct",
        source: createSourceRef(),
      },
      {
        summary: "Move to TypeScript for all backend services",
        reasoning: "Type safety and better IDE support",
        alternatives: ["Continue with JavaScript", "Use Flow for type checking"],
        entities: ["backend-team"],
        date: "2024-01-10",
        confidence: "paraphrased",
        source: createSourceRef("2024-01-10T14:00:00Z"),
      },
    ],
    tasks: [
      {
        title: "Implement JWT token generation",
        status: "in_progress",
        owner: "alice-engineer",
        project: "auth-system",
        due_date: "2024-02-01",
        source: createSourceRef(),
        confidence: "direct",
      },
      {
        title: "Write unit tests for auth middleware",
        status: "open",
        owner: "alice-engineer",
        project: "auth-system",
        due_date: "2024-02-05",
        source: createSourceRef(),
        confidence: "direct",
      },
      {
        title: "Update documentation for API authentication",
        status: "done",
        owner: "alice-engineer",
        project: "auth-system",
        source: createSourceRef("2024-01-12T09:00:00Z"),
        confidence: "inferred",
      },
    ],
    timeline: [
      {
        date: "2024-01-10",
        summary: "Decision made to migrate to TypeScript",
        entities: ["backend-team"],
        source: createSourceRef("2024-01-10T14:00:00Z"),
        confidence: "paraphrased",
      },
      {
        date: "2024-01-15",
        summary: "JWT implementation started",
        entities: ["auth-system", "alice-engineer"],
        source: createSourceRef(),
        confidence: "direct",
      },
    ],
    links: [
      {
        from: "alice-engineer",
        to: "backend-team",
        type: "works_at",
        context: "Alice is a member of the backend team",
        confidence: "direct",
      },
      {
        from: "backend-team",
        to: "auth-system",
        type: "works_on",
        context: "Backend team is responsible for auth system",
        confidence: "direct",
      },
    ],
    discoveries: [
      {
        summary: "Current auth implementation has security vulnerability in token refresh",
        detail: "Tokens are not invalidated on logout, allowing potential replay attacks",
        type: "insight",
        entities: ["auth-system"],
        source: createSourceRef(),
        confidence: "direct",
      },
      {
        summary: "Team prefers pull request review over pair programming",
        type: "preference",
        entities: ["backend-team"],
        source: createSourceRef("2024-01-12T11:00:00Z"),
        confidence: "inferred",
      },
    ],
    knowledge: [
      {
        topic: "jwt-expiration",
        content: "Access tokens should be short-lived (minutes to hours) while refresh tokens can be longer-lived (days to weeks)",
        source_type: "teaching" as const,
        related_entities: ["auth-system", "alice-engineer"],
        source: createSourceRef(),
        confidence: "direct" as const,
      },
    ],
  };
}

describe("JSONFormatter", () => {
  let formatter: JSONFormatter;
  let testResult: ExtractionResult;

  beforeEach(() => {
    formatter = new JSONFormatter();
    testResult = createTestResult();
  });

  it("should have correct id", () => {
    expect(formatter.id).toBe("json");
  });

  it("should format ExtractionResult to valid JSON string", () => {
    const output = formatter.format(testResult);
    expect(typeof output).toBe("string");

    // Should be parseable JSON
    const parsed = JSON.parse(output);
    expect(parsed).toBeDefined();
  });

  it("should include version and extracted_at fields", () => {
    const output = formatter.format(testResult);
    const parsed = JSON.parse(output);

    expect(parsed.version).toBe("1.0");
    expect(parsed.extracted_at).toBeTruthy();
    // Should be ISO 8601 date string
    expect(new Date(parsed.extracted_at)).toBeInstanceOf(Date);
  });

  it("should include source metadata", () => {
    const output = formatter.format(testResult);
    const parsed = JSON.parse(output);

    expect(parsed.source).toBeDefined();
    expect(parsed.source.platform).toBe("slack");
    expect(parsed.source.channel).toBe("engineering");
  });

  it("should include signals object with all signal types", () => {
    const output = formatter.format(testResult);
    const parsed = JSON.parse(output);

    expect(parsed.signals).toBeDefined();
    expect(parsed.signals.entities).toBeTruthy();
    expect(parsed.signals.decisions).toBeTruthy();
    expect(parsed.signals.tasks).toBeTruthy();
    expect(parsed.signals.timeline).toBeTruthy();
    expect(parsed.signals.links).toBeTruthy();
    expect(parsed.signals.discoveries).toBeTruthy();
    expect(parsed.signals.knowledge).toBeTruthy();
  });

  it("should preserve entity data in output", () => {
    const output = formatter.format(testResult);
    const parsed = JSON.parse(output);

    expect(parsed.signals.entities).toHaveLength(3);
    const alice = parsed.signals.entities.find((e: Entity) => e.slug === "alice-engineer");
    expect(alice).toBeDefined();
    expect(alice.name).toBe("Alice");
    expect(alice.type).toBe("person");
  });

  it("should preserve decision data", () => {
    const output = formatter.format(testResult);
    const parsed = JSON.parse(output);

    expect(parsed.signals.decisions).toHaveLength(2);
    const jwtDecision = parsed.signals.decisions.find((d: Decision) => d.summary.includes("JWT"));
    expect(jwtDecision).toBeDefined();
    expect(jwtDecision.alternatives).toHaveLength(2);
  });

  it("should preserve task data with status", () => {
    const output = formatter.format(testResult);
    const parsed = JSON.parse(output);

    expect(parsed.signals.tasks).toHaveLength(3);
    const inProgressTask = parsed.signals.tasks.find((t: TaskSignal) => t.status === "in_progress");
    expect(inProgressTask).toBeDefined();
    expect(inProgressTask.title).toContain("JWT");
  });

  it("should be compact and valid JSON", () => {
    const output = formatter.format(testResult);
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).toBeTruthy();
  });
});

describe("MarkdownFormatter", () => {
  let formatter: MarkdownFormatter;
  let testResult: ExtractionResult;

  beforeEach(() => {
    formatter = new MarkdownFormatter();
    testResult = createTestResult();
  });

  it("should have correct id", () => {
    expect(formatter.id).toBe("markdown");
  });

  it("should format ExtractionResult to valid markdown string", () => {
    const output = formatter.format(testResult);
    expect(typeof output).toBe("string");
    expect(output).toContain("---"); // YAML frontmatter delimiter
  });

  it("should have YAML frontmatter at the beginning", () => {
    const output = formatter.format(testResult);
    expect(output.startsWith("---")).toBe(true);

    const parts = output.split("---");
    expect(parts.length).toBeGreaterThanOrEqual(3); // Opening ---, frontmatter, closing ---, content

    const frontmatter = parts[1];
    expect(frontmatter).toContain("title:");
    expect(frontmatter).toContain("platform:");
    expect(frontmatter).toContain("channel:");
    expect(frontmatter).toContain("extracted_at:");
  });

  it("should include required metadata in frontmatter", () => {
    const output = formatter.format(testResult);
    const parts = output.split("---");
    const frontmatter = parts[1];

    expect(frontmatter).toContain("title:");
    expect(frontmatter).toContain("platform: slack");
    expect(frontmatter).toContain("channel: engineering");
    expect(frontmatter).toContain("extracted_at:");
  });

  it("should include entities in frontmatter", () => {
    const output = formatter.format(testResult);
    const parts = output.split("---");
    const frontmatter = parts[1];

    expect(frontmatter).toContain("entities:");
    // Should list entity slugs
    expect(frontmatter).toContain("alice-engineer");
  });

  it("should have Decisions section in body", () => {
    const output = formatter.format(testResult);
    expect(output).toContain("## Decisions");

    // Should include decision summaries
    expect(output).toContain("JWT");
    expect(output).toContain("TypeScript");
  });

  it("should have Tasks section in body", () => {
    const output = formatter.format(testResult);
    expect(output).toContain("## Tasks");
  });

  it("should represent task status with checkboxes", () => {
    const output = formatter.format(testResult);

    // 'done' task should have [x]
    expect(output).toContain("- [x]");
    // 'open' or 'in_progress' should have [ ]
    expect(output).toContain("- [ ]");
  });

  it("should have Timeline section in body", () => {
    const output = formatter.format(testResult);
    expect(output).toContain("## Timeline");
    expect(output).toContain("2024-01-10");
    expect(output).toContain("2024-01-15");
  });

  it("should have Entities section in body", () => {
    const output = formatter.format(testResult);
    expect(output).toContain("## Entities");
    expect(output).toContain("Alice");
    expect(output).toContain("Auth System");
  });

  it("should have Discoveries section in body", () => {
    const output = formatter.format(testResult);
    expect(output).toContain("## Discoveries");
    expect(output).toContain("security vulnerability");
    expect(output).toContain("pull request review");
  });

  it("should have Knowledge section in body", () => {
    const output = formatter.format(testResult);
    expect(output).toContain("## Knowledge");
    expect(output).toContain("### jwt-expiration");
    expect(output).toContain("Access tokens should be short-lived");
  });

  it("should render related entities in Knowledge section", () => {
    const output = formatter.format(testResult);
    const knowledgeStart = output.indexOf("## Knowledge");
    const knowledgeSection = output.substring(knowledgeStart);
    expect(knowledgeSection).toContain("auth-system");
    expect(knowledgeSection).toContain("alice-engineer");
  });

  it("should show 'No knowledge extracted.' when empty", () => {
    const emptyResult: ExtractionResult = {
      source: createSourceRef(),
      entities: [],
      decisions: [],
      tasks: [],
      timeline: [],
      links: [],
      discoveries: [],
      knowledge: [],
    };
    const output = formatter.format(emptyResult);
    expect(output).toContain("No knowledge extracted.");
  });

  it("should format task status correctly", () => {
    const output = formatter.format(testResult);

    // Find the tasks section
    const tasksStart = output.indexOf("## Tasks");
    const tasksSection = output.substring(tasksStart);

    // Task with status 'done' should show as checked
    expect(tasksSection).toContain("- [x]");
    // Tasks with status 'open' or 'in_progress' should show as unchecked
    expect(tasksSection).toContain("- [ ]");
  });

  it("should be valid markdown with proper structure", () => {
    const output = formatter.format(testResult);

    // Check structure
    expect(output).toContain("---"); // YAML delimiter
    expect(output).toContain("## "); // H2 headers

    // No double headers
    expect(output.match(/##\s+##/)).toBeNull();
  });

  it("should handle empty sections gracefully", () => {
    const emptyResult: ExtractionResult = {
      source: createSourceRef(),
      entities: [],
      decisions: [],
      tasks: [],
      timeline: [],
      links: [],
      discoveries: [],
      knowledge: [],
    };

    const output = formatter.format(emptyResult);
    expect(output).toContain("## Decisions");
    expect(output).toContain("## Tasks");
    // Should not error, should have structure even if empty
    expect(typeof output).toBe("string");
  });

  it("should preserve task ownership and project info", () => {
    const output = formatter.format(testResult);
    const tasksSection = output.substring(output.indexOf("## Tasks"));

    expect(tasksSection).toContain("JWT");
    expect(tasksSection).toContain("Implement"); // Task title
  });
});

describe("Formatter comparison", () => {
  it("should produce different outputs with same input", () => {
    const testResult = createTestResult();
    const jsonFormatter = new JSONFormatter();
    const mdFormatter = new MarkdownFormatter();

    const jsonOutput = jsonFormatter.format(testResult);
    const mdOutput = mdFormatter.format(testResult);

    expect(jsonOutput).not.toBe(mdOutput);
    expect(typeof jsonOutput).toBe("string");
    expect(typeof mdOutput).toBe("string");
  });

  it("should contain same core information despite different formats", () => {
    const testResult = createTestResult();
    const jsonFormatter = new JSONFormatter();
    const mdFormatter = new MarkdownFormatter();

    const jsonOutput = jsonFormatter.format(testResult);
    const mdOutput = mdFormatter.format(testResult);

    // Both should contain entity slug
    expect(jsonOutput).toContain("alice-engineer");
    expect(mdOutput).toContain("alice-engineer");

    // Both should contain decision
    expect(jsonOutput).toContain("JWT");
    expect(mdOutput).toContain("JWT");

    // Both should contain task
    expect(jsonOutput).toContain("Implement JWT");
    expect(mdOutput).toContain("Implement JWT");
  });
});
