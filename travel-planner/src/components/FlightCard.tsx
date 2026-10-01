"use client";

import type { FlightOption, PriceInsights } from "@/lib/flights/types";
import { fmtDuration, fmtTime, fmtUsd } from "@/lib/format";
import { Badge } from "./ui";

function dayOffset(fromTime: string, toTime: string): number {
  const a = Date.parse(fromTime.slice(0, 10));
  const b = Date.parse(toTime.slice(0, 10));
  return Math.round((b - a) / 86_400_000);
}

export function PriceInsightBar({ pi }: { pi: PriceInsights | null }) {
  if (!pi || !pi.priceLevel) return null;
  const tone = pi.priceLevel === "low" ? "ok" : pi.priceLevel === "high" ? "danger" : "neutral";
  return (
    <div className="card flex flex-wrap items-center gap-2 p-3 text-sm">
      <Badge tone={tone}>Prices are {pi.priceLevel}</Badge>
      {pi.typicalRange && (
        <span className="text-muted">
          Typical for this route: {fmtUsd(pi.typicalRange[0])}–{fmtUsd(pi.typicalRange[1])}
        </span>
      )}
      <span className="text-xs text-muted">· Google Flights price insight</span>
    </div>
  );
}

export function FlightCard({
  o,
  paying,
  onSelect,
  selectLabel,
  onBook,
  compact = false,
}: {
  o: FlightOption;
  paying: number;
  onSelect?: () => void;
  selectLabel?: string;
  onBook?: () => void;
  compact?: boolean;
}) {
  const first = o.segments[0];
  const last = o.segments[o.segments.length - 1];
  if (!first || !last) return null;
  const plusDays = dayOffset(first.from.time, last.to.time);

  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {o.best && <Badge tone="accent">Google &quot;best&quot;</Badge>}
            <span className="truncate text-sm font-semibold">{o.airlines.join(" + ")}</span>
            <Badge tone={o.isBudgetCarrier ? "warn" : "neutral"}>{o.isBudgetCarrier ? "Budget" : "Full-service"}</Badge>
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums">
            {fmtTime(first.from.time)} – {fmtTime(last.to.time)}
            {plusDays > 0 && <sup className="ml-0.5 text-xs text-danger">+{plusDays}</sup>}
          </p>
          <p className="text-sm text-muted">
            {first.from.code} → {last.to.code} · {fmtDuration(o.totalDurationMin)} ·{" "}
            {o.stops === 0 ? "Nonstop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-extrabold">{fmtUsd(o.priceTotal)}</p>
          <p className="text-xs text-muted">total{o.typeLabel ? ` · ${o.typeLabel.toLowerCase()}` : ""}</p>
          {paying > 1 && o.pricePerPerson !== null && <p className="text-xs text-muted">{fmtUsd(o.pricePerPerson)} / person</p>}
        </div>
      </div>

      {o.layovers.length > 0 && (
        <p className="mt-2 text-sm">
          <span className="text-muted">Layovers: </span>
          {o.layovers.map((l, i) => (
            <span key={i}>
              {i > 0 && ", "}
              {fmtDuration(l.durationMin)} in {l.code}
              {l.overnight ? " (overnight)" : ""}
            </span>
          ))}
        </p>
      )}

      {o.flags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Warnings">
          {o.flags.map((f, i) => (
            <li key={i}>
              <Badge tone={f.severity === "danger" ? "danger" : f.severity === "warn" ? "warn" : "neutral"} title={f.detail}>
                ⚠ {f.label}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {!compact && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold text-accent">Flight details</summary>
          <ol className="mt-2 space-y-2">
            {o.segments.map((s, i) => (
              <li key={i} className="rounded-lg bg-surface-2 p-2">
                <p className="font-semibold">
                  {s.airline} {s.flightNumber} · {fmtDuration(s.durationMin)}
                </p>
                <p>
                  {fmtTime(s.from.time)} {s.from.code} → {fmtTime(s.to.time)} {s.to.code}
                </p>
                <p className="text-xs text-muted">
                  {[s.travelClass, s.airplane, s.legroom && `legroom ${s.legroom}`].filter(Boolean).join(" · ")}
                </p>
                {s.extensions.length > 0 && <p className="text-xs text-muted">{s.extensions.join(" · ")}</p>}
              </li>
            ))}
          </ol>
          {o.flags.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-muted">
              {o.flags.map((f, i) => (
                <li key={i}>
                  <b>{f.label}:</b> {f.detail}
                </li>
              ))}
            </ul>
          )}
          {o.carbon && (
            <p className="mt-2 text-xs text-muted">
              CO₂: {o.carbon.thisFlightKg} kg
              {o.carbon.differencePct !== null && ` (${o.carbon.differencePct > 0 ? "+" : ""}${o.carbon.differencePct}% vs typical)`} · Google Flights estimate
            </p>
          )}
        </details>
      )}
      {o.carbon && compact && <p className="mt-1 text-xs text-muted">CO₂ {o.carbon.thisFlightKg} kg</p>}

      {(onSelect || onBook) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {onSelect && (
            <button type="button" className="btn flex-1" onClick={onSelect}>
              {selectLabel ?? "Select"}
            </button>
          )}
          {onBook && (
            <button type="button" className="btn btn-ghost flex-1" onClick={onBook}>
              Booking options
            </button>
          )}
        </div>
      )}
    </article>
  );
}
