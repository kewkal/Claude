/**
 * Discovery is pluggable. Everything downstream consumes `PreliminaryLead` and
 * never learns which adapter produced it, so adding a permitted directory later
 * means adding one file here — not touching the enrichment pipeline.
 */

import type { PreliminaryLead } from '../types/lead.js';

export interface DiscoveryQuery {
  vertical: string;
  location: string;
  limit: number;
  /** ISO-3166 alpha-2 derived from the location, for phone normalisation. */
  region: string | null;
  signal?: AbortSignal;
}

export interface SourceAdapter {
  /** Stable identifier used by `--source` and in logs. */
  readonly name: string;
  /** Human-readable one-liner shown when the adapter is selected. */
  readonly description: string;
  /** False when required configuration (e.g. an API key) is absent. */
  isAvailable(): boolean;
  /** Why the adapter is unavailable, for a useful error message. */
  unavailableReason(): string;
  /** Yields leads as they are found so discovery can stream into enrichment. */
  discover(query: DiscoveryQuery): AsyncIterable<PreliminaryLead>;
}

export class SourceRegistry {
  private readonly adapters = new Map<string, SourceAdapter>();

  register(adapter: SourceAdapter): this {
    this.adapters.set(adapter.name, adapter);
    return this;
  }

  get(name: string): SourceAdapter | undefined {
    return this.adapters.get(name);
  }

  names(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Resolve `--source`. `auto` picks the first available adapter in
   * registration order, which is how the Places adapter takes over from
   * OpenStreetMap the moment an API key is present.
   */
  resolve(requested: string): SourceAdapter {
    if (requested !== 'auto') {
      const adapter = this.adapters.get(requested);
      if (!adapter) {
        throw new Error(`Unknown source "${requested}". Available: auto, ${this.names().join(', ')}`);
      }
      if (!adapter.isAvailable()) {
        throw new Error(`Source "${requested}" is not usable: ${adapter.unavailableReason()}`);
      }
      return adapter;
    }

    for (const adapter of this.adapters.values()) {
      if (adapter.isAvailable()) return adapter;
    }
    throw new Error('No discovery source is available. Check your configuration.');
  }
}
