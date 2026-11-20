// Pure budget math (no I/O). Claude never computes money; this module does.
import { valueScore } from "@/lib/flights/sort";
import type { AppSettings } from "@/lib/settings-shared";
import { findRef, type CostBreakdown, type CostLine, type Dataset, type PlanDay, type PlanInput, type RefFlight, type RefHotel, type Slot, type VersionKey } from "./types";

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

/** Price-check result for a hotel: the cheapest booking site's whole-stay total, when it beats Google's headline. */
export function cheapestHotelOffer(h: RefHotel, ds: Dataset) {
  const offers = ds.priceCheck?.hotels.find((x) => x.ref === h.ref)?.offers ?? [];
  const best = offers.find((o) => o.totalUsd !== null);
  if (!best || (h.totalRate !== null && best.totalUsd! >= h.totalRate)) return null;
  return { offer: best, count: offers.length };
}

export function lodgingCost(h: RefHotel, ds: Dataset): { amount: number; basis: CostLine["basis"]; note: string; sourceUrl?: string } {
  const cheaper = cheapestHotelOffer(h, ds);
  if (cheaper) {
    return {
      amount: cheaper.offer.totalUsd! * ds.rooms,
      basis: ds.rooms > 1 ? "calculated" : "sourced",
      note: `${h.name}: cheapest of ${cheaper.count} booking sites is ${cheaper.offer.seller}, total for ${ds.nights} nights${ds.rooms > 1 ? ` × ${ds.rooms} rooms` : ""}${h.totalRate !== null ? ` (Google's headline was $${Math.round(h.totalRate)})` : ""}`,
      sourceUrl: cheaper.offer.link,
    };
  }
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

export function foodEstimate(
  key: VersionKey,
  input: Pick<PlanInput, "travelers">,
  days: number,
  settings: AppSettings,
  /** Planned restaurants with a real per-person USD price; each replaces that slot's default meal cost. */
  priced: { slot: Slot; usd: number }[] = [],
): { amount: number; note: string } {
  const [b, l, d] = MEAL_LEVELS[key];
  const m = settings.mealCostByPriceLevel;
  const perDay = m[b] + m[l] + m[d];
  const n = people(input);
  const slotDefault: Record<Slot, number> = { morning: m[b], afternoon: m[l], evening: m[d] };
  const swap = priced.slice(0, days * 3).reduce((s, p) => s + p.usd - slotDefault[p.slot], 0);
  const base = `Estimate from your Settings: breakfast ${"$".repeat(b)} $${m[b]} + lunch ${"$".repeat(l)} $${m[l]} + dinner ${"$".repeat(d)} $${m[d]} = $${perDay}/person/day × ${n} people × ${days} days`;
  return {
    amount: Math.max(0, Math.round((perDay * days + swap) * n)),
    note: priced.length ? `${base}. ${priced.length} planned meal${priced.length > 1 ? "s" : ""} use${priced.length > 1 ? "" : "s"} the restaurant's own listed price instead.` : base,
  };
}

/** Planned restaurants with a per-person USD price (middle of Google's range, or a converted/found price). */
export function pricedMeals(days: PlanDay[], ds: Dataset): { slot: Slot; usd: number }[] {
  const out: { slot: Slot; usd: number }[] = [];
  for (const d of days)
    for (const b of d.blocks)
      for (const it of b.items) {
        const r = findRef(ds, it.ref);
        if (!r || r.kind !== "place" || r.item.category !== "food") continue;
        const { minUsd, maxUsd } = r.item.price;
        const usd = minUsd !== null && maxUsd !== null ? (minUsd + maxUsd) / 2 : (maxUsd ?? minUsd ?? foundPrice(ds, it.ref));
        if (usd !== null && usd > 0) out.push({ slot: b.slot, usd });
      }
  return out;
}

/** Per-person USD price the price check found for an item no source priced in USD. */
export function foundPrice(ds: Dataset, ref: string): number | null {
  return ds.priceCheck?.activities.find((a) => a.ref === ref)?.usd ?? null;
}

/**
 * Activities with a listed USD price (sourced) × people, plus prices you entered for items no source priced.
 * Food-category items are covered by the food estimate.
 */
export function activitiesCost(
  days: PlanDay[],
  ds: Dataset,
  input: Pick<PlanInput, "travelers">,
): { amount: number; unpriced: string[]; note: string; userAmount: number; userCount: number } {
  const seen = new Set<string>();
  let amount = 0;
  let userAmount = 0;
  let userCount = 0;
  let found = 0;
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
        const usd = price.maxUsd ?? price.minUsd ?? foundPrice(ds, it.ref);
        const mine = ds.userPrices?.[it.ref];
        if (usd !== null) {
          amount += usd * n;
          if (price.maxUsd === null && price.minUsd === null) found += 1;
        } else if (mine !== undefined) {
          userAmount += mine * n;
          userCount += 1;
        } else unpriced.push(r.item.name);
      }
  return {
    amount,
    userAmount,
    userCount,
    unpriced,
    note: `Listed prices × ${n} people (upper end of ranges).${found ? ` ${found} price${found > 1 ? "s" : ""} from the price check (Tripadvisor, official sites, converted currencies).` : ""}${unpriced.length ? ` ${unpriced.length} item${unpriced.length > 1 ? "s" : ""} with no listed USD price counted as $0.` : ""}`,
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
    lines.push({ key: "lodging", label: "Lodging", ...c, sourceUrl: c.sourceUrl ?? h.item.link ?? ds.hotels?.googleHotelsUrl });
  } else {
    lines.push({ key: "lodging", label: "Lodging", amount: 0, basis: "calculated", note: "No hotel with a price was found — not included" });
  }
  const act = activitiesCost(v.days, ds, input);
  lines.push({ key: "activities", label: "Activities", amount: act.amount, basis: "sourced", note: act.note });
  if (act.userCount > 0) {
    lines.push({
      key: "activities_user",
      label: "Activities (your prices)",
      amount: act.userAmount,
      basis: "entered",
      note: `Prices you entered for ${act.userCount} item${act.userCount > 1 ? "s" : ""} no source priced, × ${people(input)} people`,
    });
  }
  const food = foodEstimate(v.key, input, ds.dates.length, settings, pricedMeals(v.days, ds));
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
