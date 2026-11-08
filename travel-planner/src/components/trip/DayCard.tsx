"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { fmtDayShort, fmtMiles, fmtTime } from "@/lib/format";
import { TRAVEL_ESTIMATE_NOTE } from "@/lib/geo";
import { findRef, SLOTS, type Dataset, type PlanDay, type RefPlace, type Slot, type TripEditClient } from "@/lib/planner/types";
import { isVerified, SOURCE_LABEL } from "@/lib/places/types";
import { isRainy, weatherIcon } from "@/lib/weather-shared";
import { MapView } from "@/components/MapView";
import { priceLabel } from "@/components/PlaceCard";
import { InfoTip } from "@/components/ui";

const SLOT_LABEL: Record<Slot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const SLOT_ICON: Record<Slot, string> = { morning: "🌅", afternoon: "☀️", evening: "🌙" };
const k = (n: number | null) => (n === null ? "" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

interface Live {
  minutes: number | null;
  miles: number | null;
  mode: string;
}

/**
 * Sourced price when there is one. Otherwise "Price not listed" — tap to enter your own (0 = free).
 * Yours shows as "· yours" and is counted on its own budget line.
 */
function PriceChip({ p, mine, readOnly, onSet }: { p: RefPlace; mine: number | undefined; readOnly: boolean; onSet: (usd: number | null) => void }) {
  const sourced = p.price.minUsd !== null || p.price.maxUsd !== null;
  if (sourced || p.price.level !== null) {
    // Real USD amount, or a Google price level like "$$" (restaurants are covered by the food estimate).
    return <span className="chip shrink-0 bg-surface-2 text-text">{priceLabel(p)}</span>;
  }
  const label = mine === undefined ? (p.price.display ?? "Price not listed") : mine === 0 ? "Free · yours" : `$${mine} · yours`;
  const tone = mine === undefined ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent";
  if (readOnly) return <span className={`chip shrink-0 ${tone}`}>{label}</span>;
  function ask() {
    const hint = p.price.display ? `\nSource shows: ${p.price.display}` : "";
    const v = window.prompt(`Price per person (USD) for ${p.name}?\nEnter 0 if it's free. Leave blank to clear.${hint}`, mine === undefined ? "" : String(mine));
    if (v === null) return;
    const t = v.trim().replace(/[$,\s]/g, "");
    if (t === "") return onSet(null);
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return window.alert("Enter a number like 25, or 0 for free.");
    onSet(n);
  }
  return (
    <button type="button" onClick={ask} className={`chip shrink-0 ${tone}`} title="Tap to enter the price yourself">
      {mine === undefined ? `${label} ＋` : label}
    </button>
  );
}

/** Small inline marker for Claude-written text — present but quieter than sourced facts. */
export function AiNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 text-[0.88rem] leading-relaxed text-ai">
      <span className="mr-1 rounded bg-ai-soft px-1 py-px text-xs font-bold uppercase tracking-wide">AI</span>
      {children}
    </p>
  );
}

