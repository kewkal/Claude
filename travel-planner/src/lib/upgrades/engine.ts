// Deterministic "make it better" suggestions computed from the trip's fetched data. Pure; no I/O.
import { estimateTravel, type LatLng } from "@/lib/geo";
import { fmtDate, fmtDuration, fmtTime, fmtUsd } from "@/lib/format";
import type { AppSettings } from "@/lib/settings-shared";
import { lodgingCost, people } from "@/lib/planner/budget";
import { findRef, type Dataset, type PlanDay, type PlanInput, type PlanVersion, type RefFlight, type RefHotel, type RefPlace, type Upgrade } from "@/lib/planner/types";
import { refsInDays } from "@/lib/planner/validate";

export const RANK_FORMULA = "Rank = benefit score (1–5) ÷ (1 + extra cost ÷ $100). Savings count as $0 extra cost. Benefit scores come from hours saved, travel minutes saved, weather risk, or experience value as described on each item.";

export function rankScore(u: Pick<Upgrade, "impact" | "costDeltaUsd">): number {
  return u.impact / (1 + Math.max(0, u.costDeltaUsd ?? 0) / 100);
}

const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n * 10) / 10));
const OUTDOOR_TYPES = /park|beach|garden|hik|trail|viewpoint|scenic|outdoor|surf|zoo|lookout|miradouro|pier/i;

function isOutdoor(p: RefPlace): boolean {
  return p.category === "outdoors" || p.category === "photo" || p.types.some((t) => OUTDOOR_TYPES.test(t));
}

function placeOf(ds: Dataset, ref: string): RefPlace | null {
  const r = findRef(ds, ref);
  return r?.kind === "place" ? r.item : null;
}

function dayPlaces(ds: Dataset, d: PlanDay): RefPlace[] {
  return d.blocks.flatMap((b) => b.items.map((i) => placeOf(ds, i.ref)).filter((p): p is RefPlace => !!p));
}

/** Total estimated travel minutes for a sequence starting at the hotel. */
export function routeMinutes(start: LatLng | undefined, stops: (LatLng | undefined)[]): number {
  let prev = start;
  let total = 0;
  for (const s of stops) {
    if (prev && s) total += estimateTravel(prev, s).minutes;
    prev = s ?? prev;
  }
  return total;
}

/** Nearest-neighbor order from the hotel. Good enough for 2–6 stops a day. */
export function nearestNeighbor<T extends { gps?: LatLng }>(start: LatLng | undefined, stops: T[]): T[] {
  const rest = [...stops];
  const out: T[] = [];
  let cur = start;
  while (rest.length) {
    let bi = 0;
    if (cur) {
      let best = Infinity;
      rest.forEach((s, i) => {
        const m = s.gps ? estimateTravel(cur!, s.gps).minutes : Infinity;
        if (m < best) {
          best = m;
          bi = i;
        }
      });
    }
    const [next] = rest.splice(bi, 1);
    out.push(next);
    cur = next.gps ?? cur;
  }
  return out;
}

