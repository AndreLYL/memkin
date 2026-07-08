import { describe, expect, it } from "vitest";
import type { PrivacyConfig } from "../core/config.js";
import type { DistilledPayload } from "./contract.js";
import { redactPayload } from "./payload-privacy.js";

const config: PrivacyConfig = {
  enabled: true,
  mode: "irreversible",
  redact_phone: true,
  redact_id_card: true,
  redact_bank_card: true,
  redact_email: false,
  redact_url: false,
  blocked_words: ["SecretCodename"],
  replacement: "[REDACTED]",
};

function payloadWith(fields: Partial<Record<string, string>>): DistilledPayload {
  return {
    signals: [
      {
        type: "task",
        topic: fields.topic ?? "call vendor",
        what: fields.what ?? "call the vendor",
        why: fields.why,
        entities: ["vendor"],
        authority: "user_confirmed",
        evidence: [{ start: "msg-1", end: "msg-1" }],
        persistence_reason: fields.persistence_reason ?? "commitment",
        owner: fields.owner,
        status: "open",
      },
    ],
  };
}

describe("redactPayload — second-pass privacy before outbox (spec §4.3)", () => {
  it("redacts sensitive strings that leaked into LLM output text fields", () => {
    const dirty = payloadWith({
      what: "call the vendor at 13800138000 about SecretCodename",
      why: "their server 10.0.0.1 is down",
    });
    const clean = redactPayload(dirty, config);
    const sig = clean.signals[0];
    expect(sig.what).not.toContain("13800138000");
    expect(sig.what).toContain("[REDACTED_PHONE]");
    expect(sig.what).not.toContain("SecretCodename");
    expect(sig.why).not.toContain("10.0.0.1");
    expect(sig.why).toContain("[REDACTED_IP]");
  });

  it("redacts topic and persistence_reason too", () => {
    const dirty = payloadWith({
      topic: "SecretCodename rollout",
      persistence_reason: "phone 13800138000 must be reachable",
    });
    const clean = redactPayload(dirty, config);
    expect(clean.signals[0].topic).not.toContain("SecretCodename");
    expect(clean.signals[0].persistence_reason).not.toContain("13800138000");
  });

  it("leaves structural fields (type, authority, evidence, status) untouched", () => {
    const dirty = payloadWith({});
    const clean = redactPayload(dirty, config);
    const sig = clean.signals[0];
    expect(sig.type).toBe("task");
    expect(sig.authority).toBe("user_confirmed");
    expect(sig.evidence).toEqual([{ start: "msg-1", end: "msg-1" }]);
    if (sig.type === "task") expect(sig.status).toBe("open");
  });

  it("passes through unchanged when privacy is disabled", () => {
    const dirty = payloadWith({ what: "call 13800138000" });
    const clean = redactPayload(dirty, { ...config, enabled: false });
    expect(clean.signals[0].what).toContain("13800138000");
  });

  it("does not mutate the input payload", () => {
    const dirty = payloadWith({ what: "call 13800138000" });
    redactPayload(dirty, config);
    expect(dirty.signals[0].what).toContain("13800138000");
  });
});