export function DayCard({
  day,
  index,
  ds,
  hotelRef,
  readOnly,
  editing,
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
  editing: boolean;
  threshold: number;
  usedRefs: Set<string>;
  onEdit: (e: TripEditClient) => void;
  onRegenerate: () => void;
  onOpenPlace: (p: RefPlace) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(true);
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
  const numberOf = new Map(flat.map((it, i) => [it.ref, i + 1]));
  const markers = [
    ...(hotelGps && hotel?.kind === "hotel" ? [{ ...hotelGps, label: hotel.item.name, badge: "H", tone: "hotel" as const }] : []),
    ...places.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => p.gps).map(({ p, n }) => ({ ...p.gps!, label: p.name, badge: String(n) })),
  ];
  const otherDates = ds.dates.filter((d) => d !== day.date);
  const unused = ds.places.filter((p) => !usedRefs.has(p.ref) && (!p.event?.startDate || p.event.startDate === day.date));
  const travelMin = legs.reduce((s, it) => s + (it.travel?.minutes ?? 0), 0);

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

  const fromName = (ref: string) => (ref === hotelRef ? "hotel" : findRef(ds, ref)?.kind === "place" ? (findRef(ds, ref)!.item as RefPlace).name : "previous stop");

  return (
    <section className="card break-inside-avoid overflow-hidden" aria-label={`Day ${index + 1}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-soft text-accent">
          <span className="text-xs font-bold uppercase leading-none">Day</span>
          <span className="text-lg font-extrabold leading-none">{index + 1}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-tight">{fmtDayShort(day.date)}</h3>
          <p className="truncate text-xs text-muted">
            {flat.length ? `${flat.length} stop${flat.length > 1 ? "s" : ""}` : "Free day"}
            {travelMin > 0 && ` · ~${travelMin} min travel`}
            {!open && places.length > 0 && ` · ${places.slice(0, 3).map((p) => p.name).join(", ")}`}
          </p>
        </div>
        <div className={`shrink-0 rounded-xl px-2.5 py-1 text-right ${isRainy(weather) ? "bg-warn-soft" : "bg-surface-2"}`} title={weather?.source}>
          <span className="block text-sm font-bold leading-tight">
            {weatherIcon(weather)} {weather?.highF != null ? `${Math.round(weather.highF)}°` : "—"}
            <span className="font-normal text-muted">{weather?.lowF != null ? ` / ${Math.round(weather.lowF)}°` : ""}</span>
          </span>
          {weather?.precipChance != null && <span className={`block text-xs leading-tight ${isRainy(weather) ? "font-semibold text-warn" : "text-muted"}`}>{weather.precipChance}% rain</span>}
        </div>
        <span className={`no-print text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          {day.theme && <AiNote>{day.theme}</AiNote>}

          <div className="mt-2 space-y-1">
            {day.blocks.map((b) => {
              if (!b.items.length && !editing) return null;
              return (
                <div key={b.slot}>
                  <div className="flex items-center justify-between pb-1 pt-2">
                    <span className="eyebrow">
                      {SLOT_ICON[b.slot]} {SLOT_LABEL[b.slot]}
                    </span>
                    {editing && (
                      <button type="button" className="no-print text-xs font-semibold text-accent" onClick={() => setAdding(adding === b.slot ? null : b.slot)}>
                        + Add stop
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
                  {b.items.length === 0 && <p className="pb-1 text-sm text-muted">Free time</p>}
                  <ol>
                    {b.items.map((it, i) => {
                      const r = findRef(ds, it.ref);
                      if (r?.kind !== "place") return null;
                      const p = r.item;
                      const lv = it.travel ? live[`${it.travel.fromRef}>${it.ref}`] : undefined;
                      const src = p.sources.find((s) => s.url);
                      const ratings = p.sources.filter((s) => s.rating !== null);
                      const n = numberOf.get(it.ref)!;
                      const last = n === flat.length;
                      return (
                        <li key={it.ref} className="relative pl-10">
                          {/* timeline rail */}
                          <span className="absolute left-[0.85rem] top-0 h-full w-px bg-border" aria-hidden style={last ? { height: "1.25rem" } : undefined} />
                          {it.travel && (
                            <p className="pb-2 text-[0.82rem] text-muted">
                              {lv ? (
                                <span className="font-semibold text-text">
                                  {lv.minutes ?? "?"} min {lv.mode} · {fmtMiles(lv.miles)}
                                </span>
                              ) : (
                                <>
                                  ~{it.travel.minutes} min {it.travel.mode} · {fmtMiles(it.travel.miles)} est.
                                </>
                              )}{" "}
                              from {fromName(it.travel.fromRef)}
                            </p>
                          )}
                          <span className="absolute left-0 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-contrast ring-4 ring-surface">
                            {n}
                          </span>
                          <div className="pb-6">
                            <div className="flex items-start justify-between gap-2">
                              <button type="button" className="text-left text-[1.02rem] font-semibold leading-snug hover:underline disabled:no-underline" onClick={() => onOpenPlace(p)} disabled={readOnly}>
                                {p.name}
                              </button>
                              <PriceChip p={p} mine={ds.userPrices?.[p.ref]} readOnly={readOnly} onSet={(usd) => onEdit({ op: "set_price", ref: p.ref, usd })} />
                            </div>
                            <p className="mt-1 text-[0.82rem] leading-snug text-muted">
                              <span className="capitalize">{p.types[0] ?? p.category}</span>
                              {ratings.map((s) => (
                                <span key={s.source}>
                                  {" · "}
                                  <span className="font-semibold text-text">★ {s.rating}</span> ({k(s.reviews)}) {SOURCE_LABEL[s.source]}
                                </span>
                              ))}
                              {isVerified(p, threshold) && <span className="font-semibold text-ok"> · ✓ Verified</span>}
                            </p>
                            {(p.event?.when ?? p.hours) && <p className="mt-1 truncate text-[0.82rem] text-muted">{p.event?.when ?? p.hours}</p>}
                            {it.note && <AiNote>{it.note}</AiNote>}
                            {(src?.url || p.event?.tickets[0]) && (
                              <p className="mt-1 flex gap-3 text-xs">
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
                              </p>
                            )}
                            {editing && (
                              <div className="no-print mt-2 flex flex-wrap items-center gap-1.5">
                                <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => onEdit({ op: "move_item", ref: it.ref, toDate: day.date, toSlot: b.slot, toIndex: i - 1 })} aria-label="Move up">
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm"
                                  disabled={i === b.items.length - 1}
                                  onClick={() => onEdit({ op: "move_item", ref: it.ref, toDate: day.date, toSlot: b.slot, toIndex: i + 1 })}
                                  aria-label="Move down"
                                >
                                  ↓
                                </button>
                                <select
                                  aria-label="Move to another day or time"
                                  className="input btn-sm w-auto min-h-0 py-1"
                                  value=""
                                  onChange={(e) => {
                                    const [d, s] = e.target.value.split("|");
                                    if (d) onEdit({ op: "move_item", ref: it.ref, toDate: d, toSlot: s as Slot });
                                  }}
                                >
                                  <option value="">Move to…</option>
                                  {[day.date, ...otherDates].flatMap((d) =>
                                    SLOTS.filter((s) => !(d === day.date && s === b.slot)).map((s) => (
                                      <option key={`${d}|${s}`} value={`${d}|${s}`}>
                                        {fmtDayShort(d)} {SLOT_LABEL[s]}
                                      </option>
                                    )),
                                  )}
                                </select>
                                <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => onEdit({ op: "remove_item", date: day.date, ref: it.ref })}>
                                  Remove
                                </button>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })}
            {!flat.length && !editing && <p className="text-sm text-muted">Nothing planned. Tap Edit to add stops.</p>}
          </div>

          {day.tip && <AiNote>{day.tip}</AiNote>}

          {weather?.sunset && (
            <p className="mt-3 text-xs text-muted">
              Sunset {fmtTime(weather.sunset)}
              {weather.summary ? ` · ${weather.summary}` : ""} · {weather.source}
            </p>
          )}

          {!readOnly && (
            <div className="no-print mt-3 flex flex-wrap items-center gap-2">
              {markers.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowMap((s) => !s)} aria-expanded={showMap}>
                  🗺️ {showMap ? "Hide map" : "Map"}
                </button>
              )}
              {legs.length > 0 && Object.keys(live).length < legs.length && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={liveTimes} disabled={liveBusy}>
                  {liveBusy ? "Fetching…" : `⏱ Live times (${legs.length} search${legs.length > 1 ? "es" : ""})`}
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={onRegenerate} disabled={busy}>
                ↻ Regenerate day
              </button>
              {legs.length > 0 && (
                <span className="text-xs text-muted">
                  Times are estimates
                  <InfoTip label="How travel time is estimated">{TRAVEL_ESTIMATE_NOTE}</InfoTip>
                </span>
              )}
            </div>
          )}
          {liveErr && <p className="mt-2 text-xs text-danger">{liveErr}</p>}
          {showMap && markers.length > 0 && (
            <div className="no-print mt-3">
              <MapView markers={markers} route />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
