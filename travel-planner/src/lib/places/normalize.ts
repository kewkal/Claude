import type { Photo, Review } from "@/lib/hotels/types";
import type { PlaceCategory, PlaceItem, PopularTimes, PriceInfo, PlaceSource, Video } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const NO_PRICE: PriceInfo = { display: null, level: null, minUsd: null, maxUsd: null, source: null };

/** Parse a price string exactly as the source gave it. Never invents a number. */
export function parsePrice(raw: unknown, source: PlaceSource): PriceInfo {
  const s = str(raw).trim();
  if (!s) return NO_PRICE;
  if (/^\$+$/.test(s) && s.length <= 4) return { display: s, level: s.length, minUsd: null, maxUsd: null, source };
  if (/^free$/i.test(s)) return { display: s, level: null, minUsd: 0, maxUsd: 0, source };
  const nums = [...s.replace(/,/g, "").matchAll(/\$?\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (s.includes("$") && nums.length) {
    return { display: s, level: null, minUsd: Math.min(...nums), maxUsd: Math.max(...nums), source };
  }
  // Non-USD or unparseable: show it verbatim, but don't use it in math.
  return { display: s, level: null, minUsd: null, maxUsd: null, source };
}

function gps(v: Raw | undefined) {
  const lat = num(v?.latitude);
  const lng = num(v?.longitude);
  return lat !== null && lng !== null ? { lat, lng } : undefined;
}

function hoursText(r: Raw): string | null {
  if (typeof r.hours === "string") return r.hours;
  if (typeof r.open_state === "string") return r.open_state;
  return null;
}

function weekly(r: Raw): Record<string, string> | undefined {
  const oh = r.operating_hours;
  if (oh && typeof oh === "object" && !Array.isArray(oh)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(oh)) if (typeof v === "string") out[k] = v;
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}

function mapsUrl(r: Raw): string | undefined {
  const pid = str(r.place_id);
  if (pid) return `https://www.google.com/maps/place/?q=place_id:${pid}`;
  const g = gps(r.gps_coordinates);
  return g ? `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}` : undefined;
}

export function normalizeMapsResult(r: Raw, category: PlaceCategory, fetchedAt: string): PlaceItem | null {
  const name = str(r.title) || str(r.name);
  if (!name) return null;
  const placeId = str(r.place_id);
  const dataId = str(r.data_id);
  return {
    id: `gm:${placeId || dataId || name}`,
    name,
    category,
    types: Array.isArray(r.types) ? r.types.map(String) : str(r.type) ? [str(r.type)] : [],
    sources: [{ source: "google_maps", rating: num(r.rating), reviews: num(r.reviews), url: mapsUrl(r), fetchedAt }],
    price: parsePrice(r.price, "google_maps"),
    hours: hoursText(r),
    weeklyHours: weekly(r),
    address: str(r.address) || null,
    gps: gps(r.gps_coordinates),
    thumbnail: str(r.thumbnail) || undefined,
    description: str(r.description) || undefined,
    website: str(r.website) || undefined,
    googleDataId: dataId || undefined,
    googlePlaceId: placeId || undefined,
    fetchedAt,
  };
}

export function normalizeMaps(data: Raw, category: PlaceCategory, fetchedAt: string): PlaceItem[] {
  const list: Raw[] = Array.isArray(data.local_results) ? data.local_results : data.place_results ? [data.place_results] : [];
  return list.map((r) => normalizeMapsResult(r, category, fetchedAt)).filter((x): x is PlaceItem => x !== null);
}

export interface TripadvisorHit {
  id: string;
  name: string;
  type: string;
  rating: number | null;
  reviews: number | null;
  url?: string;
  description?: string;
  location?: string;
  thumbnail?: string;
}

export function normalizeTripadvisor(data: Raw): TripadvisorHit[] {
  const list: Raw[] = Array.isArray(data.locations) ? data.locations : [];
  return list
    .map((l) => ({
      id: String(l.place_id ?? ""),
      name: str(l.title),
      type: str(l.place_type),
      rating: num(l.rating),
      reviews: num(l.reviews),
      url: str(l.link) || undefined,
      description: str(l.description) || undefined,
      location: str(l.location) || undefined,
      thumbnail: str(l.thumbnail) || undefined,
    }))
    .filter((l) => l.id && l.name);
}

const STOP = new Set(["the", "of", "and", "de", "da", "do", "das", "dos", "la", "le", "el", "a", "museum", "museu", "restaurant", "bar", "cafe", "café"]);
function tokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Same-place check across sources: name token overlap (Jaccard ≥ 0.6) or one name containing the other. */
export function sameName(a: string, b: string): boolean {
  const na = a.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  const nb = b.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (na === nb) return true;
  if (na.length >= 6 && nb.length >= 6 && (na.includes(nb) || nb.includes(na))) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / (ta.size + tb.size - inter) >= 0.6;
}

/** Attach Tripadvisor ratings to matching Google items; unmatched Tripadvisor hits become their own items. */
export function mergeTripadvisor(
  items: PlaceItem[],
  hits: TripadvisorHit[],
  category: PlaceCategory,
  fetchedAt: string,
  includeUnmatched: (h: TripadvisorHit) => boolean,
): PlaceItem[] {
  const out = items.map((i) => ({ ...i, sources: [...i.sources] }));
  for (const h of hits) {
    const match = out.find((i) => !i.tripadvisorId && sameName(i.name, h.name));
    const src = { source: "tripadvisor" as const, rating: h.rating, reviews: h.reviews, url: h.url, fetchedAt };
    if (match) {
      match.sources.push(src);
      match.tripadvisorId = h.id;
    } else if (includeUnmatched(h)) {
      out.push({
        id: `ta:${h.id}`,
        name: h.name,
        category,
        types: h.type ? [h.type.toLowerCase()] : [],
        sources: [src],
        price: NO_PRICE,
        hours: null,
        address: h.location ?? null,
        thumbnail: h.thumbnail,
        description: h.description,
        tripadvisorId: h.id,
        fetchedAt,
      });
    }
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Nov 14" -> yyyy-mm-dd, choosing the year that puts it nearest to (and not long before) `anchor`. */
export function parseEventDate(s: string, anchor: string): string | null {
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})/.exec(s);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) return null;
  const day = Number(m[2]);
  const ay = Number(anchor.slice(0, 4));
  const candidates = [ay - 1, ay, ay + 1].map((y) => `${y}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  const a = Date.parse(anchor);
  // Prefer the closest date that isn't more than 60 days before the anchor.
  return candidates
    .filter((c) => Date.parse(c) >= a - 60 * 86_400_000)
    .sort((x, y) => Math.abs(Date.parse(x) - a) - Math.abs(Date.parse(y) - a))[0] ?? null;
}

export function normalizeEvents(data: Raw, fetchedAt: string, anchorDate: string): PlaceItem[] {
  const list: Raw[] = Array.isArray(data.events_results) ? data.events_results : [];
  return list
    .map((e) => {
      const title = str(e.title);
      if (!title) return null;
      const startText = str(e.date?.start_date);
      const when = str(e.date?.when) || startText;
      const venue = e.venue ?? {};
      const address = Array.isArray(e.address) ? e.address.join(", ") : str(e.address);
      const startDate = parseEventDate(startText || when, anchorDate);
      const item: PlaceItem = {
        id: `ev:${title}|${startDate ?? when}`.slice(0, 200),
        name: title,
        category: "events",
        types: ["event"],
        sources: [
          { source: "google_events", rating: null, reviews: null, url: str(e.link) || undefined, fetchedAt },
          ...(num(venue.rating) !== null ? [{ source: "google_maps" as const, rating: num(venue.rating), reviews: num(venue.reviews), url: str(venue.link) || undefined, fetchedAt }] : []),
        ],
        price: NO_PRICE,
        hours: when || null,
        address: address || null,
        thumbnail: str(e.thumbnail) || str(e.image) || undefined,
        description: str(e.description) || undefined,
        event: {
          when,
          startDate,
          venue: str(venue.name) || undefined,
          tickets: (Array.isArray(e.ticket_info) ? e.ticket_info : [])
            .filter((t: Raw) => str(t.link))
            .map((t: Raw) => ({ source: str(t.source) || "Tickets", link: str(t.link) })),
        },
        fetchedAt,
      };
      return item;
    })
    .filter((x): x is PlaceItem => x !== null);
}

export function normalizeMapsReviews(data: Raw): Review[] {
  const list: Raw[] = Array.isArray(data.reviews) ? data.reviews : [];
  return list
    .map((r) => ({
      author: str(r.user?.name) || "Anonymous",
      source: "Google Maps",
      rating: num(r.rating),
      bestRating: 5,
      date: str(r.iso_date) ? str(r.iso_date).slice(0, 10) : str(r.date) || null,
      text: str(r.snippet) || str(r.extracted_snippet?.original),
      link: str(r.link) || undefined,
    }))
    .filter((r) => r.text);
}

export function normalizeTripadvisorReviews(data: Raw): Review[] {
  const list: Raw[] = Array.isArray(data.reviews) ? data.reviews : [];
  return list
    .map((r) => ({
      author: str(r.author?.username) || str(r.author?.name) || str(r.user?.name) || "Tripadvisor reviewer",
      source: "Tripadvisor",
      rating: num(r.rating),
      bestRating: 5,
      date: str(r.date) || str(r.published_date) || null,
      text: [str(r.title), str(r.snippet) || str(r.text)].filter(Boolean).join(" — "),
      link: str(r.link) || undefined,
    }))
    .filter((r) => r.text);
}

export function normalizeMapsPhotos(data: Raw): Photo[] {
  const list: Raw[] = Array.isArray(data.photos) ? data.photos : [];
  return list.map((p) => ({ thumb: str(p.thumbnail), full: str(p.image) || str(p.thumbnail) })).filter((p) => p.thumb);
}

export function youtubeId(url: string): string | null {
  const m = /[?&]v=([\w-]{11})/.exec(url) ?? /youtu\.be\/([\w-]{11})/.exec(url) ?? /shorts\/([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}

export function normalizeYoutube(data: Raw, limit = 3): Video[] {
  const list: Raw[] = Array.isArray(data.video_results) ? data.video_results : [];
  const out: Video[] = [];
  for (const v of list) {
    const url = str(v.link);
    const id = youtubeId(url);
    if (!id) continue;
    out.push({
      id,
      title: str(v.title),
      channel: str(v.channel?.name),
      published: str(v.published_date) || undefined,
      views: num(v.views),
      length: str(v.length) || undefined,
      thumbnail: str(v.thumbnail?.static) || str(v.thumbnail) || undefined,
      url,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function normalizePopularTimes(data: Raw): PopularTimes | null {
  const g = data.place_results?.popular_times?.graph_results;
  if (!g || typeof g !== "object") return null;
  const days: PopularTimes["days"] = {};
  for (const [day, arr] of Object.entries(g as Record<string, Raw[]>)) {
    if (!Array.isArray(arr)) continue;
    days[day] = arr
      .map((x) => ({ time: str(x.time), busyness: num(x.busyness_score) ?? 0 }))
      .filter((x) => x.time);
  }
  return Object.keys(days).length ? { days } : null;
}
