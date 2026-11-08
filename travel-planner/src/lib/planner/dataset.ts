import "server-only";
import { AppError, badInput } from "@/lib/errors";
import { buildFlightParams, flexSearch, resolvePlace, searchFlights } from "@/lib/flights/service";
import { valueScore } from "@/lib/flights/sort";
import type { FlightSearchInput } from "@/lib/flights/types";
import { addDays, daysBetween } from "@/lib/format";
import { centroid } from "@/lib/geo";
import { buildHotelParams, searchHotels } from "@/lib/hotels/service";
import type { HotelOption, HotelSearchInput } from "@/lib/hotels/types";
import { explore, exploreRequests } from "@/lib/places/service";
import type { PlaceCategory, PlaceItem } from "@/lib/places/types";
import { normalizeParams, type SerpParams } from "@/lib/serpapi/cache-key";
import { countUncached } from "@/lib/serpapi/client";
import { weatherFor } from "@/lib/weather";
import type { Dataset, PlanInput, RefHotel, RefPlace, TripStyle } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PER_CATEGORY = 10;
const MAX_FLIGHTS = 8;
const MAX_HOTELS = 12;

const STYLE_CATEGORIES: Record<TripStyle, PlaceCategory[]> = {
  cinematic: ["photo"],
  cultural: ["culture"],
  adventure: ["outdoors", "tours"],
  luxury: ["tours"],
  relaxation: ["outdoors"],
  foodie: ["food"],
  nightlife: ["nightlife"],
  romantic: ["photo", "food"],
};

/** Google Maps categories to fetch for these styles (sights + food always; max 5 to bound cost) + events. */
export function categoriesFor(styles: TripStyle[]): PlaceCategory[] {
  const out: PlaceCategory[] = ["sights", "food"];
  for (const s of styles) for (const c of STYLE_CATEGORIES[s] ?? []) if (!out.includes(c) && out.length < 5) out.push(c);
  return [...out, "events"];
}

export function validatePlanInput(input: PlanInput): void {
  if (!input.origin?.trim()) throw badInput("Origin is required.");
  const dests = (input.destinations ?? []).map((d) => d.trim()).filter(Boolean);
  if (!dests.length) throw badInput("Add at least one destination.");
  if (dests.length > 3) throw badInput("Compare at most 3 destinations at a time.");
  if (!(input.budgetUsd > 0)) throw badInput("Enter a total budget.");
  if (!input.travelers || input.travelers.adults < 1) throw badInput("At least one adult is required.");
  if (input.travelers.children > 0 && (input.childAges?.length ?? 0) < input.travelers.children) throw badInput("Enter an age for each child.");
  if (input.dateMode === "fixed") {
    if (!DATE_RE.test(input.startDate) || !DATE_RE.test(input.endDate)) throw badInput("Pick travel dates.");
    if (input.endDate <= input.startDate) throw badInput("Return must be after departure.");
    if (daysBetween(input.startDate, input.endDate) > 21) throw badInput("Trips are limited to 3 weeks.");
  } else {
    if (!input.windowStart || !input.windowEnd || !DATE_RE.test(input.windowStart) || !DATE_RE.test(input.windowEnd)) throw badInput("Pick a date window.");
    if (!input.days || input.days < 2 || input.days > 21) throw badInput("Trip length must be 2–21 days.");
    if (daysBetween(input.windowStart, input.windowEnd) + 1 < input.days) throw badInput("The window is shorter than the trip.");
  }
}

function flightInput(input: PlanInput, destination: string, start: string, end: string): FlightSearchInput {
  return {
    tripType: "round_trip",
    origin: input.origin,
    destination,
    departDate: start,
    returnDate: end,
    travelers: input.travelers,
    cabin: input.cabin,
  };
}

function hotelInput(input: PlanInput, destination: string, start: string, end: string): HotelSearchInput {
  return {
    destination,
    checkIn: start,
    checkOut: end,
    adults: input.travelers.adults,
    children: input.travelers.children,
    childAges: input.childAges,
    rooms: input.rooms || 1,
  };
}

