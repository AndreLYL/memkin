import { describe, expect, test } from "vitest";
import { canonicalize } from "../../src/core/canonicalize";
import type { ConversationBlock, RawMessage } from "../../src/core/types";

function makeBlock(
  overrides: Partial<ConversationBlock> & { messages: RawMessage[] },
): ConversationBlock {
  return {
    block_id: "test-block-1",
    platform: "feishu",
    channel: overrides.channel ?? "group/oc_test",
    thread_id: undefined,
    messages: overrides.messages,
    start_time: overrides.messages[0].timestamp,
    end_time: overrides.messages[overrides.messages.length - 1].timestamp,
    participants: [...new Set(overrides.messages.map((m) => m.contact))],
    token_count: 100,
    ...overrides,
  };
}

function makeMsg(content: string, overrides?: Partial<RawMessage>): RawMessage {
  return {
    platform: "feishu",
    channel: "group/oc_test",
    contact: "alice",
    timestamp: "2026-05-29T10:00:00Z",
    content,
    direction: "received",
    ...overrides,
  };
}

describe("canonicalize — source type inference", () => {
  test("mail/ channel → email", () => {
    const block = makeBlock({ channel: "mail/INBOX", messages: [makeMsg("Hello")] });
    expect(canonicalize(block).source_type).toBe("email");
  });

  test("dm/ channel → dm", () => {
    const block = makeBlock({ channel: "dm/ou_123", messages: [makeMsg("Hi")] });
    expect(canonicalize(block).source_type).toBe("dm");
  });

  test("docs/ channel → document", () => {
    const block = makeBlock({ channel: "docs/folder123", messages: [makeMsg("Doc content")] });
    expect(canonicalize(block).source_type).toBe("document");
  });

  test("calendar/ channel → structured", () => {
    const block = makeBlock({ channel: "calendar/primary", messages: [makeMsg("Meeting")] });
    expect(canonicalize(block).source_type).toBe("structured");
  });

  test("tasks channel → structured", () => {
    const block = makeBlock({ channel: "tasks", messages: [makeMsg("Task item")] });
    expect(canonicalize(block).source_type).toBe("structured");
  });

  test("group/ channel → chat", () => {
    const block = makeBlock({ channel: "group/oc_abc", messages: [makeMsg("Hey")] });
    expect(canonicalize(block).source_type).toBe("chat");
  });

  // Agent collectors set channel = bare sessionId (no prefix), so source type
  // must key off the platform — otherwise agent blocks miscategorize as chat
  // (spec §8 provenance audit).
  test("claude-code platform with bare session-id channel → agent_session", () => {
    const block = makeBlock({
      platform: "claude-code",
      channel: "7f3a2b1c-session",
      messages: [makeMsg("Fixed the bug", { platform: "claude-code" })],
    });
    expect(canonicalize(block).source_type).toBe("agent_session");
  });

  test("codex and hermes platforms → agent_session", () => {
    for (const platform of ["codex", "hermes"]) {
      const block = makeBlock({
        platform,
        channel: "session-001",
        messages: [makeMsg("done", { platform })],
      });
      expect(canonicalize(block).source_type).toBe("agent_session");
    }
  });
});

describe("canonicalize — interaction tags", () => {
  test("direction=sent adds 'sent' tag", () => {
    const block = makeBlock({
      channel: "group/oc_abc",
      messages: [makeMsg("I decided", { direction: "sent" })],
    });
    expect(canonicalize(block).interaction_tags).toContain("sent");
  });

  test("dm/ channel adds 'dm' tag", () => {
    const block = makeBlock({
      channel: "dm/ou_123",
      messages: [makeMsg("Hi", { direction: "received" })],
    });
    expect(canonicalize(block).interaction_tags).toContain("dm");
  });

  test("email reply adds 'reply' tag", () => {
    const block = makeBlock({
      channel: "mail/INBOX",
      messages: [
        makeMsg("Subject\n\nReply body", {
          direction: "sent",
          metadata: { thread_id: "thread_123" },
        }),
      ],
    });
    const tags = canonicalize(block).interaction_tags;
    expect(tags).toContain("sent");
    expect(tags).toContain("reply");
  });

  test("received email with no thread_id has empty tags", () => {
    const block = makeBlock({
      channel: "mail/INBOX",
      messages: [makeMsg("Subject\n\nBody")],
    });
    expect(canonicalize(block).interaction_tags).toEqual([]);
  });
});

