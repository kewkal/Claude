/**
 * Offline discovery from a local manifest.
 *
 * Exists for two practical reasons: the end-to-end smoke test needs a source
 * that does not touch the public internet, and it is the fastest way to work on
 * the enrichment pipeline without waiting on (or loading) real directories.
 *
 * Selected with `--source fixture`. Never used by `auto`.
 */

import { readFileSync } from 'node:fs';

import type { PreliminaryLead } from '../types/lead.js';
import { normalisePhone, normaliseWhitespace, toAbsoluteUrl } from '../utils/normalise.js';
import type { DiscoveryQuery, SourceAdapter } from './sourceAdapter.js';

interface FixtureRecord {
  businessName: string;
  website?: string | null;
  phone?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  address?: string | null;
}

export class FixtureSource implements SourceAdapter {
  readonly name = 'fixture';
  readonly description = 'Local JSON manifest (offline development and the smoke test)';

  /**
   * @param manifestPath JSON file containing an array of FixtureRecord.
   * @param baseUrl      Prefix for relative website paths, e.g. a local server.
   */
  constructor(
    private readonly manifestPath: string | null,
    private readonly baseUrl: string | null,
  ) {}

  isAvailable(): boolean {
    return this.manifestPath !== null;
  }

  unavailableReason(): string {
    return 'no fixture manifest configured (set FIXTURE_MANIFEST or pass --fixture-manifest)';
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async generator contract
  async *discover(query: DiscoveryQuery): AsyncIterable<PreliminaryLead> {
    if (this.manifestPath === null) throw new Error(this.unavailableReason());

    const parsed = JSON.parse(readFileSync(this.manifestPath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) throw new Error(`Fixture manifest ${this.manifestPath} must contain an array`);

    let yielded = 0;
    for (const entry of parsed as FixtureRecord[]) {
      if (yielded >= query.limit) return;
      const businessName = normaliseWhitespace(entry.businessName ?? '');
      if (businessName === '') continue;

      const website = entry.website
        ? (toAbsoluteUrl(entry.website, this.baseUrl ?? undefined) ?? null)
        : null;

      yielded += 1;
      yield {
        businessName,
        website,
        phone: normalisePhone(entry.phone ?? null, query.region),
        reviews:
          typeof entry.rating === 'number' && typeof entry.reviewCount === 'number'
            ? { rating: entry.rating, count: entry.reviewCount }
            : null,
        address: entry.address ?? null,
        sourceUrl: `file://${this.manifestPath}#${businessName}`,
        sourceName: this.name,
      };
    }
  }
}
