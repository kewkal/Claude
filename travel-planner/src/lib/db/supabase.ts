import { AppError } from "@/lib/errors";
import type { CacheRow, Db, TripRow, TripSummary, UsageRow } from "./types";

/** Turn a Supabase failure into a message that says what to fix. Never includes the key. */
export function explainSupabaseError(status: number, body: string, what: string): AppError {
  const detail = body.slice(0, 200);
  if (status === 401 || status === 403 || /invalid api key|jwt|apikey/i.test(body)) {
    return new AppError("DB_ERROR", `Database rejected the key (${status}). Check SUPABASE_SECRET_KEY is the secret key (sb_secret_...), not the publishable/anon key. ${detail}`);
  }
  if (status === 404 || /relation .* does not exist|could not find the table|PGRST205/i.test(body)) {
    return new AppError("DB_ERROR", `Database table missing (${status}) during ${what}. Run supabase/schema.sql in the Supabase SQL Editor. ${detail}`);
  }
  if (/permission denied/i.test(body)) {
    return new AppError("DB_ERROR", `Database permission denied during ${what}: the key isn't the secret/service key, or table grants are missing. ${detail}`);
  }
  return new AppError("DB_ERROR", `Database error ${status} during ${what}: ${detail}`);
}

// Talks to Supabase's PostgREST endpoint directly with fetch — no client library needed.
export function createSupabaseDb(baseUrl: string, secretKey: string): Db {
  const rest = `${baseUrl.replace(/\/$/, "")}/rest/v1`;
  const headers: Record<string, string> = {
    apikey: secretKey,
    "Content-Type": "application/json",
  };
  // Legacy service_role keys are JWTs and also go in Authorization.
  // New sb_secret_ keys are not JWTs and must only be sent as `apikey`.
  if (secretKey.startsWith("eyJ")) headers.Authorization = `Bearer ${secretKey}`;

  async function call<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const h: Record<string, string> = { ...headers };
    if (init.prefer) h.Prefer = init.prefer;
    const what = `${init.method ?? "GET"} ${path.split("?")[0]}`;
    let res: Response;
    try {
      res = await fetch(`${rest}${path}`, { ...init, headers: h, cache: "no-store" });
    } catch (e) {
      throw new AppError("DB_ERROR", `Couldn't reach the database at ${baseUrl} (${(e as Error).message}). Check SUPABASE_URL, and that the Supabase project isn't paused.`);
    }
    if (!res.ok) throw explainSupabaseError(res.status, await res.text().catch(() => ""), what);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  const enc = encodeURIComponent;

  return {
    kind: "supabase",
    async cacheGet(key) {
      const rows = await call<CacheRow[]>(`/api_cache?key=eq.${enc(key)}&select=*`);
      return rows[0] ?? null;
    },
    async cachePut(row) {
      await call(`/api_cache?on_conflict=key`, {
        method: "POST",
        body: JSON.stringify(row),
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    },
    async logUsage(row) {
      await call(`/usage_log`, { method: "POST", body: JSON.stringify(row), prefer: "return=minimal" });
    },
    async countUsageSince(kind, sinceIso) {
      const res = await fetch(`${rest}/usage_log?kind=eq.${kind}&created_at=gte.${enc(sinceIso)}&select=id`, {
        method: "HEAD",
        headers: { ...headers, Prefer: "count=exact" },
        cache: "no-store",
      });
      if (!res.ok) throw explainSupabaseError(res.status, await res.text().catch(() => ""), "usage count");
      const range = res.headers.get("content-range") ?? "*/0";
      return Number(range.split("/")[1]) || 0;
    },
    async sumCostSince(kind, sinceIso) {
      const rows = await call<{ cost_usd: number | string }[]>(
        `/usage_log?kind=eq.${kind}&created_at=gte.${enc(sinceIso)}&select=cost_usd`,
      );
      return rows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    },
    async recentUsage(limit) {
      return call<UsageRow[]>(`/usage_log?select=*&order=created_at.desc&limit=${limit}`);
    },
    async getSetting<T>(key: string) {
      const rows = await call<{ value: T }[]>(`/settings?key=eq.${enc(key)}&select=value`);
      return rows[0]?.value ?? null;
    },
    async setSetting(key, value) {
      await call(`/settings?on_conflict=key`, {
        method: "POST",
        body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
        prefer: "resolution=merge-duplicates,return=minimal",
      });
    },
    async listTrips() {
      return call<TripSummary[]>(`/trips?select=id,name,inputs,share_token,created_at,updated_at&order=updated_at.desc`);
    },
    async getTrip(id) {
      const rows = await call<TripRow[]>(`/trips?id=eq.${enc(id)}&select=*`);
      return rows[0] ?? null;
    },
    async getTripByShareToken(token) {
      const rows = await call<TripRow[]>(`/trips?share_token=eq.${enc(token)}&select=*`);
      return rows[0] ?? null;
    },
    async insertTrip(row) {
      const rows = await call<TripRow[]>(`/trips`, {
        method: "POST",
        body: JSON.stringify(row),
        prefer: "return=representation",
      });
      return rows[0];
    },
    async updateTrip(id, patch) {
      const rows = await call<TripRow[]>(`/trips?id=eq.${enc(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
        prefer: "return=representation",
      });
      return rows[0] ?? null;
    },
    async deleteTrip(id) {
      await call(`/trips?id=eq.${enc(id)}`, { method: "DELETE", prefer: "return=minimal" });
    },
    async ping() {
      await call(`/settings?select=key&limit=1`);
      // Best-effort cache housekeeping; ignore if the function wasn't created.
      await call(`/rpc/purge_expired_cache`, { method: "POST", body: "{}" }).catch(() => undefined);
    },
  };
}
