import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { type CrmProvider, proposeRecord } from "../crm/extract.js";
import { ApplySchema, type ProposalInput } from "../crm/schemas.js";
import type { CrmStore, Proposal } from "../crm/store.js";
import { InstantSchema, TimezoneSchema } from "../crm/temporal.js";
import type { AudioProvider } from "./providers.js";
import {
  evidenceSegments,
  type Transcript,
  TranscriptSchema,
  transcriptParts,
} from "./transcript.js";

const ID = z.string().regex(/^[a-f0-9]{32}$/);
const META = z.object({ captured_at: InstantSchema, timezone: TimezoneSchema }).strict();
export interface VoiceSession {
  schema_version: 1;
  id: string;
  audio_sha256: string;
  audio_file: string;
  source_name: string;
  captured_at: string;
  timezone: string;
  created_at: string;
  state: "saved" | "transcribed" | "captured" | "proposed" | "applied";
  transcript_sha256?: string;
  last_error?: { stage: string; message: string; at: string };
  records: Array<{
    id: string;
    part: number;
    proposal_id?: string;
    applied?: boolean;
    evidence?: Array<{ quote: string; segment_ids: string[] }>;
  }>;
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const data of createReadStream(path)) hash.update(data);
  return hash.digest("hex");
}
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

async function atomicWrite(path: string, value: string): Promise<void> {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, value, { flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

/** One local writer per archive. Never time out and steal an active ASR job's lock. */
async function locked<T>(root: string, run: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true });
  const lock = join(root, ".writer-lock");
  const owner = { pid: process.pid, host: hostname(), token: randomUUID() };
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const ownerText = await readFile(join(lock, "owner.json"), "utf8");
    const previous = JSON.parse(ownerText) as typeof owner;
    if (previous.host !== owner.host || !Number.isSafeInteger(previous.pid) || previous.pid <= 0)
      throw new Error("Voice archive is locked by another host");
    try {
      process.kill(previous.pid, 0);
      throw new Error(`Voice archive is busy (PID ${previous.pid})`);
    } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
    }
    // A permanent claim for this dead owner serializes recovery contenders.
    const claim = join(
      root,
      ".recovered-locks",
      createHash("sha256").update(ownerText).digest("hex"),
    );
    await mkdir(join(root, ".recovered-locks"), { recursive: true });
    await mkdir(claim);
    if ((await readFile(join(lock, "owner.json"), "utf8")) !== ownerText)
      throw new Error("Archive lock changed; retry");
    const stale = `${lock}.stale-${randomUUID()}`;
    await rename(lock, stale);
    await rm(stale, { recursive: true });
    await mkdir(lock);
  }
  try {
    await writeFile(join(lock, "owner.json"), json(owner), { flag: "wx" });
    return await run();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export class VoicePipeline {
  constructor(
    readonly root: string,
    private readonly crm: CrmStore,
  ) {}

  directory(id: string): string {
    return join(this.root, ID.parse(id));
  }

  async get(id: string): Promise<VoiceSession> {
    const session = JSON.parse(
      await readFile(join(this.directory(id), "session.json"), "utf8"),
    ) as VoiceSession;
    if (
      session.id !== id ||
      session.schema_version !== 1 ||
      basename(session.audio_file) !== session.audio_file ||
      !/^audio\.[a-z0-9]+$/.test(session.audio_file)
    )
      throw new Error("Invalid voice session manifest");
    return session;
  }

  private async save(session: VoiceSession): Promise<void> {
    await atomicWrite(join(this.directory(session.id), "session.json"), json(session));
  }

  async transcript(id: string): Promise<Transcript> {
    const session = await this.get(id);
    const path = join(this.directory(id), "transcript.json");
    if (!session.transcript_sha256 || (await digest(path)) !== session.transcript_sha256)
      throw new Error(
        "Transcript changed after capture; immutable sources cannot be silently overwritten",
      );
    const transcript = TranscriptSchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (transcript.audio_sha256 !== session.audio_sha256)
      throw new Error("Transcript belongs to a different audio file");
    return transcript;
  }

  async importAudio(
    audioPath: string,
    metadata: { captured_at: string; timezone: string },
    provider: AudioProvider,
  ): Promise<VoiceSession> {
    const meta = META.parse(metadata);
    const extension = extname(audioPath).toLowerCase();
    if (![".m4a", ".wav", ".mp3", ".aac", ".flac", ".aiff", ".caf", ".ogg"].includes(extension))
      throw new Error("Unsupported audio extension");
    const info = await stat(audioPath);
    if (!info.isFile() || info.size === 0) throw new Error("Expected a non-empty audio file");
    const hash = await digest(audioPath);
    // Capture representation is intentional: replay with changed time metadata is a distinct source.
    const id = createHash("sha256")
      .update(json({ hash, ...meta }))
      .digest("hex")
      .slice(0, 32);
    return locked(this.root, async () => {
      const dir = this.directory(id);
      await mkdir(dir, { recursive: true });
      let session: VoiceSession;
      try {
        session = await this.get(id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        session = {
          schema_version: 1,
          id,
          audio_sha256: hash,
          audio_file: `audio${extension}`,
          source_name: basename(audioPath),
          ...meta,
          created_at: new Date().toISOString(),
          state: "saved",
          records: [],
        };
        const temp = join(dir, `audio-${randomUUID()}.tmp`);
        try {
          await copyFile(audioPath, temp);
          if ((await digest(temp)) !== hash)
            throw new Error(
              "Source audio changed while being copied; retry after recording has finished",
            );
          await rename(temp, join(dir, session.audio_file));
        } finally {
          await rm(temp, { force: true });
        }
        await this.save(session);
      }
      try {
        if ((await digest(join(dir, session.audio_file))) !== hash)
          throw new Error("Archived audio checksum mismatch");
        for (const saved of session.records) {
          const record = await this.crm.getRecord(saved.id);
          if (record.external_id !== `memkin-voice:${id}:v1:${saved.part}`)
            throw new Error("Archive and Memkin database do not match");
        }
        if (!session.transcript_sha256) {
          const transcript = TranscriptSchema.parse(
            await provider.transcribe(join(dir, session.audio_file)),
          );
          if (transcript.audio_sha256 !== hash)
            throw new Error("Transcription provider returned a different audio checksum");
          await atomicWrite(join(dir, "transcript.json"), json(transcript));
          session.transcript_sha256 = await digest(join(dir, "transcript.json"));
          session.state = "transcribed";
          await this.save(session);
        }
        const transcript = await this.transcript(id);
        if (
          provider.reviewedTranscript &&
          json(TranscriptSchema.parse(provider.reviewedTranscript)) !== json(transcript)
        ) {
          throw new Error(
            "A different transcript is already saved for this recording. P0 does not overwrite or revise captured transcripts.",
          );
        }
        const parts = transcriptParts(transcript);
        await atomicWrite(join(dir, "transcript.txt"), parts.map((p) => p.content).join(""));
        for (const [index, part] of parts.entries()) {
          // Replay capture even when a manifest has the ID: detects using a different database.
          const record = await this.crm.capture({
            content: part.content,
            source: "voice",
            captured_at: meta.captured_at,
            timezone: meta.timezone,
            external_id: `memkin-voice:${id}:v1:${index}`,
            person_ids: [],
          });
          const saved = session.records.find((r) => r.part === index);
          if (saved && saved.id !== record.id)
            throw new Error(
              "Archive was opened against a different Memkin database; use its original database",
            );
          if (!saved) session.records.push({ id: record.id, part: index });
          await this.save(session);
        }
        if (["saved", "transcribed"].includes(session.state)) session.state = "captured";
        delete session.last_error;
        await this.save(session);
        return session;
      } catch (error) {
        session.last_error = {
          stage: "import",
          message: error instanceof Error ? error.message : "Import failed",
          at: new Date().toISOString(),
        };
        await this.save(session);
        throw error;
      }
    });
  }

  async propose(
    id: string,
    options: { provider?: CrmProvider; manual?: Record<string, ProposalInput> },
  ): Promise<VoiceSession> {
    return locked(this.root, async () => {
      const session = await this.get(id);
      const parts = transcriptParts(await this.transcript(id));
      if (session.records.length !== parts.length)
        throw new Error("Finish importing all transcript parts first");
      try {
        for (const record of session.records) {
          const existing = await this.crm.listProposals(record.id);
          let proposal = record.proposal_id
            ? existing.find((p) => p.id === record.proposal_id)
            : existing[0];
          if (record.proposal_id && !proposal)
            throw new Error("Saved proposal is missing from this database");
          if (!proposal) {
            const manual = options.manual?.[record.id];
            proposal = manual
              ? await this.crm.saveProposal(record.id, manual)
              : await proposeRecord(this.crm, record.id, options.provider);
          }
          record.evidence = proposal.data.entries.map((e) => ({
            quote: e.evidence.quote,
            segment_ids: evidenceSegments(parts[record.part], e.evidence.quote),
          }));
          if (record.evidence.some((e) => e.segment_ids.length === 0))
            throw new Error("Proposal evidence could not be linked to audio");
          record.proposal_id = proposal.id;
          record.applied = proposal.status === "applied";
          await this.save(session);
        }
        session.state = session.records.every((r) => r.applied) ? "applied" : "proposed";
        delete session.last_error;
        await this.save(session);
        await this.exportReview(session);
        return session;
      } catch (error) {
        session.last_error = {
          stage: "propose",
          message: error instanceof Error ? error.message : "Proposal failed",
          at: new Date().toISOString(),
        };
        await this.save(session);
        throw error;
      }
    });
  }

  private async exportReview(session: VoiceSession): Promise<void> {
    const proposals: Proposal[] = [];
    for (const record of session.records) {
      const proposal = (await this.crm.listProposals(record.id)).find(
        (p) => p.id === record.proposal_id,
      );
      if (proposal) proposals.push(proposal);
    }
    await atomicWrite(join(this.directory(session.id), "proposals.json"), json(proposals));
    await atomicWrite(
      join(this.directory(session.id), "review-template.json"),
      json({
        session_id: session.id,
        records: proposals.map((p) => ({
          record_id: p.record_id,
          proposal_id: p.id,
          identities: Object.fromEntries(p.data.people.map((person) => [person.key, null])),
        })),
      }),
    );
    const lines = [
      `Memkin Voice — ${session.state === "applied" ? "已确认的人物记忆" : "待确认的记忆提案"}`,
      `原始录制时间：${session.captured_at} (${session.timezone})`,
      "",
    ];
    for (const p of proposals) {
      lines.push(`记录 ${p.record_id} · ${p.status}`);
      for (const e of p.data.entries) {
        lines.push(
          `- ${e.kind === "interaction" ? e.summary : e.kind === "fact" ? `${e.predicate}：${e.value}` : e.relation}`,
          `  依据：${e.evidence.quote}`,
        );
      }
    }
    await atomicWrite(join(this.directory(session.id), "summary.txt"), `${lines.join("\n")}\n`);
  }

  async apply(id: string, input: unknown): Promise<VoiceSession> {
    const review = z
      .object({
        session_id: ID,
        records: z
          .array(
            z
              .object({
                record_id: z.string(),
                proposal_id: z.string(),
                identities: ApplySchema.shape.identities,
              })
              .strict(),
          )
          .min(1),
      })
      .strict()
      .parse(input);
    if (review.session_id !== id) throw new Error("Review belongs to another session");
    return locked(this.root, async () => {
      const session = await this.get(id);
      await this.transcript(id);
      if (new Set(review.records.map((r) => r.record_id)).size !== review.records.length)
        throw new Error("Duplicate review records");
      if (
        review.records.length !== session.records.length ||
        review.records.some(
          (r) =>
            !session.records.some((s) => s.id === r.record_id && s.proposal_id === r.proposal_id),
        )
      )
        throw new Error("Review must cover exactly the saved session proposals");
      try {
        for (const r of review.records) {
          await this.crm.applyProposal(r.proposal_id, { identities: r.identities });
          const saved = session.records.find((s) => s.id === r.record_id);
          if (saved) saved.applied = true;
          await this.save(session);
        }
        session.state = "applied";
        delete session.last_error;
        await this.save(session);
        await this.exportReview(session);
        return session;
      } catch (error) {
        session.last_error = {
          stage: "apply",
          message: error instanceof Error ? error.message : "Apply failed",
          at: new Date().toISOString(),
        };
        await this.save(session);
        throw error;
      }
    });
  }
}
