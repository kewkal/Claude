"use client";

import { airportLabel, airportsForCity, milesFrom, US_AIRPORTS, withNearbyAirports } from "@/lib/airports";
import type { Travelers } from "@/lib/flights/types";

export function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost h-9 min-h-0 w-9 p-0" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <span className="w-5 text-center font-semibold tabular-nums" aria-live="polite">
          {value}
        </span>
        <button type="button" className="btn btn-ghost h-9 min-h-0 w-9 p-0" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export function TravelersInput({ value, onChange }: { value: Travelers; onChange: (t: Travelers) => void }) {
  const total = value.adults + value.children + value.infantsInSeat + value.infantsOnLap;
  const room = 9 - total;
  return (
    <fieldset className="rounded-xl border border-border p-3">
      <legend className="label px-1">Travelers</legend>
      <Stepper label="Adults" value={value.adults} min={1} max={value.adults + room} onChange={(n) => onChange({ ...value, adults: n })} />
      <Stepper label="Children (2–11)" value={value.children} min={0} max={value.children + room} onChange={(n) => onChange({ ...value, children: n })} />
      <Stepper label="Infants in seat" value={value.infantsInSeat} min={0} max={value.infantsInSeat + room} onChange={(n) => onChange({ ...value, infantsInSeat: n })} />
      <Stepper
        label="Infants on lap"
        value={value.infantsOnLap}
        min={0}
        max={Math.min(value.adults, value.infantsOnLap + room)}
        onChange={(n) => onChange({ ...value, infantsOnLap: n })}
      />
    </fieldset>
  );
}

export function travelersLabel(t: Travelers): string {
  const parts = [`${t.adults} adult${t.adults > 1 ? "s" : ""}`];
  if (t.children) parts.push(`${t.children} child${t.children > 1 ? "ren" : ""}`);
  const inf = t.infantsInSeat + t.infantsOnLap;
  if (inf) parts.push(`${inf} infant${inf > 1 ? "s" : ""}`);
  return parts.join(", ");
}

export function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function HourRange({ label, value, onChange }: { label: string; value: [number, number]; onChange: (v: [number, number]) => void }) {
  const h = (n: number) => (n === 0 || n === 24 ? "12 AM" : n === 12 ? "12 PM" : n < 12 ? `${n} AM` : `${n - 12} PM`);
  return (
    <div>
      <span className="label">
        {label}: {h(value[0])} – {h(value[1])}
      </span>
      <div className="flex items-center gap-2">
        <input aria-label={`${label} from`} type="range" min={0} max={24} value={value[0]} onChange={(e) => onChange([Math.min(Number(e.target.value), value[1]), value[1]])} className="w-full" />
        <input aria-label={`${label} to`} type="range" min={0} max={24} value={value[1]} onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0])])} className="w-full" />
      </div>
    </div>
  );
}

/** Rendered once per page; airport inputs point at it with list="us-airports". */
export function AirportSuggestions() {
  return (
    <datalist id="us-airports">
      {US_AIRPORTS.map((a) => (
        <option key={a.code} value={a.code}>
          {a.city} · {a.name}
        </option>
      ))}
    </datalist>
  );
}

/** Any airport code ("DFW") or city ("Denver"); suggests US airports as you type. */
export function AirportInput({
  id,
  label,
  value,
  onChange,
  placeholder = "City or airport code, e.g. DFW or Denver",
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const known = airportLabel(value);
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        list="us-airports"
        autoComplete="off"
        autoCapitalize="characters"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
      {known && <p className="mt-1 text-xs text-muted">{known}</p>}
    </div>
  );
}

/** The airports a typed origin will actually search (city -> airports, plus nearby when on). */
export function originAirports(origin: string, nearby: boolean): string[] {
  const t = origin.trim();
  const base = /^[a-z]{3}$/i.test(t) ? t.toUpperCase() : airportsForCity(t);
  if (!base) return [];
  return (nearby ? withNearbyAirports(base) : base).split(",");
}

/** "Include nearby airports" switch with a preview of exactly which airports get searched. */
export function NearbyAirportsToggle({ origin, checked, onChange }: { origin: string; checked: boolean; onChange: (v: boolean) => void }) {
  const all = originAirports(origin, true);
  const base = originAirports(origin, false);
  const extra = all.filter((c) => !base.includes(c));
  return (
    <label className="flex items-start gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">
        <span className="block font-semibold">Include nearby airports</span>
        <span className="block text-muted">
          {extra.length
            ? `Also checks ${extra.map((c) => `${c}${base[0] ? ` (${milesFrom(base[0], c)} mi)` : ""}`).join(", ")}. Still 1 search.`
            : "Checks airports within 100 miles in the same search: catches low-cost carriers like Avelo, Allegiant, and Breeze at smaller airports."}
        </span>
      </span>
    </label>
  );
}
