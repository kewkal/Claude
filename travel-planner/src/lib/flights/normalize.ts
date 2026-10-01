import { isBudgetCarrier } from "./carriers";
import type { BookingOption, FlightFlag, FlightOption, FlightSegment, Layover, PriceInsights, Travelers } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function payingTravelers(t: Travelers): number {
  return Math.max(1, t.adults + t.children + t.infantsInSeat);
}

function hourOf(time: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*$/.exec(time);
  return m ? Number(m[1]) : null;
}
function dateOf(time: string): string {
  return time.slice(0, 10);
}

export function computeFlags(segments: FlightSegment[], layovers: Layover[], rawText: string): FlightFlag[] {
  const flags: FlightFlag[] = [];

  const redEye = segments.find((s) => {
    if (s.overnight) return true;
    const h = hourOf(s.from.time);
    const crossesMidnight = dateOf(s.to.time) > dateOf(s.from.time);
    return h !== null && (h >= 21 || h < 4) && crossesMidnight;
  });
  if (redEye) {
    flags.push({ kind: "red_eye", label: "Red-eye", detail: `${redEye.from.code}→${redEye.to.code} flies overnight`, severity: "warn" });
  }

  for (const l of layovers) {
    if (l.durationMin < 60) {
      flags.push({ kind: "short_layover", label: "Tight connection", detail: `${l.durationMin} min in ${l.code}`, severity: "danger" });
    } else if (l.durationMin > 240) {
      flags.push({ kind: "long_layover", label: "Long layover", detail: `${Math.round((l.durationMin / 60) * 10) / 10} hrs in ${l.code}`, severity: "warn" });
    }
    if (l.overnight) {
      flags.push({ kind: "overnight_layover", label: "Overnight layover", detail: `Overnight in ${l.code}`, severity: "warn" });
    }
  }

  if (/self[\s-]?transfer|separate tickets/i.test(rawText)) {
    flags.push({
      kind: "self_transfer",
      label: "Self-transfer",
      detail: "Separate tickets: you re-check bags and the airline won't rebook a missed connection",
      severity: "danger",
    });
  }
  if (/basic economy/i.test(rawText)) {
    flags.push({ kind: "basic_economy", label: "Basic economy", detail: "Usually no seat choice, no changes, boards last", severity: "warn" });
  }
  if (/carry-?on bag not included|no carry-?on|carry-?on not included|personal item only/i.test(rawText)) {
    flags.push({ kind: "no_carry_on", label: "No carry-on", detail: "Full-size carry-on bag not included in this fare", severity: "warn" });
  }
  const delayed = segments.filter((s) => s.oftenDelayed);
  if (delayed.length) {
    flags.push({
      kind: "often_delayed",
      label: "Often delayed",
      detail: `${delayed.map((s) => s.flightNumber ?? s.airline).join(", ")} often delayed 30+ min`,
      severity: "info",
    });
  }
  return flags;
}

function normalizeSegment(f: Raw): FlightSegment {
  return {
    from: { code: str(f.departure_airport?.id), name: str(f.departure_airport?.name), time: str(f.departure_airport?.time) },
    to: { code: str(f.arrival_airport?.id), name: str(f.arrival_airport?.name), time: str(f.arrival_airport?.time) },
    durationMin: num(f.duration) ?? 0,
    airline: str(f.airline) || "Unknown airline",
    airlineLogo: str(f.airline_logo) || undefined,
    flightNumber: str(f.flight_number) || undefined,
    airplane: str(f.airplane) || undefined,
    travelClass: str(f.travel_class) || undefined,
    legroom: str(f.legroom) || undefined,
    extensions: Array.isArray(f.extensions) ? f.extensions.map(String) : [],
    overnight: f.overnight === true,
    oftenDelayed: f.often_delayed_by_over_30_min === true,
  };
}

