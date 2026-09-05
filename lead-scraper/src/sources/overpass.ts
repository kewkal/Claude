/**
 * OpenStreetMap discovery via the public Overpass API.
 *
 * Chosen as the default because it is genuinely open data (ODbL), explicitly
 * permits automated querying, needs no key and no account, and has no bot
 * defences to tiptoe around. The trade-off is honest: OSM carries no ratings,
 * so `reviews` is always null on this source, and `website`/`phone` tags are
 * present on maybe half of records.
 *
 * Fair-use rules we follow: one request at a time, ~1 req/s, a descriptive
 * User-Agent, and a server-side result cap.
 */

import { ENDPOINTS, OSM_TAG_FILTERS, SOURCE_PACING } from '../config.js';
import type { PreliminaryLead } from '../types/lead.js';
import { HostPacer } from '../utils/concurrency.js';
import { fetchJson } from '../utils/http.js';
import { log } from '../utils/logger.js';
import { normalisePhone, normaliseWhitespace, toAbsoluteUrl } from '../utils/normalise.js';
import type { DiscoveryQuery, SourceAdapter } from './sourceAdapter.js';

interface NominatimPlace {
  boundingbox?: [string, string, string, string];
  display_name?: string;
  lat?: string;
  lon?: string;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Overpass tag filters for a vertical; falls back to a name search when unmapped. */
export function tagFiltersForVertical(vertical: string): string[] {
  const haystack = vertical.toLowerCase();
  for (const { keywords, filters } of OSM_TAG_FILTERS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return [...filters];
  }
  // Unmapped vertical: match the vertical's leading word against the name tag.
  const word = (vertical.match(/[A-Za-z]{3,}/) ?? ['business'])[0] ?? 'business';
  return [`["name"~"${word}",i]`];
}

/** Build the Overpass QL query for a bbox and set of tag filters. */
export function buildOverpassQuery(bbox: BoundingBox, filters: readonly string[], limit: number): string {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const clauses = filters
    .flatMap((filter) => [`node${filter}(${box});`, `way${filter}(${box});`, `relation${filter}(${box});`])
    .join('\n  ');
  return `[out:json][timeout:60];\n(\n  ${clauses}\n);\nout center tags ${Math.max(1, Math.min(1000, limit * 3))};`;
}

export class OverpassSource implements SourceAdapter {
  readonly name = 'overpass';
  readonly description = 'OpenStreetMap via the Overpass API (open data, no key, no ratings)';

  private readonly pacer = new HostPacer(SOURCE_PACING.overpassDelayMs);

  isAvailable(): boolean {
    return true;
  }

  unavailableReason(): string {
    return '';
  }

  /** Resolve a free-text location to a bounding box via Nominatim. */
  private async geocode(location: string, signal?: AbortSignal): Promise<BoundingBox> {
    const url = new URL(ENDPOINTS.nominatim);
    url.searchParams.set('q', location);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');

    const places = await fetchJson<NominatimPlace[]>(url.toString(), {
      expectHtml: false,
      pacer: this.pacer,
      signal,
    });

    const place = places[0];
    const box = place?.boundingbox;
    if (!box || box.length !== 4) {
      throw new Error(`Could not geocode location "${location}"`);
    }
    const [south, north, west, east] = box.map(Number) as [number, number, number, number];
    if ([south, north, west, east].some((value) => !Number.isFinite(value))) {
      throw new Error(`Nominatim returned an unusable bounding box for "${location}"`);
    }
    log.debug(`geocoded "${location}" -> ${south},${west},${north},${east} (${place?.display_name ?? 'unknown'})`);
    return { south, west, north, east };
  }

  async *discover(query: DiscoveryQuery): AsyncIterable<PreliminaryLead> {
    const bbox = await this.geocode(query.location, query.signal);
    const filters = tagFiltersForVertical(query.vertical);
    const body = buildOverpassQuery(bbox, filters, query.limit);
    log.debug(`overpass filters: ${filters.join(' ')}`);

    const response = await fetchJson<OverpassResponse>(ENDPOINTS.overpass, {
      method: 'POST',
      body: new URLSearchParams({ data: body }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      expectHtml: false,
      pacer: this.pacer,
      signal: query.signal,
      timeoutMs: 90_000,
    });

    let yielded = 0;
    for (const element of response.elements ?? []) {
      if (yielded >= query.limit) return;
      const tags = element.tags;
      if (!tags) continue;

      const businessName = normaliseWhitespace(tags['name'] ?? tags['operator'] ?? '');
      if (businessName === '') continue; // an unnamed node is not a lead

      const website = toAbsoluteUrl(tags['website'] ?? tags['contact:website'] ?? tags['url'] ?? null);
      const phone = normalisePhone(tags['phone'] ?? tags['contact:phone'] ?? null, query.region);
      const address =
        [tags['addr:housenumber'], tags['addr:street'], tags['addr:city'], tags['addr:postcode']]
          .filter((part) => part !== undefined && part !== '')
          .join(' ') || null;

      yielded += 1;
      yield {
        businessName,
        website,
        phone,
        reviews: null, // OSM has no ratings; never invent one
        address,
        sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
        sourceName: this.name,
      };
    }
  }
}
