// Prompt + output schema for itinerary generation. Pure functions (tested without the API).
import { fmtTime } from "@/lib/format";
import { SOURCE_LABEL } from "@/lib/places/types";
import { weatherNote } from "@/lib/weather-shared";
import type { Dataset, Pace, PlanDay, PlanInput, RefFlight, RefHotel, VersionKey } from "./types";

export const ITEMS_PER_DAY: Record<Pace, string> = { chill: "2–3", balanced: "3–4", packed: "5–6" };

const ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["ref", "note"],
  properties: {
    ref: { type: "string", description: "Exact ref from DATA, e.g. P12 or E3" },
    note: { type: "string", description: "≤ 25 words: why/when/how. No prices, ratings, or facts not in DATA." },
  },
};

export const DAY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["date", "theme", "tip", "morning", "afternoon", "evening"],
  properties: {
    date: { type: "string", description: "yyyy-mm-dd" },
    theme: { type: "string" },
    tip: { type: "string" },
    morning: { type: "array", items: ITEM },
    afternoon: { type: "array", items: ITEM },
    evening: { type: "array", items: ITEM },
  },
};

export const ITINERARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "tips", "days"],
  properties: {
    summary: { type: "string" },
    tips: { type: "array", items: { type: "string" } },
    days: { type: "array", items: DAY_SCHEMA },
  },
};

export const SINGLE_DAY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["day"],
  properties: { day: DAY_SCHEMA },
};

export interface RawItem {
  ref: string;
  note: string;
}
export interface RawDay {
  date: string;
  theme: string;
  tip: string;
  morning: RawItem[];
  afternoon: RawItem[];
  evening: RawItem[];
}
export interface RawItinerary {
  summary: string;
  tips: string[];
  days: RawDay[];
}

