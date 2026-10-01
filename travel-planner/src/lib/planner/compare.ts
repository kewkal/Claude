import "server-only";
import type { AppSettings } from "@/lib/settings-shared";
import { isVerified } from "@/lib/places/types";
import { chooseFlight, chooseHotel, computeCosts } from "./budget";
import { buildDataset } from "./dataset";
import { VERSION_KEYS, type PlanInput, type VersionKey } from "./types";

export interface ComparisonRow {
  destination: string;
  startDate: string;
  endDate: string;
  ok: boolean;
  error?: string;
  /** Fixed costs (flight + lodging + food + transport + buffer) per version, before activities. */
  fixedCosts: Record<VersionKey, { total: number; remaining: number; flight: number | null; lodging: number | null }>;
  cheapestFlight: number | null;
  flightStops: number | null;
  medianHotelNightly: number | null;
  verifiedPlaces: number;
  events: number;
  avgHighF: number | null;
  rainyDays: number;
  weatherSource: string | null;
  warnings: string[];
}

/** Grounded side-by-side of destinations, no Claude calls. Generating the chosen one reuses the cache. */
export async function compareDestinations(input: PlanInput, settings: AppSettings): Promise<ComparisonRow[]> {
  const rows: ComparisonRow[] = [];
  for (const destination of input.destinations.map((d) => d.trim()).filter(Boolean)) {
    try {
      const ds = await buildDataset(input, destination, settings.valueOfTimeUsdPerHour);
      const fixedCosts = Object.fromEntries(
        VERSION_KEYS.map((k) => {
          const f = chooseFlight(ds, k, settings.valueOfTimeUsdPerHour);
          const h = chooseHotel(ds, k);
          const c = computeCosts({ key: k, flightRef: f?.ref ?? null, hotelRef: h?.ref ?? null, days: [] }, ds, input, settings);
          return [k, { total: c.total, remaining: c.remaining, flight: f?.priceTotal ?? null, lodging: c.lines.find((l) => l.key === "lodging")?.amount ?? null }];
        }),
      ) as ComparisonRow["fixedCosts"];
      const nightly = (ds.hotels?.options ?? []).map((h) => h.ratePerNight).filter((x): x is number => x !== null).sort((a, b) => a - b);
      const highs = ds.weather.map((w) => w.highF).filter((x): x is number => x !== null);
      const flights = (ds.flights?.options ?? []).filter((f) => f.priceTotal !== null);
      const cheapest = flights.sort((a, b) => a.priceTotal! - b.priceTotal!)[0];
      rows.push({
        destination,
        startDate: ds.startDate,
        endDate: ds.endDate,
        ok: true,
        fixedCosts,
        cheapestFlight: cheapest?.priceTotal ?? null,
        flightStops: cheapest?.stops ?? null,
        medianHotelNightly: nightly.length ? nightly[Math.floor(nightly.length / 2)] : null,
        verifiedPlaces: ds.places.filter((p) => p.category !== "events" && isVerified(p, settings.verifiedReviewThreshold)).length,
        events: ds.places.filter((p) => p.category === "events").length,
        avgHighF: highs.length ? Math.round(highs.reduce((s, x) => s + x, 0) / highs.length) : null,
        rainyDays: ds.weather.filter((w) => (w.precipChance ?? 0) >= 50).length,
        weatherSource: ds.weather[0]?.source ?? null,
        warnings: ds.errors,
      });
    } catch (e) {
      if ((e as { code?: string }).code?.startsWith("SERPAPI_QUOTA")) throw e;
      rows.push({
        destination,
        startDate: input.startDate,
        endDate: input.endDate,
        ok: false,
        error: (e as Error).message,
        fixedCosts: {} as ComparisonRow["fixedCosts"],
        cheapestFlight: null,
        flightStops: null,
        medianHotelNightly: null,
        verifiedPlaces: 0,
        events: 0,
        avgHighF: null,
        rainyDays: 0,
        weatherSource: null,
        warnings: [],
      });
    }
  }
  return rows;
}
