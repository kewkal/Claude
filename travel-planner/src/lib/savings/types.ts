// Client-safe types for money-saving tips.

export type TipCategory = "flights" | "hotels" | "food" | "getting_around" | "general";

export const TIP_CATEGORIES: { id: TipCategory; label: string; icon: string }[] = [
  { id: "flights", label: "Flights", icon: "✈️" },
  { id: "hotels", label: "Hotels", icon: "🏨" },
  { id: "food", label: "Food", icon: "🍽️" },
  { id: "getting_around", label: "Getting around", icon: "🚌" },
  { id: "general", label: "General", icon: "💡" },
];

export type SourceKind = "reddit" | "forum" | "video" | "web";

export interface TipSource {
  id: string; // "S1"
  kind: SourceKind;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  date?: string;
}

/** A tip Claude wrote from fetched web sources. Cross-checked = 2+ different websites back it (computed server-side). */
export interface WebTip {
  category: TipCategory;
  text: string;
  sourceIds: string[];
  domains: string[];
  crossChecked: boolean;
}

/** A tip computed from this trip's fetched data (no AI). */
export interface DataTip {
  id: string;
  category: TipCategory;
  text: string;
  /** Estimated saving vs. the current plan, when it can be computed from fetched prices. */
  saveUsd: number | null;
  refs: string[];
}

export interface SavingsTips {
  web: WebTip[];
  sources: TipSource[];
  queries: string[];
  fetchedAt: string;
  /** Sources fetched but not cited by any kept tip are still listed for transparency. */
  removed: number;
}

export function sourceKind(domain: string): SourceKind {
  const d = domain.toLowerCase();
  if (d.endsWith("reddit.com")) return "reddit";
  if (d.includes("youtube.com") || d === "youtu.be") return "video";
  if (/flyertalk|tripadvisor\.[a-z.]+$|fodors|lonelyplanet|thorntree|boardingarea|forum|community|quora|stackexchange/.test(d)) return "forum";
  return "web";
}

export const KIND_ICON: Record<SourceKind, string> = { reddit: "🟠", forum: "💬", video: "▶️", web: "🌐" };
export const KIND_LABEL: Record<SourceKind, string> = { reddit: "Reddit", forum: "Forum", video: "YouTube", web: "Web" };
