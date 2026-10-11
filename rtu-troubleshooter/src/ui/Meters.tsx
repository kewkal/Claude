import type { ReadingDef, ReadingValue } from '../engine/types';
import { bubbleTempF, dewTempF, subcool, superheat } from '../engine/pt';

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(Number.isInteger(v) ? 0 : 1));

function Gauge({ psig, high }: { psig: number; high: boolean }) {
  const max = high ? 800 : 300;
  const a = Math.PI * (1 - Math.min(Math.max(psig, 0), max) / max);
  const x = 60 + 46 * Math.cos(a);
  const y = 60 - 46 * Math.sin(a);
  const sat = high ? bubbleTempF(psig) : dewTempF(psig);
  const color = high ? '#f43f5e' : '#38bdf8';
  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 120 70" className="h-16 w-28 shrink-0">
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#334155" strokeWidth="8" />
        <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke={color} strokeWidth="3" strokeDasharray="2 6" />
        <line x1="60" y1="60" x2={x} y2={y} stroke="#e2e8f0" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="60" cy="60" r="4" fill="#e2e8f0" />
        <text x="10" y="69" fontSize="7" fill="#64748b">0</text>
        <text x="100" y="69" fontSize="7" fill="#64748b">{max}</text>
      </svg>
      <div className="font-mono">
        <div className="text-2xl font-bold" style={{ color }}>{fmt(psig)}<span className="ml-1 text-xs text-slate-400">PSIG</span></div>
        <div className="text-xs text-slate-400">R-410A {high ? 'bubble' : 'dew'}: {sat.toFixed(1)}°F</div>
      </div>
    </div>
  );
}

function Dmm({ value, unit, mode }: { value: ReadingValue; unit: string; mode: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="lcd rounded-md border-2 border-slate-600 bg-[#a8b89a] px-3 py-1.5 text-right text-2xl font-bold text-slate-900 shadow-inner min-w-[7.5rem]">
        {typeof value === 'number' ? fmt(value) : value}
        <span className="ml-1 text-xs">{value === 'OL' ? 'Ω' : unit}</span>
      </div>
      <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-900">{mode}</span>
    </div>
  );
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-24 items-end gap-0.5 rounded border border-slate-600 bg-slate-800 p-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-full flex-1 origin-bottom bg-slate-400" style={{ transform: `scaleX(${Math.max(0.1, 1 - pct / 100)})` }} />
        ))}
      </div>
      <span className="font-mono text-2xl font-bold text-slate-100">{pct}%<span className="ml-1 text-xs text-slate-400">open</span></span>
    </div>
  );
}

const modeFor: Record<string, string> = {
  'dmm-vac': 'V~', 'dmm-vdc': 'V⎓', 'clamp-a': 'A~ CLAMP', 'dmm-ohm': 'Ω', 'dmm-megohm': 'MΩ 500V', 'dmm-uf': 'µF',
  thermo: 'PROBE', manometer: 'MANOMETER', ppm: 'CO₂', rh: 'RH',
};

export function ReadingDisplay({ def, value }: { def: ReadingDef; value: ReadingValue | undefined }) {
  if (value === undefined) return <p className="text-sm text-slate-500">Not applicable on this call.</p>;
  if (def.display === 'text' || (typeof value === 'string' && value !== 'OL'))
    return <p className="rounded-md bg-amber-50/5 p-2 text-sm leading-snug text-slate-200">{String(value)}</p>;
  if (def.display === 'gauge-low' || def.display === 'gauge-high') return <Gauge psig={value as number} high={def.display === 'gauge-high'} />;
  if (def.display === 'percent') return <Bar pct={value as number} />;
  return <Dmm value={value} unit={def.unit} mode={modeFor[def.display] ?? def.unit} />;
}

/** Calculated values that appear once the inputs have been measured. */
export function derived(r: Record<string, ReadingValue>) {
  const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : undefined);
  const out: { label: string; value: string }[] = [];
  const ps = n('p_suction1'), ts = n('t_suction1'), pl = n('p_liquid1'), tl = n('t_liquid1');
  if (ps !== undefined && ts !== undefined) out.push({ label: 'Superheat', value: `${superheat(ps, ts).toFixed(1)}°F` });
  if (pl !== undefined && tl !== undefined) out.push({ label: 'Subcooling', value: `${subcool(pl, tl).toFixed(1)}°F` });
  const mat = n('t_mat'), sat = n('t_sat'), rat = n('t_rat');
  if (mat !== undefined && sat !== undefined) out.push({ label: 'Coil ΔT (MAT−SAT)', value: `${(mat - sat).toFixed(1)}°F` });
  else if (rat !== undefined && sat !== undefined) out.push({ label: 'ΔT (RAT−SAT)', value: `${(rat - sat).toFixed(1)}°F` });
  const v = [n('v_l1_l2'), n('v_l2_l3'), n('v_l1_l3')];
  if (v.every((x) => x !== undefined)) {
    const a = (v as number[]).reduce((x, y) => x + y) / 3;
    out.push({ label: 'Voltage imbalance', value: `${((Math.max(...(v as number[]).map((x) => Math.abs(x - a))) / a) * 100).toFixed(1)}%` });
  }
  const amps = [n('a_comp1_l1'), n('a_comp1_l2'), n('a_comp1_l3')];
  if (amps.every((x) => x !== undefined)) {
    const a = (amps as number[]).reduce((x, y) => x + y) / 3;
    if (a > 0.2) out.push({ label: 'Current imbalance', value: `${((Math.max(...(amps as number[]).map((x) => Math.abs(x - a))) / a) * 100).toFixed(0)}%` });
  }
  const cmd = n('vdc_act_cmd');
  if (cmd !== undefined) out.push({ label: 'Commanded damper', value: `${Math.max(0, ((cmd - 2) / 8) * 100).toFixed(0)}%` });
  return out;
}