/** Departure dates tried in flexible mode: up to 7, spread evenly across the window. */
export function flexCandidates(input: PlanInput): string[] {
  const lastStart = addDays(input.windowEnd!, -(input.days! - 1));
  const span = daysBetween(input.windowStart!, lastStart);
  const n = Math.min(7, span + 1);
  const today = new Date().toISOString().slice(0, 10);
  const out = new Set<string>();
  for (let i = 0; i < n; i++) out.add(addDays(input.windowStart!, n === 1 ? 0 : Math.round((span * i) / (n - 1))));
  return [...out].filter((d) => d >= today);
}

/** Paid searches a plan would use right now (cache hits are free). Approximate when airports still need resolving. */
export async function estimateSearches(input: PlanInput): Promise<{ perDestination: { destination: string; total: number; uncached: number }[]; flexDates: number }> {
  validatePlanInput(input);
  const cats = categoriesFor(input.styles);
  const flexDates = input.dateMode === "flexible" ? flexCandidates(input).length : 0;
  const start = input.dateMode === "fixed" ? input.startDate : input.windowStart!;
  const end = input.dateMode === "fixed" ? input.endDate : addDays(input.windowStart!, input.days! - 1);
  const per = [];
  for (const raw of input.destinations.map((d) => d.trim()).filter(Boolean)) {
    const reqs: { engine: string; params: SerpParams }[] = [];
    let extra = 0;
    const isCode = /^[A-Za-z]{3}$/.test(raw);
    if (!isCode) reqs.push({ engine: "google_flights_autocomplete", params: { q: raw, hl: "en", gl: "us" } });
    let dest = raw.toUpperCase();
    if (!isCode) {
      try {
        // Only free when the autocomplete is already cached; otherwise count the flight search as one more.
        const uncached = await countUncached(reqs);
        dest = uncached ? "" : (await resolvePlace(raw)).id;
      } catch {
        dest = "";
      }
    }
    if (dest) reqs.push({ engine: "google_flights", params: buildFlightParams({ ...flightInput(input, dest, start, end), origin: input.origin.toUpperCase() }) });
    else extra += 1;
    reqs.push({ engine: "google_hotels", params: buildHotelParams(hotelInput(input, raw, start, end)) });
    for (const c of cats) reqs.push(...exploreRequests(raw, c));
    extra += 1; // events (query includes month label; treat as uncached)
    // Several categories share one Tripadvisor search; count each distinct request once.
    const unique = [...new Map(reqs.map((r) => [`${r.engine}:${JSON.stringify(normalizeParams(r.params))}`, r])).values()];
    const uncached = (await countUncached(unique)) + extra;
    per.push({ destination: raw, total: unique.length + extra, uncached });
  }
  return { perDestination: per, flexDates };
}

/** Flexible mode: cheapest departure date across the window (one flight search per uncached date). */
export async function pickFlexibleDates(input: PlanInput, destination: string): Promise<{ startDate: string; endDate: string }> {
  const candidates = flexCandidates(input);
  if (!candidates.length) throw badInput("The date window is in the past.");
  const best: { start: string; price: number }[] = [];
  for (const start of candidates) {
    const end = addDays(start, input.days! - 1);
    const days = await flexSearch(flightInput(input, destination, start, end), 0);
    const d = days[0];
    if (d?.cheapestTotal != null) best.push({ start, price: d.cheapestTotal });
    if (d?.error && /quota/i.test(d.error)) throw new AppError("SERPAPI_QUOTA", d.error);
  }
  best.sort((a, b) => a.price - b.price);
  const start = best[0]?.start ?? candidates[0];
  return { startDate: start, endDate: addDays(start, input.days! - 1) };
}

function pickHotels(all: HotelOption[]): HotelOption[] {
  const priced = all.filter((h) => h.ratePerNight !== null);
  const byPrice = [...priced].sort((a, b) => a.ratePerNight! - b.ratePerNight!);
  const byRating = [...all].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.reviews ?? 0) - (a.reviews ?? 0));
  const picked: HotelOption[] = [];
  const add = (h: HotelOption) => {
    if (picked.length < MAX_HOTELS && !picked.some((p) => p.id === h.id)) picked.push(h);
  };
  for (const tier of ["Budget", "Mid", "Luxury"] as const) byRating.filter((h) => h.tier === tier).slice(0, 3).forEach(add);
  byPrice.slice(0, 3).forEach(add);
  byRating.forEach(add);
  return picked;
}

const rethrowQuota = (e: unknown) => {
  if ((e as { code?: string }).code?.startsWith("SERPAPI_QUOTA")) throw e;
};

