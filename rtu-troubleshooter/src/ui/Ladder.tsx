import type { ReadingValue, Scenario } from '../engine/types';
import type { Unit } from '../content';
import { SourceTag } from './Tags';

export interface TestPoint { id: string; label: string; volts: number }

/** Voltage from each point to C, derived from the scenario's measured values so it can't contradict them. */
export function ladderPoints(sc: Scenario, unit: Unit, r: Record<string, ReadingValue>): TestPoint[] {
  const d = (k: string) => unit.designations[k]?.value ?? k;
  const num = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : undefined);
  const sec = num('v_xfmr_sec') ?? 24;
  const out = sc.state.callForCooling && sc.state.compressor1 !== 'locked-out' ? sec : 0;
  const hpsOpen = sc.faults.some((f) => f.type === 'hps-trip') && sc.state.compressor1 === 'tripped';
  const afterHps = hpsOpen ? 0 : out;
  const afterLps = (num('v_lps1') ?? 0) > 20 ? 0 : afterHps;
  const coil = num('v_cc1_coil') ?? afterLps;
  return [
    { id: 'tp1', label: `${d('xfmr')} secondary (R)`, volts: sec },
    { id: 'tp2', label: 'Load side of control fuse', volts: sec },
    { id: 'tp3', label: `${d('controller')} (compressor 1 call)`, volts: out },
    { id: 'tp4', label: `Load side of ${d('hps1')} (HPS)`, volts: afterHps },
    { id: 'tp5', label: `Load side of ${d('lps1')} (LPS)`, volts: afterLps },
    { id: 'tp6', label: `${d('cc1')} coil, line side`, volts: coil },
  ];
}

export function Ladder({ points, measured, onTap }: { points: TestPoint[]; measured: Record<string, number>; onTap: (p: TestPoint) => void }) {
  const xs = [30, 80, 140, 200, 260, 320];
  const parts = [
    { x: 55, label: 'FU' },
    { x: 110, label: 'OUT', box: true },
    { x: 170, label: 'HPS', sw: true },
    { x: 230, label: 'LPS', sw: true },
    { x: 290, label: 'COIL', coil: true },
  ];
  return (
    <div className="space-y-2">
      <svg viewBox="0 0 370 120" className="w-full rounded-lg border border-slate-700 bg-slate-900">
        <text x="8" y="16" fontSize="9" fill="#94a3b8">24 VAC compressor 1 control rung (simplified)</text>
        <line x1="14" y1="30" x2="14" y2="110" stroke="#f59e0b" strokeWidth="2" />
        <text x="4" y="118" fontSize="8" fill="#f59e0b">R</text>
        <line x1="356" y1="30" x2="356" y2="110" stroke="#38bdf8" strokeWidth="2" />
        <text x="350" y="118" fontSize="8" fill="#38bdf8">C</text>
        <line x1="14" y1="70" x2="356" y2="70" stroke="#64748b" strokeWidth="1.5" />
        {parts.map((p) => (
          <g key={p.label}>
            {p.coil ? (
              <circle cx={p.x} cy={70} r={11} fill="#0f172a" stroke="#e2e8f0" strokeWidth="1.5" />
            ) : p.sw ? (
              <>
                <rect x={p.x - 12} y={62} width={24} height={16} fill="#0f172a" />
                <line x1={p.x - 12} y1={70} x2={p.x + 8} y2={60} stroke="#e2e8f0" strokeWidth="1.5" />
              </>
            ) : (
              <rect x={p.x - 12} y={63} width={24} height={14} fill="#0f172a" stroke="#e2e8f0" strokeWidth="1.5" rx={p.box ? 2 : 6} />
            )}
            <text x={p.x} y={95} fontSize="8" textAnchor="middle" fill="#cbd5e1">{p.label}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={p.id} onClick={() => onTap(p)} className="cursor-pointer">
            <circle cx={xs[i]} cy={70} r={9} fill="transparent" />
            <circle cx={xs[i]} cy={70} r={5} fill={measured[p.id] !== undefined ? '#10b981' : '#f43f5e'} stroke="#0f172a" strokeWidth="1.5" />
            <text x={xs[i]} y={50} fontSize="8" textAnchor="middle" fill="#fda4af">{`TP${i + 1}`}</text>
            {measured[p.id] !== undefined && (
              <text x={xs[i]} y={40} fontSize="9" textAnchor="middle" fill="#6ee7b7" fontWeight="bold">{measured[p.id].toFixed(1)}V</text>
            )}
          </g>
        ))}
      </svg>
      <div className="grid grid-cols-2 gap-2">
        {points.map((p, i) => (
          <button key={p.id} onClick={() => onTap(p)} className="rounded-lg bg-slate-800 px-2 py-2 text-left text-xs text-slate-200 active:bg-slate-700">
            <span className="font-bold text-rose-300">TP{i + 1}</span> {p.label}
            {measured[p.id] !== undefined && <span className="ml-1 font-mono text-emerald-300">{measured[p.id].toFixed(1)} V</span>}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        Tap a test point to read it to C (1 min each, power on). Generic rung redraw, not the OEM wiring diagram. <SourceTag s={{ verified: false, note: 'Designations and rung order to be checked against the unit wiring diagram.' }} />
      </p>
    </div>
  );
}
