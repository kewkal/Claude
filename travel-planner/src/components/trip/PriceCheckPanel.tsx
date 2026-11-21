"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { fmtDate, fmtTimestamp, fmtUsd } from "@/lib/format";
import { refsInDays } from "@/lib/planner/validate";
import type { TripRecord, VersionKey } from "@/lib/planner/types";
import { SOURCE_NAME, type FoundPrice, type PriceCheckPlan } from "@/lib/prices/types";
import { KIND_ICON, KIND_LABEL } from "@/lib/savings/types";
import { ErrorState } from "@/components/ui";

function FxNote({ fx }: { fx: NonNullable<FoundPrice["fx"]> }) {
  return (
    <span>
      {fx.currency} {fx.amount} × {fx.rate.toFixed(4)} (ECB rate, {fmtDate(fx.date)})
    </span>
  );
}

/** "Get real prices": hotel prices by booking site, ticket prices, and what Reddit/Tripadvisor forums recommend. */
export interface FilledSummary {
  before: number;
  after: number;
  hotels: number;
  activities: number;
}

/** One-line summary of what a price check filled in (shown at the top of the trip after a run). */
export function FilledBanner({ f, onClose }: { f: FilledSummary; onClose: () => void }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-ok/30 bg-ok-soft p-4 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ok">✓ Real prices filled in across your plan</p>
        <p className="mt-1">
          {f.hotels > 0 && `Hotel${f.hotels > 1 ? "s" : ""} compared across booking sites`}
          {f.hotels > 0 && f.activities > 0 && " · "}
          {f.activities > 0 && `${f.activities} activit${f.activities > 1 ? "ies" : "y"} priced (green chips in each day)`}
          {f.hotels + f.activities === 0 && "No new prices were found"}. Total {fmtUsd(f.before)} → <span className="font-semibold">{fmtUsd(f.after)}</span>.
        </p>
      </div>
      <button type="button" className="text-muted" aria-label="Dismiss" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

export function PriceCheckPanel({ trip, version, readOnly, onTrip, onFilled }: { trip: TripRecord; version: VersionKey; readOnly: boolean; onTrip: (t: TripRecord) => void; onFilled?: (f: FilledSummary) => void }) {
  const pc = trip.dataset.priceCheck;
  const [plan, setPlan] = useState<PriceCheckPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  useEffect(() => {
    if (readOnly) return;
    let live = true;
    api<{ plan: PriceCheckPlan }>(`/api/trips/${trip.id}/prices`)
      .then((r) => live && setPlan(r.plan))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [trip.id, readOnly, pc?.fetchedAt]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const before = trip.plan.versions[version].costs.total;
      const r = await api<{ trip: TripRecord }>(`/api/trips/${trip.id}/prices`, { method: "POST" });
      const next = r.trip.dataset.priceCheck;
      const summary: FilledSummary = {
        before,
        after: r.trip.plan.versions[version].costs.total,
        hotels: next?.hotels.filter((h) => h.offers.length).length ?? 0,
        activities: next?.activities.length ?? 0,
      };
      onFilled?.(summary);
      onTrip(r.trip);
      // Show the user where the prices landed: the top of the trip, with the updated totals.
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const inPlan = new Set(refsInDays(trip.plan.versions[version].days));
  const byId = new Map((pc?.sources ?? []).map((s) => [s.id, s]));
  const cost =
    plan &&
    [
      `${plan.searches} search${plan.searches === 1 ? "" : "es"}`,
      plan.pages ? `${plan.pages} page read${plan.pages === 1 ? "" : "s"}` : null,
      "2 small Claude calls",
    ]
      .filter(Boolean)
      .join(" + ");

  return (
    <section id="real-prices" className="scroll-mt-28 space-y-3" aria-label="Real prices">
      <div>
        <h2 className="section-title">Real prices</h2>
        <p className="text-sm text-muted">Hotel prices across booking sites, ticket prices from Tripadvisor and official websites, and the places Reddit and Tripadvisor forums recommend for your trip styles.</p>
      </div>

      {error && <ErrorState message={error.message} code={error.code} />}


      {!pc && !readOnly && (
        <div className="card space-y-3 p-4">
          {plan ? (
            <ul className="space-y-1 text-sm">
              {plan.hotels.length > 0 && <li>🏨 Compare {plan.hotels.length} hotel{plan.hotels.length > 1 ? "s" : ""} across Booking.com, Expedia, official sites…</li>}
              {plan.tripadvisor.length > 0 && <li>🎟️ Ticket prices from Tripadvisor for {plan.tripadvisor.length} activit{plan.tripadvisor.length > 1 ? "ies" : "y"}</li>}
              {plan.websites.length > 0 && <li>🌐 Read {plan.websites.length} official website{plan.websites.length > 1 ? "s" : ""} for admission prices</li>}
              {plan.convert.length > 0 && <li>💱 Convert {plan.convert.length} price{plan.convert.length > 1 ? "s" : ""} listed in another currency</li>}
              <li>🗣️ What Reddit & Tripadvisor forums recommend for {trip.inputs.styles.join(", ") || "your trip"}</li>
              {!plan.firecrawlConfigured && <li className="text-muted">Add FIRECRAWL_API_KEY in Vercel to also read official websites.</li>}
            </ul>
          ) : (
            <p className="text-sm text-muted">Checking what can be priced…</p>
          )}
          <button type="button" className="btn w-full" onClick={run} disabled={busy}>
            {busy ? "Checking prices… (up to a minute)" : "💲 Get real prices"}
          </button>
          {cost && <p className="text-center text-xs text-muted">Uses about {cost}. Results are saved with the trip.</p>}
        </div>
      )}

      {pc && (
        <>
          {pc.hotels.some((h) => h.offers.length) && (
            <div className="card divide-y divide-border">
              <p className="eyebrow px-4 pb-2 pt-3">Hotels · whole stay, 1 room</p>
              {pc.hotels
                .filter((h) => h.offers.length)
                .map((h) => {
                  const best = h.offers[0];
                  const save = best.totalUsd !== null && h.headlineTotalUsd !== null ? h.headlineTotalUsd - best.totalUsd : 0;
                  return (
                    <div key={h.ref} className="px-4 py-3">
                      <p className="font-semibold">{h.name}</p>
                      {save > 0 && <p className="mt-0.5 text-sm font-semibold text-ok">Save {fmtUsd(save)} booking on {best.seller}</p>}
                      <ul className="mt-2 space-y-1.5">
                        {h.offers.slice(0, 5).map((o, i) => (
                          <li key={o.seller} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0">
                              {i === 0 && <span className="chip mr-1.5 bg-ok-soft text-ok">Cheapest</span>}
                              {o.link ? (
                                <a href={o.link} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
                                  {o.seller} ↗
                                </a>
                              ) : (
                                o.seller
                              )}
                              {o.official && <span className="ml-1 text-xs text-muted">official</span>}
                              {o.freeCancellation && <span className="ml-1 text-xs text-ok">free cancellation</span>}
                            </span>
                            <span className="shrink-0 font-semibold tabular-nums">{o.totalUsd !== null ? fmtUsd(o.totalUsd) : `${fmtUsd(o.perNightUsd)}/night`}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
            </div>
          )}

          {pc.activities.length > 0 && (
            <div className="card divide-y divide-border">
              <p className="eyebrow px-4 pb-2 pt-3">Activity prices found · per person</p>
              {pc.activities.map((a) => (
                <div key={a.ref} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-semibold leading-snug">{a.name}</p>
                    <span className="shrink-0 font-semibold tabular-nums">{a.usd === 0 ? "Free" : fmtUsd(a.usd, true)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
                        {SOURCE_NAME[a.source]} ↗
                      </a>
                    ) : (
                      SOURCE_NAME[a.source]
                    )}{" "}
                    shows {a.display}
                    {a.fx && (
                      <>
                        {" · "}
                        <FxNote fx={a.fx} />
                      </>
                    )}
                    {!inPlan.has(a.ref) && " · not in this version"}
                  </p>
                  {a.quote && <p className="mt-1 text-xs italic text-muted">&ldquo;{a.quote}&rdquo;</p>}
                </div>
              ))}
            </div>
          )}

          {pc.notFound.length > 0 && (
            <div className="card px-4 py-3 text-sm">
              <button type="button" className="font-semibold text-accent" onClick={() => setShowMissing((s) => !s)}>
                {showMissing ? "Hide" : "Show"} {pc.notFound.length} item{pc.notFound.length > 1 ? "s" : ""} still without a price
              </button>
              {showMissing && (
                <ul className="mt-2 space-y-1 text-muted">
                  {pc.notFound.map((n) => (
                    <li key={n.ref}>
                      <span className="text-text">{n.name}</span>: {n.reason}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted">Tap any &quot;Price not listed&quot; chip in the itinerary to enter a price you found yourself.</p>
            </div>
          )}

          {pc.picks.length > 0 && (
            <div className="card divide-y divide-border">
              <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
                <p className="eyebrow">Reddit & travelers recommend</p>
                <p className="text-xs text-muted">{pc.picks.filter((p) => p.crossChecked).length} cross-checked</p>
              </div>
              {pc.picks.map((p) => (
                <div key={p.name} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="mr-1 font-semibold">{p.name}</p>
                    {p.ref && inPlan.has(p.ref) ? (
                      <span className="chip bg-accent-soft text-accent">✓ In your plan</span>
                    ) : p.ref ? (
                      <span className="chip bg-surface-2 text-text">In trip data · not planned</span>
                    ) : (
                      <span className="chip bg-surface-2 text-muted">Not in fetched data</span>
                    )}
                  </div>
                  {p.why && (
                    <p className="mt-1 text-[0.9rem] leading-relaxed text-ai">
                      <span className="mr-1 rounded bg-ai-soft px-1 py-px text-xs font-bold uppercase tracking-wide">AI</span>
                      {p.why}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {p.crossChecked ? <span className="chip bg-ok-soft text-ok">✓ Cross-checked · {p.domains.length} sites</span> : <span className="chip bg-warn-soft text-warn">Single source</span>}
                    {p.sourceIds.map((id) => {
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
              ))}
            </div>
          )}

          <div className="space-y-1 text-center text-xs text-muted">
            {pc.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
            <p>
              Checked {fmtTimestamp(pc.fetchedAt)} · {pc.searchesUsed} search{pc.searchesUsed === 1 ? "" : "es"}, {pc.pagesRead} page read{pc.pagesRead === 1 ? "" : "s"}. Prices are kept only when the source shows them; budget lines updated.
            </p>
            {!readOnly && (
              <button type="button" className="font-semibold text-accent" onClick={run} disabled={busy}>
                {busy ? "Checking…" : "Check again"}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
