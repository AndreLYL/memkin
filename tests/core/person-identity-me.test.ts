import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersonIdentityStore } from "../../src/core/person-identity.js";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";

describe("PersonIdentityStore — entities/me + self identity", () => {
  let db: Database;
  let pages: PageStore;
  let identity: PersonIdentityStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.pg);
    identity = new PersonIdentityStore(db.pg, { pages });
  });

  afterEach(async () => {
    await db.close();
  });

  it("ensureEntitiesMe creates a person page at entities/me and is idempotent", async () => {
    const slug = await identity.ensureEntitiesMe();
    expect(slug).toBe("entities/me");

    const page = await pages.getPage("entities/me");
    expect(page).not.toBeNull();
    expect(page?.type).toBe("person");

    // idempotent — does not throw, does not duplicate
    const again = await identity.ensureEntitiesMe();
    expect(again).toBe("entities/me");
  });

  it("registerSelfHandle records a strong handle pointing at entities/me", async () => {
    await identity.ensureEntitiesMe();
    await identity.registerSelfHandle("email", "Me@Example.com");
    await identity.registerSelfHandle("feishu_open_id", "ou_self123");

    expect(await identity.resolveHandle("email", "me@example.com")).toBe("entities/me");
    expect(await identity.resolveHandle("feishu_open_id", "ou_self123")).toBe("entities/me");

    const handles = await identity.listHandles("entities/me");
    expect(handles.every((h) => h.strength === "strong")).toBe(true);
  });

  it("isMe is true for handles canonicalized to entities/me, false for others", async () => {
    await identity.ensureEntitiesMe();
    await identity.registerSelfHandle("email", "me@example.com");

    // the canonical slug itself
    expect(await identity.isMe("entities/me")).toBe(true);
    // a handle value resolving to me
    expect(await identity.isMe("me@example.com")).toBe(true);

    // someone else
    await pages.putPage(
      "people/alice",
      "---\ntitle: Alice\ntype: person\n---\nAlice is a teammate.",
    );
    await identity.recordCanonical("Alice", "people/alice");
    expect(await identity.isMe("people/alice")).toBe(false);
    expect(await identity.isMe("alice@nowhere.com")).toBe(false);
  });
});
