import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { buildPipelineConfig } from "../../src/core/pipeline-factory.js";

describe("buildPipelineConfig", () => {
  it("returns a PipelineConfig from Config + output_dir", () => {
    const config = loadConfig();
    const result = buildPipelineConfig(config, "/tmp/test-output");
    expect(result.block_gap_minutes).toBe(config.block_builder.block_gap_minutes);
    expect(result.max_block_tokens).toBe(config.block_builder.max_block_tokens);
    expect(result.max_block_messages).toBe(config.block_builder.max_block_messages);
    expect(result.privacy).toEqual(config.privacy);
    expect(result.output_dir).toBe("/tmp/test-output");
    expect(result.dedup_checkpoint).toContain("dedup.jsonl");
    expect(result.cursor_checkpoint).toContain("cursors.yaml");
  });

  it("passes block_concurrency from config.pipeline to PipelineConfig", () => {
    const config = loadConfig();
    (config as unknown as Record<string, unknown>).pipeline = { block_concurrency: 10 };
    const result = buildPipelineConfig(config, "/tmp/test");
    expect(result.block_concurrency).toBe(10);
  });

  it("block_concurrency is undefined when pipeline section absent", () => {
    const config = loadConfig();
    const result = buildPipelineConfig(config, "/tmp/test");
    expect(result.block_concurrency).toBeUndefined();
  });
});

describe("SchedulerConfig in Config", () => {
  it("Config type accepts scheduler field", () => {
    const config = loadConfig();
    expect(config.scheduler).toBeUndefined();
  });
});
