import { beforeEach, describe, expect, it } from "vitest";
import { CursorStaging } from "../../../src/collectors/feishu/cursor-staging";

describe("CursorStaging", () => {
  let staging: CursorStaging;

  beforeEach(() => {
    staging = new CursorStaging();
  });

  it("returns empty when nothing staged", () => {
    expect(staging.getCommittable()).toEqual({});
  });

  it("staged but uncommitted cursors are not committable", () => {
    staging.stage("messages", "oc_xxx", { last_sync_at: 100 });
    expect(staging.getCommittable()).toEqual({});
  });

  it("committed cursors are returned by getCommittable", () => {
    staging.stage("messages", "oc_xxx", { last_sync_at: 100 });
    staging.commit("messages", "oc_xxx");
    expect(staging.getCommittable()).toEqual({
      messages: { oc_xxx: { last_sync_at: 100 } },
    });
  });

  it("discarded cursors are not committable", () => {
    staging.stage("messages", "oc_xxx", { last_sync_at: 100 });
    staging.discard("messages", "oc_xxx");
    staging.commit("messages", "oc_xxx");
    expect(staging.getCommittable()).toEqual({});
  });

  it("discardSource removes all cursors for a source including committed", () => {
    staging.stage("messages", "oc_aaa", { last_sync_at: 100 });
    staging.commit("messages", "oc_aaa");
    staging.stage("messages", "oc_bbb", { last_sync_at: 200 });
    staging.commit("messages", "oc_bbb");
    staging.discardSource("messages");
    expect(staging.getCommittable()).toEqual({});
  });

  it("multiple sources are independent", () => {
    staging.stage("messages", "oc_xxx", { last_sync_at: 100 });
    staging.commit("messages", "oc_xxx");
    staging.stage("calendar", "cal_xxx", { sync_token: "abc" });
    staging.commit("calendar", "cal_xxx");
    staging.discardSource("messages");
    expect(staging.getCommittable()).toEqual({
      calendar: { cal_xxx: { sync_token: "abc" } },
    });
  });

  it("commitSource promotes every staged key under a source", () => {
    staging.stage("messages", "oc_aaa", { last_sync_at: 100 });
    staging.stage("messages", "oc_bbb", { last_sync_at: 200 });
    staging.stage("dm", "oc_ccc", { last_sync_at: 300 });
    staging.commitSource("messages");
    expect(staging.getCommittable()).toEqual({
      messages: { oc_aaa: { last_sync_at: 100 }, oc_bbb: { last_sync_at: 200 } },
    });
  });

  it("commitSource on an unknown source is a no-op", () => {
    staging.commitSource("nope");
    expect(staging.getCommittable()).toEqual({});
  });

  it("stage overwrites previous staged value for same key", () => {
    staging.stage("messages", "oc_xxx", { last_sync_at: 100 });
    staging.stage("messages", "oc_xxx", { last_sync_at: 200 });
    staging.commit("messages", "oc_xxx");
    expect(staging.getCommittable()).toEqual({
      messages: { oc_xxx: { last_sync_at: 200 } },
    });
  });
});
