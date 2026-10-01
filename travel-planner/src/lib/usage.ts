import "server-only";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getContext } from "@/lib/request-context";
import { getSettings } from "@/lib/settings";

export const WARN_AT = 0.8;

export interface SerpAccountSnapshot {
  /** SerpApi's own count for the current billing month. */
  thisMonthUsage: number;
  searchesPerMonth: number | null;
  planName: string | null;
  totalSearchesLeft: number | null;
  fetchedAt: string;
}

export interface MeterState {
  used: number;
  limit: number;
  pct: number;
  state: "ok" | "warn" | "blocked" | "override";
  overrideUntil: string | null;
}

export interface UsageSummary {
  serpapi: MeterState & { source: "serpapi-account" | "local-log"; account: SerpAccountSnapshot | null };
  claude: MeterState & { spentUsd: number; budgetUsd: number };
  periodStart: string;
}

const ACCOUNT_KEY = "serpapi_account_snapshot";
const SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function monthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function meter(used: number, limit: number, overrideUntil: string | null, now = Date.now()): MeterState {
  const pct = limit > 0 ? used / limit : 1;
  const overrideActive = !!overrideUntil && Date.parse(overrideUntil) > now;
  let state: MeterState["state"] = "ok";
  if (pct >= 1) state = overrideActive ? "override" : "blocked";
  else if (pct >= WARN_AT) state = "warn";
  return { used, limit, pct, state, overrideUntil: overrideActive ? overrideUntil : null };
}

/**
 * SerpApi searches used this month. Prefers SerpApi's own count (Account API snapshot, which
 * follows the real billing cycle) plus anything we've logged since the snapshot; falls back
 * to our calendar-month log when no fresh snapshot exists. Whichever is higher wins, so the
 * gate errs on the side of stopping early.
 */
export async function serpUsedThisMonth(): Promise<{ used: number; source: "serpapi-account" | "local-log"; account: SerpAccountSnapshot | null }> {
  const db = getDb();
  const local = await db.countUsageSince("serpapi", monthStartIso());
  const snap = await db.getSetting<SerpAccountSnapshot>(ACCOUNT_KEY);
  if (snap && Date.now() - Date.parse(snap.fetchedAt) < SNAPSHOT_MAX_AGE_MS) {
    const since = await db.countUsageSince("serpapi", snap.fetchedAt);
    const fromAccount = snap.thisMonthUsage + since;
    return fromAccount >= local
      ? { used: fromAccount, source: "serpapi-account", account: snap }
      : { used: local, source: "local-log", account: snap };
  }
  return { used: local, source: "local-log", account: snap };
}

export async function getUsageSummary(): Promise<UsageSummary> {
  const settings = await getSettings();
  const serp = await serpUsedThisMonth();
  const spent = await getDb().sumCostSince("claude", monthStartIso());
  const budget = env.claudeMonthlyBudgetUsd;
  return {
    serpapi: { ...meter(serp.used, env.serpApiMonthlyQuota, settings.serpOverrideUntil), source: serp.source, account: serp.account },
    claude: { ...meter(spent, budget, settings.claudeOverrideUntil), spentUsd: spent, budgetUsd: budget },
    periodStart: monthStartIso(),
  };
}

/** Throws unless a new SerpApi search is allowed right now. */
export async function assertSerpQuota(): Promise<void> {
  const settings = await getSettings();
  const { used } = await serpUsedThisMonth();
  const m = meter(used, env.serpApiMonthlyQuota, settings.serpOverrideUntil);
  if (m.state === "blocked") {
    throw new AppError(
      "SERPAPI_QUOTA",
      `SerpApi quota hit: ${used} of ${m.limit} searches used this month. Cached results still work. Turn on the override in Settings to continue.`,
      m,
    );
  }
  if (m.state === "override" && !getContext().confirmOverQuota) {
    throw new AppError(
      "SERPAPI_QUOTA_CONFIRM",
      `You're over your SerpApi quota (${used}/${m.limit}). This search may be billed as overage. Confirm to run it.`,
      m,
    );
  }
}

/** Throws unless a new Claude call is allowed right now. */
export async function assertClaudeBudget(): Promise<void> {
  const settings = await getSettings();
  const spent = await getDb().sumCostSince("claude", monthStartIso());
  const m = meter(spent, env.claudeMonthlyBudgetUsd, settings.claudeOverrideUntil);
  if (m.state === "blocked") {
    throw new AppError(
      "CLAUDE_BUDGET",
      `Claude budget hit: $${spent.toFixed(2)} of $${m.limit.toFixed(2)} this month. Turn on the override in Settings to continue.`,
      m,
    );
  }
  if (m.state === "override" && !getContext().confirmOverBudget) {
    throw new AppError("CLAUDE_BUDGET_CONFIRM", `You're over your Claude budget ($${spent.toFixed(2)}). Confirm to continue.`, m);
  }
}

/** Pull SerpApi's own usage numbers. The Account API is free and doesn't count toward quota. */
export async function syncSerpAccount(): Promise<SerpAccountSnapshot | null> {
  const key = env.serpApiKey;
  if (!key || env.fixtureMode) return null;
  const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`, { cache: "no-store" });
  if (!res.ok) throw new AppError("SERPAPI_ERROR", `SerpApi account lookup failed (${res.status}).`);
  const a = (await res.json()) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" ? v : v == null ? null : Number(v));
  const snap: SerpAccountSnapshot = {
    thisMonthUsage: n(a.this_month_usage) ?? 0,
    searchesPerMonth: n(a.searches_per_month),
    planName: typeof a.plan_name === "string" ? a.plan_name : null,
    totalSearchesLeft: n(a.total_searches_left),
    fetchedAt: new Date().toISOString(),
  };
  await getDb().setSetting(ACCOUNT_KEY, snap);
  return snap;
}
