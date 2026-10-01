import "server-only";
import { badInput } from "@/lib/errors";
import type { Photo, Review } from "@/lib/hotels/types";
import type { SerpParams } from "@/lib/serpapi/cache-key";
import { serpSearch } from "@/lib/serpapi/client";
import {
  mergeTripadvisor,
  normalizeEvents,
  normalizeMaps,
  normalizeMapsPhotos,
  normalizeMapsReviews,
  normalizePopularTimes,
  normalizeTripadvisor,
  normalizeTripadvisorReviews,
  normalizeYoutube,
  type TripadvisorHit,
} from "./normalize";
import type { PlaceCategory, PlaceItem, PopularTimes, Video } from "./types";

const QUERY: Record<Exclude<PlaceCategory, "events">, string> = {
  sights: "top sights in",
  tours: "tours and experiences in",
  food: "best restaurants in",
  nightlife: "bars and nightlife in",
  outdoors: "parks and outdoor activities in",
  culture: "museums in",
  photo: "scenic viewpoints in",
};

const looksLikeTour = (h: TripadvisorHit) => /\b(tours?|trip|cruise|sailing|class|experience|excursion|walk)\b/i.test(h.name);

// Which Tripadvisor search (if any) feeds each category ("A" = things to do, "r" = restaurants),
// and which unmatched Tripadvisor-only hits get listed as their own items there.
const TA_SEARCH: Partial<Record<PlaceCategory, { ssrc: "A" | "r"; unmatched: (h: TripadvisorHit) => boolean }>> = {
  sights: { ssrc: "A", unmatched: (h) => !looksLikeTour(h) },
  tours: { ssrc: "A", unmatched: looksLikeTour },
  culture: { ssrc: "A", unmatched: () => false },
  outdoors: { ssrc: "A", unmatched: () => false },
  photo: { ssrc: "A", unmatched: () => false },
  food: { ssrc: "r", unmatched: () => true },
};

/** The SerpApi requests explore() makes for a category (events excluded: its query depends on the month). Used for cost previews. */
export function exploreRequests(destination: string, category: PlaceCategory, tripadvisor = true): { engine: string; params: SerpParams }[] {
  if (category === "events") return [];
  const reqs: { engine: string; params: SerpParams }[] = [{ engine: "google_maps", params: { q: `${QUERY[category]} ${destination.trim()}`, type: "search", hl: "en", gl: "us" } }];
  const ta = TA_SEARCH[category];
  if (ta && tripadvisor) reqs.push({ engine: "tripadvisor", params: { q: destination.trim(), ssrc: ta.ssrc, hl: "en" } });
  return reqs;
}

export interface ExploreResult {
  category: PlaceCategory;
  items: PlaceItem[];
  fetchedAt: string;
  /** paid searches this call actually made (cache hits are free) */
  searchesUsed: number;
}

export interface ExploreOptions {
  /** yyyy-mm-dd; events are filtered to this window */
  startDate?: string;
  endDate?: string;
  /** include Tripadvisor ratings (1 extra search per destination per kind, cached 7 days) */
  tripadvisor?: boolean;
}

