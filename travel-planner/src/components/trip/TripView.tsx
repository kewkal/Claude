"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/client/api";
import { DEFAULT_SETTINGS } from "@/lib/settings-shared";
import { fmtDate, fmtTimestamp, fmtUsd } from "@/lib/format";
import { findRef, VERSION_KEYS, VERSION_LABEL, type RefPlace, type TripEditClient, type TripRecord, type VersionKey } from "@/lib/planner/types";
import { refsInDays } from "@/lib/planner/validate";
import { travelersLabel } from "@/components/inputs";
import { FlightCard } from "@/components/FlightCard";
import { PlaceDetailsSheet } from "@/components/PlaceCard";
import { AiText, Badge, ErrorState, Rating } from "@/components/ui";
import { CostTable } from "./CostTable";
import { DayCard } from "./DayCard";

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

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        {renaming && !readOnly ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Trip name" autoFocus />
            <button className="btn" disabled={!!busy}>
              Save
            </button>
          </form>
        ) : (
          <h1 className="text-2xl font-extrabold leading-tight">
            {trip.name}
            {!readOnly && (
              <button type="button" className="no-print ml-2 align-middle text-sm font-semibold text-accent" onClick={() => setRenaming(true)}>
                Rename
              </button>
            )}
          </h1>
        )}
        <p className="text-sm text-muted">
          {trip.inputs.origin} → {ds.destination} · {fmtDate(ds.startDate)}–{fmtDate(ds.endDate)} · {travelersLabel(ds.travelers)} · budget {fmtUsd(trip.inputs.budgetUsd)} · {trip.inputs.pace} pace
          {trip.inputs.styles.length ? ` · ${trip.inputs.styles.join(", ")}` : ""}
        </p>
        <p className="text-xs text-muted">
          Data fetched {fmtTimestamp(ds.fetchedAt)} · plan by {trip.plan.model} · {fmtTimestamp(trip.plan.generatedAt)}
        </p>
        {!readOnly && (
          <div className="no-print flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={duplicate} disabled={!!busy}>
              Duplicate
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => share(!trip.share_token)} disabled={!!busy}>
              {trip.share_token ? "Stop sharing" : "Share link"}
            </button>
            <Link className="btn btn-ghost" href={`/trips/${trip.id}/print?v=${vk}`}>
              Print / PDF
            </Link>
            <button type="button" className="btn btn-ghost text-danger" onClick={remove} disabled={!!busy}>
              Delete
            </button>
          </div>
        )}
        {!readOnly && shareUrl && (
          <div className="no-print card flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="font-semibold">Read-only link:</span>
            <input readOnly value={shareUrl} className="input min-w-0 flex-1" onFocus={(e) => e.target.select()} aria-label="Share link" />
            <button type="button" className="btn btn-ghost" onClick={() => navigator.clipboard?.writeText(shareUrl)}>
              Copy
            </button>
          </div>
        )}
      </header>

      {error && <ErrorState message={error.message} code={error.code} />}
      {busy && busy !== "edit" && <p className="text-sm font-semibold text-accent">Working…</p>}

      {!printMode && (
        <div role="tablist" aria-label="Plan versions" className="no-print grid grid-cols-3 gap-2">
          {VERSION_KEYS.map((k) => {
            const c = trip.plan.versions[k].costs;
            return (
              <button
                key={k}
                role="tab"
                aria-selected={vk === k}
                type="button"
                onClick={() => setVk(k)}
                className={`rounded-xl border p-2 text-left ${vk === k ? "border-accent bg-accent-soft" : "border-border bg-surface"}`}
              >
                <span className="block text-sm font-bold">{VERSION_LABEL[k]}</span>
                <span className="block text-sm tabular-nums">{fmtUsd(c.total)}</span>
                <span className={`block text-xs font-semibold ${c.overBudget ? "text-danger" : "text-ok"}`}>{c.overBudget ? `${fmtUsd(-c.remaining)} over` : `${fmtUsd(c.remaining)} under`}</span>
              </button>
            );
          })}
        </div>
      )}
      {printMode && <h2 className="text-xl font-bold">{VERSION_LABEL[vk]} version</h2>}

      {ds.errors.length > 0 && (
        <div className="rounded-lg bg-warn-soft p-3 text-sm text-warn">
          <p className="font-semibold">Some data couldn&apos;t be fetched:</p>
          <ul className="list-disc pl-5">
            {ds.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {v.summary && <AiText>{v.summary}</AiText>}

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Cost breakdown</h2>
        <CostTable costs={v.costs} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Flight</h2>
        {flight?.kind === "flight" ? (
          <FlightCard o={flight.item} paying={ds.flights?.payingTravelers ?? 1} compact={printMode} />
        ) : (
          <p className="text-sm text-muted">No flight with a price was found for these dates.</p>
        )}
        {!readOnly && ds.flights && ds.flights.options.length > 1 && (
          <select className="input no-print" aria-label="Change flight" value={v.flightRef ?? ""} onChange={(e) => edit({ op: "set_flight", ref: e.target.value })}>
            {ds.flights.options.map((f) => (
              <option key={f.ref} value={f.ref}>
                {fmtUsd(f.priceTotal)} · {f.airlines.join("+")} · {f.stops === 0 ? "nonstop" : `${f.stops} stop`} · {Math.round(f.totalDurationMin / 6) / 10}h
              </option>
            ))}
          </select>
        )}
        {ds.flights?.googleFlightsUrl && (
          <a href={ds.flights.googleFlightsUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent">
            Return flights & booking on Google Flights ↗
          </a>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Stay</h2>
        {hotel?.kind === "hotel" ? (
          <div className="card flex gap-3 p-3">
            {hotel.item.images[0] && <img src={hotel.item.images[0].thumb} alt="" loading="lazy" referrerPolicy="no-referrer" className="no-print h-20 w-24 shrink-0 rounded-lg object-cover" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold">{hotel.item.name}</span>
                <Badge tone={hotel.item.tier === "Luxury" ? "ai" : hotel.item.tier === "Budget" ? "ok" : "neutral"}>{hotel.item.tier}</Badge>
                {hotel.item.hotelClass !== null && <Badge>{hotel.item.hotelClass}★</Badge>}
              </div>
              <Rating rating={hotel.item.rating} reviews={hotel.item.reviews} source="Google" />
              <p className="text-sm">
                {fmtUsd(hotel.item.ratePerNight)}/night · check-in {hotel.item.checkInTime ?? "—"} · check-out {hotel.item.checkOutTime ?? "—"}
              </p>
              {(hotel.item.link || ds.hotels?.googleHotelsUrl) && (
                <a href={hotel.item.link ?? ds.hotels!.googleHotelsUrl!} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent">
                  Book / view ↗
                </a>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No hotel with a price was found.</p>
        )}
        {!readOnly && ds.hotels && ds.hotels.options.length > 1 && (
          <select className="input no-print" aria-label="Change hotel" value={v.hotelRef ?? ""} onChange={(e) => edit({ op: "set_hotel", ref: e.target.value })}>
            {ds.hotels.options.map((h) => (
              <option key={h.ref} value={h.ref}>
                {h.name} · {h.tier} · {fmtUsd(h.ratePerNight)}/night · ★{h.rating ?? "—"}
              </option>
            ))}
          </select>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Day by day</h2>
        {v.days.map((d, i) => (
          <DayCard
            key={`${vk}-${d.date}`}
            day={d}
            index={i}
            ds={ds}
            hotelRef={v.hotelRef}
            readOnly={readOnly}
            threshold={threshold}
            usedRefs={used}
            onEdit={edit}
            onRegenerate={() => regenerate(d.date)}
            onOpenPlace={setOpenPlace}
            busy={!!busy}
          />
        ))}
      </section>

      {v.tips.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold">Tips</h2>
          {v.tips.map((t, i) => (
            <AiText key={i}>{t}</AiText>
          ))}
        </section>
      )}

      {v.removed.length > 0 && !readOnly && (
        <section className="no-print text-xs text-muted">
          <button type="button" className="font-semibold" onClick={() => setShowRemoved((s) => !s)}>
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

      {upgrades && !readOnly && upgrades(trip, vk, setTrip)}

      <footer className="border-t border-border pt-3 text-xs text-muted">
        Sources: Google Flights, Google Hotels, Google Maps, Tripadvisor, Google Events (via SerpApi); weather from Open-Meteo. Text marked &quot;AI suggestion&quot; was written by Claude; everything else is
        from the listed sources as of the fetch time.
      </footer>

      {openPlace && !readOnly && <PlaceDetailsSheet item={openPlace} destination={ds.destination} threshold={threshold} onClose={() => setOpenPlace(null)} />}
    </div>
  );
}
