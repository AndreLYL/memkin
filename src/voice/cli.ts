import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { resolveDb } from "../cli-stores.js";
import { loadConfig } from "../core/config.js";
import { stateDirFor } from "../core/state.js";
import { ProposalSchema } from "../crm/schemas.js";
import { CrmStore } from "../crm/store.js";
import { VoicePipeline } from "./pipeline.js";
import { localOllamaProvider, localPythonProvider } from "./providers.js";
import { TranscriptSchema } from "./transcript.js";

interface Common {
  config: string;
  archive?: string;
}
async function withVoice<T>(
  options: Common,
  action: (pipeline: VoicePipeline) => Promise<T>,
): Promise<void> {
  // loadConfig deliberately falls back to defaults for a missing file. Voice
  // requires an explicit existing config so a typo cannot open the default DB.
  await readFile(resolve(options.config), "utf8");
  const config = loadConfig(options.config);
  if (config.store.engine === "postgres") {
    const database = new URL(config.store.database_url ?? "");
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !["127.0.0.1", "[::1]"].includes(database.hostname) ||
      database.search ||
      database.hash
    )
      throw new Error("Voice P0 requires a local database");
  }
  const { db } = await resolveDb(config);
  try {
    const archive = options.archive
      ? resolve(options.archive)
      : resolve(stateDirFor(config.__context.projectRoot), "voice");
    const result = await action(new VoicePipeline(archive, new CrmStore(db.executor)));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.close();
  }
}

function common(command: Command): Command {
  return command
    .requiredOption(
      "-c, --config <path>",
      "Explicit Memkin config (use an isolated local P0 database first)",
    )
    .option("--archive <path>", "Local audio archive; default: config directory/.memkin/voice");
}

export function registerVoiceCommands(program: Command): void {
  const voice = program
    .command("voice")
    .description("Local recording → reviewed person memory (P0)");
  common(voice.command("import <audio>"))
    .requiredOption("--captured-at <timestamp>", "Original recording time, including UTC offset")
    .requiredOption("--timezone <iana>", "Original IANA timezone, e.g. Asia/Shanghai")
    .option(
      "--transcript <json>",
      "Import a reviewed, hash-bound transcript instead of invoking ASR",
    )
    .option("--python <executable>", "Python interpreter with local ASR dependencies", "python3")
    .option("--model-dir <path>", "Previously downloaded faster-whisper model directory")
    .option("--language <code>", "ASR language", "zh")
    .option("--device <device>", "cpu or cuda", "cpu")
    .action(async (audio, options) => {
      if (!options.transcript && !options.modelDir)
        throw new Error("Supply --model-dir or --transcript; runtime never downloads models");
      if (!["cpu", "cuda"].includes(options.device))
        throw new Error("--device must be cpu or cuda");
      const reviewedTranscript = options.transcript
        ? TranscriptSchema.parse(JSON.parse(await readFile(resolve(options.transcript), "utf8")))
        : undefined;
      const provider = reviewedTranscript
        ? {
            reviewedTranscript,
            transcribe: async () => reviewedTranscript,
          }
        : localPythonProvider({
            python: options.python,
            script: resolve(
              dirname(fileURLToPath(import.meta.url)),
              "../../services/voice/worker.py",
            ),
            modelDir: resolve(options.modelDir),
            language: options.language,
            device: options.device,
          });
      await withVoice(options, (pipeline) =>
        pipeline.importAudio(
          resolve(audio),
          { captured_at: options.capturedAt, timezone: options.timezone },
          provider,
        ),
      );
    });
  common(voice.command("status <session>")).action(async (id, options) =>
    withVoice(options, (pipeline) => pipeline.get(id)),
  );
  common(voice.command("propose <session>"))
    .option("--model <name>", "Downloaded local Ollama model; cloud configuration is never used")
    .option("--ollama-url <url>", "Explicit loopback Ollama URL", "http://127.0.0.1:11434")
    .option("--from-json <file>", "Manual proposals: JSON object keyed by CRM record ID")
    .action(async (id, options) => {
      if (Boolean(options.model) === Boolean(options.fromJson))
        throw new Error("Choose exactly one of --model or --from-json");
      const manual = options.fromJson
        ? Object.fromEntries(
            Object.entries(JSON.parse(await readFile(resolve(options.fromJson), "utf8"))).map(
              ([key, value]) => [key, ProposalSchema.parse(value)],
            ),
          )
        : undefined;
      const provider = options.model
        ? localOllamaProvider(options.model, options.ollamaUrl)
        : undefined;
      await withVoice(options, (pipeline) =>
        pipeline.propose(id, { manual, provider: provider ? () => provider : undefined }),
      );
    });
  common(voice.command("apply <session>"))
    .requiredOption(
      "--review <file>",
      "Explicitly reviewed proposal IDs and person identity choices",
    )
    .action(async (id, options) => {
      const review: unknown = JSON.parse(await readFile(resolve(options.review), "utf8"));
      await withVoice(options, (pipeline) => pipeline.apply(id, review));
    });
}
