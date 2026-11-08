import "server-only";
import { claudeJson } from "@/lib/claude";
import { fmtDate } from "@/lib/format";
import type { TripRecord } from "@/lib/planner/types";
import { serpSearch } from "@/lib/serpapi/client";
import { getDb } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { TIP_CATEGORIES, type SavingsTips } from "./types";
import { buildSources, validateWebTips, type RawTip } from "./verify";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tips"],
  properties: {
    tips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "text", "sourceIds"],
        properties: {
          category: { type: "string", enum: TIP_CATEGORIES.map((c) => c.id) },
          text: { type: "string", description: "One practical, specific tip in 1–2 sentences." },
          sourceIds: { type: "array", items: { type: "string" }, description: "Every source id (S1, S2…) that supports this tip." },
        },
      },
    },
  },
};

/** The searches used for web tips (cached 30 days per destination). Search Saver drops the general web query. */
export function tipQueries(destination: string, saver: boolean): { engine: string; params: Record<string, string> }[] {
  const d = destination.trim();
  const q: { engine: string; params: Record<string, string> }[] = [
    { engine: "google", params: { q: `site:reddit.com ${d} travel tips save money cheap flights hotels food`, hl: "en", gl: "us", num: "10" } },
    { engine: "youtube", params: { search_query: `${d} travel tips how to save money`, hl: "en", gl: "us" } },
  ];
  if (!saver) q.splice(1, 0, { engine: "google", params: { q: `${d} money saving travel tips cheap flights hotels food forum -site:reddit.com`, hl: "en", gl: "us", num: "10" } });
  return q;
}

const TTL_30_DAYS = 30 * 24 * 60 * 60;

export async function generateSavingsTips(trip: TripRecord): Promise<TripRecord> {
  const settings = await getSettings();
  const ds = trip.dataset;
  const queries = tipQueries(ds.destination, settings.searchSaver);
  const results = await Promise.all(queries.map((q) => serpSearch(q.engine, q.params, { ttlSeconds: TTL_30_DAYS })));
  const google = results.filter((_, i) => queries[i].engine === "google").map((r) => r.data as Record<string, unknown>);
  const yt = results.find((_, i) => queries[i].engine === "youtube")?.data as Record<string, unknown> | undefined;
  const sources = buildSources(google, yt ?? null);

  let tips: SavingsTips["web"] = [];
  if (sources.length) {
    const list = sources.map((s) => `${s.id} | ${s.domain} | ${s.title}${s.date ? ` | ${s.date}` : ""}\n   ${s.snippet}`).join("\n");
    const { data } = await claudeJson<{ tips: RawTip[] }>({
      system: `You extract money-saving travel tips from search results. The app shows only tips that trace back to these sources.

RULES
1. Every tip must be directly supported by the cited source snippets. Do not use outside knowledge, and do not invent prices, names, or schedules.
2. Cite EVERY source id that supports a tip. Tips backed by several different websites are worth more, so look for advice that repeats across sources.
3. Be specific and practical (what to do, where, when). Skip vague advice like "plan ahead" unless a source gives a concrete reason.
4. Only include a dollar amount if it appears in a cited snippet.
5. Categories: flights, hotels, food, getting_around, general.

SOURCES
${list}`,
      user: `Trip: ${trip.inputs.origin} → ${ds.destination}, ${fmtDate(ds.startDate)}–${fmtDate(ds.endDate)}, ${ds.travelers.adults + ds.travelers.children} travelers.
Give up to 12 tips for saving money on flights, hotels, food, and getting around in ${ds.destination}, with source ids.`,
      schema: SCHEMA,
      note: `savings-tips:${ds.destination}`,
      maxTokens: 12000,
      fixture: () => ({
        tips: [
          { category: "food", text: "Eat at the fixture market's lunch counters, which several travelers say cost about $12.", sourceIds: ["S1", "S3"] },
          { category: "getting_around", text: "Take the fixture bus from the airport instead of a taxi; one traveler said it's $2.75 and a taxi is $99.", sourceIds: ["S2"] },
          { category: "hotels", text: "This tip cites a source that doesn't exist and must be dropped.", sourceIds: ["S99"] },
        ],
      }),
    });
    tips = validateWebTips(data.tips, sources);
  }

  const cited = new Set(tips.flatMap((t) => t.sourceIds));
  const savings: SavingsTips = {
    web: tips,
    sources,
    queries: queries.map((q) => q.params.q ?? q.params.search_query),
    fetchedAt: results.map((r) => r.fetchedAt).sort()[0] ?? new Date().toISOString(),
    removed: sources.filter((s) => !cited.has(s.id)).length,
  };
  const plan = { ...trip.plan, savings };
  return (await getDb().updateTrip(trip.id, { plan })) as unknown as TripRecord;
}
