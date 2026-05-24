import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileAdapter } from "../../src/adapters/file.js";
import { GBrainAdapter } from "../../src/adapters/gbrain.js";
import { StdoutAdapter } from "../../src/adapters/stdout.js";
import type { ExtractionResult, Knowledge, SourceRef } from "../../src/core/types.js";

const createMockSourceRef = (): SourceRef => ({
  platform: "test-platform",
  channel: "test-channel",
  timestamp: "2026-05-19T10:00:00Z",
  message_id: "msg-123",
  raw_hash: "hash-abc123",
  quote: "Test quote",
});

const createMockKnowledge = (overrides?: Partial<Knowledge>): Knowledge => ({
  topic: "react-hooks",
  content: "React useEffect runs twice in StrictMode during development",
  source_type: "teaching",
  related_entities: ["tool/react"],
  source: { ...createMockSourceRef(), raw_hash: "know-hash-001" },
  confidence: "direct",
  ...overrides,
});

const createMockExtractionResult = (): ExtractionResult => ({
  source: createMockSourceRef(),
  entities: [
    {
      slug: "people/zheng-yang",
      name: "Zheng Yang",
      type: "person",
      context: "Senior Engineer working on Apollo project",
      confidence: "direct",
    },
    {
      slug: "projects/apollo",
      name: "Apollo",
      type: "project",
      context: "Main product development project",
      confidence: "direct",
    },
  ],
  timeline: [
    {
      date: "2026-05-15",
      summary: "Zheng Yang joined Apollo project",
      entities: ["people/zheng-yang", "projects/apollo"],
      source: createMockSourceRef(),
      confidence: "direct",
    },
  ],
  links: [
    {
      from: "people/zheng-yang",
      to: "projects/apollo",
      type: "works_on",
      context: "Working as senior engineer",
      confidence: "direct",
    },
  ],
  decisions: [
    {
      summary: "Use TypeScript for all new code",
      reasoning: "Better type safety and developer experience",
      alternatives: ["JavaScript", "Flow"],
      entities: ["projects/apollo"],
      date: "2026-05-10",
      confidence: "direct",
      source: createMockSourceRef(),
    },
  ],
  tasks: [
    {
      title: "Implement authentication module",
      status: "in_progress",
      owner: "people/zheng-yang",
      project: "projects/apollo",
      due_date: "2026-05-30",
      source: createMockSourceRef(),
      confidence: "direct",
    },
  ],
  discoveries: [
    {
      summary: "TypeScript inference works well with Zod",
      detail: "Using z.infer<> provides automatic type safety",
      type: "insight",
      entities: ["projects/apollo"],
      source: createMockSourceRef(),
      confidence: "direct",
    },
  ],
  knowledge: [createMockKnowledge()],
});

