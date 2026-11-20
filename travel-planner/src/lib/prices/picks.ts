// Grounding rules for "Reddit & travelers recommend". Pure, so it's unit-tested.
import { cleanNote } from "@/lib/planner/validate";
import { sameName } from "@/lib/places/normalize";
import type { TipSource } from "@/lib/savings/types";
import { mentions } from "./extract";
import type { CommunityPick } from "./types";

export interface RawPick {
  name: string;
  ref: string | null;
  why: string;
  sourceIds: string[];
}

/**
 * Keep a pick only if a cited source actually names it. A pick is cross-checked when 2+ different
 * websites name it. A ref is kept only if it points at a real item with the same name.
 */
export function validatePicks(raw: RawPick[], sources: TipSource[], places: { ref: string; name: string }[], max = 10): CommunityPick[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: CommunityPick[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    const name = (p.name ?? "").trim().slice(0, 120);
    if (!name || seen.has(name.toLowerCase())) continue;
    const cited = [...new Set(p.sourceIds ?? [])].map((id) => byId.get(id)).filter((s): s is TipSource => !!s);
    const backing = cited.filter((s) => mentions(`${s.title} ${s.snippet}`, name));
    if (!backing.length) continue;
    const place = p.ref ? places.find((x) => x.ref === p.ref) : undefined;
    const ref = place && (sameName(place.name, name) || backing.some((s) => mentions(`${s.title} ${s.snippet}`, place.name))) ? place.ref : null;
    const domains = [...new Set(backing.map((s) => s.domain))];
    seen.add(name.toLowerCase());
    out.push({ name: place && ref ? place.name : name, ref, why: cleanNote(p.why) ?? "", sourceIds: backing.map((s) => s.id), domains, crossChecked: domains.length >= 2 });
  }
  return out.sort((a, b) => Number(b.crossChecked) - Number(a.crossChecked) || b.sourceIds.length - a.sourceIds.length).slice(0, max);
}
