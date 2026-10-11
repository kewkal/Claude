import { useEffect, useRef, useState } from 'react';
import { jadeMenu, jobs, unitById, type CommissioningJob, type JadeItem } from '../content';
import { update, useProgress } from '../state/progress';
import { JadeSim, defaultJadeValues, type JadeValues } from '../ui/JadeSim';
import { Pill, SourceTag } from '../ui/Tags';

const PACKAGES = [
  { strategy: 'referential dry bulb', label: 'OA dry-bulb sensor only', parts: 'C7250A on OA' },
  { strategy: 'differential dry bulb', label: 'OA + RA dry-bulb sensors', parts: 'C7250A on OA and RA' },
  { strategy: 'referential enthalpy', label: 'OA enthalpy sensor only', parts: 'C7400S (Sylk) on OA' },
  { strategy: 'differential enthalpy', label: 'OA + RA enthalpy sensors', parts: 'C7400S (Sylk) on OA and RA' },
];

export function CommissioningList({ onPlay }: { onPlay: (id: string) => void }) {
  const p = useProgress();
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">Set up a JADE from the job spec. Wrong settings play out 30 days later.</p>
      {jobs.map((j) => (
        <button key={j.id} onClick={() => onPlay(j.id)} className="w-full rounded-xl bg-slate-800 p-4 text-left active:bg-slate-700">
          <div className="flex items-center gap-1.5">
            <Pill>{unitById[j.unitId].shortName}</Pill>
            {p.jobs[j.id] && <Pill tone={p.jobs[j.id].perfect ? 'emerald' : 'amber'}>best {p.jobs[j.id].bestScore}%</Pill>}
          </div>
          <div className="mt-2 font-semibold text-slate-100">{j.title}</div>
          <div className="mt-1 text-sm text-slate-400">{j.climate}</div>
        </button>
      ))}
    </div>
  );
}

interface Check { label: string; ok: boolean; got: string; want: string; consequence?: string }

