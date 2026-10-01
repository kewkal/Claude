import type { LatLng } from "@/lib/geo";

export type PlaceCategory = "sights" | "tours" | "food" | "nightlife" | "outdoors" | "culture" | "photo" | "events";

export const CATEGORIES: { id: PlaceCategory; label: string }[] = [
  { id: "sights", label: "Sights" },
  { id: "tours", label: "Tours & experiences" },
  { id: "food", label: "Food" },
  { id: "nightlife", label: "Nightlife" },
  { id: "outdoors", label: "Outdoors & adventure" },
  { id: "culture", label: "Culture & museums" },
  { id: "photo", label: "Photo spots" },
  { id: "events", label: "Events on your dates" },
];

export type PlaceSource = "google_maps" | "tripadvisor" | "google_events";

export const SOURCE_LABEL: Record<PlaceSource, string> = {
  google_maps: "Google Maps",
  tripadvisor: "Tripadvisor",
  google_events: "Google Events",
};

export interface SourceRating {
  source: PlaceSource;
  rating: number | null;
  reviews: number | null;
  url?: string;
  fetchedAt: string;
}

export interface PriceInfo {
  /** Exactly what the source showed ("$$", "$10–20", "Free"), or null when the source gives no price. */
  display: string | null;
  /** Google price level 1–4 when the source gives "$".."$$$$". */
  level: number | null;
  minUsd: number | null;
  maxUsd: number | null;
  source: PlaceSource | null;
}

export interface EventInfo {
  when: string;
  /** yyyy-mm-dd when we could parse the source's date; null when it couldn't be parsed. */
  startDate: string | null;
  venue?: string;
  tickets: { source: string; link: string }[];
}

export interface PlaceItem {
  id: string;
  name: string;
  category: PlaceCategory;
  types: string[];
  sources: SourceRating[];
  price: PriceInfo;
  hours: string | null;
  weeklyHours?: Record<string, string>;
  address: string | null;
  gps?: LatLng;
  thumbnail?: string;
  description?: string;
  website?: string;
  googleDataId?: string;
  googlePlaceId?: string;
  tripadvisorId?: string;
  event?: EventInfo;
  fetchedAt: string;
}

export interface Video {
  id: string;
  title: string;
  channel: string;
  published?: string;
  views?: number | null;
  length?: string;
  thumbnail?: string;
  url: string;
}

export interface PopularTimes {
  /** day -> [{hour label, busyness 0-100}] */
  days: Record<string, { time: string; busyness: number }[]>;
}

export function isVerified(item: Pick<PlaceItem, "sources">, threshold: number): boolean {
  return item.sources.some((s) => s.rating !== null && (s.reviews ?? 0) >= threshold);
}

export const PRICE_NOT_LISTED = "Price not listed";
