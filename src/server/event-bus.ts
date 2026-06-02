import { EventEmitter } from "node:events";

export interface SignalNewEvent {
  slug: string;
  type: string;
  title: string;
  summary: string;
}

export interface PipelineStartEvent {
  platform: string;
  timestamp: string;
}

export interface PipelineEndEvent {
  platform: string;
  stats: { written: number; skipped: number; errors: number };
  timestamp: string;
}

export interface PipelineErrorEvent {
  platform: string;
  error: string;
  timestamp: string;
}

interface EventMap {
  "signal:new": [SignalNewEvent];
  "pipeline:start": [PipelineStartEvent];
  "pipeline:end": [PipelineEndEvent];
  "pipeline:error": [PipelineErrorEvent];
}

export class EventBus extends EventEmitter<EventMap> {}
