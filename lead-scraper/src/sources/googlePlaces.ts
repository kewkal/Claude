/**
 * Google Places API (v1) discovery.
 *
 * This is the official, documented API — not scraped Maps HTML. It is the only
 * source in this project that can supply ratings, so `reviews` is populated
 * only when this adapter runs.
 *
 * Activated by setting GOOGLE_PLACES_API_KEY. Without a key the adapter reports
 * itself unavailable and `auto` falls through to OpenStreetMap.
 */

import { ENDPOINTS, SOURCE_PACING } from '../config.js';
import type { PreliminaryLead } from '../types/lead.js';
import { HostPacer } from '../utils/concurrency.js';
import { fetchJson } from '../utils/http.js';
import { log } from '../utils/logger.js';
import { normalisePhone, normaliseWhitespace, toAbsoluteUrl } from '../utils/normalise.js';
import type { DiscoveryQuery, SourceAdapter } from './sourceAdapter.js';

interface PlacesPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
}

interface PlacesResponse {
  places?: PlacesPlace[];
  nextPageToken?: string;
}

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.websiteUri',
  'places.internationalPhoneNumber',
  'places.nationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
  'nextPageToken',
].join(',');

/** Places returns at most 20 per page. */
const PAGE_SIZE = 20;

export class GooglePlacesSource implements SourceAdapter {
  readonly name = 'google-places';
  readonly description = 'Google Places API v1 Text Search (official API, includes ratings)';

  private readonly pacer = new HostPacer(SOURCE_PACING.googlePlacesDelayMs);

  private get apiKey(): string {
    return process.env['GOOGLE_PLACES_API_KEY']?.trim() ?? '';
  }

  isAvailable(): boolean {
    return this.apiKey !== '';
  }

  unavailableReason(): string {
    return 'GOOGLE_PLACES_API_KEY is not set';
  }

  async *discover(query: DiscoveryQuery): AsyncIterable<PreliminaryLead> {
    const seen = new Set<string>();
    let pageToken: string | undefined;
    let yielded = 0;

    while (yielded < query.limit) {
      const body: Record<string, unknown> = {
        textQuery: `${query.vertical} in ${query.location}`,
        pageSize: Math.min(PAGE_SIZE, query.limit - yielded),
      };
      if (pageToken !== undefined) body['pageToken'] = pageToken;

      const response = await fetchJson<PlacesResponse>(ENDPOINTS.googlePlacesSearchText, {
        method: 'POST',
        expectHtml: false,
        headers: {
          'content-type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
        pacer: this.pacer,
        signal: query.signal,
      });

      const places = response.places ?? [];
      if (places.length === 0) return;

      for (const place of places) {
        if (yielded >= query.limit) return;
        const businessName = normaliseWhitespace(place.displayName?.text ?? '');
        if (businessName === '') continue;

        const id = place.id ?? businessName;
        if (seen.has(id)) continue;
        seen.add(id);

        const rating = typeof place.rating === 'number' ? place.rating : null;
        const count = typeof place.userRatingCount === 'number' ? place.userRatingCount : null;

        yielded += 1;
        yield {
          businessName,
          website: toAbsoluteUrl(place.websiteUri ?? null),
          phone: normalisePhone(place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null, query.region),
          reviews: rating !== null && count !== null ? { rating, count } : null,
          address: normaliseWhitespace(place.formattedAddress ?? '') || null,
          sourceUrl: place.googleMapsUri ?? `https://places.googleapis.com/v1/places/${id}`,
          sourceName: this.name,
        };
      }

      pageToken = response.nextPageToken;
      if (pageToken === undefined) return;
      log.debug(`google places: fetching next page (${yielded}/${query.limit} so far)`);
    }
  }
}
