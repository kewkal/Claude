import type { CacheRow, Db, TripRow, UsageRow } from "./types";

// In-process store used by tests and by local dev when Supabase isn't configured.
// Data is lost on restart — never used in production (see db/index.ts).
export function createMemoryDb(): Db {
  const cache = new Map<string, CacheRow>();
  const usage: Required<UsageRow>[] = [];
  const settings = new Map<string, unknown>();
  const trips = new Map<string, TripRow>();

  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

  return {
    kind: "memory",
    async cacheGet(key) {
      return clone(cache.get(key) ?? null);
    },
    async cachePut(row) {
      cache.set(row.key, clone(row));
    },
    async logUsage(row) {
      usage.push({
        kind: row.kind,
        engine: row.engine,
        cache_key: row.cache_key ?? null,
        input_tokens: row.input_tokens ?? null,
        output_tokens: row.output_tokens ?? null,
        cost_usd: row.cost_usd ?? 0,
        note: row.note ?? null,
        created_at: row.created_at ?? new Date().toISOString(),
      });
    },
    async countUsageSince(kind, sinceIso) {
      return usage.filter((u) => u.kind === kind && u.created_at >= sinceIso).length;
    },
    async sumCostSince(kind, sinceIso) {
      return usage
        .filter((u) => u.kind === kind && u.created_at >= sinceIso)
        .reduce((s, u) => s + Number(u.cost_usd || 0), 0);
    },
    async recentUsage(limit) {
      return clone(usage.slice(-limit).reverse());
    },
    async getSetting<T>(key: string) {
      return clone((settings.get(key) as T) ?? null);
    },
    async setSetting(key, value) {
      settings.set(key, clone(value));
    },
    async listTrips() {
      return [...trips.values()]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(({ id, name, inputs, share_token, created_at, updated_at }) =>
          clone({ id, name, inputs, share_token, created_at, updated_at }),
        );
    },
    async getTrip(id) {
      return clone(trips.get(id) ?? null);
    },
    async getTripByShareToken(token) {
      return clone([...trips.values()].find((t) => t.share_token === token) ?? null);
    },
    async insertTrip(row) {
      const now = new Date().toISOString();
      const t: TripRow = { ...clone(row), id: row.id ?? crypto.randomUUID(), created_at: now, updated_at: now };
      trips.set(t.id, t);
      return clone(t);
    },
    async updateTrip(id, patch) {
      const t = trips.get(id);
      if (!t) return null;
      const next = { ...t, ...clone(patch), updated_at: new Date().toISOString() };
      trips.set(id, next);
      return clone(next);
    },
    async deleteTrip(id) {
      trips.delete(id);
    },
    async ping() {},
  };
}