describe("FileAdapter", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), "tests", "temp", `file-${Date.now()}`);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("healthCheck creates output_dir if not exists", async () => {
    const adapter = new FileAdapter({ output_dir: tempDir, format: "json" });

    const health = await adapter.healthCheck();

    expect(health.ok).toBe(true);
    expect(existsSync(tempDir)).toBe(true);
  });

  it("healthCheck succeeds when output_dir exists", async () => {
    mkdirSync(tempDir, { recursive: true });
    const adapter = new FileAdapter({ output_dir: tempDir, format: "json" });

    const health = await adapter.healthCheck();

    expect(health.ok).toBe(true);
  });

  it("push writes JSON file with correct naming", async () => {
    mkdirSync(tempDir, { recursive: true });
    const adapter = new FileAdapter({ output_dir: tempDir, format: "json" });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBe(1);
    expect(pushResult.skipped).toBe(0);
    expect(pushResult.errors).toHaveLength(0);

    const files = readdirSync(tempDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^test-platform-test-channel-\d+\.json$/);

    const content = readFileSync(join(tempDir, files[0]), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe("1.0");
    expect(parsed.signals.entities).toHaveLength(2);
  });

  it("push writes Markdown file with correct naming", async () => {
    mkdirSync(tempDir, { recursive: true });
    const adapter = new FileAdapter({ output_dir: tempDir, format: "markdown" });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBe(1);
    expect(pushResult.skipped).toBe(0);
    expect(pushResult.errors).toHaveLength(0);

    const files = readdirSync(tempDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^test-platform-test-channel-\d+\.md$/);

    const content = readFileSync(join(tempDir, files[0]), "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("## Decisions");
    expect(content).toContain("Use TypeScript for all new code");
  });

  it("push handles multiple results", async () => {
    mkdirSync(tempDir, { recursive: true });
    const adapter = new FileAdapter({ output_dir: tempDir, format: "json" });

    const result1 = createMockExtractionResult();

    // Wait a tiny bit to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 5));

    const result2 = {
      ...createMockExtractionResult(),
      source: { ...createMockSourceRef(), timestamp: "2026-05-19T11:00:00Z" },
    };

    const pushResult = await adapter.push([result1, result2]);

    expect(pushResult.written).toBe(2);
    expect(pushResult.skipped).toBe(0);
    expect(pushResult.errors).toHaveLength(0);

    const files = readdirSync(tempDir);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.length).toBeLessThanOrEqual(2);
  });

  it("push reports errors when write fails", async () => {
    // Use invalid path (root on Unix-like systems)
    const adapter = new FileAdapter({
      output_dir: "/invalid/path/that/cannot/be/created",
      format: "json",
    });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBe(0);
    expect(pushResult.errors.length).toBeGreaterThan(0);
  });
});

