export interface CacheRow {
  key: string;
  engine: string;
  params: Record<string, unknown>;
  response: unknown;
  fetched_at: string;
  expires_at: string;
}

export interface UsageRow {
  kind: "serpapi" | "claude";
  engine: string;
  cache_key?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number;
  note?: string | null;
  created_at?: string;
}

export interface TripRow {
  id: string;
  name: string;
  inputs: unknown;
  dataset: unknown;
  plan: unknown;
  upgrades: unknown | null;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

export type TripSummary = Pick<TripRow, "id" | "name" | "inputs" | "share_token" | "created_at" | "updated_at">;

export interface Db {
  readonly kind: "supabase" | "memory";
  cacheGet(key: string): Promise<CacheRow | null>;
  cachePut(row: CacheRow): Promise<void>;
  logUsage(row: UsageRow): Promise<void>;
  countUsageSince(kind: UsageRow["kind"], sinceIso: string): Promise<number>;
  sumCostSince(kind: UsageRow["kind"], sinceIso: string): Promise<number>;
  recentUsage(limit: number): Promise<UsageRow[]>;
  getSetting<T>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;
  listTrips(): Promise<TripSummary[]>;
  getTrip(id: string): Promise<TripRow | null>;
  getTripByShareToken(token: string): Promise<TripRow | null>;
  insertTrip(row: Omit<TripRow, "id" | "created_at" | "updated_at"> & { id?: string }): Promise<TripRow>;
  updateTrip(id: string, patch: Partial<Omit<TripRow, "id" | "created_at">>): Promise<TripRow | null>;
  deleteTrip(id: string): Promise<void>;
  ping(): Promise<void>;
}
