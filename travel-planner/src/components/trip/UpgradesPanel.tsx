"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { fmtTimestamp, fmtUsd } from "@/lib/format";
import { VERSION_LABEL, type TripRecord, type Upgrade, type VersionKey } from "@/lib/planner/types";
import { RANK_FORMULA } from "@/lib/upgrades/engine";
import { Badge, ErrorState, InfoTip } from "@/components/ui";

const GROUP_LABEL: Record<Upgrade["group"], string> = { comfort: "Comfort", experience: "Experience", logistics: "Logistics" };

function Delta({ usd }: { usd: number | null }) {
  if (usd === null) return <span className="text-muted">cost unknown</span>;
  if (usd === 0) return <span className="text-ok">no extra cost</span>;
  return usd > 0 ? <span className="text-danger">+{fmtUsd(usd)}</span> : <span className="text-ok">saves {fmtUsd(-usd)}</span>;
}

export function UpgradesPanel({ trip, version, onTrip }: { trip: TripRecord; version: VersionKey; onTrip: (t: TripRecord) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const set = trip.upgrades?.version === version ? trip.upgrades : null;

  async function generate(ai: boolean) {
    setBusy(ai ? "ai" : "rules");
    setError(null);
    try {
      const r = await api<{ trip: TripRecord }>(`/api/trips/${trip.id}/upgrades`, { method: "POST", json: { version, ai } });
      onTrip(r.trip);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  async function apply(u: Upgrade) {
    if (!u.action) return;
    setBusy(u.id);
    setError(null);
    try {
      const r = await api<{ trip: TripRecord }>(`/api/trips/${trip.id}`, { method: "PATCH", json: { ...u.action, version } });
      // Applying changes the plan, so the old list may be stale; regenerate the free rule-based part.
      const r2 = await api<{ trip: TripRecord }>(`/api/trips/${trip.id}/upgrades`, { method: "POST", json: { version, ai: false } }).catch(() => r);
      onTrip(r2.trip);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="no-print space-y-3" aria-label="Trip upgrades">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">
          Make it better
          <InfoTip label="How upgrades are ranked">{RANK_FORMULA}</InfoTip>
        </h2>
        {set && <span className="text-xs text-muted">{fmtTimestamp(set.generatedAt)}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost flex-1" onClick={() => generate(false)} disabled={!!busy}>
          {busy === "rules" ? "Checking…" : set ? "Refresh (free)" : `Find upgrades for ${VERSION_LABEL[version]} (free)`}
        </button>
        <button type="button" className="btn btn-ghost flex-1" onClick={() => generate(true)} disabled={!!busy}>
          {busy === "ai" ? "Asking Claude…" : "+ Claude ideas (1 call)"}
        </button>
      </div>
      {error && <ErrorState message={error.message} code={error.code} />}
      {set && set.items.length === 0 && <p className="text-sm text-muted">No upgrades found — this plan already uses the best fetched options.</p>}
      {set?.items.map((u, i) => (
        <article key={u.id} className={`card p-3 ${u.ai ? "border-l-4 border-l-ai" : ""}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-muted">#{i + 1}</span>
                <Badge tone="accent">{GROUP_LABEL[u.group]}</Badge>
                {u.ai && <Badge tone="ai">AI suggestion</Badge>}
                {u.basis === "general" ? <Badge tone="warn">General advice</Badge> : <Badge tone="ok">From fetched data</Badge>}
              </div>
              <h3 className="font-semibold leading-tight">{u.title}</h3>
            </div>
            <div className="shrink-0 text-right text-sm font-semibold">
              <Delta usd={u.costDeltaUsd} />
              <span className="block text-[0.7rem] font-normal text-muted">benefit {u.impact}/5</span>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">{u.why}</p>
          {u.metric && <p className="mt-1 text-xs font-semibold">{u.metric}</p>}
          {u.action && (
            <button type="button" className="btn mt-2 w-full" onClick={() => apply(u)} disabled={!!busy}>
              {busy === u.id ? "Applying…" : "Apply to this version"}
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