/** Fetch everything a plan needs for one destination. Each source fails independently (errors recorded). */
export async function buildDataset(input: PlanInput, destination: string, valueOfTime: number, dates?: { startDate: string; endDate: string }): Promise<Dataset> {
  validatePlanInput(input);
  const { startDate, endDate } = dates ?? (input.dateMode === "fixed" ? { startDate: input.startDate, endDate: input.endDate } : await pickFlexibleDates(input, destination));
  const errors: string[] = [];
  const cats = categoriesFor(input.styles);

  const [flightRes, hotelRes, ...placeRes] = await Promise.all([
    searchFlights(flightInput(input, destination, startDate, endDate)).catch((e) => {
      rethrowQuota(e);
      errors.push(`Flights: ${(e as Error).message}`);
      return null;
    }),
    searchHotels(hotelInput(input, destination, startDate, endDate)).catch((e) => {
      rethrowQuota(e);
      errors.push(`Hotels: ${(e as Error).message}`);
      return null;
    }),
    ...cats.map((c) =>
      explore(destination, c, { startDate, endDate }).catch((e) => {
        rethrowQuota(e);
        errors.push(`${c}: ${(e as Error).message}`);
        return null;
      }),
    ),
  ]);

  const flightsSorted = flightRes ? [...flightRes.options].sort((a, b) => (valueScore(a, valueOfTime) ?? Infinity) - (valueScore(b, valueOfTime) ?? Infinity)) : [];
  // Keep the cheapest and fastest even if they rank low on value.
  const cheapest = flightRes ? [...flightRes.options].sort((a, b) => (a.priceTotal ?? Infinity) - (b.priceTotal ?? Infinity))[0] : undefined;
  const fastest = flightRes ? [...flightRes.options].sort((a, b) => a.totalDurationMin - b.totalDurationMin)[0] : undefined;
  const flightPick = [...new Map([...flightsSorted.slice(0, MAX_FLIGHTS - 2), cheapest, fastest].filter(Boolean).map((f) => [f!.id, f!])).values()];

  const hotels: RefHotel[] = hotelRes ? pickHotels(hotelRes.hotels).map((h, i) => ({ ...h, ref: `H${i + 1}` })) : [];

  const seen = new Set<string>();
  const places: RefPlace[] = [];
  let p = 0;
  let e = 0;
  for (const r of placeRes) {
    if (!r) continue;
    const items: PlaceItem[] = [...r.items]
      .sort((a, b) => Math.max(0, ...b.sources.map((s) => s.reviews ?? 0)) - Math.max(0, ...a.sources.map((s) => s.reviews ?? 0)))
      .slice(0, MAX_PER_CATEGORY);
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      places.push({ ...it, ref: it.category === "events" ? `E${++e}` : `P${++p}` });
    }
  }

  const center = centroid(hotels.filter((h) => h.gps).map((h) => h.gps!)) ?? centroid(places.filter((x) => x.gps).map((x) => x.gps!));
  let weather: Dataset["weather"] = [];
  if (center) {
    try {
      weather = await weatherFor(center, startDate, endDate);
    } catch (err) {
      errors.push(`Weather: ${(err as Error).message}`);
    }
  } else errors.push("Weather: no coordinates for this destination.");

  const n = daysBetween(startDate, endDate) + 1;
  return {
    destination,
    origin: input.origin.toUpperCase(),
    startDate,
    endDate,
    dates: Array.from({ length: n }, (_, i) => addDays(startDate, i)),
    nights: n - 1,
    travelers: input.travelers,
    rooms: input.rooms || 1,
    flights: flightRes
      ? {
          options: flightPick.map((f, i) => ({ ...f, ref: `F${i + 1}` })),
          priceInsights: flightRes.priceInsights,
          googleFlightsUrl: flightRes.googleFlightsUrl,
          fetchedAt: flightRes.fetchedAt,
          searchInput: flightInput(input, destination, startDate, endDate),
          payingTravelers: flightRes.travelersPaying,
        }
      : null,
    hotels: hotelRes ? { options: hotels, googleHotelsUrl: hotelRes.googleHotelsUrl, fetchedAt: hotelRes.fetchedAt } : null,
    places,
    categories: cats,
    weather,
    center,
    errors,
    fetchedAt: new Date().toISOString(),
  };
}
