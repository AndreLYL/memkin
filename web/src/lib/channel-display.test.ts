import { describe, expect, it } from "vitest";
import { channelDisplay } from "./channel-display";

describe("channelDisplay", () => {
  it("resolved group: shows name without prefix", () => {
    const r = channelDisplay("group/oc_xxx", "产品讨论", "resolved");
    expect(r.text).toBe("产品讨论");
    expect(r.tooltip).toBe("group/oc_xxx");
    expect(r.status).toBe("resolved");
  });

  it("resolved p2p: keeps the 💬 prefix from cache", () => {
    const r = channelDisplay("dm/oc_xxx", "💬 张三", "resolved");
    expect(r.text).toBe("💬 张三");
    expect(r.tooltip).toBe("dm/oc_xxx");
  });

  it("unresolved: shows raw with ⚠ and hint", () => {
    const r = channelDisplay("group/oc_xxx", null, "unresolved");
    expect(r.text).toBe("group/oc_xxx ⚠");
    expect(r.tooltip).toContain("未解析");
    expect(r.status).toBe("unresolved");
  });

  it("failed: shows raw with ✕", () => {
    const r = channelDisplay("group/oc_xxx", null, "failed");
    expect(r.text).toBe("group/oc_xxx ✕");
    expect(r.tooltip).toContain("解析失败");
    expect(r.status).toBe("failed");
  });

  it("mail: hardcoded 📧 邮件", () => {
    const r = channelDisplay("mail/INBOX", null, "mail");
    expect(r.text).toBe("📧 邮件");
    expect(r.tooltip).toBe("mail/INBOX");
    expect(r.status).toBe("mail");
  });
});
