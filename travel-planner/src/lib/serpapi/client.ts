import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertSerpQuota } from "@/lib/usage";
import { cacheKey, normalizeParams, type SerpParams } from "./cache-key";
import { loadFixture } from "./fixtures";
import { ttlFor } from "./ttl";

export interface SerpResult<T = Record<string, unknown>> {
  data: T;
  /** true when served from our Supabase cache (no quota used). */
  cached: boolean;
  fetchedAt: string;
  cacheKey: string;
}

export interface SerpOptions {
  /** Override the engine's default TTL (seconds). */
  ttlSeconds?: number;
  /** Ignore a cached copy and fetch fresh (still subject to the quota gate). */
  refresh?: boolean;
}

const inflight = new Map<string, Promise<SerpResult>>();

/**
 * The single entry point for every SerpApi request:
 * normalize -> cache lookup -> quota gate -> fetch -> cache write -> usage log.
 */
export async function serpSearch<T = Record<string, unknown>>(
  engine: string,
  params: SerpParams,
  opts: SerpOptions = {},
): Promise<SerpResult<T>> {
  const key = await cacheKey(engine, params);
  const db = getDb();

  if (!opts.refresh) {
    const hit = await db.cacheGet(key);
    if (hit && Date.parse(hit.expires_at) > Date.now()) {
      return { data: hit.response as T, cached: true, fetchedAt: hit.fetched_at, cacheKey: key };
    }
  }

  // Two identical requests at the same moment share one paid search.
  const pending = inflight.get(key);
  if (pending) return pending as Promise<SerpResult<T>>;

  const run = (async (): Promise<SerpResult> => {
    const normalized = normalizeParams(params);
    let data: Record<string, unknown>;

    if (env.fixtureMode) {
      data = (await loadFixture(engine, params)) as Record<string, unknown>;
    } else {
      const apiKey = env.serpApiKey;
      if (!apiKey) throw new AppError("SERPAPI_NOT_CONFIGURED", "SERPAPI_API_KEY is not set.");
      await assertSerpQuota();
      data = await fetchSerp(engine, normalized, apiKey);
      await db.logUsage({ kind: "serpapi", engine, cache_key: key, cost_usd: 0 });
    }

    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (opts.ttlSeconds ?? ttlFor(engine)) * 1000).toISOString();
    await db.cachePut({ key, engine, params: normalized, response: data, fetched_at: fetchedAt, expires_at: expiresAt });
    return { data, cached: false, fetchedAt, cacheKey: key };
  })();

  inflight.set(key, run);
  try {
    return (await run) as SerpResult<T>;
  } finally {
    inflight.delete(key);
  }
}

/** How many of these requests would cost a search right now (i.e. aren't fresh in cache). */
export async function countUncached(requests: { engine: string; params: SerpParams }[]): Promise<number> {
  if (env.fixtureMode) return 0;
  const db = getDb();
  const now = Date.now();
  let n = 0;
  for (const r of requests) {
    const hit = await db.cacheGet(await cacheKey(r.engine, r.params));
    if (!hit || Date.parse(hit.expires_at) <= now) n++;
  }
  return n;
}

// SerpApi reports "no results" as an `error` string with HTTP 200. That's a valid (empty) answer, not a failure.
const EMPTY_RESULT = /hasn't returned any results|no results/i;

async function fetchSerp(engine: string, params: Record<string, string>, apiKey: string): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ ...params, engine, api_key: apiKey, output: "json" });
  let res: Response;
  try {
    res = await fetch(`https://serpapi.com/search.json?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
  } catch (e) {
    throw new AppError("SERPAPI_ERROR", `Couldn't reach SerpApi (${(e as Error).name}). Try again.`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = typeof body.error === "string" ? body.error : null;

  if (res.status === 429 || (err && /run out of searches|plan.*limit|exceeded/i.test(err))) {
    throw new AppError("SERPAPI_QUOTA", `SerpApi quota hit: ${err ?? "rate limited"}`);
  }
  if (res.status === 401 || (err && /invalid api key/i.test(err))) {
    throw new AppError("SERPAPI_NOT_CONFIGURED", "SerpApi rejected the API key. Check SERPAPI_API_KEY.");
  }
  if (err && EMPTY_RESULT.test(err)) return { ...body, _empty: true };
  if (!res.ok || err) {
    throw new AppError("SERPAPI_ERROR", `SerpApi error (${res.status}): ${err ?? "unknown error"}`);
  }
  return body;
}
