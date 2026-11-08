import "server-only";
import { claudeJson } from "@/lib/claude";
import { systemPrompt } from "@/lib/planner/prompt";
import { saveUpgrades } from "@/lib/planner/trips";
import { findRef, type Dataset, type PlanVersion, type TripRecord, type Upgrade, type UpgradeSet, type VersionKey } from "@/lib/planner/types";
import { cleanNote } from "@/lib/planner/validate";
import { getSettings } from "@/lib/settings";
import { computeUpgrades, sortUpgrades } from "./engine";

interface RawSuggestion {
  group: "comfort" | "experience" | "logistics";
  title: string;
  why: string;
  refs: string[];
  impact: number;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["group", "title", "why", "refs", "impact"],
        properties: {
          group: { type: "string", enum: ["comfort", "experience", "logistics"] },
          title: { type: "string" },
          why: { type: "string" },
          refs: { type: "array", items: { type: "string" } },
          impact: { type: "number", description: "1 (minor) to 5 (transformative)" },
        },
      },
    },
  },
};

function planDigest(ds: Dataset, v: PlanVersion): string {
  return v.days
    .map((d) => {
      const stops = d.blocks.flatMap((b) => b.items.map((i) => `${b.slot}:${i.ref}`));
      return `${d.date}: ${stops.join(", ") || "free"}`;
    })
    .join("\n");
}

/** Validate Claude's suggestions: drop unknown refs; a suggestion whose refs were all invented is dropped entirely. */
export function validateAiSuggestions(raw: { suggestions?: RawSuggestion[] } | null, ds: Dataset): Upgrade[] {
  const out: Upgrade[] = [];
  (raw?.suggestions ?? []).slice(0, 6).forEach((s, i) => {
    const title = cleanNote(s.title);
    const why = cleanNote(s.why);
    if (!title || !why) return;
    const asked = Array.isArray(s.refs) ? s.refs.map((r) => String(r).trim().toUpperCase()) : [];
    const refs = asked.filter((r) => findRef(ds, r));
    if (asked.length && !refs.length) return;
    out.push({
      id: `ai-${i}`,
      group: ["comfort", "experience", "logistics"].includes(s.group) ? s.group : "experience",
      title,
      why,
      costDeltaUsd: null,
      impact: Math.max(1, Math.min(5, Number(s.impact) || 2)),
      basis: refs.length ? "grounded" : "general",
      refs,
      ai: true,
    });
  });
  return out;
}

export async function generateUpgrades(trip: TripRecord, version: VersionKey, withAi: boolean): Promise<TripRecord> {
  const settings = await getSettings();
  const v = trip.plan.versions[version];
  const ds = trip.dataset;
  const items = computeUpgrades(ds, v, trip.inputs, settings);

  if (withAi) {
    const { data } = await claudeJson<{ suggestions: RawSuggestion[] }>({
      system: systemPrompt(ds),
      user: `Here is the ${version.toUpperCase()} itinerary (ref per stop):
${planDigest(ds, v)}
Flight: ${v.flightRef ?? "none"}; hotel: ${v.hotelRef ?? "none"}; budget remaining: $${Math.round(v.costs.remaining)}.

The app already computed these upgrades, so don't repeat them:
${items.map((u) => `- ${u.title}`).join("\n") || "- none"}

Suggest up to 5 MORE ways to make this trip better (comfort, experience, logistics), ranked by experience gained per dollar.
Each suggestion must reference the DATA refs it relies on. If it's general travel advice not tied to DATA, return an empty refs array (the app will label it "general advice").
No prices or ratings in the text.`,
      schema: SCHEMA,
      note: `upgrades:${version}:${ds.destination}`,
      maxTokens: 16000,
      fixture: () => ({
        suggestions: [
          { group: "experience", title: "Fixture: pair the market with a viewpoint", why: "Fixture suggestion.", refs: [ds.places[0]?.ref ?? "P1"], impact: 3 },
          { group: "comfort", title: "Fixture: invented place", why: "Must be dropped.", refs: ["P999"], impact: 5 },
          { group: "logistics", title: "Fixture: buy a transit card", why: "Fixture general advice.", refs: [], impact: 2 },
        ],
      }),
    });
    items.push(...validateAiSuggestions(data, ds));
  }

  const set: UpgradeSet = { version, items: sortUpgrades(items), generatedAt: new Date().toISOString() };
  return saveUpgrades(trip, set);
}