const k = (n: number | null) => (n === null ? "?" : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

/** Compact, line-per-item view of the dataset. Everything Claude may reference, nothing else. */
export function datasetForPrompt(ds: Dataset): string {
  const lines: string[] = [];
  lines.push(`DESTINATION: ${ds.destination}`);
  lines.push(`DATES: ${ds.dates.join(", ")} (${ds.nights} nights)`);
  lines.push("");
  lines.push("WEATHER (per date):");
  for (const w of ds.weather) lines.push(`- ${w.date}: ${weatherNote(w)}${w.sunset ? `; sunset ${w.sunset}` : ""} [${w.source}]`);
  lines.push("");
  lines.push("PLACES & EVENTS (ref | name | category | ratings | price | hours | lat,lng):");
  for (const p of ds.places) {
    const ratings = p.sources
      .filter((s) => s.rating !== null)
      .map((s) => `${SOURCE_LABEL[s.source]} ${s.rating}(${k(s.reviews)})`)
      .join(", ") || "no ratings";
    const price = p.price.display ?? "price not listed";
    const hours = p.event ? `event: ${p.event.when}${p.event.startDate ? ` [date ${p.event.startDate}]` : " [date unconfirmed]"}` : p.hours ?? "hours not listed";
    const where = p.gps ? `${p.gps.lat.toFixed(4)},${p.gps.lng.toFixed(4)}` : "no coords";
    lines.push(`${p.ref} | ${p.name} | ${p.category}${p.types[0] ? `/${p.types[0]}` : ""} | ${ratings} | ${price} | ${hours} | ${where}`);
  }
  return lines.join("\n");
}

export function systemPrompt(ds: Dataset): string {
  return `You build day-by-day travel itineraries inside an app whose promise is: every fact shown traces to a real source.

HARD RULES
1. Use ONLY the places and events listed in DATA. Reference each with its exact ref (e.g. "P12", "E3"). Never invent a place, event, venue, price, rating, review, or opening hour.
2. Each ref at most once per itinerary.
3. Events (E refs) only on their listed date. Skip events marked "date unconfirmed" unless the user asked for them.
4. Notes are short practical guidance (≤ 25 words): why this stop, best time, what to do there, how it pairs with the next stop. Do not state prices, ratings, review counts, or hours in notes; the app shows the sourced numbers itself.
5. If DATA doesn't have enough fitting items, leave a slot empty. An empty slot is better than a made-up one.
6. Return JSON matching the schema; one entry in "days" per date in DATES, in order.

PLANNING GUIDANCE
- Cluster nearby stops (use lat,lng) to cut travel time; start each day near the hotel.
- Put food items in lunch/dinner positions (afternoon/evening). Put photo spots and viewpoints near sunset when possible.
- Respect listed hours. Put outdoor items on the driest days; museums and indoor items on rainy days.
- The first date is the departure day from home. Plan nothing before the arrival time given (overnight flights land the next day; leave earlier dates empty). The last date is the departure day: morning only, keep it light.

DATA
${datasetForPrompt(ds)}`;
}

const STYLE_HINT: Record<string, string> = {
  cinematic: "scenic, photogenic moments (viewpoints, golden hour)",
  cultural: "history, museums, local traditions",
  adventure: "active and outdoor experiences",
  luxury: "premium experiences and refined dining",
  relaxation: "unhurried time, parks, downtime",
  foodie: "standout local food",
  nightlife: "bars, live music, late evenings",
  romantic: "intimate settings, sunsets, memorable dinners",
};

export function versionPrompt(
  key: VersionKey,
  input: Pick<PlanInput, "styles" | "pace" | "travelers">,
  ds: Dataset,
  flight: RefFlight | null,
  hotel: RefHotel | null,
  activityAllowanceUsd: number,
): string {
  const firstSeg = flight?.segments[flight.segments.length - 1];
  const arrival = firstSeg ? `${fmtTime(firstSeg.to.time)} on ${firstSeg.to.time.slice(0, 10)}` : "unknown (assume mid-afternoon)";
  const tone: Record<VersionKey, string> = {
    lean: "LEAN: favor free or low-cost items, street food and casual spots, walking between stops.",
    balanced: "BALANCED: a mix of headline sights and local favorites; one or two paid experiences.",
    splurge: "SPLURGE: prioritize the best-rated experiences, tours, and dining regardless of cost.",
  };
  const n = input.travelers.adults + input.travelers.children;
  return `Plan the ${key.toUpperCase()} version.
${tone[key]}
Travelers: ${n} (${input.travelers.adults} adults${input.travelers.children ? `, ${input.travelers.children} children` : ""}).
Trip style: ${input.styles.length ? input.styles.map((s) => STYLE_HINT[s] ?? s).join("; ") : "general sightseeing"}.
Pace: ${input.pace} — about ${ITEMS_PER_DAY[input.pace]} stops per full day (fewer on arrival/departure days).
Hotel: ${hotel ? `${hotel.name}${hotel.gps ? ` at ${hotel.gps.lat.toFixed(4)},${hotel.gps.lng.toFixed(4)}` : ""}` : "not chosen"}.
Arrival: ${arrival}. Return flight time unknown: keep the last date to a light morning.
Activity spending room: about $${Math.round(activityAllowanceUsd)} total for paid activities (prices are in DATA; don't mention them in notes).`;
}

export function regenerateDayPrompt(date: string, usedRefs: string[], base: string): string {
  return `${base}

Regenerate ONLY the plan for ${date}. Return {"day": ...} for that date.
Do not use these refs (already used on other days): ${usedRefs.length ? usedRefs.join(", ") : "none"}.
Offer a fresh take compared to before.`;
}

/** Deterministic stand-in for Claude in fixture mode / tests. Deliberately includes one bad ref and one duplicate. */
export function fixtureItinerary(ds: Dataset, key: VersionKey, pace: Pace): RawItinerary {
  const perDay = pace === "chill" ? 2 : pace === "balanced" ? 3 : 5;
  const food = ds.places.filter((p) => p.category === "food");
  const events = ds.places.filter((p) => p.category === "events");
  const other = ds.places.filter((p) => p.category !== "food" && p.category !== "events");
  const offset = key === "lean" ? 0 : key === "balanced" ? 1 : 2;
  let oi = offset;
  let fi = offset;
  const days: RawDay[] = ds.dates.map((date, di) => {
    const last = di === ds.dates.length - 1;
    const count = last ? 1 : perDay;
    const morning: RawItem[] = [];
    const afternoon: RawItem[] = [];
    const evening: RawItem[] = [];
    for (let i = 0; i < count && oi < other.length; i++) (i % 2 === 0 ? morning : afternoon).push({ ref: other[oi++].ref, note: "Fixture note: go early to beat crowds." });
    if (!last && fi < food.length) evening.push({ ref: food[fi++].ref, note: "Fixture note: book ahead for dinner." });
    const ev = events.find((e) => e.event?.startDate === date);
    if (ev && !last) evening.push({ ref: ev.ref, note: "Fixture note: event on this date." });
    return { date, theme: `Fixture day ${di + 1}`, tip: "Fixture tip.", morning, afternoon, evening };
  });
  if (days[0]) days[0].afternoon.push({ ref: "P999", note: "Invented place that must be stripped." });
  if (days[1] && days[0]?.morning[0]) days[1].morning.push({ ...days[0].morning[0] });
  return { summary: `Fixture ${key} itinerary for ${ds.destination}.`, tips: ["Fixture tip: carry a light rain jacket."], days };
}

export function fixtureDay(ds: Dataset, date: string, used: Set<string>): { day: RawDay } {
  const free = ds.places.filter((p) => p.category !== "events" && !used.has(p.ref));
  return {
    day: {
      date,
      theme: "Fixture regenerated day",
      tip: "Fixture tip.",
      morning: free.slice(0, 1).map((p) => ({ ref: p.ref, note: "Fixture regenerated." })),
      afternoon: free.slice(1, 2).map((p) => ({ ref: p.ref, note: "Fixture regenerated." })),
      evening: [],
    },
  };
}

export type { PlanDay };
