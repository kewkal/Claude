// Pure budget math (no I/O). Claude never computes money; this module does.
import { valueScore } from "@/lib/flights/sort";
import type { AppSettings } from "@/lib/settings-shared";
import { findRef, type CostBreakdown, type CostLine, type Dataset, type PlanDay, type PlanInput, type RefFlight, type RefHotel, type VersionKey } from "./types";

export const BUFFER_PCT = 0.1;

/** Meal price levels per version: [breakfast, lunch, dinner] as Google price levels 1–4. */
export const MEAL_LEVELS: Record<VersionKey, [1 | 2 | 3 | 4, 1 | 2 | 3 | 4, 1 | 2 | 3 | 4]> = {
  lean: [1, 1, 1],
  balanced: [1, 1, 2],
  splurge: [1, 2, 3],
};

export function people(input: Pick<PlanInput, "travelers">): number {
  return input.travelers.adults + input.travelers.children;
}

export function chooseFlight(ds: Dataset, key: VersionKey, valueOfTime: number): RefFlight | null {
  const opts = (ds.flights?.options ?? []).filter((f) => f.priceTotal !== null);
  if (!opts.length) return null;
  if (key === "lean") return [...opts].sort((a, b) => a.priceTotal! - b.priceTotal! || a.totalDurationMin - b.totalDurationMin)[0];
  if (key === "balanced") return [...opts].sort((a, b) => valueScore(a, valueOfTime)! - valueScore(b, valueOfTime)!)[0];
  // Splurge: fewest stops, then fastest, avoiding self-transfers.
  const safe = opts.filter((f) => !f.flags.some((x) => x.kind === "self_transfer"));
  const pool = safe.length ? safe : opts;
  return [...pool].sort((a, b) => a.stops - b.stops || a.totalDurationMin - b.totalDurationMin)[0];
}

export function chooseHotel(ds: Dataset, key: VersionKey): RefHotel | null {
  const opts = (ds.hotels?.options ?? []).filter((h) => h.ratePerNight !== null);
  if (!opts.length) return null;
  const byPrice = [...opts].sort((a, b) => a.ratePerNight! - b.ratePerNight!);
  const byRating = (list: RefHotel[]) => [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.ratePerNight! - b.ratePerNight!);
  if (key === "lean") return byPrice.find((h) => (h.rating ?? 0) >= 4) ?? byPrice[0];
  if (key === "balanced") return byRating(opts.filter((h) => h.tier === "Mid"))[0] ?? byRating(opts)[0];
  return byRating(opts.filter((h) => h.tier === "Luxury"))[0] ?? byRating(opts)[0];
}

export function lodgingCost(h: RefHotel, ds: Dataset): { amount: number; basis: CostLine["basis"]; note: string } {
  if (h.totalRate !== null) {
    return {
      amount: h.totalRate * ds.rooms,
      basis: ds.rooms > 1 ? "calculated" : "sourced",
      note: `${h.name}: Google Hotels total for ${ds.nights} nights${ds.rooms > 1 ? ` × ${ds.rooms} rooms` : ""} (incl. taxes & fees)`,
    };
  }
  return {
    amount: (h.ratePerNight ?? 0) * ds.nights * ds.rooms,
    basis: "calculated",
    note: `${h.name}: nightly rate × ${ds.nights} nights${ds.rooms > 1 ? ` × ${ds.rooms} rooms` : ""}`,
  };
}

export function foodEstimate(key: VersionKey, input: Pick<PlanInput, "travelers">, days: number, settings: AppSettings): { amount: number; note: string } {
  const [b, l, d] = MEAL_LEVELS[key];
  const m = settings.mealCostByPriceLevel;
  const perDay = m[b] + m[l] + m[d];
  const n = people(input);
  return {
    amount: perDay * n * days,
    note: `Estimate from your Settings: breakfast ${"$".repeat(b)} $${m[b]} + lunch ${"$".repeat(l)} $${m[l]} + dinner ${"$".repeat(d)} $${m[d]} = $${perDay}/person/day × ${n} people × ${days} days`,
  };
}

