"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { fmtTimestamp, fmtUsd } from "@/lib/format";
import type { AppSettings } from "@/lib/settings-shared";
import type { UsageRow } from "@/lib/db/types";
import type { MeterState, UsageSummary } from "@/lib/usage";
import { CardSkeletons, ErrorState, InfoTip } from "@/components/ui";

interface UsageResp {
  summary: UsageSummary;
  recent: UsageRow[];
  dbKind: "supabase" | "memory";
}

function endOfMonthIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
}

function Meter({ title, m, valueLabel }: { title: string; m: MeterState; valueLabel: string }) {
  const pct = Math.min(1, m.pct);
  const color = m.state === "ok" ? "bg-ok" : m.state === "warn" ? "bg-warn" : "bg-danger";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-muted">{valueLabel}</span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(m.pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
        <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">
        {Math.round(m.pct * 100)}% used · warning at 80% · hard stop at 100%
        {m.state === "override" && " · override ON"}
      </p>
    </div>
  );
}

export default function SettingsPage() {
  const [usage, setUsage] = useState<UsageResp | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function load() {
    try {
      const [u, s] = await Promise.all([api<UsageResp>("/api/usage"), api<{ settings: AppSettings }>("/api/settings")]);
      setUsage(u);
      setSettings(s.settings);
    } catch (e) {
      setError(e as ApiError);
    }
  }
  useEffect(() => {
    Promise.all([api<UsageResp>("/api/usage"), api<{ settings: AppSettings }>("/api/settings")])
      .then(([u, s]) => {
        setUsage(u);
        setSettings(s.settings);
      })
      .catch((e) => setError(e as ApiError));
  }, []);

  async function save(patch: Partial<AppSettings>, msg = "Saved") {
    setSaving(true);
    try {
      const r = await api<{ settings: AppSettings }>("/api/settings", { method: "PUT", json: patch });
      setSettings(r.settings);
      setSavedMsg(msg);
      setTimeout(() => setSavedMsg(null), 2000);
      await load();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSaving(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      await api("/api/usage", { method: "POST" });
      await load();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSyncing(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    // Full reload on auth change so no stale client state survives.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  if (error && !usage) return <ErrorState message={error.message} code={error.code} />;
  if (!usage || !settings) return <CardSkeletons count={3} />;

  const { serpapi, claude } = usage.summary;
  const serpOverride = !!serpapi.overrideUntil;
  const claudeOverride = !!claude.overrideUntil;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-extrabold">Settings & usage</h1>
      {error && <ErrorState message={error.message} code={error.code} />}
      {usage.dbKind === "memory" && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn">
          Supabase isn&apos;t configured — using a temporary in-memory store. Usage and trips reset on restart.
        </p>
      )}

      <section className="card space-y-5 p-4">
        <Meter title="SerpApi searches this month" m={serpapi} valueLabel={`${serpapi.used} / ${serpapi.limit}`} />
        <p className="text-xs text-muted">
          Source: {serpapi.source === "serpapi-account" ? "SerpApi's own count + searches since last sync" : "this app's log (calendar month)"}
          {serpapi.account && ` · last synced ${fmtTimestamp(serpapi.account.fetchedAt)}`}
          {serpapi.account?.planName && ` · plan: ${serpapi.account.planName}`}
        </p>
        <button className="btn btn-ghost" onClick={sync} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync with SerpApi (free)"}
        </button>

        <Meter title="Claude API spend this month (estimate)" m={claude} valueLabel={`${fmtUsd(claude.spentUsd, true)} / ${fmtUsd(claude.budgetUsd)}`} />
        <p className="text-xs text-muted">
          Calculated from token counts on each response × published per-token pricing.
          <InfoTip>Sonnet 5.5: $2 per million input tokens, $10 per million output tokens; cache reads bill at 10% of input. Check the Claude Console for the authoritative bill.</InfoTip>
        </p>
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">Manual override</h2>
        <p className="text-sm text-muted">
          At 100% the app stops making new paid calls. Turning the override on allows calls until the end of this month — each one asks you to confirm first.
        </p>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>SerpApi override {serpOverride && <span className="text-danger">(on until {fmtTimestamp(serpapi.overrideUntil)})</span>}</span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={serpOverride}
            disabled={saving}
            onChange={(e) => save({ serpOverrideUntil: e.target.checked ? endOfMonthIso() : null })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Claude override {claudeOverride && <span className="text-danger">(on until {fmtTimestamp(claude.overrideUntil)})</span>}</span>
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={claudeOverride}
            disabled={saving}
            onChange={(e) => save({ claudeOverrideUntil: e.target.checked ? endOfMonthIso() : null })}
          />
        </label>
      </section>

      <SettingsForm key={JSON.stringify(settings)} settings={settings} onSave={(p) => save(p)} saving={saving} />
      {savedMsg && <p className="text-sm font-semibold text-ok">{savedMsg}</p>}

      <section className="card p-4">
        <h2 className="mb-2 font-bold">Recent paid calls</h2>
        {usage.recent.length === 0 ? (
          <p className="text-sm text-muted">None yet. Cache hits don&apos;t show here because they cost nothing.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {usage.recent.map((r, i) => (
              <li key={i} className="flex justify-between gap-2 py-1.5">
                <span className="truncate">
                  {r.kind === "serpapi" ? "SerpApi" : "Claude"} · {r.engine}
                  {r.note ? ` · ${r.note}` : ""}
                </span>
                <span className="shrink-0 text-muted">
                  {r.kind === "claude" ? fmtUsd(Number(r.cost_usd), true) + " · " : ""}
                  {fmtTimestamp(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="btn btn-ghost w-full" onClick={logout}>
        Sign out
      </button>
    </div>
  );
}

function SettingsForm({ settings, onSave, saving }: { settings: AppSettings; onSave: (p: Partial<AppSettings>) => void; saving: boolean }) {
  const [s, setS] = useState(settings);
  const n = (v: string) => (v === "" ? 0 : Number(v));
  return (
    <form
      className="card space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(s);
      }}
    >
      <h2 className="font-bold">Preferences</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="vt">Verified badge: min reviews (any one source)</label>
          <input id="vt" className="input" type="number" min={0} value={s.verifiedReviewThreshold} onChange={(e) => setS({ ...s, verifiedReviewThreshold: n(e.target.value) })} />
        </div>
        <div>
          <label className="label" htmlFor="vot">Value of your time ($/hour)</label>
          <input id="vot" className="input" type="number" min={0} value={s.valueOfTimeUsdPerHour} onChange={(e) => setS({ ...s, valueOfTimeUsdPerHour: n(e.target.value) })} />
        </div>
        <div>
          <label className="label" htmlFor="lt">Local transport estimate ($/day, whole group)</label>
          <input id="lt" className="input" type="number" min={0} value={s.localTransportUsdPerDay} onChange={(e) => setS({ ...s, localTransportUsdPerDay: n(e.target.value) })} />
        </div>
        <div>
          <label className="label" htmlFor="org">Default origin</label>
          <select id="org" className="input" value={s.defaultOrigin} onChange={(e) => setS({ ...s, defaultOrigin: e.target.value as "IAH" | "HOU" })}>
            <option value="IAH">IAH — Houston Bush</option>
            <option value="HOU">HOU — Houston Hobby</option>
          </select>
        </div>
      </div>
      <fieldset>
        <legend className="label">Food estimate per person per meal, by Google price level</legend>
        <div className="grid grid-cols-4 gap-2">
          {([1, 2, 3, 4] as const).map((lvl) => (
            <div key={lvl}>
              <span className="mb-1 block text-center text-xs font-semibold text-muted">{"$".repeat(lvl)}</span>
              <input
                aria-label={`${"$".repeat(lvl)} meal estimate`}
                className="input text-center"
                type="number"
                min={0}
                value={s.mealCostByPriceLevel[lvl]}
                onChange={(e) => setS({ ...s, mealCostByPriceLevel: { ...s.mealCostByPriceLevel, [lvl]: n(e.target.value) } })}
              />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">These are your assumptions, not sourced prices. They&apos;re always labeled &quot;estimate&quot; in plans.</p>
      </fieldset>
      <button className="btn" disabled={saving}>
        {saving ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}
