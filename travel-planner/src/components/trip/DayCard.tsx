"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { fmtDayShort, fmtMiles, fmtTime } from "@/lib/format";
import { TRAVEL_ESTIMATE_NOTE } from "@/lib/geo";
import { findRef, SLOTS, type Dataset, type PlanDay, type RefPlace, type Slot, type TripEditClient } from "@/lib/planner/types";
import { isVerified, SOURCE_LABEL } from "@/lib/places/types";
import { isRainy, weatherNote } from "@/lib/weather-shared";
import { MapView } from "@/components/MapView";
import { priceLabel } from "@/components/PlaceCard";
import { AiText, Badge, InfoTip, VerifiedBadge } from "@/components/ui";

const SLOT_LABEL: Record<Slot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };

interface Live {
  minutes: number | null;
  miles: number | null;
  mode: string;
}

export function DayCard({
  day,
  index,
  ds,
  hotelRef,
  readOnly,
  threshold,
  usedRefs,
  onEdit,
  onRegenerate,
  onOpenPlace,
  busy,
}: {
  day: PlanDay;
  index: number;
  ds: Dataset;
  hotelRef: string | null;
  readOnly: boolean;
  threshold: number;
  usedRefs: Set<string>;
  onEdit: (e: TripEditClient) => void;
  onRegenerate: () => void;
  onOpenPlace: (p: RefPlace) => void;
  busy: boolean;
}) {
  const [showMap, setShowMap] = useState(false);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [adding, setAdding] = useState<Slot | null>(null);

  const weather = ds.weather.find((w) => w.date === day.date);
  const hotel = hotelRef ? findRef(ds, hotelRef) : null;
  const hotelGps = hotel?.kind === "hotel" ? hotel.item.gps : undefined;
  const flat = day.blocks.flatMap((b) => b.items.map((i) => ({ ...i, slot: b.slot })));
  const places = flat.map((i) => findRef(ds, i.ref)).filter((r): r is { kind: "place"; item: RefPlace } => r?.kind === "place").map((r) => r.item);
  const legs = flat.filter((i) => i.travel);
  const markers = [
    ...(hotelGps && hotel?.kind === "hotel" ? [{ ...hotelGps, label: hotel.item.name, badge: "H", tone: "hotel" as const }] : []),
    ...places.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => p.gps).map(({ p, n }) => ({ ...p.gps!, label: p.name, badge: String(n) })),
  ];

  async function liveTimes() {
    setLiveBusy(true);
    setLiveErr(null);
    try {
      for (const it of legs) {
        const from = findRef(ds, it.travel!.fromRef);
        const to = findRef(ds, it.ref);
        const fg = from?.kind === "place" ? from.item.gps : from?.kind === "hotel" ? from.item.gps : undefined;
        const tg = to?.kind === "place" ? to.item.gps : undefined;
        if (!fg || !tg) continue;
        const r = await api<Live>("/api/directions", { method: "POST", json: { from: fg, to: tg } });
        setLive((prev) => ({ ...prev, [`${it.travel!.fromRef}>${it.ref}`]: r }));
      }
    } catch (e) {
      setLiveErr((e as ApiError).message);
    } finally {
      setLiveBusy(false);
    }
  }

  const otherDates = ds.dates.filter((d) => d !== day.date);
  const unused = ds.places.filter((p) => !usedRefs.has(p.ref) && (!p.event?.startDate || p.event.startDate === day.date));
  const numberOf = new Map(flat.map((it, i) => [it.ref, i + 1]));

  return (
    <section className="card break-inside-avoid p-4" aria-label={`Day ${index + 1}`}>
      <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold">
            Day {index + 1} · {fmtDayShort(day.date)}
          </h3>
          <p className="text-sm">
            <span className={isRainy(weather) ? "font-semibold text-warn" : ""}>{weatherNote(weather)}</span>
            {weather?.sunset && <span className="text-muted"> · sunset {fmtTime(weather.sunset)}</span>}
            <span className="text-xs text-muted"> · {weather?.source ?? "Open-Meteo"}</span>
          </p>
        </div>
        {!readOnly && (
          <div className="no-print flex gap-2">
            <button type="button" className="btn btn-ghost min-h-0 px-2 py-1 text-xs" onClick={() => setShowMap((s) => !s)} aria-expanded={showMap}>
              {showMap ? "Hide map" : "Map"}
            </button>
            <button type="button" className="btn btn-ghost min-h-0 px-2 py-1 text-xs" onClick={onRegenerate} disabled={busy}>
              ↻ Regenerate day
            </button>
          </div>
        )}
      </header>
      {day.theme && <AiText className="mb-3">{day.theme}</AiText>}
      {showMap && markers.length > 0 && (
        <div className="no-print mb-3">
          <MapView markers={markers} route />
        </div>
      )}

      <div className="space-y-3">
        {day.blocks.map((b) => (
          <div key={b.slot}>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wide text-muted">{SLOT_LABEL[b.slot]}</h4>
              {!readOnly && (
                <button type="button" className="no-print text-xs font-semibold text-accent" onClick={() => setAdding(adding === b.slot ? null : b.slot)}>
                  + Add
                </button>
              )}
            </div>
            {adding === b.slot && (
              <select
                className="input no-print mb-2"
                aria-label={`Add to ${SLOT_LABEL[b.slot]}`}
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) onEdit({ op: "add_item", date: day.date, slot: b.slot, ref: e.target.value });
                  setAdding(null);
                }}
              >
                <option value="">Choose from fetched places…</option>
                {unused.map((p) => (
                  <option key={p.ref} value={p.ref}>
                    {p.name} ({p.category})
                  </option>
                ))}
              </select>
            )}
            {b.items.length === 0 ? (
              <p className="text-sm text-muted">Free time</p>
            ) : (
              <ol className="space-y-2">
                {b.items.map((it, i) => {
                  const r = findRef(ds, it.ref);
                  if (r?.kind !== "place") return null;
                  const p = r.item;
                  const lv = it.travel ? live[`${it.travel.fromRef}>${it.ref}`] : undefined;
                  const src = p.sources.find((s) => s.url);
                  return (
                    <li key={it.ref} className="rounded-xl bg-surface-2 p-3">
                      {it.travel && (
                        <p className="mb-1 text-xs text-muted">
                          ↓{" "}
                          {lv ? (
                            <span className="font-semibold text-text">
                              {lv.minutes ?? "?"} min {lv.mode} · {fmtMiles(lv.miles)} (Google Maps)
                            </span>
                          ) : (
                            <>
                              ~{it.travel.minutes} min {it.travel.mode} · {fmtMiles(it.travel.miles)} (est.)
                            </>
                          )}{" "}
                          from {it.travel.fromRef === hotelRef ? "hotel" : findRef(ds, it.travel.fromRef)?.kind === "place" ? (findRef(ds, it.travel.fromRef)!.item as RefPlace).name : "previous stop"}
                        </p>
                      )}
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-contrast">{numberOf.get(it.ref)}</span>
                        <div className="min-w-0 flex-1">
                          <button type="button" className="text-left font-semibold leading-tight hover:underline" onClick={() => onOpenPlace(p)} disabled={readOnly}>
                            {p.name}
                          </button>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            {isVerified(p, threshold) && <VerifiedBadge threshold={threshold} />}
                            <Badge>{p.types[0] ?? p.category}</Badge>
                            <Badge tone={p.price.display ? "neutral" : "warn"}>{priceLabel(p)}</Badge>
                            {p.sources
                              .filter((s) => s.rating !== null)
                              .map((s) => (
                                <span key={s.source} className="text-muted">
                                  ★ {s.rating} ({(s.reviews ?? 0).toLocaleString("en-US")}) {SOURCE_LABEL[s.source]}
                                </span>
                              ))}
                          </div>
                          {p.event ? <p className="mt-1 text-xs">{p.event.when}</p> : p.hours && <p className="mt-1 text-xs text-muted">{p.hours}</p>}
                          {p.address && <p className="text-xs text-muted">{p.address}</p>}
                          {it.note && <AiText className="mt-2">{it.note}</AiText>}
                          <div className="mt-1 flex flex-wrap gap-3 text-xs">
                            {src?.url && (
                              <a href={src.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
                                {SOURCE_LABEL[src.source]} ↗
                              </a>
                            )}
                            {p.event?.tickets[0] && (
                              <a href={p.event.tickets[0].link} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
                                Tickets ↗
                              </a>
                            )}
                          </div>
                          {!readOnly && (
                            <div className="no-print mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <button type="button" className="font-semibold text-muted disabled:opacity-40" disabled={i === 0} onClick={() => onEdit({ op: "move_item", ref: it.ref, toDate: day.date, toSlot: b.slot, toIndex: i - 1 })}>
                                ↑ Up
                              </button>
                              <button
                                type="button"
                                className="font-semibold text-muted disabled:opacity-40"
                                disabled={i === b.items.length - 1}
                                onClick={() => onEdit({ op: "move_item", ref: it.ref, toDate: day.date, toSlot: b.slot, toIndex: i + 1 })}
                              >
                                ↓ Down
                              </button>
                              <select
                                aria-label="Move to"
                                className="rounded-md border border-border bg-surface px-1 py-0.5"
                                value=""
                                onChange={(e) => {
                                  const [d, s] = e.target.value.split("|");
                                  if (d) onEdit({ op: "move_item", ref: it.ref, toDate: d, toSlot: s as Slot });
                                }}
                              >
                                <option value="">Move…</option>
                                {[day.date, ...otherDates].flatMap((d) =>
                                  SLOTS.filter((s) => !(d === day.date && s === b.slot)).map((s) => (
                                    <option key={`${d}|${s}`} value={`${d}|${s}`}>
                                      {fmtDayShort(d)} {SLOT_LABEL[s]}
                                    </option>
                                  )),
                                )}
                              </select>
                              <button type="button" className="font-semibold text-danger" onClick={() => onEdit({ op: "remove_item", date: day.date, ref: it.ref })}>
                                Remove
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        ))}
      </div>

      {day.tip && <AiText className="mt-3">{day.tip}</AiText>}
      {legs.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Travel times are estimates
          <InfoTip label="How travel time is estimated">{TRAVEL_ESTIMATE_NOTE}</InfoTip>
          {!readOnly && Object.keys(live).length < legs.length && (
            <button type="button" className="no-print ml-2 font-semibold text-accent" onClick={liveTimes} disabled={liveBusy}>
              {liveBusy ? "Fetching…" : `Live times for this day (${legs.length} search${legs.length > 1 ? "es" : ""})`}
            </button>
          )}
          {liveErr && <span className="ml-2 text-danger">{liveErr}</span>}
        </p>
      )}
    </section>
  );
}