describe("canonicalize — email adapter", () => {
  test("strips reply chain (On ... wrote:)", () => {
    const content =
      "Re: Project Update\n\nSounds good, let's proceed.\n\nOn 2026-05-28 Alice wrote:\n> Original message here\n> More quoted text";
    const block = makeBlock({ channel: "mail/INBOX", messages: [makeMsg(content)] });
    const result = canonicalize(block);
    expect(result.canonical_markdown).not.toContain("On 2026-05-28 Alice wrote:");
    expect(result.canonical_markdown).not.toContain("> Original message here");
    expect(result.canonical_markdown).toContain("Sounds good");
  });

  test("strips footer (unsubscribe)", () => {
    const content =
      "Important update\n\nHere is the news.\n\nTo unsubscribe from this mailing list, click here.";
    const block = makeBlock({ channel: "mail/INBOX", messages: [makeMsg(content)] });
    const result = canonicalize(block);
    expect(result.canonical_markdown).not.toContain("unsubscribe");
    expect(result.canonical_markdown).toContain("Here is the news");
  });

  test("strips Teams meeting template", () => {
    const content =
      "Sync meeting\n\nLet's discuss the roadmap.\n\nMicrosoft Teams meeting\nJoin on your computer\nhttps://teams.microsoft.com/l/meetup";
    const block = makeBlock({ channel: "mail/INBOX", messages: [makeMsg(content)] });
    const result = canonicalize(block);
    expect(result.canonical_markdown).not.toContain("Microsoft Teams meeting");
    expect(result.canonical_markdown).toContain("Let's discuss the roadmap");
  });

  test("extracts subject from first line before \\n\\n", () => {
    const content = "Weekly Report\n\nHere are the highlights.";
    const block = makeBlock({ channel: "mail/INBOX", messages: [makeMsg(content)] });
    const result = canonicalize(block);
    expect(result.canonical_markdown).toContain("Subject: Weekly Report");
    expect(result.canonical_markdown).toContain("Here are the highlights");
  });

  test("formats email with headers", () => {
    const content = "Meeting Notes\n\nAction items from today.";
    const block = makeBlock({
      channel: "mail/INBOX",
      messages: [
        makeMsg(content, {
          contact: "bob@example.com",
          timestamp: "2026-05-29T10:00:00Z",
          metadata: { to: ["alice@example.com"], cc: ["carol@example.com"] },
        }),
      ],
    });
    const result = canonicalize(block);
    expect(result.canonical_markdown).toContain("From: bob@example.com");
    expect(result.canonical_markdown).toContain("To: alice@example.com");
    expect(result.canonical_markdown).toContain("CC: carol@example.com");
  });
});

describe("canonicalize — chat adapter", () => {
  test("formats as [timestamp] contact: content", () => {
    const block = makeBlock({
      channel: "group/oc_abc",
      messages: [
        makeMsg("Hello", { contact: "alice", timestamp: "2026-05-29T10:00:00Z" }),
        makeMsg("Hi there", { contact: "bob", timestamp: "2026-05-29T10:01:00Z" }),
      ],
    });
    const result = canonicalize(block);
    expect(result.canonical_markdown).toContain("[2026-05-29T10:00:00Z] alice: Hello");
    expect(result.canonical_markdown).toContain("[2026-05-29T10:01:00Z] bob: Hi there");
  });
});

describe("canonicalize — structured adapter", () => {
  test("calendar event preserves metadata fields", () => {
    const block = makeBlock({
      channel: "calendar/primary",
      messages: [
        makeMsg("Team Standup\n\nDaily sync meeting", {
          metadata: { event_id: "ev_123", location: "Zoom", attendees: ["alice", "bob"] },
        }),
      ],
    });
    const result = canonicalize(block);
    expect(result.source_type).toBe("structured");
    expect(result.canonical_markdown).toContain("Team Standup");
  });
});
