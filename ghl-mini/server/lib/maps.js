import { allSettings } from './settings.js';
import { HttpError } from './http.js';

const SEARCH_TEXT = 'https://places.googleapis.com/v1/places:searchText';
const LEGACY_TEXT = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const LEGACY_DETAILS = 'https://maps.googleapis.com/maps/api/place/details/json';

/**
 * Places API (New) returns the phone number and website in the search
 * response, so one call per page replaces one call per business. Ask for
 * exactly the fields we store — the field mask is what you get billed on.
 */
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.location',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryTypeDisplayName',
  'places.businessStatus',
  'nextPageToken',
].join(',');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Search for businesses by free text ("dentists in Austin TX").
 * Walks up to `pages` pages of 20. Returns normalized lead-shaped objects.
 */
export async function searchPlaces({ query, pages = 3, minRating = 0, maxReviews = null }) {
  const apiKey = allSettings().google_maps_api_key;
  if (!apiKey) {
    throw new HttpError(400, 'No Google Maps API key. Add one in Settings > API keys.');
  }

  const wanted = Math.max(1, Math.min(10, Number(pages) || 1));
  const collected = [];
  let pageToken = null;

  for (let page = 0; page < wanted; page++) {
    const body = { textQuery: query, pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(SEARCH_TEXT, {
      method: 'POST',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();

    if (data.error) {
      // A project with only the legacy API enabled falls back rather than failing.
      if (page === 0 && isNotEnabled(data.error)) {
        return legacySearch({ apiKey, query, pages: wanted, minRating, maxReviews });
      }
      throw new HttpError(
        data.error.code === 429 ? 429 : 400,
        `Google Places: ${data.error.message || data.error.status}`
      );
    }

    const places = data.places || [];
    if (!places.length) break;
    collected.push(...places);

    pageToken = data.nextPageToken || null;
    if (!pageToken) break;
  }

  return collected
    .filter((p) => keep({ rating: p.rating, review_count: p.userRatingCount }, minRating, maxReviews))
    .map((p) => normalizeNew(p, query));
}

function isNotEnabled(error) {
  const text = `${error.status || ''} ${error.message || ''}`;
  return /SERVICE_DISABLED|has not been used|is not enabled|PERMISSION_DENIED/i.test(text);
}

function keep({ rating, review_count }, minRating, maxReviews) {
  if (minRating && (rating || 0) < minRating) return false;
  if (maxReviews != null && (review_count || 0) > maxReviews) return false;
  return true;
}

function component(components, type) {
  const hit = (components || []).find((c) => (c.types || []).includes(type));
  return hit ? hit.shortText || hit.longText : null;
}

function normalizeNew(place, query) {
  const lead = {
    name: place.displayName?.text || 'Unknown',
    category: place.primaryTypeDisplayName?.text || null,
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
    email: null,
    website: place.websiteUri || null,
    address: place.formattedAddress || null,
    city: component(place.addressComponents, 'locality') || component(place.addressComponents, 'postal_town'),
    state: component(place.addressComponents, 'administrative_area_level_1'),
    postal_code: component(place.addressComponents, 'postal_code'),
    country: component(place.addressComponents, 'country'),
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    rating: place.rating ?? null,
    review_count: place.userRatingCount ?? null,
    place_id: place.id,
    source: 'google_maps',
    search_query: query,
  };
  lead.score = scoreLead(lead);
  return lead;
}

/**
 * Fallback for projects that only have the legacy Places API enabled.
 * Legacy search omits phone and website, so each result needs its own
 * details call, and its pagination token is unreliable — one page only.
 */
async function legacySearch({ apiKey, query, minRating, maxReviews }) {
  const url = new URL(LEGACY_TEXT);
  url.searchParams.set('query', query);
  url.searchParams.set('key', apiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const data = await res.json();

  if (data.status === 'REQUEST_DENIED') {
    throw new HttpError(400, `Google Places: ${data.error_message || 'request denied — enable the Places API for this key'}`);
  }
  if (data.status === 'OVER_QUERY_LIMIT') {
    throw new HttpError(429, 'Google Places quota exceeded for this key.');
  }
  if (data.status !== 'OK') return [];

  const filtered = (data.results || []).filter((p) =>
    keep({ rating: p.rating, review_count: p.user_ratings_total }, minRating, maxReviews)
  );

  const out = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < filtered.length; i += CONCURRENCY) {
    const batch = filtered.slice(i, i + CONCURRENCY);
    const details = await Promise.all(
      batch.map((p) => legacyDetails(p.place_id, apiKey).catch(() => ({})))
    );
    batch.forEach((place, j) => out.push(normalizeLegacy(place, details[j], query)));
  }
  return out;
}

async function legacyDetails(placeId, apiKey) {
  const url = new URL(LEGACY_DETAILS);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'formatted_phone_number,website,address_component');
  url.searchParams.set('key', apiKey);
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  return (await res.json()).result || {};
}

function normalizeLegacy(place, details, query) {
  const parts = (details.address_components || []).map((c) => ({
    types: c.types, shortText: c.short_name, longText: c.long_name,
  }));
  const lead = {
    name: place.name,
    category: (place.types || [])[0]?.replace(/_/g, ' ') || null,
    phone: details.formatted_phone_number || null,
    email: null,
    website: details.website || null,
    address: place.formatted_address || null,
    city: component(parts, 'locality') || component(parts, 'postal_town'),
    state: component(parts, 'administrative_area_level_1'),
    postal_code: component(parts, 'postal_code'),
    country: component(parts, 'country'),
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

/**
 * Lead score, 0-100. The thesis: a business with lots of happy customers
 * and no website (or a bad one) is the easiest sale for a site builder.
 */
export function scoreLead(lead) {
  const { website, rating, review_count, phone } = lead;
  let score = 30;

  if (!website) score += 35;
  else if (/facebook\.com|instagram\.com|wixsite|weebly|godaddysites|business\.site|linktr\.ee/i.test(website)) score += 25;
  if (phone) score += 10;

  if ((review_count || 0) >= 100) score += 15;
  else if ((review_count || 0) >= 25) score += 10;
  else if ((review_count || 0) >= 5) score += 5;

  if ((rating || 0) >= 4.5) score += 10;
  else if ((rating || 0) >= 4.0) score += 5;
  else if (rating && rating < 3.5) score -= 10;

  // Signals from a site scan, when one has been run. Ad spend is the
  // strongest of these: it proves there is a budget and someone already
  // decided the internet is worth paying for.
  if (lead.runs_ads) score += 18;
  if (lead.site_status && ['unreachable', 'timeout', 'server_error', 'not_found'].includes(lead.site_status)) score += 22;
  if (lead.site_status === 'ok') {
    if (lead.mobile_ready === 0) score += 12;
    if (lead.has_ssl === 0) score += 8;
    if (!lead.has_meta_pixel && !lead.has_google_tag && !lead.has_analytics && !lead.has_google_ads) score += 8;
    if (['wix', 'godaddy', 'weebly', 'duda', 'google_business'].includes(lead.site_platform)) score += 10;
  }

  // A franchise cannot buy from you. Corporate owns the site and the
  // person answering the phone has no authority to spend.
  if (lead.is_chain) score = Math.round(score * 0.25);

  return Math.max(0, Math.min(100, score));
}
