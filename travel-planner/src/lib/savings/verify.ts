// Cross-checking for web-sourced tips. Pure, so it's unit-tested without any API.
// Claude proposes tips with source ids; this decides what survives and what counts as cross-checked.
import { cleanNote } from "@/lib/planner/validate";
import { sourceKind, TIP_CATEGORIES, type TipCategory, type TipSource, type WebTip } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").replace(/^(old|m|np)\./, "");
  } catch {
    return "";
  }
}

/** Turn Google + YouTube results into numbered sources. Same URL appears once. */
export function buildSources(googleResults: Raw[], youtube: Raw | null, maxPerQuery = 8): TipSource[] {
  const out: TipSource[] = [];
  const seen = new Set<string>();
  const add = (title: string, url: string, snippet: string, date?: string) => {
    const domain = domainOf(url);
    if (!url || !domain || seen.has(url) || !snippet.trim()) return;
    seen.add(url);
    out.push({ id: `S${out.length + 1}`, kind: sourceKind(domain), title: title || domain, url, domain, snippet: snippet.slice(0, 500), date });
  };
  for (const g of googleResults) {
    const organic: Raw[] = Array.isArray(g?.organic_results) ? g.organic_results : [];
    const forums: Raw[] = Array.isArray(g?.discussions_and_forums) ? g.discussions_and_forums : [];
    for (const r of [...forums, ...organic].slice(0, maxPerQuery)) {
      add(str(r.title), str(r.link), str(r.snippet) || (Array.isArray(r.extensions) ? r.extensions.join(" · ") : ""), str(r.date) || undefined);
    }
  }
  const videos: Raw[] = Array.isArray(youtube?.video_results) ? youtube!.video_results : [];
  for (const v of videos.slice(0, 5)) add(str(v.title), str(v.link), str(v.description) || str(v.title), str(v.published_date) || undefined);
  return out;
}

const AMOUNT_RE = /\$\s?\d[\d,]*(?:\.\d+)?/g;
const norm = (s: string) => s.replace(/\s|,/g, "");

/**
 * Keep a dollar amount only if it literally appears in one of the tip's cited sources.
 * "Uber from the airport is about $25" survives only when a cited snippet says $25.
 */
export function keepVerifiedAmounts(text: string, cited: TipSource[]): string {
  const haystack = norm(cited.map((s) => `${s.title} ${s.snippet}`).join(" "));
  return text
    .replace(AMOUNT_RE, (m) => (haystack.includes(norm(m)) ? m : ""))
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

export interface RawTip {
  category: string;
  text: string;
  sourceIds: string[];
}

/**
 * - drops tips that cite nothing real (no valid source id)
 * - strips dollar amounts not present in the cited sources
 * - cross-checked = cited sources span 2+ different websites (computed here, not trusted from the model)
 * - cross-checked first, then by number of websites
 */
export function validateWebTips(raw: RawTip[] | null | undefined, sources: TipSource[], max = 14): WebTip[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const cats = new Set<string>(TIP_CATEGORIES.map((c) => c.id));
  const seenText = new Set<string>();
  const out: WebTip[] = [];
  for (const t of raw ?? []) {
    const ids = [...new Set((Array.isArray(t?.sourceIds) ? t.sourceIds : []).map((x) => String(x).trim().toUpperCase()))].filter((id) => byId.has(id));
    if (!ids.length) continue;
    const cited = ids.map((id) => byId.get(id)!);
    // Keep sourced amounts (cleanNote would strip every price), then tidy the text.
    const text = keepVerifiedAmounts(String(t.text ?? "").replace(/\s+/g, " ").trim(), cited).slice(0, 400);
    if (text.length < 12 || !cleanNote(text.replace(AMOUNT_RE, "X"))) continue;
    const key = text.toLowerCase().slice(0, 60);
    if (seenText.has(key)) continue;
    seenText.add(key);
    const domains = [...new Set(cited.map((s) => s.domain))];
    out.push({
      category: (cats.has(t.category) ? t.category : "general") as TipCategory,
      text,
      sourceIds: ids,
      domains,
      crossChecked: domains.length >= 2,
    });
  }
  return out.sort((a, b) => Number(b.crossChecked) - Number(a.crossChecked) || b.domains.length - a.domains.length).slice(0, max);
}
