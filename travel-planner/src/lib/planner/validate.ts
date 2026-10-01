// Server-side grounding check on Claude's output: anything not in the fetched dataset is stripped.
import { estimateTravel, type LatLng } from "@/lib/geo";
import type { RawDay, RawItinerary } from "./prompt";
import { SLOTS, findRef, type Dataset, type PlanDay, type PlanItem, type RefPlace } from "./types";

const REF_RE = /^[PE]\d{1,4}$/;
const MAX_NOTE = 280;
// Notes must not carry numbers the app can't source. Strip dollar amounts and star ratings.
const PRICE_RE = /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:–|-|to)\s?\$?\d[\d,]*(?:\.\d+)?)?/gi;
const RATING_RE = /\b\d(?:\.\d)?\s?(?:\/\s?5\s?)?(?:stars?|★)/gi;

export function cleanNote(note: unknown): string | undefined {
  if (typeof note !== "string") return undefined;
  let s = note.replace(PRICE_RE, "").replace(RATING_RE, "").replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  if (s.length > MAX_NOTE) s = `${s.slice(0, MAX_NOTE - 1).trimEnd()}…`;
  return s || undefined;
}

export interface Removed {
  ref: string;
  reason: string;
}

export interface ValidateOptions {
  /** Refs already used elsewhere (e.g. other days when regenerating one day). */
  alreadyUsed?: Set<string>;
}

function validateDay(raw: RawDay | undefined, date: string, ds: Dataset, used: Set<string>, removed: Removed[]): PlanDay {
  const day: PlanDay = { date, theme: cleanNote(raw?.theme), tip: cleanNote(raw?.tip), blocks: SLOTS.map((slot) => ({ slot, items: [] as PlanItem[] })) };
  if (!raw) return day;
  for (const block of day.blocks) {
    const items = Array.isArray(raw[block.slot]) ? raw[block.slot] : [];
    for (const it of items) {
      const ref = typeof it?.ref === "string" ? it.ref.trim().toUpperCase() : "";
      if (!REF_RE.test(ref)) {
        removed.push({ ref: ref || "(empty)", reason: "Not a place/event reference" });
        continue;
      }
      const found = findRef(ds, ref);
      if (!found || found.kind !== "place") {
        removed.push({ ref, reason: "Not in the fetched data" });
        continue;
      }
      if (used.has(ref)) {
        removed.push({ ref, reason: `Duplicate of ${found.item.name}` });
        continue;
      }
      const ev = found.item.event;
      if (ev?.startDate && ev.startDate !== date) {
        removed.push({ ref, reason: `${found.item.name} is on ${ev.startDate}, not ${date}` });
        continue;
      }
      used.add(ref);
      block.items.push({ ref, note: cleanNote(it.note) });
    }
  }
  return day;
}

/** Validate a full itinerary: one day per dataset date, only known refs, no repeats, events on their dates. */
export function validateItinerary(raw: RawItinerary | null | undefined, ds: Dataset, opts: ValidateOptions = {}): { days: PlanDay[]; summary?: string; tips: string[]; removed: Removed[] } {
  const removed: Removed[] = [];
  const used = new Set(opts.alreadyUsed ?? []);
  const rawDays = Array.isArray(raw?.days) ? raw!.days : [];
  const byDate = new Map(rawDays.filter((d) => d && typeof d.date === "string").map((d) => [d.date, d]));
  const days = ds.dates.map((date, i) => validateDay(byDate.get(date) ?? (byDate.size === 0 ? rawDays[i] : undefined), date, ds, used, removed));
  const tips = (Array.isArray(raw?.tips) ? raw!.tips : []).map(cleanNote).filter((t): t is string => !!t).slice(0, 8);
  return { days: attachTravel(days, ds, null), summary: cleanNote(raw?.summary), tips, removed };
}

export function validateSingleDay(raw: { day?: RawDay } | null | undefined, date: string, ds: Dataset, alreadyUsed: Set<string>): { day: PlanDay; removed: Removed[] } {
  const removed: Removed[] = [];
  const used = new Set(alreadyUsed);
  const day = validateDay(raw?.day && raw.day.date === date ? raw.day : raw?.day ? { ...raw.day, date } : undefined, date, ds, used, removed);
  return { day, removed };
}

/** Recompute estimated travel between consecutive stops (first stop of the day starts at the hotel). */
export function attachTravel(days: PlanDay[], ds: Dataset, hotelRef: string | null): PlanDay[] {
  const hotel = hotelRef ? findRef(ds, hotelRef) : null;
  const hotelGps = hotel?.kind === "hotel" ? hotel.item.gps : undefined;
  return days.map((d) => {
    let prev: { ref: string; gps?: LatLng } | null = hotelGps ? { ref: hotelRef!, gps: hotelGps } : null;
    return {
      ...d,
      blocks: d.blocks.map((b) => ({
        ...b,
        items: b.items.map((it) => {
          const place = findRef(ds, it.ref);
          const gps = place?.kind === "place" ? (place.item as RefPlace).gps : undefined;
          const next: PlanItem = { ref: it.ref, note: it.note };
          if (prev?.gps && gps) next.travel = { ...estimateTravel(prev.gps, gps), fromRef: prev.ref };
          prev = { ref: it.ref, gps: gps ?? prev?.gps };
          return next;
        }),
      })),
    };
  });
}

export function refsInDays(days: PlanDay[]): string[] {
  return days.flatMap((d) => d.blocks.flatMap((b) => b.items.map((i) => i.ref)));
}