function flightUpgrades(ds: Dataset, v: PlanVersion, cur: RefFlight): Upgrade[] {
  const out: Upgrade[] = [];
  const opts = (ds.flights?.options ?? []).filter((f) => f.ref !== cur.ref && f.priceTotal !== null && cur.priceTotal !== null);

  // Comfort: fewer stops / faster, priced per hour saved.
  const faster = opts
    .map((f) => ({ f, hours: (cur.totalDurationMin - f.totalDurationMin) / 60, delta: f.priceTotal! - cur.priceTotal! }))
    .filter((x) => x.hours >= 1 && !x.f.flags.some((fl) => fl.kind === "self_transfer"))
    .sort((a, b) => Math.max(0, a.delta) / a.hours - Math.max(0, b.delta) / b.hours);
  const best = faster[0];
  if (best) {
    const perHour = best.delta > 0 ? best.delta / best.hours : 0;
    const fewerStops = best.f.stops < cur.stops;
    out.push({
      id: `flight-faster-${best.f.ref}`,
      group: "comfort",
      title: `${fewerStops ? (best.f.stops === 0 ? "Fly nonstop" : `Cut to ${best.f.stops} stop`) : "Take a faster flight"}: ${best.f.airlines.join(" + ")}`,
      why: `Saves ${fmtDuration(Math.round(best.hours * 60))} of travel (${fmtDuration(cur.totalDurationMin)} → ${fmtDuration(best.f.totalDurationMin)}), ${best.delta > 0 ? `${fmtUsd(perHour)} per hour saved` : "and costs less"}. Prices from Google Flights.`,
      metric: best.delta > 0 ? `${fmtUsd(perHour)}/hour saved` : "saves time and money",
      costDeltaUsd: best.delta,
      impact: clamp(1 + best.hours / 2 + (fewerStops ? 0.5 : 0)),
      basis: "grounded",
      refs: [best.f.ref],
      ai: false,
      action: { op: "set_flight", ref: best.f.ref },
    });
  }

  // Logistics: risky connections on the chosen flight.
  const risky = cur.flags.filter((f) => f.kind === "short_layover" || f.kind === "self_transfer" || f.kind === "overnight_layover");
  if (risky.length) {
    const safer = opts
      .filter((f) => !f.flags.some((x) => x.kind === "short_layover" || x.kind === "self_transfer" || x.kind === "overnight_layover"))
      .sort((a, b) => a.priceTotal! - b.priceTotal!)[0];
    if (safer && safer.ref !== best?.f.ref) {
      out.push({
        id: `flight-safer-${safer.ref}`,
        group: "logistics",
        title: `Avoid the ${risky.map((r) => r.label.toLowerCase()).join(" / ")}`,
        why: `Current flight: ${risky.map((r) => r.detail).join("; ")}. ${safer.airlines.join(" + ")} has no tight, overnight, or self-transfer connection.`,
        costDeltaUsd: safer.priceTotal! - cur.priceTotal!,
        impact: risky.some((r) => r.kind === "self_transfer") ? 4.5 : 3.5,
        basis: "grounded",
        refs: [safer.ref],
        ai: false,
        action: { op: "set_flight", ref: safer.ref },
      });
    } else if (!safer) {
      out.push({
        id: "flight-risky-flag",
        group: "logistics",
        title: `Heads-up: ${risky.map((r) => r.label.toLowerCase()).join(" / ")}`,
        why: `${risky.map((r) => r.detail).join("; ")}. No fetched alternative avoids it — consider a later connection or travel insurance.`,
        costDeltaUsd: null,
        impact: 2,
        basis: "grounded",
        refs: [cur.ref],
        ai: false,
      });
    }
  }
  return out;
}

function hotelUpgrade(ds: Dataset, v: PlanVersion, cur: RefHotel): Upgrade | null {
  const stops = v.days.flatMap((d) => dayPlaces(ds, d)).filter((p) => p.gps);
  if (!stops.length || !cur.gps) return null;
  const avgMin = (h: LatLng) => stops.reduce((s, p) => s + estimateTravel(h, p.gps!).minutes, 0) / stops.length;
  const curAvg = avgMin(cur.gps);
  const curCost = lodgingCost(cur, ds).amount;
  const cands = (ds.hotels?.options ?? [])
    .filter((h) => h.ref !== cur.ref && h.gps && h.ratePerNight !== null && (h.rating ?? 0) >= (cur.rating ?? 0) - 0.2)
    .map((h) => ({ h, saved: curAvg - avgMin(h.gps!), delta: lodgingCost(h, ds).amount - curCost }))
    .filter((x) => x.saved >= 5)
    .sort((a, b) => rankScore({ impact: b.saved, costDeltaUsd: b.delta }) - rankScore({ impact: a.saved, costDeltaUsd: a.delta }));
  const best = cands[0];
  if (!best) return null;
  const perDay = Math.round(best.saved * 2); // out and back each day
  return {
    id: `hotel-closer-${best.h.ref}`,
    group: "comfort",
    title: `Stay closer to the action: ${best.h.name}`,
    why: `About ${Math.round(best.saved)} min closer (est.) to your planned stops on average — roughly ${perDay} min/day saved. Rated ${best.h.rating ?? "—"} on Google vs ${cur.rating ?? "—"}.`,
    metric: `~${perDay} min/day saved (est.)`,
    costDeltaUsd: Math.round(best.delta),
    impact: clamp(1 + perDay / 15),
    basis: "grounded",
    refs: [best.h.ref],
    ai: false,
    action: { op: "set_hotel", ref: best.h.ref },
  };
}

function checkoutAdvice(cur: RefHotel | null): Upgrade | null {
  if (!cur?.checkOutTime) return null;
  return {
    id: "late-checkout",
    group: "comfort",
    title: `Plan around the ${cur.checkOutTime} checkout`,
    why: `${cur.name} lists checkout at ${cur.checkOutTime} (Google Hotels). Return flight times aren't fetched yet — if yours leaves in the evening, ask for late checkout or luggage storage.`,
    costDeltaUsd: null,
    impact: 1.5,
    basis: "general",
    refs: [],
    ai: false,
  };
}

