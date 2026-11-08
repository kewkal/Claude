export type SerpParams = Record<string, string | number | boolean | null | undefined>;

// Params whose values are case-insensitive free text — normalized so "Paris " and "paris" share a cache row.
const TEXT_KEYS = new Set(["q", "search_query"]);
// Airport codes are case-insensitive too.
const CODE_KEYS = new Set(["departure_id", "arrival_id"]);

/** Drop empties, trim/collapse text, sort keys. Never includes api_key. */
export function normalizeParams(params: SerpParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(params).sort()) {
    if (k === "api_key") continue;
    const raw = params[k];
    if (raw === undefined || raw === null || raw === "") continue;
    let v = String(raw).trim().replace(/\s+/g, " ");
    if (TEXT_KEYS.has(k)) v = v.toLowerCase();
    if (CODE_KEYS.has(k)) v = v.toUpperCase().replace(/\s*,\s*/g, ",");
    if (v === "") continue;
    out[k] = v;
  }
  return out;
}

export async function cacheKey(engine: string, params: SerpParams): Promise<string> {
  const payload = JSON.stringify({ engine, ...normalizeParams(params) });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
