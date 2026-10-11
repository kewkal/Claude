import { useState } from 'react';
import { components, jobs, scenarios } from './content';
import { rankFor, resetProgress, useProgress } from './state/progress';
import { ServiceCallGame, ServiceCallList } from './modes/ServiceCall';
import { ComponentLab } from './modes/ComponentLab';
import { CommissioningGame, CommissioningList } from './modes/Commissioning';
import { ComponentDetail, LibraryList } from './modes/Library';

type Screen =
  | { s: 'home' }
  | { s: 'calls' }
  | { s: 'call'; id: string }
  | { s: 'lab' }
  | { s: 'jobs' }
  | { s: 'job'; id: string }
  | { s: 'library' };

const TITLES: Record<Screen['s'], string> = { home: 'RTU Troubleshooter', calls: 'Service Calls', call: 'Service Call', lab: 'Component Lab', jobs: 'JADE Commissioning', job: 'JADE Commissioning', library: 'Component Library' };

export default function App() {
  const [stack, setStack] = useState<Screen[]>([{ s: 'home' }]);
  const [sheet, setSheet] = useState<string | null>(null);
  const screen = stack[stack.length - 1];
  const go = (x: Screen) => setStack((st) => [...st, x]);
  const back = () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
  const p = useProgress();
  const r = rankFor(p.xp);

  return (
    <div className="mx-auto min-h-full max-w-md bg-slate-950 px-4 pb-6 text-slate-100">
      <header className="flex items-center gap-3 py-3">
        {stack.length > 1 && <button onClick={back} className="-ml-2 rounded-full px-3 py-2 text-xl text-slate-300 active:bg-slate-800" aria-label="Back">‹</button>}
        <h1 className="flex-1 truncate text-lg font-bold">{TITLES[screen.s]}</h1>
        <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-semibold text-amber-300">{p.xp} XP</span>
      </header>

      {screen.s === 'home' && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 p-4">
            <div className="text-xs uppercase tracking-widest text-slate-400">Rank</div>
            <div className="text-2xl font-black text-white">{r.rank}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700"><div className="h-full bg-amber-400" style={{ width: `${Math.round(r.pct * 100)}%` }} /></div>
            <div className="mt-1 text-xs text-slate-400">{r.next ? `${r.toNext} XP to ${r.next}` : 'Top rank'}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-slate-950/50 p-2"><div className="font-mono text-lg font-bold text-emerald-300">${p.truckBudget.toLocaleString()}</div>truck budget</div>
              <div className="rounded-lg bg-slate-950/50 p-2"><div className="font-mono text-lg font-bold text-rose-300">{p.callbacks}</div>callbacks</div>
              <div className="rounded-lg bg-slate-950/50 p-2"><div className="font-mono text-lg font-bold text-sky-300">{p.lab.bestStreak}</div>best lab streak</div>
            </div>
          </div>
          {[
            { to: { s: 'calls' } as Screen, icon: '🚐', name: 'Service Call', sub: `${scenarios.length} calls · diagnose under the clock` },
            { to: { s: 'lab' } as Screen, icon: '🔬', name: 'Component Lab', sub: `${components.reduce((n, c) => n + c.labCases.length, 0)} bench tests · good, bad, or marginal` },
            { to: { s: 'jobs' } as Screen, icon: '🟩', name: 'JADE Commissioning', sub: `${jobs.length} jobs · set it up to spec` },
            { to: { s: 'library' } as Screen, icon: '📘', name: 'Component Library', sub: `${components.length} components · tests, thresholds, failure modes` },
          ].map((t) => (
            <button key={t.name} onClick={() => go(t.to)} className="flex w-full items-center gap-4 rounded-2xl bg-slate-800 p-4 text-left active:bg-slate-700">
              <span className="text-3xl">{t.icon}</span>
              <span><span className="block font-bold text-white">{t.name}</span><span className="text-sm text-slate-400">{t.sub}</span></span>
            </button>
          ))}
          <div className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
            Coming after play-test: Flashcards, Speed Round, Reading Interpreter, Sequence Builder, Wiring Trace, Component ID, badges & daily call.
          </div>
          <div className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200">
            ⚠ Build preview: unit specs, thresholds, JADE menus, and controller codes are flagged as generic until checked against the manuals in /docs. Look for the ⚠ tags.
          </div>
          <button onClick={() => confirm('Wipe all XP and progress?') && resetProgress()} className="w-full py-2 text-xs text-slate-600">Reset progress</button>
        </div>
      )}

      {screen.s === 'calls' && <ServiceCallList onPlay={(id) => go({ s: 'call', id })} />}
      {screen.s === 'call' && <ServiceCallGame key={screen.id} id={screen.id} onExit={back} onOpenComponent={setSheet} />}
      {screen.s === 'lab' && <ComponentLab onOpenComponent={setSheet} />}
      {screen.s === 'jobs' && <CommissioningList onPlay={(id) => go({ s: 'job', id })} />}
      {screen.s === 'job' && <CommissioningGame key={screen.id} id={screen.id} onExit={back} />}
      {screen.s === 'library' && <LibraryList onOpen={setSheet} />}

      {sheet && (
        <div className="fixed inset-0 z-40 flex flex-col bg-black/60" onClick={() => setSheet(null)}>
          <div className="mx-auto mt-10 w-full max-w-md flex-1 overflow-y-auto rounded-t-2xl bg-slate-900 px-4 pt-3" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex justify-end bg-slate-900 py-1"><button onClick={() => setSheet(null)} className="rounded-full bg-slate-800 px-3 py-1 text-sm">Close</button></div>
            <ComponentDetail id={sheet} />
          </div>
        </div>
      )}
    </div>
  );
}
