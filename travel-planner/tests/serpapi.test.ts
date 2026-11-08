import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { runWithContext } from "@/lib/request-context";
import { cacheKey, normalizeParams } from "@/lib/serpapi/cache-key";
import { countUncached, serpSearch } from "@/lib/serpapi/client";
import { updateSettings } from "@/lib/settings";
import { getUsageSummary } from "@/lib/usage";

const fixture = JSON.parse(readFileSync(path.join(__dirname, "../fixtures/serpapi/google_flights.json"), "utf8"));

/** Simulates SerpApi with a saved fixture (no real network). */
function mockSerpApi(body: unknown = fixture, status = 200) {
  const f = vi.fn(async (url: string) => {
    if (!String(url).startsWith("https://serpapi.com/")) throw new Error("unexpected url");
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

function liveMode() {
  process.env.DATA_MODE = "";
  process.env.SERPAPI_API_KEY = "test-key";
}

async function seedUsage(n: number) {
  const db = getDb();
  for (let i = 0; i < n; i++) await db.logUsage({ kind: "serpapi", engine: "google_maps" });
}

describe("cache keys", () => {
  it("normalizes params: drops empties and api_key, sorts, case-folds text and airport codes", () => {
    expect(normalizeParams({ q: "  Museums  in   PARIS ", api_key: "x", empty: "", n: undefined, departure_id: "iah, hou" })).toEqual({
      departure_id: "IAH,HOU",
      q: "museums in paris",
    });
  });
  it("produces the same key for equivalent params", async () => {
    expect(await cacheKey("google_maps", { q: "Paris", hl: "en" })).toBe(await cacheKey("google_maps", { hl: "en", q: " paris " }));
    expect(await cacheKey("google_maps", { q: "Paris" })).not.toBe(await cacheKey("google_hotels", { q: "Paris" }));
  });
});

describe("serpSearch", () => {
  it("serves fixtures in fixture mode without logging usage", async () => {
    const r = await serpSearch("google_flights", { departure_id: "IAH", arrival_id: "LIS" });
    expect(r.cached).toBe(false);
    expect((r.data as { best_flights: unknown[] }).best_flights.length).toBeGreaterThan(0);
    expect(await getDb().countUsageSince("serpapi", "1970-01-01")).toBe(0);
  });

  it("caches responses: the second identical call costs nothing", async () => {
    liveMode();
    const f = mockSerpApi();
    const a = await serpSearch("google_flights", { departure_id: "IAH", arrival_id: "LIS", outbound_date: "2026-11-12" });
    const b = await serpSearch("google_flights", { arrival_id: "lis", departure_id: "iah", outbound_date: "2026-11-12" });
    expect(a.cached).toBe(false);
    expect(b.cached).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    expect(await getDb().countUsageSince("serpapi", "1970-01-01")).toBe(1);
    // api_key never stored in the cache row
    const row = await getDb().cacheGet(a.cacheKey);
    expect(JSON.stringify(row)).not.toContain("test-key");
  });

  it("re-fetches after the TTL expires", async () => {
    liveMode();
    const f = mockSerpApi();
    await serpSearch("google_flights", { departure_id: "IAH" }, { ttlSeconds: -1 });
    await serpSearch("google_flights", { departure_id: "IAH" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent identical requests into one paid search", async () => {
    liveMode();
    const f = mockSerpApi();
    await Promise.all([serpSearch("youtube", { search_query: "lisbon" }), serpSearch("youtube", { search_query: "Lisbon" })]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("treats SerpApi's 'no results' error as an empty answer", async () => {
    liveMode();
    mockSerpApi({ error: "Google hasn't returned any results for this query." });
    const r = await serpSearch("google_events", { q: "events in nowhere" });
    expect((r.data as { _empty?: boolean })._empty).toBe(true);
  });

  it("surfaces other SerpApi errors", async () => {
    liveMode();
    mockSerpApi({ error: "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key" }, 401);
    await expect(serpSearch("google_maps", { q: "x" })).rejects.toMatchObject({ code: "SERPAPI_NOT_CONFIGURED" });
  });
});

describe("quota gate", () => {
  it("warns at 80% and hard-stops at 100%", async () => {
    liveMode();
    process.env.SERPAPI_MONTHLY_QUOTA = "10";
    await seedUsage(8);
    expect((await getUsageSummary()).serpapi.state).toBe("warn");
    await seedUsage(2);
    expect((await getUsageSummary()).serpapi.state).toBe("blocked");
    const f = mockSerpApi();
    await expect(serpSearch("google_maps", { q: "new query" })).rejects.toMatchObject({ code: "SERPAPI_QUOTA" });
    expect(f).not.toHaveBeenCalled();
  });

  it("still serves cached results when over quota", async () => {
    liveMode();
    process.env.SERPAPI_MONTHLY_QUOTA = "1";
    mockSerpApi();
    await serpSearch("google_maps", { q: "cached one" });
    const again = await serpSearch("google_maps", { q: "cached one" });
    expect(again.cached).toBe(true);
  });

  it("override requires per-request confirmation", async () => {
    liveMode();
    process.env.SERPAPI_MONTHLY_QUOTA = "1";
    await seedUsage(1);
    await updateSettings({ serpOverrideUntil: new Date(Date.now() + 86_400_000).toISOString() });
    const f = mockSerpApi();
    await expect(serpSearch("google_maps", { q: "over" })).rejects.toMatchObject({ code: "SERPAPI_QUOTA_CONFIRM" });
    const r = await runWithContext({ confirmOverQuota: true, confirmOverBudget: false }, () => serpSearch("google_maps", { q: "over" }));
    expect(r.cached).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("an expired override counts as off", async () => {
    liveMode();
    process.env.SERPAPI_MONTHLY_QUOTA = "1";
    await seedUsage(1);
    await updateSettings({ serpOverrideUntil: new Date(Date.now() - 1000).toISOString() });
    await expect(serpSearch("google_maps", { q: "x" })).rejects.toMatchObject({ code: "SERPAPI_QUOTA" });
  });

  it("counts uncached requests for cost previews", async () => {
    liveMode();
    mockSerpApi();
    await serpSearch("google_maps", { q: "a" });
    expect(await countUncached([{ engine: "google_maps", params: { q: "A" } }, { engine: "google_maps", params: { q: "b" } }])).toBe(1);
  });
});
