const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Cache lifetimes per SerpApi engine (seconds). Flights move fast; places barely move.
export const TTL_SECONDS: Record<string, number> = {
  google_flights: 30 * MIN,
  google_flights_autocomplete: 30 * DAY,
  google_hotels: 6 * HOUR,
  google_hotels_reviews: 7 * DAY,
  google_hotels_photos: 7 * DAY,
  google_maps: 7 * DAY,
  google_maps_reviews: 7 * DAY,
  google_maps_photos: 7 * DAY,
  google_maps_directions: 7 * DAY,
  tripadvisor: 7 * DAY,
  tripadvisor_reviews: 7 * DAY,
  google_events: 24 * HOUR,
  youtube: 7 * DAY,
};

export function ttlFor(engine: string): number {
  return TTL_SECONDS[engine] ?? 6 * HOUR;
}