describe("GBrainAdapter", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(process.cwd(), "tests", "temp", `gbrain-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("healthCheck succeeds when output_dir exists", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    const health = await adapter.healthCheck();

    expect(health.ok).toBe(true);
  });

  it("healthCheck fails when output_dir does not exist", async () => {
    const adapter = new GBrainAdapter({ output_dir: "/nonexistent/path" });

    const health = await adapter.healthCheck();

    expect(health.ok).toBe(false);
  });

  it("push creates Entity pages with correct structure", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBeGreaterThan(0);
    expect(pushResult.errors).toHaveLength(0);

    // Check person entity file
    const personFile = join(tempDir, "people", "zheng-yang.md");
    expect(existsSync(personFile)).toBe(true);

    const personContent = readFileSync(personFile, "utf-8");
    expect(personContent).toContain("---");
    expect(personContent).toContain("title: Zheng Yang");
    expect(personContent).toContain("type: person");
    expect(personContent).toContain("## Context");
    expect(personContent).toContain("Senior Engineer working on Apollo project");

    // Check project entity file
    const projectFile = join(tempDir, "projects", "apollo.md");
    expect(existsSync(projectFile)).toBe(true);

    const projectContent = readFileSync(projectFile, "utf-8");
    expect(projectContent).toContain("title: Apollo");
    expect(projectContent).toContain("type: project");
  });

  it("push creates Decision pages", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBeGreaterThan(0);

    const decisionFile = join(tempDir, "decisions", "use-typescript-for-all-new-code.md");
    expect(existsSync(decisionFile)).toBe(true);

    const content = readFileSync(decisionFile, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("Use TypeScript for all new code");
    expect(content).toContain("Better type safety");
    expect(content).toContain("## Alternatives");
    expect(content).toContain("JavaScript");
  });

  it("push creates Task pages", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBeGreaterThan(0);

    const taskFile = join(tempDir, "tasks", "implement-authentication-module.md");
    expect(existsSync(taskFile)).toBe(true);

    const content = readFileSync(taskFile, "utf-8");
    expect(content).toContain("Implement authentication module");
    expect(content).toContain("status: in_progress");
    expect(content).toContain("owner: people/zheng-yang");
  });

  it("push creates Discovery pages", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBeGreaterThan(0);

    const discoveryFile = join(
      tempDir,
      "discoveries",
      "typescript-inference-works-well-with-zod.md",
    );
    expect(existsSync(discoveryFile)).toBe(true);

    const content = readFileSync(discoveryFile, "utf-8");
    expect(content).toContain("TypeScript inference works well with Zod");
    expect(content).toContain("Using z.infer<>");
    expect(content).toContain("type: discovery-insight");
  });

  it("push appends Timeline entries to existing entity pages", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBeGreaterThan(0);

    const personFile = join(tempDir, "people", "zheng-yang.md");
    const content = readFileSync(personFile, "utf-8");

    expect(content).toContain("## Timeline");
    expect(content).toContain("2026-05-15");
    expect(content).toContain("Zheng Yang joined Apollo project");
  });

  it("push appends Links to entity pages", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    const result = createMockExtractionResult();
    const pushResult = await adapter.push([result]);

    expect(pushResult.written).toBeGreaterThan(0);

    const personFile = join(tempDir, "people", "zheng-yang.md");
    const content = readFileSync(personFile, "utf-8");

    expect(content).toContain("## Links");
    expect(content).toContain("works_on");
    expect(content).toContain("projects/apollo");
  });

  it("push merges when entity page already exists", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    // First push
    const result1 = createMockExtractionResult();
    await adapter.push([result1]);

    // Second push with new timeline entry
    const result2: ExtractionResult = {
      ...createMockExtractionResult(),
      timeline: [
        {
          date: "2026-05-18",
          summary: "Zheng Yang completed first milestone",
          entities: ["people/zheng-yang"],
          source: { ...createMockSourceRef(), raw_hash: "different-hash" },
          confidence: "direct",
        },
      ],
    };

    const _pushResult2 = await adapter.push([result2]);

    const personFile = join(tempDir, "people", "zheng-yang.md");
    const content = readFileSync(personFile, "utf-8");

    // Should have both timeline entries
    expect(content).toContain("2026-05-15");
    expect(content).toContain("Zheng Yang joined Apollo project");
    expect(content).toContain("2026-05-18");
    expect(content).toContain("completed first milestone");
  });

  it("push skips duplicate signals based on raw_hash", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });

    const result1 = createMockExtractionResult();
    const _pushResult1 = await adapter.push([result1]);

    // Push same result again (same raw_hash)
    const pushResult2 = await adapter.push([result1]);

    expect(pushResult2.skipped).toBeGreaterThan(0);
  });

  it("push creates Knowledge pages with content-hash path", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });
    const result = createMockExtractionResult();
    await adapter.push([result]);

    const knowledgeDir = join(tempDir, "knowledge", "react-hooks");
    expect(existsSync(knowledgeDir)).toBe(true);

    const files = readdirSync(knowledgeDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[a-f0-9]{12}-.*\.md$/);

    const content = readFileSync(join(knowledgeDir, files[0]), "utf-8");
    expect(content).toContain("React useEffect runs twice");
    expect(content).toContain("type: knowledge");
    expect(content).toContain("topic: react-hooks");
  });

  it("push skips speculative Knowledge", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });
    const result: ExtractionResult = {
      ...createMockExtractionResult(),
      knowledge: [createMockKnowledge({ confidence: "speculative" })],
    };
    const pushResult = await adapter.push([result]);
    const knowledgeDir = join(tempDir, "knowledge", "react-hooks");
    const knowledgeExists = existsSync(knowledgeDir) && readdirSync(knowledgeDir).length > 0;
    expect(knowledgeExists).toBe(false);
  });

  it("push deduplicates Knowledge by source_hash", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });
    const result = createMockExtractionResult();
    await adapter.push([result]);
    const pushResult2 = await adapter.push([result]);
    expect(pushResult2.skipped).toBeGreaterThan(0);
    const knowledgeDir = join(tempDir, "knowledge", "react-hooks");
    const files = readdirSync(knowledgeDir);
    expect(files).toHaveLength(1);
  });

  it("push appends provenance for same content from different source", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });
    const result1 = createMockExtractionResult();
    await adapter.push([result1]);

    const result2: ExtractionResult = {
      ...createMockExtractionResult(),
      knowledge: [
        createMockKnowledge({
          source: { ...createMockSourceRef(), raw_hash: "different-hash-002", quote: "Different source quote" },
        }),
      ],
    };
    await adapter.push([result2]);

    const knowledgeDir = join(tempDir, "knowledge", "react-hooks");
    const files = readdirSync(knowledgeDir);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(knowledgeDir, files[0]), "utf-8");
    expect(content).toContain("Test quote");
    expect(content).toContain("Different source quote");
  });

  it("push uses content hash as fallback when raw_hash is empty", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });
    const result: ExtractionResult = {
      ...createMockExtractionResult(),
      knowledge: [
        createMockKnowledge({
          source: { ...createMockSourceRef(), raw_hash: "" },
        }),
      ],
    };
    await adapter.push([result]);
    const knowledgeDir = join(tempDir, "knowledge", "react-hooks");
    const files = readdirSync(knowledgeDir);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(knowledgeDir, files[0]), "utf-8");
    expect(content).not.toContain('source_hash: ""');
    expect(content).not.toContain("source_hash: ''");
  });

  it("push renders Provenance section with source details", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });
    const result = createMockExtractionResult();
    await adapter.push([result]);
    const knowledgeDir = join(tempDir, "knowledge", "react-hooks");
    const files = readdirSync(knowledgeDir);
    const content = readFileSync(join(knowledgeDir, files[0]), "utf-8");
    expect(content).toContain("## Provenance");
    expect(content).toContain("Test quote");
    expect(content).toContain("test-platform");
    expect(content).toContain("test-channel");
  });

  it("push generates valid YAML frontmatter for content with special chars", async () => {
    const adapter = new GBrainAdapter({ output_dir: tempDir });
    const result: ExtractionResult = {
      ...createMockExtractionResult(),
      knowledge: [
        createMockKnowledge({
          content: 'Content with "quotes" and colons: value and #hash',
        }),
      ],
    };
    await adapter.push([result]);
    const knowledgeDir = join(tempDir, "knowledge", "react-hooks");
    const files = readdirSync(knowledgeDir);
    const content = readFileSync(join(knowledgeDir, files[0]), "utf-8");
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(frontmatterMatch).not.toBeNull();
  });
});

describe("StdoutAdapter", () => {
  it("healthCheck always succeeds", async () => {
    const adapter = new StdoutAdapter();

    const health = await adapter.healthCheck();

    expect(health.ok).toBe(true);
  });

  it("push outputs JSON to console and returns written count", async () => {
    const adapter = new StdoutAdapter();
    const originalLog = console.log;
    let capturedOutput = "";

    console.log = (msg: string) => {
      capturedOutput = msg;
    };

    try {
      const result = createMockExtractionResult();
      const pushResult = await adapter.push([result]);

      expect(pushResult.written).toBe(1);
      expect(pushResult.skipped).toBe(0);
      expect(pushResult.errors).toHaveLength(0);

      const parsed = JSON.parse(capturedOutput);
      expect(parsed.entities).toHaveLength(2);
      expect(parsed.decisions).toHaveLength(1);
    } finally {
      console.log = originalLog;
    }
  });

  it("push handles multiple results", async () => {
    const adapter = new StdoutAdapter();
    const originalLog = console.log;
    const capturedOutputs: string[] = [];

    console.log = (msg: string) => {
      capturedOutputs.push(msg);
    };

    try {
      const result1 = createMockExtractionResult();
      const result2 = {
        ...createMockExtractionResult(),
        source: { ...createMockSourceRef(), timestamp: "2026-05-19T11:00:00Z" },
      };

      const pushResult = await adapter.push([result1, result2]);

      expect(pushResult.written).toBe(2);
      expect(capturedOutputs).toHaveLength(2);
    } finally {
      console.log = originalLog;
    }
  });
});
