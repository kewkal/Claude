// Client-safe types for the on-demand "Get real prices" check.
import type { TipSource } from "@/lib/savings/types";

/** One booking site's price for a hotel, whole stay, one room, as Google Hotels lists it. */
export interface HotelOffer {
  seller: string;
  totalUsd: number | null;
  perNightUsd: number | null;
  link?: string;
  official: boolean;
  freeCancellation: boolean;
}

export interface HotelPriceCheck {
  ref: string;
  name: string;
  offers: HotelOffer[];
  /** What the trip used before the check (Google's headline total). */
  headlineTotalUsd: number | null;
  fetchedAt: string;
}

export type FoundPriceSource = "tripadvisor" | "website" | "listed";

/** A per-person USD price found for an item no source had priced in USD. */
export interface FoundPrice {
  ref: string;
  name: string;
  usd: number;
  /** Exactly what the source showed, e.g. "€15", "Adults $29". */
  display: string;
  source: FoundPriceSource;
  url?: string;
  /** Text copied from the page that contains the price (website reads only). */
  quote?: string;
  /** Set when converted: original currency and amount, and the ECB rate used. */
  fx?: { currency: string; amount: number; rate: number; date: string };
  fetchedAt: string;
}

export interface NotFound {
  ref: string;
  name: string;
  reason: string;
}

/** A place Reddit or travel sites recommend for your trip styles. */
export interface CommunityPick {
  name: string;
  /** Matching item in this trip's data, when there is one. */
  ref: string | null;
  /** AI one-liner on why people recommend it, from the cited snippets. */
  why: string;
  sourceIds: string[];
  domains: string[];
  crossChecked: boolean;
}

export interface PriceCheck {
  hotels: HotelPriceCheck[];
  activities: FoundPrice[];
  notFound: NotFound[];
  picks: CommunityPick[];
  sources: TipSource[];
  searchesUsed: number;
  pagesRead: number;
  /** Things that couldn't be checked (missing key, quota, a site that blocked us). */
  notes: string[];
  fetchedAt: string;
}

export interface PriceCheckPlan {
  hotels: { ref: string; name: string }[];
  tripadvisor: { ref: string; name: string }[];
  websites: { ref: string; name: string; url: string }[];
  convert: { ref: string; name: string; display: string }[];
  picksQueries: number;
  /** SerpApi searches that aren't already cached. */
  searches: number;
  pages: number;
  firecrawlConfigured: boolean;
}

export const SOURCE_NAME: Record<FoundPriceSource, string> = {
  tripadvisor: "Tripadvisor",
  website: "Official site",
  listed: "Google Maps",
};