function sunsetUpgrades(ds: Dataset, v: PlanVersion): Upgrade[] {
  const out: Upgrade[] = [];
  for (const d of v.days) {
    const w = ds.weather.find((x) => x.date === d.date);
    if (!w?.sunset) continue;
    for (const b of d.blocks) {
      if (b.slot === "evening") continue;
      for (const it of b.items) {
        const p = placeOf(ds, it.ref);
        if (!p || !(p.category === "photo" || /viewpoint|scenic|miradouro|lookout/i.test(p.types.join(" ")))) continue;
        out.push({
          id: `sunset-${p.ref}`,
          group: "experience",
          title: `See ${p.name} at sunset`,
          why: `It's scheduled for the ${b.slot}; sunset on ${fmtDate(d.date)} is ${fmtTime(w.sunset)} (${w.source}).${w.precipChance !== null && w.precipChance >= 50 ? " Rain is likely that day, so check the sky first." : ""}`,
          costDeltaUsd: 0,
          impact: w.precipChance !== null && w.precipChance >= 50 ? 2 : 3,
          basis: "grounded",
          refs: [p.ref],
          ai: false,
          action: { op: "move_item", ref: p.ref, toDate: d.date, toSlot: "evening", toIndex: 0 },
        });
      }
    }
  }
  return out.slice(0, 3);
}

function eventUpgrades(ds: Dataset, v: PlanVersion, threshold: number): Upgrade[] {
  const used = new Set(refsInDays(v.days));
  return ds.places
    .filter((p) => p.category === "events" && !used.has(p.ref) && p.event?.startDate && ds.dates.includes(p.event.startDate))
    .slice(0, 4)
    .map((p) => {
      const venueRated = p.sources.some((s) => s.source === "google_maps" && (s.reviews ?? 0) >= threshold);
      return {
        id: `event-${p.ref}`,
        group: "experience" as const,
        title: `Add ${p.name} on ${fmtDate(p.event!.startDate!)}`,
        why: `${p.event!.when}${p.event!.venue ? ` at ${p.event!.venue}` : ""} (Google Events). Price not listed${p.event!.tickets.length ? `; tickets via ${p.event!.tickets.map((t) => t.source).join(", ")}` : ""}.`,
        costDeltaUsd: null,
        impact: venueRated ? 3.5 : 3,
        basis: "grounded" as const,
        refs: [p.ref],
        ai: false,
        action: { op: "add_item" as const, date: p.event!.startDate!, slot: "evening" as const, ref: p.ref },
      };
    });
}

function skipLineUpgrades(ds: Dataset, v: PlanVersion, input: Pick<PlanInput, "travelers">): Upgrade[] {
  const used = new Set(refsInDays(v.days));
  const n = people(input);
  return ds.places
    .filter((p) => !used.has(p.ref) && /skip[- ]the[- ]line|priority (access|entry)|fast[- ]?track/i.test(`${p.name} ${p.description ?? ""}`))
    .slice(0, 2)
    .map((p) => {
      const usd = p.price.maxUsd ?? p.price.minUsd;
      return {
        id: `skipline-${p.ref}`,
        group: "experience" as const,
        title: `Skip the line: ${p.name}`,
        why: `Listed on ${p.sources.map((s) => s.source.replace("_", " ")).join(" & ")}. ${usd !== null ? `${fmtUsd(usd)} per person listed.` : "Price not listed."}`,
        costDeltaUsd: usd !== null ? usd * n : null,
        impact: 3,
        basis: "grounded" as const,
        refs: [p.ref],
        ai: false,
        action: { op: "add_item" as const, date: v.days[1]?.date ?? v.days[0].date, slot: "morning" as const, ref: p.ref },
      };
    });
}

function reorderUpgrades(ds: Dataset, v: PlanVersion): Upgrade[] {
  const hotel = v.hotelRef ? findRef(ds, v.hotelRef) : null;
  const start = hotel?.kind === "hotel" ? hotel.item.gps : undefined;
  const out: Upgrade[] = [];
  for (const d of v.days) {
    const stops = dayPlaces(ds, d);
    // Events and meals keep their slot; only reorder days made of movable sights.
    if (stops.length < 3 || stops.some((p) => p.event || p.category === "food")) continue;
    const before = routeMinutes(start, stops.map((s) => s.gps));
    const better = nearestNeighbor(start, stops);
    const after = routeMinutes(start, better.map((s) => s.gps));
    const saved = before - after;
    if (saved < 15) continue;
    out.push({
      id: `reorder-${d.date}`,
      group: "logistics",
      title: `Reorder ${fmtDate(d.date)} to cut travel`,
      why: `New order: ${better.map((s) => s.name).join(" → ")}. Saves about ${saved} min of travel (est.: ${before} → ${after} min).`,
      metric: `~${saved} min saved (est.)`,
      costDeltaUsd: 0,
      impact: clamp(1 + saved / 20),
      basis: "grounded",
      refs: better.map((s) => s.ref),
      ai: false,
      action: { op: "reorder_day", date: d.date, order: better.map((s) => s.ref) },
    });
  }
  return out;
}

