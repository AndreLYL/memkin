/**
 * Hardware and data volume assessment for embedding provider recommendation.
 * Detects CPU, GPU, memory, and estimates local data size to recommend
 * whether local Ollama or remote OpenAI embedding is more suitable.
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import type { DetectedSource } from "./detect-sources.js";

export interface HardwareProfile {
  cpuModel: string;
  cpuCores: number;
  memoryGB: number;
  hasAppleSilicon: boolean;
  hasNvidiaGpu: boolean;
  gpuName?: string;
  arch: string;
  platform: NodeJS.Platform;
}

export interface DataVolumeEstimate {
  jsonlFiles: number;
  totalSizeMB: number;
  estimatedChunks: number;
}

export type EmbeddingRecommendation = "ollama" | "openai";

export interface AssessmentResult {
  hardware: HardwareProfile;
  dataVolume: DataVolumeEstimate;
  recommendation: EmbeddingRecommendation;
  reason: string;
  estimatedOllamaMinutes?: number;
}

// ── Hardware detection ─────────────────────────────────────────────────────

function detectGpuMacOS(): string | undefined {
  try {
    const out = execSync("system_profiler SPDisplaysDataType 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = out.match(/Chipset Model:\s*(.+)/);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

function detectGpuLinux(): string | undefined {
  try {
    const out = execSync("lspci 2>/dev/null | grep -i 'vga\\|3d\\|display'", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n")[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function detectGpuWindows(): string | undefined {
  try {
    const out = execSync("wmic path win32_VideoController get name /format:list 2>nul", {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const match = out.match(/Name=(.+)/);
    return match?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function detectHardware(): HardwareProfile {
  const platform = process.platform;
  const arch = process.arch;
  const cpuList = cpus();
  const cpuModel = cpuList[0]?.model ?? "Unknown";
  const cpuCores = cpuList.length;
  const memoryGB = Math.round(totalmem() / 1024 / 1024 / 1024);

  // Apple Silicon: macOS + arm64
  const hasAppleSilicon = platform === "darwin" && arch === "arm64";

  // GPU detection
  let gpuName: string | undefined;
  if (platform === "darwin") gpuName = detectGpuMacOS();
  else if (platform === "linux") gpuName = detectGpuLinux();
  else if (platform === "win32") gpuName = detectGpuWindows();

  const hasNvidiaGpu = Boolean(gpuName && /nvidia/i.test(gpuName));

  return { cpuModel, cpuCores, memoryGB, hasAppleSilicon, hasNvidiaGpu, gpuName, arch, platform };
}

// ── Data volume estimation ─────────────────────────────────────────────────

function getFileSizeMB(filePath: string): number {
  try {
    return statSync(filePath).size / 1024 / 1024;
  } catch {
    return 0;
  }
}

function walkJsonl(dir: string, results: string[]): void {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) walkJsonl(full, results);
        else if (entry.endsWith(".jsonl")) results.push(full);
      } catch {}
    }
  } catch {}
}

export function estimateDataVolume(sources: DetectedSource[]): DataVolumeEstimate {
  const files: string[] = [];
  for (const source of sources) {
    if (source.detected && source.path) {
      walkJsonl(source.path, files);
    }
  }

  const totalSizeMB = files.reduce((sum, f) => sum + getFileSizeMB(f), 0);

  // Rough heuristic: 1MB JSONL ≈ 50 messages ≈ 30 chunks after block building
  const estimatedChunks = Math.round((totalSizeMB / 1) * 30);

  return {
    jsonlFiles: files.length,
    totalSizeMB: Math.round(totalSizeMB * 10) / 10,
    estimatedChunks: Math.max(estimatedChunks, 0),
  };
}

// ── Assessment & recommendation ────────────────────────────────────────────

// Benchmarks (seconds per chunk on each hardware type)
const SECONDS_PER_CHUNK: Record<string, number> = {
  apple_silicon: 0.05, // M1/M2/M3 Metal GPU — very fast
  nvidia_gpu: 0.08, // NVIDIA CUDA
  intel_cpu: 0.8, // Intel CPU only — slow
  amd_cpu: 0.6, // AMD CPU only
  other: 1.0,
};

function getSecondsPerChunk(hw: HardwareProfile): number {
  if (hw.hasAppleSilicon) return SECONDS_PER_CHUNK.apple_silicon;
  if (hw.hasNvidiaGpu) return SECONDS_PER_CHUNK.nvidia_gpu;
  if (/intel/i.test(hw.cpuModel)) return SECONDS_PER_CHUNK.intel_cpu;
  if (/amd/i.test(hw.cpuModel)) return SECONDS_PER_CHUNK.amd_cpu;
  return SECONDS_PER_CHUNK.other;
}

export function assessEmbedding(hw: HardwareProfile, data: DataVolumeEstimate): AssessmentResult {
  const secsPerChunk = getSecondsPerChunk(hw);
  const estimatedSeconds = data.estimatedChunks * secsPerChunk;
  const estimatedMinutes = Math.round(estimatedSeconds / 60);

  // Decision thresholds
  const TOO_SLOW_MINUTES = 30; // > 30 min → recommend OpenAI
  const LOW_MEMORY_GB = 8; // < 8GB RAM → risk of OOM with local model

  let recommendation: EmbeddingRecommendation;
  let reason: string;

  if (hw.memoryGB < LOW_MEMORY_GB) {
    recommendation = "openai";
    reason = `内存仅 ${hw.memoryGB}GB，本地模型运行可能不稳定，建议使用 OpenAI`;
  } else if (hw.hasAppleSilicon) {
    recommendation = "ollama";
    reason = `Apple Silicon（Metal GPU）本地 embedding 速度快，约 ${estimatedMinutes} 分钟处理完 ${data.estimatedChunks} 个 chunk`;
  } else if (hw.hasNvidiaGpu) {
    recommendation = "ollama";
    reason = `检测到 NVIDIA GPU（${hw.gpuName}），本地 embedding 速度快，约 ${estimatedMinutes} 分钟`;
  } else if (estimatedMinutes > TOO_SLOW_MINUTES) {
    recommendation = "openai";
    reason = `${hw.cpuModel} 处理 ${data.estimatedChunks} 个 chunk 预计需要约 ${estimatedMinutes} 分钟，建议使用 OpenAI（秒级完成）`;
  } else if (data.estimatedChunks === 0) {
    recommendation = "ollama";
    reason = "未检测到本地数据，Ollama 适合轻量使用";
  } else {
    recommendation = "ollama";
    reason = `预计约 ${estimatedMinutes} 分钟处理完 ${data.estimatedChunks} 个 chunk`;
  }

  return {
    hardware: hw,
    dataVolume: data,
    recommendation,
    reason,
    estimatedOllamaMinutes: estimatedMinutes,
  };
}

export function runEmbeddingAssessment(sources: DetectedSource[]): AssessmentResult {
  const hw = detectHardware();
  const data = estimateDataVolume(sources);
  return assessEmbedding(hw, data);
}
