"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/client/api";
import { DEFAULT_SETTINGS } from "@/lib/settings-shared";
import { fmtDate, fmtDuration, fmtTime, fmtTimestamp, fmtUsd } from "@/lib/format";
import { findRef, VERSION_KEYS, VERSION_LABEL, type RefPlace, type TripEditClient, type TripRecord, type VersionKey } from "@/lib/planner/types";
import { refsInDays } from "@/lib/planner/validate";
import { milesFrom } from "@/lib/airports";
import { originAirports, travelersLabel } from "@/components/inputs";
import { PlaceDetailsSheet } from "@/components/PlaceCard";
import { AiText, Badge, ErrorState, Rating } from "@/components/ui";
import { BudgetBar, CostTable } from "./CostTable";
import { DayCard } from "./DayCard";
import { SavingsPanel } from "./SavingsPanel";

export function TripView({
  initial,
  readOnly = false,
  printMode = false,
  initialVersion = "balanced",
  threshold = DEFAULT_SETTINGS.verifiedReviewThreshold,
  upgrades,
}: {
  initial: TripRecord;
  readOnly?: boolean;
  printMode?: boolean;
  initialVersion?: VersionKey;
  threshold?: number;
  upgrades?: (trip: TripRecord, version: VersionKey, setTrip: (t: TripRecord) => void) => ReactNode;
}) {
  const router = useRouter();
  const [trip, setTrip] = useState(initial);
  const [vk, setVk] = useState<VersionKey>(initialVersion);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [openPlace, setOpenPlace] = useState<RefPlace | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(trip.name);
  const [showRemoved, setShowRemoved] = useState(false);
  const [editing, setEditing] = useState(false);

  const ds = trip.dataset;
  const v = trip.plan.versions[vk];
  const flight = v.flightRef ? findRef(ds, v.flightRef) : null;
  const hotel = v.hotelRef ? findRef(ds, v.hotelRef) : null;
  const used = useMemo(() => new Set(refsInDays(v.days)), [v.days]);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  const edit = (e: TripEditClient) =>
    run("edit", async () => {
      const r = await api<{ trip: TripRecord }>(`/api/trips/${trip.id}`, { method: "PATCH", json: { ...e, version: vk } });
      setTrip(r.trip);
    });

  const regenerate = (date: string) =>
    run(`regen:${date}`, async () => {
      if (!window.confirm(`Regenerate ${fmtDate(date)} for the ${VERSION_LABEL[vk]} version? This is one Claude call; other days stay as they are.`)) return;
      const r = await api<{ trip: TripRecord }>(`/api/trips/${trip.id}/regenerate-day`, { method: "POST", json: { version: vk, date } });
      setTrip(r.trip);
    });

  const rename = () =>
    run("rename", async () => {
      const r = await api<{ trip: TripRecord }>(`/api/trips/${trip.id}`, { method: "PATCH", json: { op: "rename", name } });
      setTrip(r.trip);
      setRenaming(false);
    });

  const duplicate = () =>
    run("dup", async () => {
      const r = await api<{ id: string }>(`/api/trips/${trip.id}/duplicate`, { method: "POST" });
      router.push(`/trips/${r.id}`);
    });

  const share = (on: boolean) =>
    run("share", async () => {
      const r = await api<{ shareToken: string | null }>(`/api/trips/${trip.id}/share`, { method: "POST", json: { on } });
      setTrip({ ...trip, share_token: r.shareToken });
    });

  const remove = () =>
    run("delete", async () => {
      if (!window.confirm(`Delete "${trip.name}"? This can't be undone.`)) return;
      await api(`/api/trips/${trip.id}`, { method: "DELETE" });
      router.push("/saved");
    });

  const shareUrl = trip.share_token && typeof window !== "undefined" ? `${window.location.origin}/share/${trip.share_token}` : null;

  const c = v.costs;
  const f = flight?.kind === "flight" ? flight.item : null;
  const h = hotel?.kind === "hotel" ? hotel.item : null;
  const firstSeg = f?.segments[0];
  const lastSeg = f?.segments[f.segments.length - 1];

  return (
    <div className="space-y-5">
      {/* Summary card */}
      <header className="card overflow-hidden">
        <div className="bg-gradient-to-br from-accent to-[#115e59] px-4 pb-4 pt-4 text-white">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/80">
            {trip.inputs.origin} → {ds.destination}
          </p>
          {renaming && !readOnly ? (
            <form
              className="mt-1 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                rename();
              }}
            >
              <input className="input text-text" value={name} onChange={(e) => setName(e.target.value)} aria-label="Trip name" autoFocus />
              <button className="btn bg-white text-accent" disabled={!!busy}>
                Save
              </button>
            </form>
          ) : (
            <h1 className="mt-1 text-2xl font-extrabold leading-tight">
              {/* Auto-generated names repeat the dates shown below; show just the destination for those. */}
              {trip.name.startsWith(`${ds.destination} · `) ? ds.destination : trip.name}
              {!readOnly && (
                <button type="button" className="no-print ml-2 align-middle text-xs font-semibold text-white/80 underline" onClick={() => setRenaming(true)}>
                  Rename
                </button>
              )}
            </h1>
          )}
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-white/90">
            <span>📅 {fmtDate(ds.startDate)} – {fmtDate(ds.endDate)}</span>
            <span>👥 {travelersLabel(ds.travelers)}</span>
            <span className="capitalize">🎒 {trip.inputs.pace}</span>
            {trip.inputs.styles.length > 0 && <span className="capitalize">✨ {trip.inputs.styles.join(", ")}</span>}
          </p>
        </div>

        <div className="px-4 py-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="eyebrow">Total</p>
              <p className="text-xl font-extrabold tabular-nums">{fmtUsd(c.total)}</p>
            </div>
            <div>
              <p className="eyebrow">Budget</p>
              <p className="text-xl font-extrabold tabular-nums text-muted">{fmtUsd(c.budget)}</p>
            </div>
            <div>
              <p className="eyebrow">{c.overBudget ? "Over by" : "Left"}</p>
              <p className={`text-xl font-extrabold tabular-nums ${c.overBudget ? "text-danger" : "text-ok"}`}>{fmtUsd(Math.abs(c.remaining))}</p>
            </div>
          </div>
          <div className="mt-3">
            <BudgetBar costs={c} />
          </div>
          {!readOnly && (
            <div className="no-print mt-4 flex flex-wrap gap-2">
              <button type="button" className={`btn btn-sm ${editing ? "" : "btn-ghost"}`} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
                {editing ? "✓ Done editing" : "✏️ Edit"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => share(!trip.share_token)} disabled={!!busy}>
                🔗 {trip.share_token ? "Stop sharing" : "Share"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={duplicate} disabled={!!busy}>
                ⧉ Duplicate
              </button>
              <Link className="btn btn-ghost btn-sm" href={`/trips/${trip.id}/print?v=${vk}`}>
                🖨 Print
              </Link>
              <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={remove} disabled={!!busy}>
                Delete
              </button>
            </div>
          )}
          {!readOnly && shareUrl && (
            <div className="no-print mt-3 flex items-center gap-2 rounded-xl bg-surface-2 p-2 text-sm">
              <input readOnly value={shareUrl} className="input min-w-0 flex-1 text-xs" onFocus={(e) => e.target.select()} aria-label="Share link" />
              <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(shareUrl)}>
                Copy
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Version switcher stays reachable while scrolling */}
      {!printMode && (
        <div className="no-print sticky top-[3.6rem] z-30 -mx-4 bg-bg/90 px-4 py-2 backdrop-blur">
          <div role="tablist" aria-label="Plan versions" className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1">
            {VERSION_KEYS.map((key) => {
              const vc = trip.plan.versions[key].costs;
              const on = vk === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={on}
                  type="button"
                  onClick={() => setVk(key)}
                  className={`rounded-xl px-2 py-1.5 text-center transition ${on ? "bg-surface shadow-sm" : ""}`}
                >
                  <span className={`block text-sm font-bold ${on ? "text-accent" : ""}`}>{VERSION_LABEL[key]}</span>
                  <span className="block text-xs tabular-nums text-muted">
                    {fmtUsd(vc.total)} <span className={vc.overBudget ? "text-danger" : "text-ok"}>{vc.overBudget ? "▲" : "✓"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {printMode && <h2 className="section-title">{VERSION_LABEL[vk]} version</h2>}

      {error && <ErrorState message={error.message} code={error.code} />}
      {busy && busy !== "edit" && <p className="text-sm font-semibold text-accent">Working…</p>}
      {editing && (
        <p className="no-print rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">
          Edit mode: reorder, move, remove, or add stops; change the flight or hotel. Costs and travel times update automatically.
        </p>
      )}

      {ds.errors.length > 0 && (
        <details className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
          <summary className="cursor-pointer font-semibold">⚠ Some data couldn&apos;t be fetched ({ds.errors.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {ds.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      {v.summary && <AiText>{v.summary}</AiText>}

      {/* At a glance */}
      <section className="space-y-2">
        <h2 className="section-title">Getting there & staying</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="eyebrow">✈️ Flight</p>
              {f && <p className="text-right text-lg font-extrabold leading-none">{fmtUsd(f.priceTotal)}</p>}
            </div>
            {f && firstSeg && lastSeg ? (
              <>
                <p className="mt-2 text-sm font-semibold">
                  {f.airlines.join(" + ")}
                  {!originAirports(trip.inputs.origin, false).includes(firstSeg.from.code) && originAirports(trip.inputs.origin, false).length > 0 && (
                    <span className="ml-2 font-normal text-accent">
                      📍 from {firstSeg.from.code}
                      {milesFrom(originAirports(trip.inputs.origin, false)[0], firstSeg.from.code) !== null ? ` · ${milesFrom(originAirports(trip.inputs.origin, false)[0], firstSeg.from.code)} mi away` : ""}
                    </span>
                  )}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <div>
                    <p className="text-base font-bold tabular-nums">{fmtTime(firstSeg.from.time)}</p>
                    <p className="text-xs text-muted">{firstSeg.from.code}</p>
                  </div>
                  <div className="flex-1 text-center">
                    <p className="text-xs text-muted">{fmtDuration(f.totalDurationMin)}</p>
                    <div className="relative my-0.5 h-px bg-border">
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface px-1 text-xs">✈</span>
                    </div>
                    <p className="text-xs text-muted">{f.stops === 0 ? "Nonstop" : `${f.stops} stop${f.stops > 1 ? "s" : ""} · ${f.layovers.map((l) => l.code).join(", ")}`}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold tabular-nums">{fmtTime(lastSeg.to.time)}</p>
                    <p className="text-xs text-muted">{lastSeg.to.code}</p>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Round trip total{f.pricePerPerson !== null && (ds.flights?.payingTravelers ?? 1) > 1 ? ` · ${fmtUsd(f.pricePerPerson)}/person` : ""}
                </p>
                {f.flags.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1">
                    {f.flags.map((fl, i) => (
                      <Badge key={i} tone={fl.severity === "danger" ? "danger" : fl.severity === "warn" ? "warn" : "neutral"} title={fl.detail}>
                        {fl.label}
                      </Badge>
                    ))}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">No flight with a price was found for these dates.</p>
            )}
            {editing && ds.flights && ds.flights.options.length > 1 && (
              <select className="input no-print mt-3" aria-label="Change flight" value={v.flightRef ?? ""} onChange={(e) => edit({ op: "set_flight", ref: e.target.value })}>
                {ds.flights.options.map((o) => (
                  <option key={o.ref} value={o.ref}>
                    {fmtUsd(o.priceTotal)} · {o.airlines.join("+")} · {o.stops === 0 ? "nonstop" : `${o.stops} stop`} · {fmtDuration(o.totalDurationMin)}
                  </option>
                ))}
              </select>
            )}
            {ds.flights?.googleFlightsUrl && (
              <a href={ds.flights.googleFlightsUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-accent">
                Return flights & booking on Google Flights ↗
              </a>
            )}
          </div>

          <div className="card overflow-hidden">
            {h?.images[0] && (
              <img
                src={h.images[0].thumb}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                className="no-print h-28 w-full object-cover"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            )}
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="eyebrow">🏨 Stay</p>
                {h && (
                  <p className="text-right">
                    <span className="text-lg font-extrabold leading-none">{fmtUsd(h.ratePerNight)}</span>
                    <span className="text-xs text-muted">/night</span>
                  </p>
                )}
              </div>
              {h ? (
                <>
                  <p className="mt-1 font-semibold leading-tight">{h.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={h.tier === "Luxury" ? "ai" : h.tier === "Budget" ? "ok" : "neutral"}>{h.tier}</Badge>
                    {h.hotelClass !== null && <Badge>{h.hotelClass}★</Badge>}
                    <Rating rating={h.rating} reviews={h.reviews} source="Google" />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Check-in {h.checkInTime ?? "—"} · Check-out {h.checkOutTime ?? "—"}
                  </p>
                  {(h.link || ds.hotels?.googleHotelsUrl) && (
                    <a href={h.link ?? ds.hotels!.googleHotelsUrl!} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-accent">
                      Book / view ↗
                    </a>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">No hotel with a price was found.</p>
              )}
              {editing && ds.hotels && ds.hotels.options.length > 1 && (
                <select className="input no-print mt-3" aria-label="Change hotel" value={v.hotelRef ?? ""} onChange={(e) => edit({ op: "set_hotel", ref: e.target.value })}>
                  {ds.hotels.options.map((o) => (
                    <option key={o.ref} value={o.ref}>
                      {o.name} · {o.tier} · {fmtUsd(o.ratePerNight)}/night · ★{o.rating ?? "—"}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="section-title">Day by day</h2>
          <span className="text-xs text-muted">{v.days.length} days</span>
        </div>
        {v.days.map((d, i) => (
          <DayCard
            key={`${vk}-${d.date}`}
            day={d}
            index={i}
            ds={ds}
            hotelRef={v.hotelRef}
            readOnly={readOnly}
            editing={editing && !readOnly}
            threshold={threshold}
            usedRefs={used}
            onEdit={edit}
            onRegenerate={() => regenerate(d.date)}
            onOpenPlace={setOpenPlace}
            busy={!!busy}
          />
        ))}
      </section>

      <SavingsPanel trip={trip} version={vk} readOnly={readOnly} onTrip={setTrip} />

      <details className="group" open={printMode}>
        <summary className="section-title cursor-pointer list-none">
          Full cost breakdown <span className="text-sm font-normal text-muted group-open:hidden">▸ show</span>
        </summary>
        <div className="mt-2">
          <CostTable costs={c} />
        </div>
      </details>

      {v.tips.length > 0 && (
        <section className="space-y-2">
          <h2 className="section-title">Tips</h2>
          {v.tips.map((t, i) => (
            <AiText key={i}>{t}</AiText>
          ))}
        </section>
      )}

      {upgrades && !readOnly && upgrades(trip, vk, setTrip)}

      {v.removed.length > 0 && !readOnly && (
        <section className="no-print text-xs text-muted">
          <button type="button" className="font-semibold" onClick={() => setShowRemoved((x) => !x)}>
            {showRemoved ? "Hide" : "Show"} {v.removed.length} suggestion{v.removed.length > 1 ? "s" : ""} the server rejected (not in fetched data)
          </button>
          {showRemoved && (
            <ul className="mt-1 list-disc pl-5">
              {v.removed.map((r, i) => (
                <li key={i}>
                  {r.ref}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <footer className="border-t border-border pt-3 text-xs text-muted">
        Sources: Google Flights, Google Hotels, Google Maps, Tripadvisor, Google Events (via SerpApi); weather from Open-Meteo. Data fetched {fmtTimestamp(ds.fetchedAt)}; plan by {trip.plan.model}. Text marked
        &quot;AI&quot; was written by Claude; everything else is from the listed sources.
      </footer>

      {openPlace && !readOnly && <PlaceDetailsSheet item={openPlace} destination={ds.destination} threshold={threshold} onClose={() => setOpenPlace(null)} />}
    </div>
  );
}
