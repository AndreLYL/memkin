import type { Readable, Writable } from "node:stream";
import { render } from "ink";
import React from "react";
import { runEmbeddingAssessment } from "../setup/assess-hardware.js";
import { detectApiKeys } from "../setup/detect-api-keys.js";
import { detectSources } from "../setup/detect-sources.js";
import { loadConfigDocument } from "./document.js";
import { buildConfigRecommendations } from "./recommendations.js";
import { ConfigCenterApp } from "./tui/app.js";

export interface ConfigCenterOptions {
  configPath: string;
  force?: boolean;
  input?: Readable;
  output?: Writable;
}

export async function runConfigCenter(options: ConfigCenterOptions): Promise<void> {
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;
  const doc = await loadConfigDocument(options.configPath);
  const sources = detectSources();
  const recommendations = buildConfigRecommendations({
    apiKeys: detectApiKeys(),
    embeddingAssessment: runEmbeddingAssessment(sources),
  });
  const app = render(
    React.createElement(ConfigCenterApp, {
      doc,
      recommendations,
      sourceDetections: sources,
      onExit: () => app.unmount(),
    }),
    {
      stdin: input as NodeJS.ReadStream,
      stdout: output as NodeJS.WriteStream,
      exitOnCtrlC: true,
    },
  );
}