export function normalizeOption(o: Raw, paying: number, best: boolean): FlightOption {
  const segments = (Array.isArray(o.flights) ? o.flights : []).map(normalizeSegment);
  const layovers: Layover[] = (Array.isArray(o.layovers) ? o.layovers : []).map((l: Raw) => ({
    code: str(l.id),
    name: str(l.name),
    durationMin: num(l.duration) ?? 0,
    overnight: l.overnight === true,
  }));
  const priceTotal = num(o.price);
  const airlines = [...new Set(segments.map((s) => s.airline))];
  const carbon = o.carbon_emissions && num(o.carbon_emissions.this_flight) !== null
    ? {
        thisFlightKg: Math.round((o.carbon_emissions.this_flight as number) / 1000),
        typicalKg: num(o.carbon_emissions.typical_for_this_route) !== null ? Math.round(o.carbon_emissions.typical_for_this_route / 1000) : null,
        differencePct: num(o.carbon_emissions.difference_percent),
      }
    : undefined;
  const totalDurationMin = num(o.total_duration) ?? segments.reduce((s, x) => s + x.durationMin, 0) + layovers.reduce((s, x) => s + x.durationMin, 0);
  const id = [segments.map((s) => `${s.flightNumber ?? s.airline}@${s.from.time}`).join("|"), priceTotal ?? "na"].join("#");

  return {
    id,
    segments,
    layovers,
    totalDurationMin,
    stops: Math.max(0, segments.length - 1),
    priceTotal,
    pricePerPerson: priceTotal !== null ? Math.round((priceTotal / paying) * 100) / 100 : null,
    carbon,
    airlines,
    isBudgetCarrier: airlines.length > 0 && airlines.every(isBudgetCarrier),
    flags: computeFlags(segments, layovers, JSON.stringify(o)),
    departureToken: str(o.departure_token) || undefined,
    bookingToken: str(o.booking_token) || undefined,
    typeLabel: str(o.type) || undefined,
    extensions: Array.isArray(o.extensions) ? o.extensions.map(String) : [],
    best,
  };
}

export function normalizeFlights(data: Raw, paying: number): { options: FlightOption[]; priceInsights: PriceInsights | null; googleFlightsUrl: string | null } {
  const best = (Array.isArray(data.best_flights) ? data.best_flights : []).map((o: Raw) => normalizeOption(o, paying, true));
  const other = (Array.isArray(data.other_flights) ? data.other_flights : []).map((o: Raw) => normalizeOption(o, paying, false));
  const seen = new Set<string>();
  const options = [...best, ...other].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));

  const pi = data.price_insights;
  const level = str(pi?.price_level).toLowerCase();
  const priceInsights: PriceInsights | null = pi
    ? {
        lowestPrice: num(pi.lowest_price),
        priceLevel: level === "low" || level === "typical" || level === "high" ? level : null,
        typicalRange:
          Array.isArray(pi.typical_price_range) && pi.typical_price_range.length === 2
            ? [Number(pi.typical_price_range[0]), Number(pi.typical_price_range[1])]
            : null,
      }
    : null;

  return { options, priceInsights, googleFlightsUrl: str(data.search_metadata?.google_flights_url) || null };
}

export function normalizeBookingOptions(data: Raw): BookingOption[] {
  const list = Array.isArray(data.booking_options) ? data.booking_options : [];
  return list.flatMap((b: Raw) => {
    // Google groups "book together" vs. separate tickets per leg.
    const parts: Raw[] = b.together ? [b.together] : [b.departing, b.returning].filter(Boolean);
    return parts.map((p) => ({
      seller: str(p.book_with) || "Unknown seller",
      price: num(p.price),
      optionTitle: str(p.option_title) || undefined,
      extensions: Array.isArray(p.extensions) ? p.extensions.map(String) : [],
      bookingRequest: p.booking_request?.url ? { url: str(p.booking_request.url), postData: str(p.booking_request.post_data) || undefined } : undefined,
      baggage: Array.isArray(p.baggage_prices) ? p.baggage_prices.map(String) : undefined,
    }));
  });
}
