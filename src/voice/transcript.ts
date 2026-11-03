import { z } from "zod";

export const TranscriptSchema = z
  .object({
    schema_version: z.literal(1),
    audio_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    duration_ms: z.number().int().positive(),
    language: z.string().min(1).max(32),
    asr: z
      .object({ provider: z.string().min(1).max(100), model: z.string().min(1).max(500) })
      .strict(),
    diarization: z.enum(["none", "manual", "pyannote"]),
    segments: z
      .array(
        z
          .object({
            id: z.string().regex(/^s\d{6}$/),
            start_ms: z.number().int().nonnegative(),
            end_ms: z.number().int().positive(),
            speaker: z
              .string()
              .regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/)
              .nullable(),
            text: z.string().trim().min(1).max(10000),
          })
          .strict(),
      )
      .min(1)
      .max(100000),
  })
  .strict()
  .superRefine((t, ctx) => {
    const ids = new Set<string>();
    let previousStart = -1;
    for (const [i, s] of t.segments.entries()) {
      if (
        ids.has(s.id) ||
        s.start_ms < previousStart ||
        s.end_ms <= s.start_ms ||
        s.end_ms > t.duration_ms ||
        (t.diarization === "none" && s.speaker !== null)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", i],
          message: "Invalid segment ID, timing, order, or unverified speaker label",
        });
      }
      ids.add(s.id);
      previousStart = s.start_ms;
    }
  });
export type Transcript = z.infer<typeof TranscriptSchema>;

export function timecode(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export interface TranscriptPart {
  content: string;
  segments: Array<{
    id: string;
    char_start: number;
    char_end: number;
    start_ms: number;
    end_ms: number;
  }>;
}

/** Split on utterance boundaries below CRM's 100,000-character source limit. */
export function transcriptParts(transcript: Transcript, maxCharacters = 12000): TranscriptPart[] {
  const parts: TranscriptPart[] = [];
  let part: TranscriptPart = { content: "", segments: [] };
  for (const s of transcript.segments) {
    const line = `[${s.id} ${timecode(s.start_ms)}–${timecode(s.end_ms)}] ${s.speaker ?? "UNKNOWN"}: ${s.text}\n`;
    if (line.length > maxCharacters) throw new Error("One utterance exceeds the record size limit");
    if (part.content.length + line.length > maxCharacters) {
      parts.push(part);
      part = { content: "", segments: [] };
    }
    const start = part.content.length;
    part.content += line;
    part.segments.push({
      id: s.id,
      char_start: start,
      char_end: part.content.length,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
    });
  }
  if (part.segments.length) parts.push(part);
  return parts;
}

/** Keep every matching occurrence; a repeated 'yes' must not silently select the first. */
export function evidenceSegments(part: TranscriptPart, quote: string): string[] {
  const ids = new Set<string>();
  let offset = part.content.indexOf(quote);
  while (quote && offset !== -1) {
    for (const s of part.segments) {
      if (s.char_start < offset + quote.length && s.char_end > offset) ids.add(s.id);
    }
    offset = part.content.indexOf(quote, offset + 1);
  }
  return [...ids];
}
