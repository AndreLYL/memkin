import type {
  CanonicalisedBlock,
  ConversationBlock,
  InteractionTag,
  RawMessage,
  SourceType,
} from "./types";

export function canonicalize(block: ConversationBlock): CanonicalisedBlock {
  const source_type = inferSourceType(block.channel);
  const interaction_tags = inferInteractionTags(block, source_type);
  const canonical_markdown = buildMarkdown(block, source_type);

  return { block, source_type, interaction_tags, canonical_markdown };
}

function inferSourceType(channel: string): SourceType {
  if (channel.startsWith("mail/")) return "email";
  if (channel.startsWith("dm/")) return "dm";
  if (channel.startsWith("docs/")) return "document";
  if (channel.startsWith("calendar/") || channel === "tasks") return "structured";
  return "chat";
}

function inferInteractionTags(block: ConversationBlock, sourceType: SourceType): InteractionTag[] {
  const tags: InteractionTag[] = [];

  if (block.messages.some(m => m.direction === "sent")) {
    tags.push("sent");
  }

  if (sourceType === "email") {
    const hasSentReply = block.messages.some(
      m => m.direction === "sent" && m.metadata?.thread_id
    );
    if (hasSentReply) tags.push("reply");
  }

  if (sourceType === "dm") {
    tags.push("dm");
  }

  return tags;
}

function buildMarkdown(block: ConversationBlock, sourceType: SourceType): string {
  switch (sourceType) {
    case "email":
      return canonicalizeEmail(block.messages);
    case "chat":
    case "dm":
      return canonicalizeChat(block.messages);
    case "document":
      return canonicalizeDocument(block.messages);
    case "structured":
      return canonicalizeStructured(block.messages);
  }
}

// --- Email adapter ---

const REPLY_CHAIN_RE = /\n\s*On .{10,80} wrote:\s*\n[\s\S]*/;
const QUOTE_BLOCK_RE = /\n(>{3,}[^\n]*\n?)+/g;
const ORIGINAL_MSG_RE = /\n\s*---+\s*Original Message\s*---+[\s\S]*/i;

const FOOTER_PATTERNS = [
  /unsubscribe/i,
  /view in browser/i,
  /all rights reserved/i,
  /此邮件由系统自动发送/,
  /请勿回复/,
  /Microsoft Teams meeting/i,
  /Join on your computer/i,
  /Join with a video conferencing device/i,
];

function canonicalizeEmail(messages: RawMessage[]): string {
  return messages.map(msg => {
    const splitIdx = msg.content.indexOf("\n\n");
    let subject = "";
    let body = msg.content;
    if (splitIdx > 0) {
      subject = msg.content.slice(0, splitIdx);
      body = msg.content.slice(splitIdx + 2);
    }

    // Strip reply chains
    body = body.replace(REPLY_CHAIN_RE, "");
    body = body.replace(QUOTE_BLOCK_RE, "");
    body = body.replace(ORIGINAL_MSG_RE, "");

    // Strip footers (find first footer marker from top, cut from there)
    const lines = body.split("\n");
    let cutoff = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (FOOTER_PATTERNS.some(p => p.test(line))) {
        cutoff = i;
        break;
      }
    }
    body = lines.slice(0, cutoff).join("\n").trimEnd();

    // Build structured output
    const to = Array.isArray(msg.metadata?.to) ? (msg.metadata.to as string[]).join(", ") : "";
    const cc = Array.isArray(msg.metadata?.cc) ? (msg.metadata.cc as string[]).join(", ") : "";

    let header = "---\n";
    header += `From: ${msg.contact}\n`;
    if (subject) header += `Subject: ${subject}\n`;
    header += `Date: ${msg.timestamp}\n`;
    if (to) header += `To: ${to}\n`;
    if (cc) header += `CC: ${cc}\n`;
    header += "---\n";

    return `${header}${body}`;
  }).join("\n\n");
}

// --- Chat/DM adapter ---

function canonicalizeChat(messages: RawMessage[]): string {
  return messages
    .map(msg => `[${msg.timestamp}] ${msg.contact}: ${msg.content}`)
    .join("\n");
}

// --- Document adapter ---

function canonicalizeDocument(messages: RawMessage[]): string {
  return messages.map(m => m.content.trim()).join("\n\n");
}

// --- Structured adapter (calendar/tasks) ---

function canonicalizeStructured(messages: RawMessage[]): string {
  return messages.map(msg => {
    const meta = msg.metadata ?? {};
    const metaLines: string[] = [];

    if (meta.event_id) metaLines.push(`Event: ${meta.event_id}`);
    if (meta.task_id) metaLines.push(`Task: ${meta.task_id}`);
    if (meta.location) metaLines.push(`Location: ${meta.location}`);
    if (meta.status) metaLines.push(`Status: ${meta.status}`);
    if (meta.priority) metaLines.push(`Priority: ${meta.priority}`);
    if (meta.due_date) metaLines.push(`Due: ${meta.due_date}`);
    if (Array.isArray(meta.attendees)) metaLines.push(`Attendees: ${(meta.attendees as string[]).join(", ")}`);
    if (Array.isArray(meta.assignees)) metaLines.push(`Assignees: ${(meta.assignees as string[]).join(", ")}`);

    const metaBlock = metaLines.length > 0 ? metaLines.join("\n") + "\n\n" : "";
    return `${metaBlock}${msg.content.trim()}`;
  }).join("\n\n");
}
