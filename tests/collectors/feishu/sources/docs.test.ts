import { describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../../../../src/collectors/feishu/cursor-staging";
import type { FeishuHttpClient } from "../../../../src/collectors/feishu/http-client";
import { DocSource } from "../../../../src/collectors/feishu/sources/docs";
import docRawContent from "../fixtures/doc-raw-content.json";
import driveFilesData from "../fixtures/drive-files.json";

function createMockClient(driveItems: unknown[], rawContent?: string): FeishuHttpClient {
  const requestMock = vi.fn().mockImplementation(async (_method: string, path: string) => {
    if (path.includes("/raw_content")) {
      return { code: 0, data: { content: rawContent ?? "" } };
    }
    return { code: 0, data: {} };
  });
  return {
    request: requestMock,
    paginate: vi.fn().mockImplementation(async function* () {
      yield { items: driveItems, has_more: false };
    }),
  } as unknown as FeishuHttpClient;
}

describe("DocSource", () => {
  it("yields summary RawMessage for each file in default mode", async () => {
    const client = createMockClient(driveFilesData.data.items);
    const source = new DocSource(client, { doc_folders: ["folder_001"] });
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);

    const msg1 = messages[0] as {
      platform: string;
      channel: string;
      content: string;
      metadata?: {
        doc_token?: string;
        doc_type?: string;
        extract_mode?: string;
      };
    };
    expect(msg1.platform).toBe("feishu");
    expect(msg1.channel).toBe("docs/folder_001");
    expect(msg1.content).toBe("产品需求文档 PRD v2");
    expect(msg1.metadata?.doc_token).toBe("doccn_abc123");
    expect(msg1.metadata?.doc_type).toBe("docx");
    expect(msg1.metadata?.extract_mode).toBe("summary");

    const msg2 = messages[1] as {
      platform: string;
      channel: string;
      content: string;
      metadata?: {
        doc_token?: string;
        doc_type?: string;
        extract_mode?: string;
      };
    };
    expect(msg2.platform).toBe("feishu");
    expect(msg2.channel).toBe("docs/folder_001");
    expect(msg2.content).toBe("Q2 OKR Tracker");
    expect(msg2.metadata?.doc_token).toBe("shtn_def456");
    expect(msg2.metadata?.doc_type).toBe("sheet");
    expect(msg2.metadata?.extract_mode).toBe("summary");
  });

  it("skips files not modified since checkpoint", async () => {
    const client = createMockClient(driveFilesData.data.items);
    const source = new DocSource(client, { doc_folders: ["folder_001"] });
    const staging = new CursorStaging();

    // Checkpoint with last_edit_time >= all files' modified_time
    const checkpoint = {
      folder_001: { last_edit_time: 1716300000 * 1000 },
    };

    const messages: unknown[] = [];
    for await (const msg of source.fetch(checkpoint, staging)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(0);
  });

  it("uses deep mode for docx files in deep folders", async () => {
    const client = createMockClient(driveFilesData.data.items, docRawContent.data.content);
    const source = new DocSource(client, {
      doc_folders: ["folder_001"],
      doc_deep_extract_folders: ["folder_001"],
    });
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    // docx file produces 3 chunks (deep mode), sheet file produces 1 summary
    expect(messages.length).toBeGreaterThan(2);

    // First message should be deep mode chunk from docx
    const deepMsg = messages[0] as {
      metadata?: {
        extract_mode?: string;
        section_title?: string;
        chunk_index?: number;
        total_chunks?: number;
      };
    };
    expect(deepMsg.metadata?.extract_mode).toBe("deep");
    expect(deepMsg.metadata?.section_title).toBeDefined();
    expect(deepMsg.metadata?.chunk_index).toBe(0);
    expect(deepMsg.metadata?.total_chunks).toBeGreaterThan(0);

    // Last message should be summary mode from sheet
    const summaryMsg = messages[messages.length - 1] as {
      content: string;
      metadata?: {
        extract_mode?: string;
        doc_type?: string;
      };
    };
    expect(summaryMsg.content).toBe("Q2 OKR Tracker");
    expect(summaryMsg.metadata?.extract_mode).toBe("summary");
    expect(summaryMsg.metadata?.doc_type).toBe("sheet");
  });

  it("commits cursor with max modified_time", async () => {
    const client = createMockClient(driveFilesData.data.items);
    const source = new DocSource(client, { doc_folders: ["folder_001"] });
    const staging = new CursorStaging();

    for await (const _msg of source.fetch(null, staging)) {
      // Just consume
    }

    const committable = staging.getCommittable();
    expect(committable).toHaveProperty("docs");
    expect(committable.docs).toHaveProperty("folder_001");
    expect(committable.docs.folder_001).toEqual({ last_edit_time: 1716300000 * 1000 });
  });

  it("maps collaborators from edit_users", async () => {
    const client = createMockClient(driveFilesData.data.items);
    const source = new DocSource(client, { doc_folders: ["folder_001"] });
    const staging = new CursorStaging();

    const messages: unknown[] = [];
    for await (const msg of source.fetch(null, staging)) {
      messages.push(msg);
    }

    const msg1 = messages[0] as {
      metadata?: {
        collaborators?: string[];
      };
    };
    expect(msg1.metadata?.collaborators).toEqual(["ou_user_001", "ou_user_002"]);

    // Second file has no edit_users, should be empty array
    const msg2 = messages[1] as {
      metadata?: {
        collaborators?: string[];
      };
    };
    expect(msg2.metadata?.collaborators).toEqual([]);
  });
});

describe("DocSource.chunkByHeading", () => {
  it("splits content by H1/H2 headings", () => {
    const client = createMockClient([]);
    const source = new DocSource(client, { doc_folders: [] });

    const content = "# Title\n\nIntro\n\n## S1\n\nBody1\n\n## S2\n\nBody2";
    const chunks = source.chunkByHeading(content);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toEqual({ title: "Title", content: "Intro" });
    expect(chunks[1]).toEqual({ title: "S1", content: "Body1" });
    expect(chunks[2]).toEqual({ title: "S2", content: "Body2" });
  });

  it("returns single chunk for content without headings", () => {
    const client = createMockClient([]);
    const source = new DocSource(client, { doc_folders: [] });

    const content = "Just plain text without any headings.";
    const chunks = source.chunkByHeading(content);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ title: null, content: "Just plain text without any headings." });
  });

  it("ignores H3+ headings for splitting", () => {
    const client = createMockClient([]);
    const source = new DocSource(client, { doc_folders: [] });

    const content = "# Title\n\nIntro\n\n## Section\n\n### Subsection\n\nBody with H3";
    const chunks = source.chunkByHeading(content);

    // Should only split on H1 and H2, not H3
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ title: "Title", content: "Intro" });
    expect(chunks[1]).toEqual({ title: "Section", content: "### Subsection\n\nBody with H3" });
  });
});
