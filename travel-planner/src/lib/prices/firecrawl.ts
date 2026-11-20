import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { monthStartIso } from "@/lib/usage";

// Reads one public web page (e.g. an attraction's official site) through Firecrawl, as markdown.
// Cached 7 days in the same cache table as SerpApi. A monthly page cap keeps it inside the free tier.

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const USAGE_KEY = "firecrawl_usage";

export interface PageRead {
  url: string;
  markdown: string;
  fetchedAt: string;
  cached: boolean;
}

export function firecrawlConfigured(): boolean {
  return env.fixtureMode || !!env.firecrawlApiKey;
}

export async function firecrawlPagesThisMonth(): Promise<{ used: number; limit: number }> {
  const u = await getDb().getSetting<{ month: string; pages: number }>(USAGE_KEY);
  return { used: u && u.month === monthStartIso() ? u.pages : 0, limit: env.firecrawlMonthlyPages };
}

async function countPage() {
  const { used } = await firecrawlPagesThisMonth();
  await getDb().setSetting(USAGE_KEY, { month: monthStartIso(), pages: used + 1 });
}

/** Returns null (never throws) when the page can't be read: no key, monthly cap, blocked, or empty. */
export async function readPage(url: string): Promise<{ page: PageRead | null; reason?: string }> {
  const key = `firecrawl:${url}`;
  const db = getDb();
  const hit = await db.cacheGet(key);
  if (hit && Date.parse(hit.expires_at) > Date.now()) {
    const r = hit.response as { markdown: string };
    return { page: { url, markdown: r.markdown, fetchedAt: hit.fetched_at, cached: true } };
  }

  let markdown: string;
  if (env.fixtureMode) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    try {
      markdown = (JSON.parse(await readFile(path.join(process.cwd(), "fixtures", "firecrawl", `${host}.json`), "utf8")) as { data: { markdown: string } }).data.markdown;
    } catch {
      return { page: null, reason: "couldn't read the website" };
    }
  } else {
    const apiKey = env.firecrawlApiKey;
    if (!apiKey) return { page: null, reason: "FIRECRAWL_API_KEY isn't set" };
    const { used, limit } = await firecrawlPagesThisMonth();
    if (used >= limit) return { page: null, reason: `monthly page limit reached (${limit})` };
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 30000, maxAge: 7 * 24 * 60 * 60 * 1000 }),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      });
      await countPage();
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: { markdown?: string }; error?: string };
      if (!res.ok || !body.success) return { page: null, reason: res.status === 402 ? "Firecrawl is out of credits" : "the website blocked the read" };
      markdown = body.data?.markdown ?? "";
    } catch {
      return { page: null, reason: "the website didn't respond" };
    }
  }
  if (!markdown.trim()) return { page: null, reason: "the page was empty" };

  const fetchedAt = new Date().toISOString();
  await db.cachePut({ key, engine: "firecrawl", params: { url }, response: { markdown }, fetched_at: fetchedAt, expires_at: new Date(Date.now() + TTL_MS).toISOString() });
  return { page: { url, markdown, fetchedAt, cached: false } };
}
