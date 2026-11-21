import "server-only";
import { claudeJson } from "@/lib/claude";
import { env } from "@/lib/env";
import type { AppSettings } from "@/lib/settings-shared";
import { chooseFlight, chooseHotel, computeCosts } from "./budget";
import { fixtureDay, fixtureItinerary, ITINERARY_SCHEMA, STORY_DESCRIPTION, regenerateDayPrompt, SINGLE_DAY_SCHEMA, systemPrompt, versionPrompt, type RawDay, type RawItinerary } from "./prompt";
import { attachTravel, cleanStory, refsInDays, validateItinerary, validateSingleDay } from "./validate";
import { dayVibe } from "./vibe";
import { findRef, VERSION_KEYS, type Dataset, type PlanInput, type PlanVersion, type TripPlan, type VersionKey } from "./types";

/** Re-attach travel estimates and recompute costs after any change. */
export function recomputeVersion(v: PlanVersion, ds: Dataset, input: PlanInput, settings: AppSettings): PlanVersion {
  const days = attachTravel(v.days, ds, v.hotelRef).map((d) => ({ ...d, vibe: dayVibe(d, ds, input.styles) }));
  return { ...v, days, costs: computeCosts({ ...v, days }, ds, input, settings) };
}

async function generateVersion(key: VersionKey, input: PlanInput, ds: Dataset, settings: AppSettings, system: string): Promise<PlanVersion> {
  const flight = chooseFlight(ds, key, settings.valueOfTimeUsdPerHour);
  const hotel = chooseHotel(ds, key);
  const fixed = computeCosts({ key, flightRef: flight?.ref ?? null, hotelRef: hotel?.ref ?? null, days: [] }, ds, input, settings);
  const allowance = Math.max(0, fixed.remaining);

  const { data } = await claudeJson<RawItinerary>({
    system,
    user: versionPrompt(key, input, ds, flight, hotel, allowance),
    schema: ITINERARY_SCHEMA,
    note: `itinerary:${key}:${ds.destination}`,
    fixture: () => fixtureItinerary(ds, key, input.pace),
  });

  const v = validateItinerary(data, ds);
  if (v.removed.length) console.warn(`[planner] ${key}: stripped ${v.removed.length} item(s)`, v.removed);
  return recomputeVersion(
    {
      key,
      flightRef: flight?.ref ?? null,
      hotelRef: hotel?.ref ?? null,
      summary: v.summary,
      tips: v.tips,
      days: v.days,
      costs: fixed,
      removed: v.removed,
      generatedAt: new Date().toISOString(),
    },
    ds,
    input,
    settings,
  );
}

/** Lean, Balanced, and Splurge in parallel (each one Claude call). */
export async function generatePlan(input: PlanInput, ds: Dataset, settings: AppSettings): Promise<TripPlan> {
  const system = systemPrompt(ds);
  const versions = await Promise.all(VERSION_KEYS.map((k) => generateVersion(k, input, ds, settings, system)));
  return {
    versions: Object.fromEntries(versions.map((v) => [v.key, v])) as TripPlan["versions"],
    model: env.fixtureMode ? "fixture" : env.anthropicModel,
    generatedAt: new Date().toISOString(),
  };
}

/** Replace one day of one version, keeping every other day as-is. */
export async function regenerateDay(plan: TripPlan, key: VersionKey, date: string, input: PlanInput, ds: Dataset, settings: AppSettings): Promise<PlanVersion> {
  const v = plan.versions[key];
  if (!ds.dates.includes(date)) throw new Error("That date isn't part of this trip.");
  const others = v.days.filter((d) => d.date !== date);
  const used = new Set(refsInDays(others));
  const flight = v.flightRef ? findRef(ds, v.flightRef) : null;
  const hotel = v.hotelRef ? findRef(ds, v.hotelRef) : null;
  const base = versionPrompt(
    key,
    input,
    ds,
    flight?.kind === "flight" ? flight.item : null,
    hotel?.kind === "hotel" ? hotel.item : null,
    Math.max(0, v.costs.remaining),
  );
  const { data } = await claudeJson<{ day: RawDay }>({
    system: systemPrompt(ds),
    user: regenerateDayPrompt(date, [...used], base),
    schema: SINGLE_DAY_SCHEMA,
    note: `regenerate-day:${key}:${date}`,
    maxTokens: 16000,
    fixture: () => fixtureDay(ds, date, used),
  });
  const { day, removed } = validateSingleDay(data, date, ds, used);
  const days = v.days.map((d) => (d.date === date ? day : d));
  return recomputeVersion({ ...v, days, removed: [...v.removed, ...removed], generatedAt: new Date().toISOString() }, ds, input, settings);
}

const DESCRIBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["days"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "story"],
        properties: { date: { type: "string" }, story: { type: "string", description: STORY_DESCRIPTION } },
      },
    },
  },
};

/** Write (or rewrite) the "how the day will feel" description for every day of one version. One Claude call. */
export async function describeDays(plan: TripPlan, key: VersionKey, input: PlanInput, ds: Dataset, settings: AppSettings): Promise<PlanVersion> {
  const v = plan.versions[key];
  const lines = v.days.map((d) => {
    const stops = d.blocks.flatMap((b) => b.items.map((i) => `${b.slot}: ${i.ref} ${(findRef(ds, i.ref)?.item as { name?: string } | undefined)?.name ?? ""}`));
    return `${d.date}${d.theme ? ` (${d.theme})` : ""}\n  ${stops.length ? stops.join("\n  ") : "no stops planned"}`;
  });
  const { data } = await claudeJson<{ days: { date: string; story: string }[] }>({
    system: systemPrompt(ds),
    user: `This is the ${key.toUpperCase()} itinerary. Trip styles: ${input.styles.join(", ") || "general"}. Pace: ${input.pace}.
For each date, write how the day will feel and flow. Use only the stops listed for that date.

${lines.join("\n")}`,
    schema: DESCRIBE_SCHEMA,
    note: `describe-days:${key}:${ds.destination}`,
    maxTokens: 8000,
    fixture: () => ({ days: v.days.map((d) => ({ date: d.date, story: `A fixture description of ${d.date}: unhurried morning, lively evening.` })) }),
  });
  const byDate = new Map(data.days.map((d) => [d.date, cleanStory(d.story)]));
  const days = v.days.map((d) => {
    const story = byDate.get(d.date);
    return story ? { ...d, story, storyRefs: d.blocks.flatMap((b) => b.items.map((i) => i.ref)) } : d;
  });
  return recomputeVersion({ ...v, days }, ds, input, settings);
}
