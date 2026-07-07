import { describe, expect, it } from "vitest";
import type { PrivacyConfig } from "../core/config.js";
import { assignMsgIds } from "./msg-id.js";
import { RawMessagePrivacyProcessor } from "./raw-privacy.js";

const baseConfig: PrivacyConfig = {
  enabled: true,
  mode: "irreversible",
  redact_phone: true,
  redact_id_card: true,
  redact_bank_card: true,
  redact_email: false,
  redact_url: false,
  blocked_words: ["ProjectNimbus"],
  replacement: "[REDACTED]",
};

describe("RawMessagePrivacyProcessor — pre-LLM redaction (spec §4.3)", () => {
  it("redacts phone numbers, IPs and blocked words in raw message text", () => {
    const messages = assignMsgIds([
      { role: "user", content: "call me at 13800138000 about ProjectNimbus" },
      { role: "assistant", content: "server is 192.168.1.1" },
    ]);
    const proc = new RawMessagePrivacyProcessor(baseConfig);
    const { messages: red } = proc.redactMessages(messages);

    expect(red[0].content).not.toContain("13800138000");
    expect(red[0].content).toContain("[REDACTED_PHONE]");
    expect(red[0].content).not.toContain("ProjectNimbus");
    expect(red[0].content).toContain("[REDACTED]");
    expect(red[1].content).not.toContain("192.168.1.1");
    expect(red[1].content).toContain("[REDACTED_IP]");
    // msg_ids and roles are preserved.
    expect(red.map((m) => m.msgId)).toEqual(["msg-1", "msg-2"]);
    expect(red[0].role).toBe("user");
  });

  it("passes text through unchanged when privacy is disabled", () => {
    const messages = assignMsgIds([{ role: "user", content: "phone 13800138000" }]);
    const proc = new RawMessagePrivacyProcessor({ ...baseConfig, enabled: false });
    const { messages: red } = proc.redactMessages(messages);
    expect(red[0].content).toContain("13800138000");
  });

  it("in reversible mode records a restoration map keyed by msg_id", () => {
    const messages = assignMsgIds([
      { role: "user", content: "phone 13800138000 here" },
      { role: "assistant", content: "no secrets here" },
    ]);
    const proc = new RawMessagePrivacyProcessor({ ...baseConfig, mode: "reversible" });
    const { messages: red, restorationMap } = proc.redactMessages(messages);

    expect(red[0].content).toContain("[REDACTED_PHONE]");
    // Restoration entries are grouped by the msg_id they came from.
    expect(restorationMap["msg-1"]).toBeDefined();
    expect(restorationMap["msg-1"].some((e) => e.original === "13800138000")).toBe(true);
    // A message with no redactions has no entry.
    expect(restorationMap["msg-2"]).toBeUndefined();
  });

  it("restore() reverses redaction using the msg_id-keyed map", () => {
    const messages = assignMsgIds([{ role: "user", content: "phone 13800138000 here" }]);
    const proc = new RawMessagePrivacyProcessor({ ...baseConfig, mode: "reversible" });
    const { messages: red, restorationMap } = proc.redactMessages(messages);
    const restored = proc.restore(red[0].msgId, red[0].content, restorationMap);
    expect(restored).toContain("13800138000");
    expect(restored).not.toContain("[REDACTED_PHONE]");
  });

  it("does not build a restoration map in irreversible mode", () => {
    const messages = assignMsgIds([{ role: "user", content: "phone 13800138000" }]);
    const proc = new RawMessagePrivacyProcessor({ ...baseConfig, mode: "irreversible" });
    const { restorationMap } = proc.redactMessages(messages);
    expect(Object.keys(restorationMap)).toHaveLength(0);
  });
});
