import { describe, expect, test, vi } from "vitest";
import { writeCard } from "../../../../src/collectors/feishu/docs/store-writer";
import type { PointerCard } from "../../../../src/collectors/feishu/docs/types";

const pointer: PointerCard = {
  doc_token: "tok9", doc_type: "docx", title: "T", url: "u", owner_id: "o", last_editor_id: "e",
  created_at: "2026-01-01T00:00:00Z", modified_at: "2026-02-01T00:00:00Z",
  source: { kind: "my_space", folder_token: "f" }, parent_path: "My Space/",
  extract_level: "pointer", extracted_at: "2026-06-14T00:00:00Z",
};

describe("writeCard", () => {
  test("writes under feishu-docs/<token> with halflife null and rechunks", async () => {
    const putPage = vi.fn(async () => ({ id: 42, compiled_truth: "BODY" }));
    const rechunk = vi.fn(async () => {});
    const stores = { pages: { putPage }, chunks: { rechunk } };
    await writeCard(stores as never, pointer);
    expect(putPage).toHaveBeenCalledTimes(1);
    const [slug, content, opts] = putPage.mock.calls[0];
    expect(slug).toBe("feishu-docs/tok9");
    expect(content.startsWith("---\n")).toBe(true);
    expect(opts).toEqual({ halflife_days: null });
    expect(rechunk).toHaveBeenCalledWith(42, "BODY");
  });
});
