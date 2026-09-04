import { allSettings } from './settings.js';
import { HttpError } from './http.js';

const PLACES_TEXT = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const PLACES_DETAILS = 'https://maps.googleapis.com/maps/api/place/details/json';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Search Google Places by free text ("dentists in Austin TX").
 * Walks up to `pages` pages (20 results each, 60 max per Google).
 * Returns normalized lead-shaped objects.
 */
export async function searchPlaces({ query, pages = 3, minRating = 0, maxReviews = null, withDetails = true }) {
  const settings = allSettings();
  const apiKey = settings.google_maps_api_key;
  if (!apiKey) {
    throw new HttpError(400, 'No Google Maps API key. Add one in Settings > API keys.');
  }

  const collected = [];
  let pageToken = null;

  for (let page = 0; page < Math.max(1, Math.min(3, pages)); page++) {
    const url = new URL(PLACES_TEXT);
    if (pageToken) {
      url.searchParams.set('pagetoken', pageToken);
      // Google needs a moment before a next_page_token becomes valid.
      await sleep(2100);
    } else {
      url.searchParams.set('query', query);
    }
    url.searchParams.set('key', apiKey);

    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();

    if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
      throw new HttpError(400, `Google Places: ${data.error_message || data.status}`);
    }
    if (data.status === 'OVER_QUERY_LIMIT') {
      throw new HttpError(429, 'Google Places quota exceeded for this key.');
    }
    if (data.status === 'ZERO_RESULTS') break;

    for (const place of data.results || []) {
      collected.push(place);
    }
    pageToken = data.next_page_token || null;
    if (!pageToken) break;
  }

  const filtered = collected.filter((p) => {
    if (minRating && (p.rating || 0) < minRating) return false;
    if (maxReviews != null && (p.user_ratings_total || 0) > maxReviews) return false;
    return true;
  });

  const out = [];
  for (const place of filtered) {
    let details = {};
    if (withDetails) {
      details = await placeDetails(place.place_id, apiKey).catch(() => ({}));
    }
    out.push(normalize(place, details, query));
  }
  return out;
}

async function placeDetails(placeId, apiKey) {
  const url = new URL(PLACES_DETAILS);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set(
    'fields',
    'formatted_phone_number,international_phone_number,website,address_component,url,opening_hours'
  );
  url.searchParams.set('key', apiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  return data.result || {};
}

function component(details, type) {
  const list = details.address_components || [];
  const hit = list.find((c) => (c.types || []).includes(type));
  return hit ? hit.short_name : null;
}

/**
 * Lead score, 0-100. The thesis: a business with lots of happy customers
 * and no website (or a bad one) is the easiest sale for a site builder.
 */
export function scoreLead({ website, rating, review_count, phone }) {
  let score = 30;
  if (!website) score += 35;
  else if (/facebook\.com|instagram\.com|wixsite|weebly|godaddysites|business\.site/i.test(website)) score += 25;
  if (phone) score += 10;
  if ((review_count || 0) >= 100) score += 15;
  else if ((review_count || 0) >= 25) score += 10;
  else if ((review_count || 0) >= 5) score += 5;
  if ((rating || 0) >= 4.5) score += 10;
  else if ((rating || 0) >= 4.0) score += 5;
  else if (rating && rating < 3.5) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function normalize(place, details, query) {
  const website = details.website || null;
  const lead = {
    name: place.name,
    category: (place.types || [])[0]?.replace(/_/g, ' ') || null,
    phone: details.formatted_phone_number || details.international_phone_number || null,
    email: null,
    website,
    address: place.formatted_address || null,
    city: component(details, 'locality') || component(details, 'postal_town'),
    state: component(details, 'administrative_area_level_1'),
    postal_code: component(details, 'postal_code'),
    country: component(details, 'country'),
    lat: place.geometry?.location?.lat ?? null,
    lng: place.geometry?.location?.lng ?? null,
    rating: place.rating ?? null,
    review_count: place.user_ratings_total ?? null,
    place_id: place.place_id,
    source: 'google_maps',
    search_query: query,
  };
  lead.score = scoreLead(lead);
  return lead;
}
