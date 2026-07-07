/**
 * Second-pass privacy over the structured distilled payload (spec §4.3).
 *
 * The first pass (RawMessagePrivacyProcessor) redacts raw message text before
 * the LLM sees it; this second pass runs right before the payload is written to
 * the outbox, catching sensitive strings the model might have reproduced or
 * synthesized in its OUTPUT (e.g. reassembling a phone number from context).
 *
 * Field policy mirrors PrivacyProcessor (privacy.ts): free-text narrative fields
 * are redacted; structural fields (type, authority, status, evidence, dates,
 * enums), entity NAMES (aligned with Entity.name never being redacted) and
 * reference urls (the url is the core field, checked against evidence) are left
 * intact.
 */

import type { PrivacyConfig } from "../core/config.js";
import type { DistilledPayload, DistilledSignal } from "./contract.js";
import { RawMessagePrivacyProcessor } from "./raw-privacy.js";

export function redactPayload(payload: DistilledPayload, config: PrivacyConfig): DistilledPayload {
  if (!config.enabled) return payload;

  // Force irreversible for the structured pass: the reversible restoration map
  // is only kept for raw message text keyed by msg_id (first pass); structured
  // output redactions are not reversible (nothing to anchor them to).
  const proc = new RawMessagePrivacyProcessor({ ...config, mode: "irreversible" });
  const r = (text: string) => proc.redactString(text);
  const rOpt = (text: string | undefined) => (text === undefined ? undefined : r(text));

  const signals = payload.signals.map((sig): DistilledSignal => {
    const common = {
      topic: r(sig.topic),
      what: r(sig.what),
      why: rOpt(sig.why),
      project: sig.project,
      entities: sig.entities,
      authority: sig.authority,
      supersedes_topic: rOpt(sig.supersedes_topic),
      evidence: sig.evidence,
      persistence_reason: r(sig.persistence_reason),
    };
    switch (sig.type) {
      case "decision":
        return { ...sig, ...common };
      case "task":
        return { ...sig, ...common, owner: rOpt(sig.owner) };
      case "reference":
        return { ...sig, ...common, trigger: rOpt(sig.trigger) };
      case "preference":
        return { ...sig, ...common, subject: r(sig.subject) };
      case "knowledge":
        return { ...sig, ...common };
      case "discovery":
        return { ...sig, ...common };
    }
  });

  return { signals };
}