/** Activities with a listed USD price (sourced), × people. Food-category items are covered by the food estimate. */
export function activitiesCost(days: PlanDay[], ds: Dataset, input: Pick<PlanInput, "travelers">): { amount: number; unpriced: string[]; note: string } {
  const seen = new Set<string>();
  let amount = 0;
  const unpriced: string[] = [];
  const n = people(input);
  for (const d of days)
    for (const b of d.blocks)
      for (const it of b.items) {
        if (seen.has(it.ref)) continue;
        seen.add(it.ref);
        const r = findRef(ds, it.ref);
        if (!r || r.kind !== "place" || r.item.category === "food") continue;
        const price = r.item.price;
        const usd = price.maxUsd ?? price.minUsd;
        if (usd === null) unpriced.push(r.item.name);
        else amount += usd * n;
      }
  return {
    amount,
    unpriced,
    note: `Listed prices × ${n} people (upper end of ranges).${unpriced.length ? ` ${unpriced.length} item${unpriced.length > 1 ? "s" : ""} with no listed USD price counted as $0.` : ""}`,
  };
}

export function computeCosts(
  v: { key: VersionKey; flightRef: string | null; hotelRef: string | null; days: PlanDay[] },
  ds: Dataset,
  input: Pick<PlanInput, "travelers" | "budgetUsd">,
  settings: AppSettings,
): CostBreakdown {
  const lines: CostLine[] = [];
  const f = v.flightRef ? findRef(ds, v.flightRef) : null;
  if (f?.kind === "flight" && f.item.priceTotal !== null) {
    lines.push({
      key: "flights",
      label: "Flights",
      amount: f.item.priceTotal,
      basis: "sourced",
      note: `${f.item.airlines.join(" + ")}, round trip for all travelers (Google Flights)`,
      sourceUrl: ds.flights?.googleFlightsUrl,
    });
  } else {
    lines.push({ key: "flights", label: "Flights", amount: 0, basis: "calculated", note: "No flight with a price was found — not included" });
  }
  const h = v.hotelRef ? findRef(ds, v.hotelRef) : null;
  if (h?.kind === "hotel") {
    const c = lodgingCost(h.item, ds);
    lines.push({ key: "lodging", label: "Lodging", ...c, sourceUrl: h.item.link ?? ds.hotels?.googleHotelsUrl });
  } else {
    lines.push({ key: "lodging", label: "Lodging", amount: 0, basis: "calculated", note: "No hotel with a price was found — not included" });
  }
  const act = activitiesCost(v.days, ds, input);
  lines.push({ key: "activities", label: "Activities", amount: act.amount, basis: "sourced", note: act.note });
  const food = foodEstimate(v.key, input, ds.dates.length, settings);
  lines.push({ key: "food", label: "Food", amount: food.amount, basis: "estimate", note: food.note });
  lines.push({
    key: "transport",
    label: "Local transport",
    amount: settings.localTransportUsdPerDay * ds.dates.length,
    basis: "estimate",
    note: `Estimate: $${settings.localTransportUsdPerDay}/day (Settings) × ${ds.dates.length} days`,
  });
  const buffer = Math.round(input.budgetUsd * BUFFER_PCT);
  lines.push({ key: "buffer", label: "Buffer (10%)", amount: buffer, basis: "calculated", note: "10% of your total budget held back for surprises" });

  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0));
  return { lines, total, budget: input.budgetUsd, remaining: input.budgetUsd - total, overBudget: total > input.budgetUsd, unpricedItems: act.unpriced };
}

/** What's left for activities after fixed costs — given to Claude as a guide. */
export function activityAllowance(costsWithoutActivities: CostBreakdown): number {
  return Math.max(0, costsWithoutActivities.remaining);
}
