"use client";

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