function rainSwapUpgrades(ds: Dataset, v: PlanVersion): Upgrade[] {
  const info = v.days.map((d) => {
    const places = dayPlaces(ds, d);
    const w = ds.weather.find((x) => x.date === d.date);
    return { d, w, outdoor: places.filter(isOutdoor).length, fixed: places.some((p) => !!p.event?.startDate), stops: places.length };
  });
  const out: Upgrade[] = [];
  const usedDates = new Set<string>();
  for (const wet of info) {
    if (!wet.outdoor || wet.fixed || (wet.w?.precipChance ?? 0) < 50 || usedDates.has(wet.d.date)) continue;
    const dry = info
      .filter((x) => x.d.date !== wet.d.date && !x.fixed && !usedDates.has(x.d.date) && (x.w?.precipChance ?? 100) < 30 && x.outdoor < wet.outdoor && x.stops > 0)
      .sort((a, b) => (a.w?.precipChance ?? 0) - (b.w?.precipChance ?? 0))[0];
    if (!dry) continue;
    usedDates.add(wet.d.date);
    usedDates.add(dry.d.date);
    out.push({
      id: `rain-${wet.d.date}-${dry.d.date}`,
      group: "logistics",
      title: `Swap ${fmtDate(wet.d.date)} and ${fmtDate(dry.d.date)} to dodge rain`,
      why: `${fmtDate(wet.d.date)} has ${wet.outdoor} outdoor stop${wet.outdoor > 1 ? "s" : ""} and ${wet.w?.precipChance}% rain; ${fmtDate(dry.d.date)} is ${dry.w?.precipChance}% (${wet.w?.source}).`,
      costDeltaUsd: 0,
      impact: clamp(2 + (wet.w!.precipChance! - (dry.w?.precipChance ?? 0)) / 30),
      basis: "grounded",
      refs: [],
      ai: false,
      action: { op: "swap_days", a: wet.d.date, b: dry.d.date },
    });
  }
  return out;
}

function cabinAdvice(input: Pick<PlanInput, "cabin">, cur: RefFlight | null): Upgrade | null {
  if (input.cabin !== "economy" || !cur || cur.totalDurationMin < 360) return null;
  return {
    id: "cabin-premium",
    group: "comfort",
    title: "Price out premium economy",
    why: `Your longest itinerary is ${fmtDuration(cur.totalDurationMin)}. Premium economy wasn't searched — run a Flights search with that cabin (1 search) to see the real difference.`,
    costDeltaUsd: null,
    impact: 2,
    basis: "general",
    refs: [],
    ai: false,
  };
}

export function computeUpgrades(ds: Dataset, v: PlanVersion, input: Pick<PlanInput, "travelers" | "cabin">, settings: Pick<AppSettings, "verifiedReviewThreshold">): Upgrade[] {
  const flight = v.flightRef ? findRef(ds, v.flightRef) : null;
  const hotel = v.hotelRef ? findRef(ds, v.hotelRef) : null;
  const f = flight?.kind === "flight" ? flight.item : null;
  const h = hotel?.kind === "hotel" ? hotel.item : null;
  const list: (Upgrade | null)[] = [
    ...(f ? flightUpgrades(ds, v, f) : []),
    h ? hotelUpgrade(ds, v, h) : null,
    checkoutAdvice(h),
    cabinAdvice(input, f),
    ...sunsetUpgrades(ds, v),
    ...eventUpgrades(ds, v, settings.verifiedReviewThreshold),
    ...skipLineUpgrades(ds, v, input),
    ...reorderUpgrades(ds, v),
    ...rainSwapUpgrades(ds, v),
  ];
  return sortUpgrades(list.filter((u): u is Upgrade => !!u));
}

export function sortUpgrades(list: Upgrade[]): Upgrade[] {
  return [...list].sort((a, b) => rankScore(b) - rankScore(a) || (a.basis === "grounded" ? -1 : 1));
}
