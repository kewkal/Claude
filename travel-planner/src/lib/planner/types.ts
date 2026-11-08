// Client-safe planner types. A trip = inputs + the dataset fetched for it (the grounding set) + the plan.
import type { Cabin, FlightOption, FlightSearchInput, PriceInsights, Travelers } from "@/lib/flights/types";
import type { LatLng, TravelEstimate } from "@/lib/geo";
import type { HotelOption } from "@/lib/hotels/types";
import type { PlaceCategory, PlaceItem } from "@/lib/places/types";
import type { DayWeather } from "@/lib/weather-shared";

export const TRIP_STYLES = ["cinematic", "cultural", "adventure", "luxury", "relaxation", "foodie", "nightlife", "romantic"] as const;
export type TripStyle = (typeof TRIP_STYLES)[number];
export type Pace = "chill" | "balanced" | "packed";
export type VersionKey = "lean" | "balanced" | "splurge";
export const VERSION_KEYS: VersionKey[] = ["lean", "balanced", "splurge"];
export const VERSION_LABEL: Record<VersionKey, string> = { lean: "Lean", balanced: "Balanced", splurge: "Splurge" };

export interface PlanInput {
  origin: string;
  /** 1–3 destinations; more than one means "compare first" */
  destinations: string[];
  dateMode: "fixed" | "flexible";
  /** fixed mode: departure and return dates */
  startDate: string;
  endDate: string;
  /** flexible mode: earliest departure, latest return, and trip length in days */
  windowStart?: string;
  windowEnd?: string;
  days?: number;
  travelers: Travelers;
  childAges: number[];
  rooms: number;
  cabin: Cabin;
  budgetUsd: number;
  styles: TripStyle[];
  pace: Pace;
}

/** Items from the dataset, each with a short reference id ("F1", "H3", "P12") that Claude must use. */
export type RefFlight = FlightOption & { ref: string };
export type RefHotel = HotelOption & { ref: string };
export type RefPlace = PlaceItem & { ref: string };

export interface Dataset {
  destination: string;
  origin: string;
  startDate: string;
  endDate: string;
  /** every calendar date from arrival day to departure day */
  dates: string[];
  nights: number;
  travelers: Travelers;
  rooms: number;
  flights: {
    options: RefFlight[];
    priceInsights: PriceInsights | null;
    googleFlightsUrl: string | null;
    fetchedAt: string;
    searchInput: FlightSearchInput;
    payingTravelers: number;
  } | null;
  hotels: { options: RefHotel[]; googleHotelsUrl: string | null; fetchedAt: string } | null;
  places: RefPlace[];
  categories: PlaceCategory[];
  weather: DayWeather[];
  center: LatLng | null;
  errors: string[];
  fetchedAt: string;
}

export type CostBasis = "sourced" | "estimate" | "calculated";

export interface CostLine {
  key: "flights" | "lodging" | "activities" | "food" | "transport" | "buffer";
  label: string;
  amount: number;
  basis: CostBasis;
  note: string;
  sourceUrl?: string | null;
}

export interface CostBreakdown {
  lines: CostLine[];
  total: number;
  budget: number;
  /** budget - total (negative = over budget) */
  remaining: number;
  overBudget: boolean;
  unpricedItems: string[];
}

export type Slot = "morning" | "afternoon" | "evening";
export const SLOTS: Slot[] = ["morning", "afternoon", "evening"];

export interface PlanItem {
  ref: string;
  /** Claude-written note; always shown as "AI suggestion". */
  note?: string;
  /** travel from the previous stop (or the hotel for the first stop of the day) */
  travel?: TravelEstimate & { fromRef: string };
}

export interface PlanBlock {
  slot: Slot;
  items: PlanItem[];
}

export interface PlanDay {
  date: string;
  theme?: string; // AI
  tip?: string; // AI
  blocks: PlanBlock[];
}

export interface PlanVersion {
  key: VersionKey;
  flightRef: string | null;
  hotelRef: string | null;
  summary?: string; // AI
  tips: string[]; // AI
  days: PlanDay[];
  costs: CostBreakdown;
  /** what the server stripped from Claude's output and why */
  removed: { ref: string; reason: string }[];
  generatedAt: string;
}

export interface TripPlan {
  versions: Record<VersionKey, PlanVersion>;
  model: string;
  generatedAt: string;
}

export interface Upgrade {
  id: string;
  group: "comfort" | "experience" | "logistics";
  title: string;
  why: string;
  /** + costs more, - saves money, null = unknown */
  costDeltaUsd: number | null;
  /** 1–5 benefit estimate used for ranking (see formula) */
  impact: number;
  /** "grounded" = based on fetched data refs; "general" = general advice (labeled) */
  basis: "grounded" | "general";
  refs: string[];
  ai: boolean;
  /** optional one-click change, applied as a normal (validated) trip edit */
  action?: TripEditClient;
  /** shown under the title, e.g. "$42 per hour saved" */
  metric?: string;
}

export interface UpgradeSet {
  version: VersionKey;
  items: Upgrade[];
  generatedAt: string;
}

export interface TripRecord {
  id: string;
  name: string;
  inputs: PlanInput;
  dataset: Dataset;
  plan: TripPlan;
  upgrades: UpgradeSet | null;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

export type TripEdit =
  | { op: "rename"; name: string }
  | { op: "remove_item"; version: VersionKey; date: string; ref: string }
  | { op: "add_item"; version: VersionKey; date: string; slot: Slot; ref: string }
  | { op: "move_item"; version: VersionKey; ref: string; toDate: string; toSlot: Slot; toIndex?: number }
  | { op: "set_flight"; version: VersionKey; ref: string }
  | { op: "set_hotel"; version: VersionKey; ref: string }
  | { op: "swap_days"; version: VersionKey; a: string; b: string }
  | { op: "reorder_day"; version: VersionKey; date: string; order: string[] };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An edit as the trip view issues it; the active version is added when sent. */
export type TripEditClient = DistributiveOmit<Exclude<TripEdit, { op: "rename" }>, "version">;

export function findRef(ds: Dataset, ref: string): { kind: "flight"; item: RefFlight } | { kind: "hotel"; item: RefHotel } | { kind: "place"; item: RefPlace } | null {
  if (ref.startsWith("F")) {
    const f = ds.flights?.options.find((o) => o.ref === ref);
    return f ? { kind: "flight", item: f } : null;
  }
  if (ref.startsWith("H")) {
    const h = ds.hotels?.options.find((o) => o.ref === ref);
    return h ? { kind: "hotel", item: h } : null;
  }
  const p = ds.places.find((o) => o.ref === ref);
  return p ? { kind: "place", item: p } : null;
}
