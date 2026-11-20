import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

// Currency conversion with European Central Bank reference rates (Frankfurter API, free, no key).
// Cached 24 hours. Fixture mode uses fixed rates so tests never touch the network.

const FIXTURE: Record<string, number> = { EUR: 1.08, GBP: 1.27, MXN: 0.055, CAD: 0.72, JPY: 0.0066 };

export interface Rate {
  rate: number;
  date: string;
}

/** USD per 1 unit of `currency`, or null if unknown. */
export async function usdRate(currency: string): Promise<Rate | null> {
  if (currency === "USD") return { rate: 1, date: new Date().toISOString().slice(0, 10) };
  if (env.fixtureMode) return FIXTURE[currency] ? { rate: FIXTURE[currency], date: "2026-11-01" } : null;
  const key = `fx:${currency}:USD`;
  const db = getDb();
  const hit = await db.cacheGet(key);
  if (hit && Date.parse(hit.expires_at) > Date.now()) return hit.response as Rate;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(currency)}&symbols=USD`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { date?: string; rates?: { USD?: number } };
    const rate = body.rates?.USD;
    if (typeof rate !== "number" || !(rate > 0)) return null;
    const out = { rate, date: body.date ?? new Date().toISOString().slice(0, 10) };
    await db.cachePut({ key, engine: "fx", params: { currency }, response: out, fetched_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    return out;
  } catch {
    return null;
  }
}