export async function explore(destination: string, category: PlaceCategory, opts: ExploreOptions = {}): Promise<ExploreResult> {
  const dest = destination.trim();
  if (!dest) throw badInput("Destination is required.");
  let used = 0;

  if (category === "events") {
    const anchor = opts.startDate ?? new Date().toISOString().slice(0, 10);
    const monthLabel = new Date(`${anchor}T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const res = await serpSearch("google_events", { q: `events in ${dest} ${monthLabel}`, hl: "en", gl: "us" });
    used += res.cached ? 0 : 1;
    let items = normalizeEvents(res.data, res.fetchedAt, anchor);
    if (opts.startDate && opts.endDate) {
      // Keep events whose parsed date falls in the trip window; keep unparseable ones (shown as "check date").
      items = items.filter((e) => !e.event?.startDate || (e.event.startDate >= opts.startDate! && e.event.startDate <= opts.endDate!));
    }
    return { category, items, fetchedAt: res.fetchedAt, searchesUsed: used };
  }

  const res = await serpSearch("google_maps", { q: `${QUERY[category]} ${dest}`, type: "search", hl: "en", gl: "us" });
  used += res.cached ? 0 : 1;
  let items = normalizeMaps(res.data, category, res.fetchedAt);

  const ta = TA_SEARCH[category];
  if (ta && opts.tripadvisor !== false) {
    try {
      const t = await serpSearch("tripadvisor", { q: dest, ssrc: ta.ssrc, hl: "en" });
      used += t.cached ? 0 : 1;
      items = mergeTripadvisor(items, normalizeTripadvisor(t.data), category, t.fetchedAt, ta.unmatched);
    } catch (e) {
      // Tripadvisor is a second opinion; Google results still stand on their own.
      if ((e as { code?: string }).code?.startsWith("SERPAPI_QUOTA")) throw e;
      console.warn("[explore] tripadvisor failed", (e as Error).message);
    }
  }
  return { category, items, fetchedAt: res.fetchedAt, searchesUsed: used };
}

export interface DetailsResult {
  googleReviews?: Review[];
  tripadvisorReviews?: Review[];
  photos?: Photo[];
  videos?: Video[];
  popularTimes?: PopularTimes | null;
  fetchedAt: Record<string, string>;
  errors: Record<string, string>;
}

export type DetailPart = "googleReviews" | "tripadvisorReviews" | "photos" | "videos" | "popularTimes";

/** Lazy per-item data: each part is one search (cached 7 days). Parts fail independently. */
export async function placeDetails(
  item: Pick<PlaceItem, "name" | "googleDataId" | "googlePlaceId" | "tripadvisorId" | "category">,
  destination: string,
  parts: DetailPart[],
): Promise<DetailsResult> {
  const out: DetailsResult = { fetchedAt: {}, errors: {} };
  const jobs: Promise<void>[] = [];
  const run = (part: DetailPart, fn: () => Promise<{ fetchedAt: string }>) =>
    jobs.push(
      fn()
        .then((r) => {
          out.fetchedAt[part] = r.fetchedAt;
        })
        .catch((e: Error & { code?: string }) => {
          out.errors[part] = e.message;
          if (e.code?.startsWith("SERPAPI_QUOTA")) out.errors._quota = e.code;
        }),
    );

  if (parts.includes("googleReviews") && (item.googleDataId || item.googlePlaceId)) {
    run("googleReviews", async () => {
      const r = await serpSearch("google_maps_reviews", item.googleDataId ? { data_id: item.googleDataId, hl: "en" } : { place_id: item.googlePlaceId, hl: "en" });
      out.googleReviews = normalizeMapsReviews(r.data).slice(0, 8);
      return r;
    });
  }
  if (parts.includes("tripadvisorReviews") && item.tripadvisorId) {
    run("tripadvisorReviews", async () => {
      const r = await serpSearch("tripadvisor_reviews", { place_id: item.tripadvisorId, hl: "en" });
      out.tripadvisorReviews = normalizeTripadvisorReviews(r.data).slice(0, 8);
      return r;
    });
  }
  if (parts.includes("photos") && item.googleDataId) {
    run("photos", async () => {
      const r = await serpSearch("google_maps_photos", { data_id: item.googleDataId, hl: "en" });
      out.photos = normalizeMapsPhotos(r.data).slice(0, 20);
      return r;
    });
  }
  if (parts.includes("videos")) {
    run("videos", async () => {
      const r = await serpSearch("youtube", { search_query: `${item.name} ${destination}`, hl: "en", gl: "us" });
      out.videos = normalizeYoutube(r.data, 3);
      return r;
    });
  }
  if (parts.includes("popularTimes") && item.googlePlaceId) {
    run("popularTimes", async () => {
      const r = await serpSearch("google_maps", { type: "place", place_id: item.googlePlaceId, hl: "en" });
      out.popularTimes = normalizePopularTimes(r.data);
      return r;
    });
  }
  await Promise.all(jobs);
  return out;
}

/** Destination-level videos (Explore header). */
export async function destinationVideos(destination: string): Promise<{ videos: Video[]; fetchedAt: string }> {
  const r = await serpSearch("youtube", { search_query: `${destination} travel guide`, hl: "en", gl: "us" });
  return { videos: normalizeYoutube(r.data, 3), fetchedAt: r.fetchedAt };
}
