import { useMemo, useRef, useState } from 'react';
import { components, unitById } from '../content';
import type { Component, DisplayKind, LabCase, ReadingValue } from '../engine/types';
import { update, useProgress } from '../state/progress';
import { ReadingDisplay } from '../ui/Meters';
import { Pill, SourceTag } from '../ui/Tags';

const labDisplay = (k: string): { display: DisplayKind; unit: string } => {
  if (k.startsWith('drop_') || k === 'vac') return { display: 'dmm-vac', unit: 'VAC' };
  if (k === 'vdc') return { display: 'dmm-vdc', unit: 'VDC' };
  if (k === 'uf') return { display: 'dmm-uf', unit: 'µF' };
  if (k === 'ref_temp_f') return { display: 'thermo', unit: '°F' };
  if (k === 'shaft_pct') return { display: 'percent', unit: '%' };
  if (k.endsWith('_psig')) return { display: 'gauge-low', unit: 'PSIG' };
  if (k === 'stroke_s') return { display: 'dmm-vdc', unit: 's' };
  if (k.includes('ohm') || k.startsWith('no_') || k.startsWith('nc_')) return { display: 'dmm-ohm', unit: 'Ω' };
  return { display: 'text', unit: '' };
};
const labLabel: Record<string, string> = {
  coil_ohm: 'Coil', drop_p1: 'Pole 1 (L1-T1)', drop_p2: 'Pole 2 (L2-T2)', drop_p3: 'Pole 3 (L3-T3)', uf: 'Capacitance', case: 'Case', visual: 'Visual',
  no_deenergized: 'NO contacts, coil off', nc_deenergized: 'NC contacts, coil off', no_energized: 'NO contacts, coil on', nc_energized: 'NC contacts, coil on',
  opened_at_psig: 'Opened at', closed_at_psig: 'Closed at', ohm_above: 'Continuity above cut-in', ref_temp_f: 'Reference probe', ohm: 'Sensor resistance',
  vac: '24 VAC supply', vdc: 'Signal in', shaft_pct: 'Shaft position', stroke_s: 'Full-stroke time', motor_sound: 'Motor sound',
};

function pick(pool: { comp: Component; lab: LabCase }[], last?: string) {
  const choices = pool.length > 1 ? pool.filter((p) => p.lab.id !== last) : pool;
  return choices[Math.floor(Math.random() * choices.length)];
}

