import type { Adapter } from '../core/types.js';
import { FileAdapter } from './file.js';
import { GBrainAdapter } from './gbrain.js';
import { StdoutAdapter } from './stdout.js';

export interface AdapterRegistry {
  register(adapter: Adapter): void;
  get(id: string): Adapter | undefined;
  list(): Adapter[];
}

export class DefaultAdapterRegistry implements AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  register(adapter: Adapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  list(): Adapter[] {
    return Array.from(this.adapters.values());
  }
}

export { FileAdapter, GBrainAdapter, StdoutAdapter };
