import type { Sourced } from '../engine/types';

/** Short form of a source citation for the chip: "Lennox LCH p.29" style; full text stays in the tooltip. */
function shortSource(src: string) {
  const page = /p\.\s*([\d-]+)\s*$/.exec(src)?.[1];
  const doc = /\(([^)]*)\)/.exec(src)?.[1]?.split(',')[0] ?? src.split('/').pop() ?? src;
  const brand = /^(Lennox|Trane|Honeywell)/i.exec(doc)?.[1] ?? '';
  return `✓ ${brand ? `${brand} ` : ''}manual${page ? ` p.${page}` : ''}`;
}

/**
 * One chip per value:
 *  - verified           → green "✓ <brand> manual p.N"
 *  - rule of thumb      → blue "rule of thumb" (industry practice; no manual publishes it)
 *  - sister model       → orange "≈ sister-model doc"
 *  - anything else      → amber "⚠ generic value" (should come from a manual/nameplate)
 */
export function SourceTag({ s }: { s?: Pick<Sourced<unknown>, 'verified' | 'basis' | 'source' | 'note'> }) {
  if (!s) return null;
  const tip = [s.source, s.note].filter(Boolean).join(' — ');
  const chip = 'rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap';
  let el: JSX.Element;
  if (s.verified) el = <span title={tip} className={`${chip} bg-emerald-500/15 text-emerald-300`}>{s.source ? shortSource(s.source) : '✓ verified'}</span>;
  else if (s.basis === 'rule-of-thumb') el = <span title={tip || 'Industry rule of thumb: not published in the unit manuals.'} className={`${chip} bg-sky-500/15 text-sky-300`}>rule of thumb</span>;
  else if (s.basis === 'sister-model') el = <span title={tip} className={`${chip} bg-orange-500/15 text-orange-300`}>≈ sister-model doc</span>;
  else el = <span title={tip || 'Not yet sourced from a manual or nameplate'} className={`${chip} bg-amber-500/15 text-amber-300`}>⚠ generic value</span>;
  return <span className="inline-flex align-middle">{el}</span>;
}

/** Plain-English names for component pass/fail thresholds. */
const THRESHOLD_LABELS: Record<string, string> = {
  coilOhms: 'Coil resistance (Ω)',
  contactDropGoodV: 'Contact drop under load: good up to (V)',
  contactDropBadV: 'Contact drop under load: replace above (V)',
  contactOhmsMax: 'Closed contacts: good up to (Ω)',
  tolerancePct: 'Capacitance tolerance if not on the label (±%)',
  marginalPct: 'Capacitance: marginal up to (% off rating)',
  setpointTolPsig: 'Switch setpoint tolerance (± psig)',
  goodTolF: 'Sensor vs. thermometer: good within (±°F)',
  marginalTolF: 'Sensor vs. thermometer: marginal within (±°F)',
  powerVac: 'Actuator supply voltage (VAC)',
  trackTolPct: 'Shaft position vs. command: good within (±%)',
  strokeSecondsMax: 'Full stroke: worn/slow above (s)',
};

export function ThresholdList({ thresholds }: { thresholds: Record<string, Sourced<unknown>> }) {
  const anyRot = Object.values(thresholds).some((t) => t.basis === 'rule-of-thumb' && !t.verified);
  return (
    <div className="space-y-1">
      {Object.entries(thresholds).map(([k, t]) => (
        <div key={k} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
          <span className="text-slate-300">{THRESHOLD_LABELS[k] ?? k}</span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-slate-100">{Array.isArray(t.value) ? (t.value as unknown[]).join(' – ') : String(t.value)}</span>
            <SourceTag s={t} />
          </span>
        </div>
      ))}
      {anyRot && <p className="pt-1 text-[11px] text-slate-500">Rule of thumb = common field practice. The unit manuals don't publish these numbers, so check the part's own label or spec sheet when you have it.</p>}
    </div>
  );
}

export function SV({ s, suffix = '' }: { s: Sourced<unknown>; suffix?: string }) {
  const v = Array.isArray(s.value) ? s.value.join(' – ') : s.value === null ? 'unknown' : String(s.value);
  return (
    <span>
      {v}
      {suffix} <SourceTag s={s} />
    </span>
  );
}

export function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'amber' | 'emerald' | 'rose' | 'sky' | 'violet' }) {
  const tones = {
    slate: 'bg-slate-700/60 text-slate-200',
    amber: 'bg-amber-500/15 text-amber-300',
    emerald: 'bg-emerald-500/15 text-emerald-300',
    rose: 'bg-rose-500/15 text-rose-300',
    sky: 'bg-sky-500/15 text-sky-300',
    violet: 'bg-violet-500/15 text-violet-300',
  };
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export const difficultyTone = { beginner: 'emerald', medium: 'sky', advanced: 'amber', master: 'rose' } as const;
