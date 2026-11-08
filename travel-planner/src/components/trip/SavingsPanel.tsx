"use client";

import { useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { fmtTimestamp, fmtUsd } from "@/lib/format";
import type { TripRecord, VersionKey } from "@/lib/planner/types";
import { computeDataTips } from "@/lib/savings/data";
import { KIND_ICON, KIND_LABEL, TIP_CATEGORIES, type TipCategory } from "@/lib/savings/types";
import { ErrorState } from "@/components/ui";

export function SavingsPanel({ trip, version, readOnly, onTrip }: { trip: TripRecord; version: VersionKey; readOnly: boolean; onTrip: (t: TripRecord) => void }) {
  const [cat, setCat] = useState<TipCategory | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showSources, setShowSources] = useState(false);

  const dataTips = useMemo(() => computeDataTips(trip.dataset, trip.plan.versions[version], trip.inputs), [trip, version]);
  const savings = trip.plan.savings;
  const byId = new Map((savings?.sources ?? []).map((s) => [s.id, s]));
  const show = (c: TipCategory) => cat === "all" || cat === c;
  const visibleData = dataTips.filter((t) => show(t.category));
  const visibleWeb = (savings?.web ?? []).filter((t) => show(t.category));
  const crossChecked = (savings?.web ?? []).filter((t) => t.crossChecked).length;
  const icon = (c: TipCategory) => TIP_CATEGORIES.find((x) => x.id === c)?.icon ?? "💡";

  async function fetchTips() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ trip: TripRecord }>(`/api/trips/${trip.id}/savings`, { method: "POST" });
      onTrip(r.trip);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3" aria-label="Ways to save">
      <div>
        <h2 className="section-title">Ways to save</h2>
        <p className="text-sm text-muted">From your trip&apos;s own prices, plus tips from Reddit, travel forums, blogs, and YouTube, checked against each other.</p>
      </div>

      <div className="scroll-x -mx-4 flex gap-2 px-4" role="tablist" aria-label="Tip categories">
        {[{ id: "all" as const, label: "All", icon: "" }, ...TIP_CATEGORIES].map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={cat === c.id}
            onClick={() => setCat(c.id)}
            className={`chip shrink-0 px-3.5 py-2 text-sm ${cat === c.id ? "bg-text text-bg" : "bg-surface-2 text-text"}`}
          >
            {c.icon} {c.label}
          </button>
        ))}
      </div>

      {visibleData.length > 0 && (
        <div className="card divide-y divide-border">
          <p className="eyebrow px-4 pb-2 pt-3">From your trip data</p>
          {visibleData.map((t) => (
            <div key={t.id} className="flex gap-3 px-4 py-3">
              <span className="text-lg leading-6" aria-hidden>
                {icon(t.category)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.95rem] leading-relaxed">{t.text}</p>
                {t.saveUsd !== null && t.saveUsd > 0 && <p className="mt-1 text-sm font-semibold text-ok">Save about {fmtUsd(t.saveUsd)}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <ErrorState message={error.message} code={error.code} />}

      {savings ? (
        <div className="card divide-y divide-border">
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
            <p className="eyebrow">From travelers & the web</p>
            <p className="text-xs text-muted">
              {crossChecked} of {savings.web.length} cross-checked
            </p>
          </div>
          {visibleWeb.length === 0 && <p className="px-4 py-3 text-sm text-muted">No tips in this category from the sources found.</p>}
          {visibleWeb.map((t, i) => (
            <div key={i} className="flex gap-3 px-4 py-3">
              <span className="text-lg leading-6" aria-hidden>
                {icon(t.category)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[0.95rem] leading-relaxed">{t.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {t.crossChecked ? (
                    <span className="chip bg-ok-soft text-ok">✓ Cross-checked · {t.domains.length} sites</span>
                  ) : (
                    <span className="chip bg-warn-soft text-warn">Single source</span>
                  )}
                  {t.sourceIds.map((id) => {
                    const s = byId.get(id);
                    if (!s) return null;
                    return (
                      <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" className="chip bg-surface-2 text-text" title={s.title}>
                        {KIND_ICON[s.kind]} {s.kind === "web" || s.kind === "forum" ? s.domain : KIND_LABEL[s.kind]}
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          <div className="px-4 py-3 text-xs text-muted">
            Tips written by AI from the linked sources only. &quot;Cross-checked&quot; means 2+ different websites say it; prices are kept only when a cited source states them. Fetched {fmtTimestamp(savings.fetchedAt)}.{" "}
            <button type="button" className="font-semibold text-accent" onClick={() => setShowSources((s) => !s)}>
              {showSources ? "Hide" : "Show"} all {savings.sources.length} sources
            </button>
            {showSources && (
              <ul className="mt-2 space-y-1">
                {savings.sources.map((s) => (
                  <li key={s.id}>
                    {KIND_ICON[s.kind]}{" "}
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent">
                      {s.title}
                    </a>{" "}
                    · {s.domain}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        !readOnly && (
          <button type="button" className="btn btn-ghost w-full py-3" onClick={fetchTips} disabled={busy}>
            {busy ? "Reading Reddit, forums & YouTube…" : "🔎 Find tips from Reddit, forums & YouTube"}
          </button>
        )
      )}
      {!savings && !readOnly && <p className="text-center text-xs text-muted">About 3 searches + 1 Claude call. Saved with the trip; searches are cached for 30 days.</p>}
      {savings && !readOnly && (
        <button type="button" className="w-full text-center text-xs font-semibold text-accent" onClick={fetchTips} disabled={busy}>
          {busy ? "Refreshing…" : "Refresh tips"}
        </button>
      )}
    </section>
  );
}