export function ComponentLab({ onOpenComponent }: { onOpenComponent: (id: string) => void }) {
  const progress = useProgress();
  const [filter, setFilter] = useState<string | null>(null);
  const pool = useMemo(() => components.flatMap((comp) => comp.labCases.map((lab) => ({ comp, lab }))).filter((p) => !filter || p.comp.id === filter), [filter]);
  const [cur, setCur] = useState(() => pick(pool));
  const [run, setRun] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<LabCase['condition'] | null>(null);
  const [result, setResult] = useState<{ ok: boolean; mode?: string; xp: number; secs: number } | null>(null);
  const t0 = useRef(Date.now());

  const next = (f = filter) => {
    const p = components.flatMap((comp) => comp.labCases.map((lab) => ({ comp, lab }))).filter((x) => !f || x.comp.id === f);
    setCur(pick(p, cur?.lab.id));
    setRun([]);
    setVerdict(null);
    setResult(null);
    t0.current = Date.now();
  };

  const rule = (cond: LabCase['condition'], mode?: string) => {
    const secs = Math.round((Date.now() - t0.current) / 1000);
    const ok = cond === cur.lab.condition && (cond === 'good' || mode === cur.lab.failureMode);
    const xp = ok ? 30 + (secs <= 45 ? 15 : 0) : 0;
    setResult({ ok, mode, xp, secs });
    update((p) => {
      const streak = ok ? p.lab.streak + 1 : 0;
      return { ...p, xp: p.xp + xp, lab: { attempts: p.lab.attempts + 1, correct: p.lab.correct + (ok ? 1 : 0), streak, bestStreak: Math.max(p.lab.bestStreak, streak) } };
    });
  };

  const { comp, lab } = cur;
  const unit = unitById[lab.unitId];
  const per = comp.perUnit[lab.unitId];
  const tested = lab.tests.filter((t) => run.includes(t.id));

  return (
    <div className="space-y-3 pb-6">
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {[{ id: null, name: 'All parts' }, ...components.map((c) => ({ id: c.id, name: c.name.split('(')[0].replace('Honeywell ', '').trim() }))].map((c) => (
          <button key={c.id ?? 'all'} onClick={() => { setFilter(c.id); next(c.id); }} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${filter === c.id ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 text-slate-300'}`}>
            {c.name}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Streak <b className="text-amber-300">{progress.lab.streak}</b> · Best {progress.lab.bestStreak}</span>
        <span className="text-slate-400">{progress.lab.correct}/{progress.lab.attempts} correct</span>
      </div>

      <div className="rounded-xl bg-slate-800 p-4">
        <div className="flex flex-wrap gap-1.5"><Pill>{unit.shortName}</Pill><Pill tone="violet">{lab.designation}</Pill></div>
        <h2 className="mt-2 text-lg font-bold text-white">{comp.name}</h2>
        <p className="mt-1 text-sm text-slate-300">{lab.context}</p>
        <div className="mt-3 rounded-lg bg-slate-900/60 p-2 text-xs text-slate-300">
          <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Rating label</div>
          {Object.entries(lab.rating).map(([k, v]) => <div key={k}>{k}: <span className="font-mono text-slate-100">{String(v)}</span></div>)}
          <div className="mt-1"><SourceTag s={{ verified: false, note: 'Training rating values. Real ratings come from the part label / parts list.' }} /></div>
        </div>
        {per && <p className="mt-2 text-xs text-slate-500">Location: {per.location.value} <SourceTag s={per.location} /></p>}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose your tests</div>
        {lab.tests.map((t) => (
          <button key={t.id} disabled={run.includes(t.id)} onClick={() => setRun((r) => [...r, t.id])} className="flex w-full justify-between rounded-lg bg-slate-800 px-3 py-3 text-left text-sm text-slate-200 disabled:opacity-50">
            <span>{t.label} <span className="text-xs text-slate-500">({t.setup})</span></span>
            <span className="shrink-0 text-xs text-slate-500">{t.power === 'on' ? '⚡' : '🔒'}</span>
          </button>
        ))}
      </div>

      {tested.map((t) => (
        <div key={t.id} className="space-y-3 rounded-xl bg-slate-800 p-3">
          <div className="text-xs font-semibold text-slate-300">{t.label}</div>
          {Object.entries(t.readings).map(([k, v]) => {
            const d = labDisplay(k);
            return (
              <div key={k}>
                <div className="mb-1 text-[11px] text-slate-400">{labLabel[k] ?? k}</div>
                <ReadingDisplay def={{ label: k, unit: d.unit, display: d.display, power: 'any' }} value={v as ReadingValue} />
              </div>
            );
          })}
        </div>
      ))}

      {!result && run.length > 0 && (
        <div className="space-y-2 rounded-xl border border-slate-700 p-3">
          <div className="text-sm font-semibold text-white">Your call</div>
          <div className="grid grid-cols-3 gap-2">
            {(['good', 'marginal', 'bad'] as const).map((c) => (
              <button key={c} onClick={() => (c === 'good' ? rule('good') : setVerdict(c))} className={`rounded-lg py-3 text-sm font-bold uppercase ${verdict === c ? 'ring-2 ring-white' : ''} ${{ good: 'bg-emerald-600 text-white', marginal: 'bg-amber-500 text-slate-900', bad: 'bg-rose-600 text-white' }[c]}`}>
                {c}
              </button>
            ))}
          </div>
          {verdict && (
            <div className="space-y-1.5 pt-1">
              <div className="text-xs text-slate-400">Name the failure mode:</div>
              {comp.failureModes.map((f) => (
                <button key={f.id} onClick={() => rule(verdict, f.id)} className="w-full rounded-lg bg-slate-800 px-3 py-2.5 text-left text-sm text-slate-200">{f.name}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={`space-y-2 rounded-xl p-4 ${result.ok ? 'bg-emerald-600/20' : 'bg-rose-600/20'}`}>
          <div className="text-xl font-black text-white">{result.ok ? `Correct · +${result.xp} XP` : 'Wrong call'}</div>
          <div className="text-xs text-slate-300">{result.secs}s{result.ok && result.secs <= 45 ? ' · speed bonus' : ''}</div>
          <div className="text-sm text-slate-200">
            Truth: <b className="uppercase">{lab.condition}</b>
            {lab.failureMode && ` · ${comp.failureModes.find((f) => f.id === lab.failureMode)?.name}`}
          </div>
          <p className="text-sm text-slate-200">{lab.explanation}</p>
          <div className="rounded-lg bg-slate-900/50 p-2 text-xs text-slate-300">
            <div className="mb-1 font-semibold text-slate-400">Pass/fail thresholds used</div>
            {Object.entries(comp.thresholds).map(([k, s]) => (
              <div key={k}>{k}: <span className="font-mono">{Array.isArray(s.value) ? s.value.join(' – ') : String(s.value)}</span> <SourceTag s={s} /></div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={() => onOpenComponent(comp.id)} className="flex-1 rounded-lg border border-sky-500/40 py-3 text-sm font-semibold text-sky-300">📘 Library</button>
            <button onClick={() => next()} className="flex-1 rounded-lg bg-amber-500 py-3 text-sm font-bold text-slate-900">Next part →</button>
          </div>
        </div>
      )}
    </div>
  );
}
