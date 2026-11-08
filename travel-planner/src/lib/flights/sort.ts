import type { FlightOption } from "./types";

export type FlightSort = "cheapest" | "fastest" | "value";

export const VALUE_FORMULA =
  "Best value score = price per person + (your value of time × total trip hours). Lower is better. Value of time is set in Settings.";

export function valueScore(o: FlightOption, valueOfTimePerHour: number): number | null {
  if (o.pricePerPerson === null) return null;
  return o.pricePerPerson + valueOfTimePerHour * (o.totalDurationMin / 60);
}

export function sortFlights(options: FlightOption[], sort: FlightSort, valueOfTimePerHour: number): FlightOption[] {
  const inf = Number.POSITIVE_INFINITY;
  const key = (o: FlightOption): number => {
    if (sort === "cheapest") return o.priceTotal ?? inf;
    if (sort === "fastest") return o.totalDurationMin;
    return valueScore(o, valueOfTimePerHour) ?? inf;
  };
  // Stable tie-break on duration then price so ordering is deterministic.
  return [...options].sort((a, b) => key(a) - key(b) || a.totalDurationMin - b.totalDurationMin || (a.priceTotal ?? inf) - (b.priceTotal ?? inf));
}

export interface FlightFilters {
  stops: { nonstop: boolean; one: boolean; twoPlus: boolean };
  carrier: "any" | "budget" | "full_service";
  maxPriceTotal: number | null;
  departWindow: [number, number]; // hours, first segment departure
  arriveWindow: [number, number]; // hours, last segment arrival
  maxLayoverMin: number | null;
}

export const DEFAULT_FLIGHT_FILTERS: FlightFilters = {
  stops: { nonstop: true, one: true, twoPlus: true },
  carrier: "any",
  maxPriceTotal: null,
  departWindow: [0, 24],
  arriveWindow: [0, 24],
  maxLayoverMin: null,
};

function hourDecimal(time: string): number | null {
  const m = /(\d{1,2}):(\d{2})\s*$/.exec(time);
  return m ? Number(m[1]) + Number(m[2]) / 60 : null;
}

export function filterFlights(options: FlightOption[], f: FlightFilters): FlightOption[] {
  return options.filter((o) => {
    if (o.stops === 0 && !f.stops.nonstop) return false;
    if (o.stops === 1 && !f.stops.one) return false;
    if (o.stops >= 2 && !f.stops.twoPlus) return false;
    if (f.carrier === "budget" && !o.hasBudgetCarrier) return false;
    if (f.carrier === "full_service" && o.hasBudgetCarrier) return false;
    if (f.maxPriceTotal !== null && (o.priceTotal === null || o.priceTotal > f.maxPriceTotal)) return false;
    const dep = hourDecimal(o.segments[0]?.from.time ?? "");
    if (dep !== null && (dep < f.departWindow[0] || dep > f.departWindow[1])) return false;
    const arr = hourDecimal(o.segments[o.segments.length - 1]?.to.time ?? "");
    if (arr !== null && (arr < f.arriveWindow[0] || arr > f.arriveWindow[1])) return false;
    if (f.maxLayoverMin !== null && o.layovers.some((l) => l.durationMin > f.maxLayoverMin!)) return false;
    return true;
  });
}

/** Explains why a filtered list is empty and suggests the nearest relaxation. */
export function emptyHint(all: FlightOption[], f: FlightFilters): string | null {
  if (!all.length) return null;
  if (!f.stops.one && f.stops.nonstop && !all.some((o) => o.stops === 0) && all.some((o) => o.stops === 1)) {
    return "No nonstops found — show 1-stop?";
  }
  if (f.maxPriceTotal !== null && all.every((o) => (o.priceTotal ?? Infinity) > f.maxPriceTotal!)) {
    const min = Math.min(...all.map((o) => o.priceTotal ?? Infinity));
    return `Nothing under your max price. Cheapest is $${Math.round(min)}.`;
  }
  return "No flights match these filters. Try loosening one.";
}
