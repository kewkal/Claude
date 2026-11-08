import "server-only";
import { badInput } from "@/lib/errors";
import { addDays, daysBetween } from "@/lib/format";
import { countUncached, serpSearch } from "@/lib/serpapi/client";
import type { SerpParams } from "@/lib/serpapi/cache-key";
import { normalizeBookingOptions, normalizeFlights, payingTravelers } from "./normalize";
import type { BookingOption, Cabin, FlightSearchInput, FlightSearchResult } from "./types";

const CABIN: Record<Cabin, number> = { economy: 1, premium_economy: 2, business: 3, first: 4 };
const STOPS = { any: 0, nonstop: 1, max1: 2, max2: 3 } as const;

const AIRPORT_RE = /^([A-Z]{3})(,[A-Z]{3})*$/;
const KGMID_RE = /^\/[mg]\/[\w-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts IATA codes ("IAH", "CDG,ORY") as-is; resolves free text ("Paris") via Google Flights autocomplete (cached 30 days). */
export async function resolvePlace(input: string): Promise<{ id: string; label: string }> {
  const raw = input.trim();
  const upper = raw.toUpperCase().replace(/\s*,\s*/g, ",");
  if (AIRPORT_RE.test(upper)) return { id: upper, label: upper };
  if (KGMID_RE.test(raw)) return { id: raw, label: raw };
  if (raw.length < 2) throw badInput("Enter an airport code (e.g. CDG) or a city name.");
  const { data } = await serpSearch<{ suggestions?: Record<string, unknown>[] }>("google_flights_autocomplete", {
    q: raw,
    hl: "en",
    gl: "us",
  });
  const s = data.suggestions?.[0] as
    | { id?: string; name?: string; airports?: { id?: string; name?: string }[] }
    | undefined;
  if (!s) throw badInput(`Couldn't find an airport for "${raw}". Try the 3-letter code.`);
  if (s.id && KGMID_RE.test(s.id)) return { id: s.id, label: s.name ?? raw };
  const code = s.airports?.[0]?.id;
  if (code && AIRPORT_RE.test(code)) return { id: code, label: s.name ?? code };
  throw badInput(`Couldn't find an airport for "${raw}". Try the 3-letter code.`);
}

function validate(input: FlightSearchInput) {
  const t = input.travelers;
  if (!t || t.adults < 1) throw badInput("At least one adult is required.");
  if (t.adults + t.children + t.infantsInSeat + t.infantsOnLap > 9) throw badInput("Google Flights allows at most 9 travelers.");
  if (t.infantsOnLap > t.adults) throw badInput("Each lap infant needs an adult.");
  if (input.tripType === "multi_city") {
    if (!input.legs || input.legs.length < 2) throw badInput("Multi-city needs at least 2 legs.");
    for (const l of input.legs) if (!DATE_RE.test(l.date)) throw badInput("Each leg needs a date.");
  } else {
    if (!DATE_RE.test(input.departDate)) throw badInput("Departure date is required.");
    if (input.tripType === "round_trip") {
      if (!input.returnDate || !DATE_RE.test(input.returnDate)) throw badInput("Return date is required for round trips.");
      if (input.returnDate < input.departDate) throw badInput("Return date must be after departure.");
    }
  }
}

/** Build Google Flights params. Origin/destination must already be resolved ids. */
export function buildFlightParams(input: FlightSearchInput): SerpParams {
  const t = input.travelers;
  const p: SerpParams = {
    type: input.tripType === "round_trip" ? 1 : input.tripType === "one_way" ? 2 : 3,
    travel_class: CABIN[input.cabin] ?? 1,
    adults: t.adults,
    children: t.children || undefined,
    infants_in_seat: t.infantsInSeat || undefined,
    infants_on_lap: t.infantsOnLap || undefined,
    stops: input.stops ? STOPS[input.stops] || undefined : undefined,
    max_price: input.maxPrice || undefined,
    bags: input.bags || undefined,
    exclude_basic: input.excludeBasic ? "true" : undefined,
    currency: "USD",
    hl: "en",
    gl: "us",
  };
  const win = (w?: [number, number]) => (w && (w[0] > 0 || w[1] < 23) ? `${w[0]},${Math.min(23, w[1])}` : undefined);
  p.outbound_times = win(input.outboundTimes);
  if (input.tripType === "multi_city") {
    p.multi_city_json = JSON.stringify(input.legs!.map((l) => ({ departure_id: l.from.toUpperCase(), arrival_id: l.to.toUpperCase(), date: l.date })));
  } else {
    p.departure_id = input.origin;
    p.arrival_id = input.destination;
    p.outbound_date = input.departDate;
    if (input.tripType === "round_trip") {
      p.return_date = input.returnDate;
      p.return_times = win(input.returnTimes);
    }
  }
  return p;
}

async function resolveInput(input: FlightSearchInput): Promise<FlightSearchInput> {
  if (input.tripType === "multi_city") {
    const legs = await Promise.all(
      (input.legs ?? []).map(async (l) => ({ ...l, from: (await resolvePlace(l.from)).id, to: (await resolvePlace(l.to)).id })),
    );
    return { ...input, legs };
  }
  const [o, d] = await Promise.all([resolvePlace(input.origin), resolvePlace(input.destination)]);
  return { ...input, origin: o.id, destination: d.id };
}

async function run(params: SerpParams, paying: number): Promise<FlightSearchResult> {
  const res = await serpSearch("google_flights", params);
  const n = normalizeFlights(res.data, paying);
  return { ...n, fetchedAt: res.fetchedAt, cached: res.cached, travelersPaying: paying, empty: n.options.length === 0 };
}

export async function searchFlights(input: FlightSearchInput): Promise<FlightSearchResult> {
  validate(input);
  const resolved = await resolveInput(input);
  return run(buildFlightParams(resolved), payingTravelers(input.travelers));
}

/** Return flights (round trip) or the next leg (multi-city) for a chosen option. Costs 1 search. */
export async function nextLegFlights(input: FlightSearchInput, departureToken: string): Promise<FlightSearchResult> {
  validate(input);
  const resolved = await resolveInput(input);
  return run({ ...buildFlightParams(resolved), departure_token: departureToken }, payingTravelers(input.travelers));
}

/** Sellers + prices for a final itinerary. Costs 1 search. */
export async function bookingOptions(input: FlightSearchInput, bookingToken: string): Promise<{ options: BookingOption[]; fetchedAt: string; googleFlightsUrl: string | null }> {
  validate(input);
  const resolved = await resolveInput(input);
  const res = await serpSearch<Record<string, unknown>>("google_flights", { ...buildFlightParams(resolved), booking_token: bookingToken });
  const meta = res.data.search_metadata as { google_flights_url?: string } | undefined;
  return { options: normalizeBookingOptions(res.data), fetchedAt: res.fetchedAt, googleFlightsUrl: meta?.google_flights_url ?? null };
}

export interface FlexDay {
  departDate: string;
  returnDate?: string;
  cheapestTotal: number | null;
  priceLevel: string | null;
  error?: string;
}

function flexInputs(input: FlightSearchInput, spread: number): FlightSearchInput[] {
  if (input.tripType === "multi_city") throw badInput("Flexible dates aren't supported for multi-city.");
  const length = input.tripType === "round_trip" && input.returnDate ? daysBetween(input.departDate, input.returnDate) : 0;
  const today = new Date().toISOString().slice(0, 10);
  const out: FlightSearchInput[] = [];
  for (let d = -spread; d <= spread; d++) {
    const dep = addDays(input.departDate, d);
    if (dep < today) continue;
    out.push({ ...input, departDate: dep, returnDate: input.tripType === "round_trip" ? addDays(dep, length) : undefined });
  }
  return out;
}

/** How many paid searches a ±N flex check would use (cached dates are free). */
export async function flexCost(input: FlightSearchInput, spread = 3): Promise<{ total: number; uncached: number }> {
  validate(input);
  const resolved = await resolveInput(input);
  const reqs = flexInputs(resolved, spread).map((i) => ({ engine: "google_flights", params: buildFlightParams(i) }));
  return { total: reqs.length, uncached: await countUncached(reqs) };
}

/** Keeps trip length fixed and shifts departure ±spread days. One search per uncached date. */
export async function flexSearch(input: FlightSearchInput, spread = 3): Promise<FlexDay[]> {
  validate(input);
  const resolved = await resolveInput(input);
  const paying = payingTravelers(input.travelers);
  const days: FlexDay[] = [];
  // Sequential on purpose: stops cleanly if the quota gate trips mid-way.
  for (const i of flexInputs(resolved, spread)) {
    try {
      const r = await run(buildFlightParams(i), paying);
      const prices = r.options.map((o) => o.priceTotal).filter((p): p is number => p !== null);
      days.push({
        departDate: i.departDate,
        returnDate: i.returnDate,
        cheapestTotal: prices.length ? Math.min(...prices) : null,
        priceLevel: r.priceInsights?.priceLevel ?? null,
      });
    } catch (e) {
      days.push({ departDate: i.departDate, returnDate: i.returnDate, cheapestTotal: null, priceLevel: null, error: (e as Error).message });
      if ((e as { code?: string }).code?.startsWith("SERPAPI_QUOTA")) break;
    }
  }
  return days;
}