export function CommissioningGame({ id, onExit }: { id: string; onExit: () => void }) {
  const job = jobs.find((j) => j.id === id) as CommissioningJob;
  const [step, setStep] = useState<'spec' | 'sensors' | 'jade' | 'result'>('spec');
  const [strategy, setStrategy] = useState<string | null>(null);
  const [co2, setCo2] = useState(false);
  const [values, setValues] = useState<JadeValues>(defaultJadeValues);
  const [ran, setRan] = useState<string[]>([]);
  const [secs, setSecs] = useState(0);
  const [checks, setChecks] = useState<Check[]>([]);
  const timer = useRef<number>();

  useEffect(() => {
    if (step === 'sensors' || step === 'jade') {
      timer.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
      return () => window.clearInterval(timer.current);
    }
  }, [step]);

  const enthalpy = strategy?.includes('enthalpy');
  const visible = (i: JadeItem) => {
    if (i.key === 'DRYBLB SET') return !enthalpy;
    if (i.key === 'ENTH CURVE') return !!enthalpy;
    if (['DCV SET', 'VENTMIN', 'VENTMAX', 'CO2 ZERO', 'CO2 SPAN'].includes(i.key)) return co2;
    if (i.key === 'MIN POS') return !co2;
    if (['OA HUM'].includes(i.key)) return !!enthalpy;
    if (['RA TEMP'].includes(i.key)) return !!strategy?.startsWith('differential');
    if (['RA HUM'].includes(i.key)) return strategy === 'differential enthalpy';
    if (['IN CO2', 'DCV STATUS'].includes(i.key)) return co2;
    return true;
  };

  const submit = () => {
    window.clearInterval(timer.current);
    const needsDcv = 'DCV SET' in job.targets;
    const c: Check[] = [
      { label: 'Strategy / sensor package', ok: strategy === job.strategy, got: strategy ?? 'none', want: job.strategy, consequence: job.consequences.strategy },
      { label: 'DCV (CO2 sensor)', ok: co2 === needsDcv, got: co2 ? 'installed' : 'none', want: needsDcv ? 'installed' : 'none', consequence: needsDcv ? job.consequences['DCV SET'] : 'CO2 sensor nobody asked for. Owner pays for a part that isn\'t in the spec.' },
    ];
    for (const [k, t] of Object.entries(job.targets)) {
      const v = values[k];
      const ok = typeof t.value === 'number' ? Math.abs(Number(v) - t.value) <= (t.tol ?? 0) + 1e-9 : String(v) === t.value;
      c.push({ label: k, ok, got: String(v), want: String(t.value), consequence: job.consequences[k] });
    }
    const missing = job.checkout.filter((k) => !ran.includes(k));
    c.push({ label: 'Checkout', ok: missing.length === 0, got: ran.length ? ran.join(', ') : 'none', want: job.checkout.join(', '), consequence: job.consequences.checkout });
    const pct = Math.round((c.filter((x) => x.ok).length / c.length) * 100);
    const perfect = pct === 100;
    const xp = pct * 2 + (perfect && secs <= job.parSeconds ? 50 : 0);
    setChecks(c);
    setStep('result');
    update((p) => ({
      ...p,
      xp: p.xp + xp,
      jobs: { ...p.jobs, [job.id]: { bestScore: Math.max(p.jobs[job.id]?.bestScore ?? 0, pct), perfect: (p.jobs[job.id]?.perfect ?? false) || perfect } },
    }));
  };

  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  if (step === 'spec')
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-800 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Job spec</div>
          <h2 className="mt-1 text-xl font-bold text-white">{job.title}</h2>
          <p className="mt-1 text-sm text-slate-400">{job.climate}</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-slate-200">{job.spec.map((s) => <li key={s}>{s}</li>)}</ul>
          <p className="mt-3 text-xs text-slate-500">{job.note} <SourceTag s={{ verified: false, note: job.note }} /></p>
        </div>
        <div className="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">{jadeMenu.minPosNote}</div>
        <button onClick={() => setStep('sensors')} className="w-full rounded-xl bg-emerald-500 py-4 font-bold text-slate-900">Start the clock →</button>
      </div>
    );

  if (step === 'sensors')
    return (
      <div className="space-y-3">
        <div className="flex justify-between text-sm"><span className="font-semibold text-white">1 · Which sensors go in?</span><span className="font-mono text-amber-300">{clock}</span></div>
        <p className="text-xs text-slate-400">The JADE picks its strategy from the sensors it detects.</p>
        {PACKAGES.map((p) => (
          <button key={p.strategy} onClick={() => setStrategy(p.strategy)} className={`w-full rounded-xl p-4 text-left ${strategy === p.strategy ? 'bg-emerald-600/30 ring-2 ring-emerald-400' : 'bg-slate-800'}`}>
            <div className="font-semibold text-slate-100">{p.label}</div>
            <div className="text-xs text-slate-400">{p.parts}</div>
          </button>
        ))}
        <label className="flex items-center gap-3 rounded-xl bg-slate-800 p-4 text-slate-100">
          <input type="checkbox" checked={co2} onChange={(e) => setCo2(e.target.checked)} className="h-5 w-5" />
          <span>Add CO2 sensor (C7232) for DCV</span>
        </label>
        <button disabled={!strategy} onClick={() => setStep('jade')} className="w-full rounded-xl bg-emerald-500 py-4 font-bold text-slate-900 disabled:opacity-40">Wire it up, power the JADE →</button>
      </div>
    );

  if (step === 'jade')
    return (
      <div className="space-y-3 pb-24">
        <div className="flex justify-between text-sm"><span className="font-semibold text-white">2 · Configure + checkout</span><span className="font-mono text-amber-300">{clock} / par {Math.floor(job.parSeconds / 60)}:{String(job.parSeconds % 60).padStart(2, '0')}</span></div>
        <details className="rounded-lg bg-slate-800 p-3 text-sm text-slate-300">
          <summary className="cursor-pointer font-semibold text-slate-100">Spec</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">{job.spec.map((s) => <li key={s}>{s}</li>)}</ul>
        </details>
        <JadeSim
          values={values}
          alarms={[]}
          editable
          visible={visible}
          onChange={(k, v) => setValues((vs) => ({ ...vs, [k]: v }))}
          onAction={(k) => {
            setRan((r) => (r.includes(k) ? r : [...r, k]));
            return { 'DAMPER OPEN': 'ACT 10.0V OPEN', 'DAMPER CLOSE': 'ACT 2.0V CLOSED', 'DAMPER MINIMUM POSITION': `ACT ${co2 ? values.VENTMIN : values['MIN POS']}V`, 'CONNECT Y1-O': 'Y1-O ON  STG1', 'CONNECT Y2-O': 'Y2-O ON  STG2' }[k] ?? 'OK';
          }}
        />
        {ran.length > 0 && <p className="text-xs text-emerald-300">Checkout done: {ran.join(' · ')}</p>}
        <div className="fixed inset-x-0 bottom-0 border-t border-slate-800 bg-slate-950/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
          <button onClick={submit} className="mx-auto block w-full max-w-md rounded-xl bg-emerald-500 py-4 font-bold text-slate-900">Sign off the job ✓</button>
        </div>
      </div>
    );

  const pct = Math.round((checks.filter((x) => x.ok).length / checks.length) * 100);
  return (
    <div className="space-y-3">
      <div className={`rounded-xl p-4 ${pct === 100 ? 'bg-emerald-600/20' : 'bg-amber-500/15'}`}>
        <div className="text-3xl font-black text-white">{pct}%</div>
        <div className="text-sm text-slate-300">Time {clock} (par {job.parSeconds}s){pct === 100 && secs <= job.parSeconds ? ' · speed bonus' : ''}</div>
      </div>
      {checks.map((c) => (
        <div key={c.label} className="rounded-xl bg-slate-800 p-3 text-sm">
          <div className="flex justify-between"><span className="font-semibold text-slate-100">{c.ok ? '✅' : '❌'} {c.label}</span></div>
          {!c.ok && (
            <>
              <div className="mt-1 text-xs text-slate-400">You: <span className="font-mono text-rose-300">{c.got}</span> · Spec: <span className="font-mono text-emerald-300">{c.want}</span></div>
              {c.consequence && <p className="mt-2 rounded bg-slate-900/60 p-2 text-slate-300">📅 {c.consequence}</p>}
            </>
          )}
        </div>
      ))}
      <button onClick={onExit} className="w-full rounded-xl bg-emerald-500 py-4 font-bold text-slate-900">Back to jobs</button>
    </div>
  );
}
