import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ProposalSchema } from "../../src/crm/schemas.js";
import { CrmStore } from "../../src/crm/store.js";
import { Database } from "../../src/store/database.js";
import { VoicePipeline } from "../../src/voice/pipeline.js";
import { localOllamaProvider } from "../../src/voice/providers.js";
import {
  evidenceSegments,
  type Transcript,
  TranscriptSchema,
  transcriptParts,
} from "../../src/voice/transcript.js";

const meta = { captured_at: "2026-11-04T10:30:00+08:00", timezone: "Asia/Shanghai" };
const speech = "我下周整理测试数据，周一发给你。";
describe("Voice P0 through real Person CRM", () => {
  let root: string;
  let audio: string;
  let transcript: Transcript;
  let db: Database;
  let crm: CrmStore;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "memkin-voice-"));
    audio = join(root, "synthetic.wav");
    // Valid mono PCM silence; deterministic pipeline tests never claim ASR accuracy.
    const wav = Buffer.alloc(44 + 16000 * 2 * 4);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24);
    wav.writeUInt32LE(32000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    await writeFile(audio, wav);
    transcript = {
      schema_version: 1,
      audio_sha256: createHash("sha256").update(wav).digest("hex"),
      duration_ms: 4000,
      language: "zh",
      asr: { provider: "test-fixture", model: "deterministic-not-real-asr" },
      diarization: "manual",
      segments: [
        { id: "s000001", start_ms: 0, end_ms: 2000, speaker: "S1", text: speech },
        { id: "s000002", start_ms: 2200, end_ms: 3000, speaker: "S2", text: "好的。" },
        { id: "s000003", start_ms: 3100, end_ms: 3900, speaker: "S1", text: "好的。" },
      ],
    };
    db = await Database.create(undefined, { embeddingDimensions: 768 });
    crm = new CrmStore(db.executor);
  });
  afterAll(async () => {
    await db.close();
    await rm(root, { recursive: true, force: true });
  });
  const pipeline = (name: string) => new VoicePipeline(join(root, name), crm);
  const provider = () => ({ transcribe: vi.fn(async () => structuredClone(transcript)) });
  const manualProposal = () =>
    ProposalSchema.parse({
      people: [{ key: "speaker1", name: "待确认的说话人 S1" }],
      entries: [
        {
          kind: "interaction",
          summary: "承诺下周整理测试数据",
          people: [{ ref: "speaker1", role: "participant" }],
          topics: ["测试"],
          status: "planned",
          time: { value: "2026-11-09", precision: "day" },
          evidence: { quote: speech },
        },
      ],
    });

  it("archives audio, preserves original time, then requires review before creating person memory", async () => {
    const p = pipeline("e2e");
    const asr = provider();
    const session = await p.importAudio(audio, meta, asr);
    expect(session.state).toBe("captured");
    expect(await readFile(join(p.directory(session.id), session.audio_file))).toEqual(
      await readFile(audio),
    );
    const record = await crm.getRecord(session.records[0].id);
    expect(record.captured_at_input).toBe(meta.captured_at);
    expect(record.timezone).toBe(meta.timezone);
    expect(record.person_ids).toEqual([]);
    expect(record.content).toContain("[s000001 00:00:00.000–00:00:02.000] S1:");
    const proposed = await p.propose(session.id, { manual: { [record.id]: manualProposal() } });
    expect(proposed.records[0].evidence?.[0].segment_ids).toEqual(["s000001"]);
    expect((await crm.timeline({})).filter((entry) => entry.record_id === record.id)).toHaveLength(
      0,
    );
    const person = await crm.createPerson({ profile: { name: "P0 测试参与者" } });
    const review = {
      session_id: session.id,
      records: [
        {
          record_id: record.id,
          proposal_id: proposed.records[0].proposal_id,
          identities: { speaker1: { person_id: person.id, expected_revision: person.revision } },
        },
      ],
    };
    await expect(
      p.apply(session.id, { ...review, records: [{ ...review.records[0], identities: {} }] }),
    ).rejects.toThrow();
    expect((await p.apply(session.id, review)).state).toBe("applied");
    await p.apply(session.id, review);
    const memories = await crm.timeline({ person_id: person.id });
    expect(memories).toHaveLength(1);
    expect(memories[0].data).toMatchObject({ status: "planned", evidence: { quote: speech } });
    expect(await readFile(join(p.directory(session.id), "summary.txt"), "utf8")).toContain(
      "已确认",
    );
    const replay = await p.importAudio(audio, meta, asr);
    expect(replay.id).toBe(session.id);
    expect(replay.state).toBe("applied");
    expect(asr.transcribe).toHaveBeenCalledTimes(1);
  });

  it("retains original audio after ASR failure and resumes with a fresh pipeline instance", async () => {
    const p = pipeline("asr-retry");
    const captured = { ...meta, captured_at: "2026-11-04T11:00:00+08:00" };
    await expect(
      p.importAudio(audio, captured, {
        transcribe: async () => {
          throw new Error("model unavailable");
        },
      }),
    ).rejects.toThrow("model unavailable");
    const good = provider();
    const resumed = await pipeline("asr-retry").importAudio(audio, captured, good);
    expect(resumed.state).toBe("captured");
    expect(resumed.last_error).toBeUndefined();
    expect(good.transcribe).toHaveBeenCalledTimes(1);
  });

  it("recovers a crash after CRM commit without duplicating the source or rerunning ASR", async () => {
    const p = pipeline("commit-retry");
    const capture = crm.capture.bind(crm);
    const spy = vi.spyOn(crm, "capture").mockImplementationOnce(async (input) => {
      await capture(input);
      throw new Error("lost acknowledgement");
    });
    const asr = provider();
    const captured = { ...meta, captured_at: "2026-11-04T11:01:00+08:00" };
    await expect(p.importAudio(audio, captured, asr)).rejects.toThrow("lost acknowledgement");
    spy.mockRestore();
    const result = await p.importAudio(audio, captured, asr);
    expect(asr.transcribe).toHaveBeenCalledTimes(1);
    const sources = await db.executor.query<{ count: string }>(
      "SELECT count(*) FROM crm_records WHERE external_id=$1",
      [`memkin-voice:${result.id}:v1:0`],
    );
    expect(Number(sources.rows[0].count)).toBe(1);
  });

  it("rejects a transcript for other audio before adding a CRM source", async () => {
    await expect(
      pipeline("bad-hash").importAudio(audio, meta, {
        transcribe: async () => ({ ...transcript, audio_sha256: "0".repeat(64) }),
      }),
    ).rejects.toThrow("checksum");
  });

  it("detects modified archived transcripts and never overwrites saved source text", async () => {
    const p = pipeline("tamper");
    const session = await p.importAudio(audio, meta, provider());
    await writeFile(
      join(p.directory(session.id), "transcript.json"),
      JSON.stringify({ ...transcript, language: "en" }),
    );
    await expect(p.importAudio(audio, meta, provider())).rejects.toThrow("Transcript changed");
    expect((await crm.getRecord(session.records[0].id)).content).toContain(speech);
  });

  it("rejects a different reviewed sidecar instead of silently ignoring the replacement", async () => {
    const p = pipeline("different-sidecar");
    const session = await p.importAudio(audio, meta, provider());
    const changed = { ...transcript, language: "en" };
    await expect(
      p.importAudio(audio, meta, {
        reviewedTranscript: changed,
        transcribe: async () => changed,
      }),
    ).rejects.toThrow("different transcript");
    expect((await p.transcript(session.id)).language).toBe("zh");
  });

  it("resumes after apply commits but acknowledgement is lost, without duplicate memory", async () => {
    const p = pipeline("apply-retry");
    const session = await p.importAudio(
      audio,
      { ...meta, captured_at: "2026-11-04T11:04:00+08:00" },
      provider(),
    );
    const recordId = session.records[0].id;
    const proposed = await p.propose(session.id, { manual: { [recordId]: manualProposal() } });
    const review = {
      session_id: session.id,
      records: [
        {
          record_id: recordId,
          proposal_id: proposed.records[0].proposal_id,
          identities: { speaker1: { new_person: { name: "Apply recovery test" } } },
        },
      ],
    };
    const apply = crm.applyProposal.bind(crm);
    const spy = vi.spyOn(crm, "applyProposal").mockImplementationOnce(async (...args) => {
      await apply(...args);
      throw new Error("lost apply acknowledgement");
    });
    try {
      await expect(p.apply(session.id, review)).rejects.toThrow("lost apply acknowledgement");
    } finally {
      spy.mockRestore();
    }
    expect((await p.get(session.id)).last_error?.stage).toBe("apply");
    expect((await p.apply(session.id, review)).state).toBe("applied");
    expect((await crm.timeline({})).filter((entry) => entry.record_id === recordId)).toHaveLength(
      1,
    );
  });

  it("keeps unconfigured local extraction pending with the source intact", async () => {
    const p = pipeline("no-model");
    const session = await p.importAudio(
      audio,
      { ...meta, captured_at: "2026-11-04T11:02:00+08:00" },
      provider(),
    );
    await expect(p.propose(session.id, {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await p.get(session.id)).state).toBe("captured");
    expect((await crm.getRecord(session.records[0].id)).content).toContain(speech);
  });

  it("reuses persisted proposals after manifest acknowledgement loss", async () => {
    const p = pipeline("proposal-retry");
    const session = await p.importAudio(
      audio,
      { ...meta, captured_at: "2026-11-04T11:03:00+08:00" },
      provider(),
    );
    const saved = await crm.saveProposal(session.records[0].id, manualProposal());
    const result = await p.propose(session.id, {});
    expect(result.records[0].proposal_id).toBe(saved.id);
    expect(await crm.listProposals(saved.record_id)).toHaveLength(1);
  });

  it("rejects competing writers instead of running ASR twice", async () => {
    const p = pipeline("concurrent");
    let started: () => void = () => {};
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = p.importAudio(audio, meta, {
      transcribe: async () => {
        started();
        await waiting;
        return transcript;
      },
    });
    await Promise.race([
      entered,
      pending.then(() => {
        throw new Error("ASR was not reached");
      }),
    ]);
    try {
      await expect(p.importAudio(audio, meta, provider())).rejects.toThrow("busy");
    } finally {
      release();
    }
    await pending;
  });

  it("keeps repeated quotes ambiguous and splits long transcripts without losing segments", () => {
    const parts = transcriptParts(transcript);
    expect(evidenceSegments(parts[0], "好的。")).toEqual(["s000002", "s000003"]);
    const split = transcriptParts(transcript, 100);
    expect(split.length).toBeGreaterThan(1);
    expect(split.flatMap((p) => p.segments.map((s) => s.id))).toEqual(
      transcript.segments.map((s) => s.id),
    );
    expect(split.map((p) => p.content).join("")).toBe(parts[0].content);
  });

  it("rejects invalid times, duplicate IDs and implied speakers without diarization", () => {
    expect(TranscriptSchema.safeParse({ ...transcript, diarization: "none" }).success).toBe(false);
    expect(
      TranscriptSchema.safeParse({
        ...transcript,
        segments: [{ ...transcript.segments[0], end_ms: 99999 }],
      }).success,
    ).toBe(false);
    expect(
      TranscriptSchema.safeParse({
        ...transcript,
        segments: [transcript.segments[0], transcript.segments[0]],
      }).success,
    ).toBe(false);
  });
});

describe("local model boundary", () => {
  it("refuses external endpoints and cloud model names", () => {
    expect(() => localOllamaProvider("local", "https://example.com")).toThrow("loopback");
    expect(() => localOllamaProvider("model:cloud")).toThrow("cloud");
    expect(() => localOllamaProvider("local", "http://127.0.0.1.evil.test")).toThrow("loopback");
  });
  it("rejects a cloud-backed alias discovered by model inspection before sending text", async () => {
    const stub = vi.fn(
      async () =>
        new Response(JSON.stringify({ remote_host: "https://ollama.com" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", stub);
    try {
      await expect(
        localOllamaProvider("alias").chat([{ role: "user", content: "private transcript" }]),
      ).rejects.toThrow("Remote");
      expect(stub).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(stub.mock.calls)).not.toContain("private transcript");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
