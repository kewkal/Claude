import { useMemo, useState } from 'react';
import { actionById, actionDefs, componentById, readingDefs, scenarios, unitById } from '../content';
import { mergedReadings } from '../engine/rules';
import { clockAt, HINTS_ALLOWED, scoreCall, stableShuffle, type CallScore, type Penalty } from '../engine/scoring';
import type { ActionDef, Choice, ReadingValue, Scenario } from '../engine/types';
import { update, useProgress } from '../state/progress';
import { JadeSim, defaultJadeValues } from '../ui/JadeSim';
import { Ladder, ladderPoints, type TestPoint } from '../ui/Ladder';
import { ReadingDisplay, derived } from '../ui/Meters';
import { Pill, SourceTag, difficultyTone } from '../ui/Tags';

const GROUPS: { id: ActionDef['group']; label: string }[] = [
  { id: 'safety', label: '🔒 Safety / power' },
  { id: 'look', label: '👀 Look & listen' },
  { id: 'controls', label: '🎛 Controls & safeties' },
  { id: 'jade', label: '🟩 JADE' },
  { id: 'electrical', label: '⚡ Electrical' },
  { id: 'refrigeration', label: '❄️ Refrigeration' },
  { id: 'air', label: '🌬 Air side' },
  { id: 'economizer', label: '🪟 Economizer' },
  { id: 'hands-on', label: '🔧 Hands-on' },
];

const SAFETY_RULES: Record<string, Omit<Penalty, 'id'>> = {
  'ohms-live': { title: 'Resistance/capacitance test on a live circuit', why: 'Ohmmeters and capacitance meters go on de-energized circuits only. Live voltage can destroy the meter and put an arc in your face. LOTO, then verify dead.' },
  'no-verify': { title: 'Touched it without verifying zero energy', why: 'A lock on the disconnect isn\'t proof. Back-feeds, wrong disconnect, a second source. Live-dead-live test before you touch anything.' },
  'jumper-left': { title: 'Left a safety jumped out', why: 'A jumped LPS lets the compressor pull into a vacuum and destroy itself. Pull every jumper before you leave.' },
};

type Phase = 'dispatch' | 'work' | 'diagnose' | 'repair' | 'debrief';
type Power = 'live' | 'locked' | 'verified';
interface LogEntry { action: string; minute: number; readings: string[]; note?: string }

export function ServiceCallList({ onPlay }: { onPlay: (id: string) => void }) {
  const p = useProgress();
  const done = new Set(p.calls.filter((c) => c.correctRoot).map((c) => c.scenarioId));
  return (
    <div className="space-y-3">
      {scenarios.map((s) => (
        <button key={s.id} onClick={() => onPlay(s.id)} className="w-full rounded-xl bg-slate-800 p-4 text-left active:bg-slate-700">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={difficultyTone[s.difficulty]}>{s.difficulty}</Pill>
            <Pill>{unitById[s.unitId].shortName}</Pill>
            {s.honeywell && <Pill tone="emerald">Honeywell</Pill>}
            {done.has(s.id) && <span className="ml-auto text-emerald-400">✓</span>}
          </div>
          <div className="mt-2 font-semibold text-slate-100">{s.title}</div>
          <div className="mt-1 text-sm italic text-slate-400">“{s.dispatch.complaint}”</div>
        </button>
      ))}
    </div>
  );
}

export function ServiceCallGame({ id, onExit, onOpenComponent }: { id: string; onExit: () => void; onOpenComponent: (id: string) => void }) {
  const sc = scenarios.find((s) => s.id === id) as Scenario;
  const unit = unitById[sc.unitId];
  const all = useMemo(() => mergedReadings(sc, unit), [sc, unit]);
  const points = useMemo(() => ladderPoints(sc, unit, all), [sc, unit, all]);
  const jadeValues = useMemo(() => {
    // Defaults < values implied by the measured readings < scenario's explicit snapshot.
    const v = defaultJadeValues();
    const n = (k: string) => (typeof all[k] === 'number' ? (all[k] as number) : undefined);
    if (n('t_mat') !== undefined) v['MA TEMP'] = n('t_mat')!;
    if (n('t_oat') !== undefined) v['OA TEMP'] = n('t_oat')!;
    if (n('vdc_act_cmd') !== undefined) v['DAMPER OUT'] = n('vdc_act_cmd')!;
    if (n('t_oat') !== undefined) v['ECON AVAIL'] = n('t_oat')! < Number(v['DRYBLB SET']) ? 'YES' : 'NO';
    v['COOL Y1-IN'] = v['COOL Y1-OUT'] = sc.state.callForCooling ? 'ON' : 'OFF';
    v['MECH COOLING'] = ['running', 'short-cycling'].includes(sc.state.compressor1) ? 'ON' : 'OFF';
    return { ...v, ...(sc.jade?.values ?? {}) };
  }, [sc, all]);

  const [phase, setPhase] = useState<Phase>('dispatch');
  const [tab, setTab] = useState<'tools' | 'log' | 'jade' | 'ladder'>('tools');
  const [openGroup, setOpenGroup] = useState<string | null>('look');
  const [minutes, setMinutes] = useState(0);
  const [power, setPower] = useState<Power>('live');
  const [jumper, setJumper] = useState(false);
  const [taken, setTaken] = useState<Record<string, ReadingValue>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [ladderMeasured, setLadderMeasured] = useState<Record<string, number>>({});
  const [diag, setDiag] = useState<Choice | null>(null);
  const [score, setScore] = useState<CallScore | null>(null);
  const [repairChoice, setRepairChoice] = useState<Choice | null>(null);

  const hasJade = sc.dispatch.economizer.toLowerCase().includes('jade');
  const say = (text: string, bad = false) => {
    setToast({ text, bad });
    window.setTimeout(() => setToast(null), 3500);
  };
  const penalize = (id: string) => {
    if (penalties.some((p) => p.id === id)) return;
    setPenalties((ps) => [...ps, { id, ...SAFETY_RULES[id] }]);
    say(`SAFETY: ${SAFETY_RULES[id].title}`, true);
  };
  const addLog = (e: Omit<LogEntry, 'minute'>, cost: number) => {
    setLog((l) => [{ ...e, minute: minutes + cost }, ...l]);
    setMinutes((m) => m + cost);
  };

  const doAction = (a: ActionDef) => {
    if (a.id === 'loto') {
      if (power !== 'live') return say('Already locked out.');
      setPower('locked');
      return addLog({ action: a.id, readings: [], note: 'Disconnect off, lock and tag on.' }, a.minutes);
    }
    if (a.id === 'verify-dead') {
      if (power === 'live') return say(`Meter reads ${all.v_l1_l2 ?? '---'} V. It's live. Lock it out first.`, true);
      setPower('verified');
      return addLog({ action: a.id, readings: [], note: 'Live-dead-live: 0 V on all phases and to ground. Verified zero energy.' }, a.minutes);
    }
    if (a.id === 'restore') {
      if (power === 'live') return say('Power is already on.');
      setPower('live');
      return addLog({ action: a.id, readings: [], note: 'Lock off, power restored.' }, a.minutes);
    }
    if (a.id === 'remove-jumper') {
      if (!jumper) return say('No jumper installed.');
      setJumper(false);
      return addLog({ action: a.id, readings: [], note: 'Jumper removed. LPS back in circuit.' }, a.minutes);
    }
    if (a.power === 'off' && power !== 'verified') {
      penalize(power === 'live' ? 'ohms-live' : 'no-verify');
      return addLog({ action: a.id, readings: [], note: 'Reading refused. Wrong power state.' }, 1);
    }
    if (a.power === 'on' && power !== 'live') {
      say('Unit is locked out. No power, no reading.');
      return addLog({ action: a.id, readings: [], note: 'No reading. Unit de-energized.' }, 1);
    }
    if (a.id === 'jump-lps1') {
      setJumper(true);
      const lowSide = sc.faults.some((f) => f.type === 'low-charge');
      return addLog({ action: a.id, readings: [], note: lowSide ? 'Jumper in. Compressor keeps running and suction keeps falling on your gauges. The switch was telling the truth.' : 'Jumper in. No change in operation.' }, a.minutes);
    }
    if (a.id === 'jade') {
      setTab('jade');
      if (!log.some((l) => l.action === 'jade')) addLog({ action: a.id, readings: [], note: 'Opened the JADE display.' }, a.minutes);
      return;
    }
    const got: Record<string, ReadingValue> = {};
    for (const k of a.readings) if (all[k] !== undefined) got[k] = all[k];
    setTaken((t) => ({ ...t, ...got }));
    addLog({ action: a.id, readings: a.readings }, a.minutes);
    setTab('log');
  };

  const tapPoint = (p: TestPoint) => {
    if (power !== 'live') return say('Unit is locked out. Restore power to take voltages.');
    setLadderMeasured((m) => ({ ...m, [p.id]: p.volts }));
    setMinutes((m) => m + 1);
  };

  const submitRepair = (r: Choice) => {
    const pens = [...penalties];
    if (jumper) pens.push({ id: 'jumper-left', ...SAFETY_RULES['jumper-left'] });
    const s = scoreCall({
      sc, diag: diag!, repair: r, minutes, hintsUsed, penalties: pens, actionById,
      actionsTaken: [...log].reverse().map((l) => l.action),
    });
    setRepairChoice(r);
    setScore(s);
    setPhase('debrief');
    update((p) => ({
      ...p,
      xp: p.xp + s.xp,
      truckBudget: p.truckBudget - s.partsLost,
      callbacks: p.callbacks + (s.callback ? 1 : 0),
      calls: [...p.calls, { scenarioId: sc.id, at: Date.now(), xp: s.xp, correctRoot: s.correctRoot, callback: s.callback, minutes, safetyPenalties: pens.length }],
      missedConcepts: s.correctRoot ? p.missedConcepts : sc.concepts.reduce((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), p.missedConcepts),
    }));
  };

  const hintsLeft = HINTS_ALLOWED[sc.difficulty] - hintsUsed;
  const nextGuided = sc.difficulty === 'beginner' ? sc.idealPath.find((p) => !log.some((l) => l.action === p.action)) : undefined;
  const powerChip = { live: ['⚡ LIVE', 'bg-rose-500/20 text-rose-300'], locked: ['🔒 LOCKED (unverified)', 'bg-amber-500/20 text-amber-300'], verified: ['🔒 VERIFIED DEAD', 'bg-emerald-500/20 text-emerald-300'] }[power];

  // ----- Dispatch
  if (phase === 'dispatch')
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-amber-400">Dispatch</div>
          <h2 className="mt-1 text-xl font-bold text-white">{sc.title}</h2>
          <blockquote className="mt-3 border-l-4 border-amber-400 pl-3 text-lg italic text-slate-100">“{sc.dispatch.complaint}”</blockquote>
          <div className="mt-1 text-sm text-slate-400">— {sc.dispatch.customer}</div>
          <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-400">Unit</dt><dd className="text-slate-100">{unit.model.value}</dd>
            <dt className="text-slate-400">Economizer</dt><dd className="text-slate-100">{sc.dispatch.economizer}</dd>
            <dt className="text-slate-400">Outdoor</dt><dd className="text-slate-100">{sc.dispatch.outdoorF}°F / {sc.dispatch.outdoorRH}% RH</dd>
            <dt className="text-slate-400">Time</dt><dd className="text-slate-100">{sc.dispatch.timeOfDay}</dd>
            <dt className="text-slate-400">Refrigerant</dt><dd className="text-slate-100">{unit.refrigerant.value} <SourceTag s={unit.refrigerant} /></dd>
            <dt className="text-slate-400">Voltage</dt><dd className="text-slate-100">{unit.voltage.value} <SourceTag s={unit.voltage} /></dd>
          </dl>
          {sc.dispatch.notes && <p className="mt-3 rounded bg-slate-900/60 p-2 text-sm text-slate-300">📝 {sc.dispatch.notes}</p>}
        </div>
        <div className="flex gap-2 text-xs">
          <Pill tone={difficultyTone[sc.difficulty]}>{sc.difficulty}</Pill>
          {sc.domains.map((d) => <Pill key={d}>{d}</Pill>)}
        </div>
        <button onClick={() => setPhase('work')} className="w-full rounded-xl bg-amber-500 py-4 text-lg font-bold text-slate-900 active:bg-amber-400">Roll the truck →</button>
      </div>
    );

  // ----- Diagnose / Repair
  if (phase === 'diagnose' || phase === 'repair') {
    const choices = stableShuffle(phase === 'diagnose' ? sc.diagnosis : sc.repair, sc.id + phase);
    return (
      <div className="space-y-3">
        <h2 className="text-xl font-bold text-white">{phase === 'diagnose' ? 'What\'s the root cause?' : 'What\'s the fix?'}</h2>
        {phase === 'repair' && diag && <p className="text-sm text-slate-400">Your call: <span className="text-slate-200">{diag.label}</span></p>}
        {choices.map((c) => (
          <button key={c.id} onClick={() => (phase === 'diagnose' ? (setDiag(c), setPhase('repair')) : submitRepair(c))} className="w-full rounded-xl bg-slate-800 p-4 text-left text-slate-100 active:bg-slate-700">
            {c.label}
            {phase === 'repair' && c.partsCost ? <span className="ml-2 text-xs text-slate-400">${c.partsCost.toLocaleString()}</span> : null}
          </button>
        ))}
        <button onClick={() => setPhase(phase === 'diagnose' ? 'work' : 'diagnose')} className="w-full py-3 text-sm text-slate-400">← Back</button>
      </div>
    );
  }

  // ----- Debrief
  if (phase === 'debrief' && score && diag && repairChoice) {
    const did = new Set(log.map((l) => l.action));
    const root = sc.faults.find((f) => f.role === 'root');
    return (
      <div className="space-y-4">
        <div className={`rounded-xl p-4 ${score.correctRoot && !score.callback ? 'bg-emerald-600/20' : score.correctRoot ? 'bg-amber-500/15' : 'bg-rose-600/20'}`}>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-300">{score.correctRoot ? (score.callback ? 'Found it, but…' : 'Nailed it') : 'Missed it'}</div>
          <div className="mt-1 text-3xl font-black text-white">+{score.xp} XP</div>
          {score.callback && <div className="mt-1 text-sm font-semibold text-rose-300">📞 Callback flagged</div>}
        </div>
        <div className="rounded-xl bg-slate-800 p-4 text-sm">
          <p className="text-slate-300"><b className="text-slate-100">Your diagnosis:</b> {diag.label}<br /><span className="text-slate-400">{diag.feedback}</span></p>
          <p className="mt-2 text-slate-300"><b className="text-slate-100">Your repair:</b> {repairChoice.label}<br /><span className="text-slate-400">{repairChoice.feedback}</span></p>
        </div>
        <div className="rounded-xl bg-slate-800 p-4">
          <h3 className="mb-2 font-bold text-white">Score</h3>
          {score.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-2 border-b border-slate-700/60 py-1.5 text-sm last:border-0">
              <div>
                <div className="text-slate-200">{l.label}</div>
                {l.note && <div className="text-xs text-slate-400">{l.note}</div>}
              </div>
              <div className={`font-mono ${l.xp < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{l.xp >= 0 ? '+' : ''}{l.xp}</div>
            </div>
          ))}
        </div>
        <div className="rounded-xl bg-slate-800 p-4">
          <h3 className="mb-2 font-bold text-white">The clean diagnostic path</h3>
          <ol className="space-y-2 text-sm">
            {sc.idealPath.map((p, i) => (
              <li key={i} className="flex gap-2">
                <span className={did.has(p.action) ? 'text-emerald-400' : 'text-slate-500'}>{did.has(p.action) ? '✓' : '○'}</span>
                <span><b className="text-slate-100">{actionById[p.action]?.label}</b> <span className="text-slate-400">· {p.why}</span></span>
              </li>
            ))}
          </ol>
          {score.wasted.length > 0 && (
            <p className="mt-3 text-xs text-slate-400">Extra steps you took: {score.wasted.map((a) => actionById[a]?.label ?? a).join(' · ')}</p>
          )}
        </div>
        <div className="rounded-xl bg-slate-800 p-4 text-sm leading-relaxed text-slate-200">
          <h3 className="mb-1 font-bold text-white">Why</h3>
          {sc.debrief}
          <div className="mt-3 space-y-1">
            {sc.faults.map((f, i) => (
              <div key={i} className="text-xs text-slate-400">
                <Pill tone={f.role === 'root' ? 'rose' : 'slate'}>{f.role}</Pill> {f.description}
              </div>
            ))}
          </div>
        </div>
        {root?.componentId && componentById[root.componentId] && (
          <button onClick={() => onOpenComponent(root.componentId!)} className="w-full rounded-xl border border-sky-500/40 bg-sky-500/10 py-3 font-semibold text-sky-300">
            📘 Component Library: {componentById[root.componentId].name}
          </button>
        )}
        <button onClick={onExit} className="w-full rounded-xl bg-amber-500 py-4 font-bold text-slate-900">Back to dispatch board</button>
      </div>
    );
  }

  // ----- Work loop
  const der = derived(taken);
  return (
    <div className="space-y-3 pb-28">
      <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-slate-800 bg-slate-950/95 px-4 pb-2 pt-1 backdrop-blur">
        <div className="flex items-center justify-between text-sm">
          <span className="font-mono text-lg font-bold text-amber-300">🕐 {clockAt(sc.dispatch.timeOfDay, minutes)}</span>
          <span className="text-slate-400">{minutes} min on site</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${powerChip[1]}`}>{powerChip[0]}</span>
          {jumper && <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[11px] font-bold text-white">⚠ LPS JUMPED</span>}
          {penalties.length > 0 && <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-300">Safety ×{penalties.length}</span>}
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-lg bg-slate-800 p-1 text-xs font-semibold">
          {(['tools', 'log', 'jade', 'ladder'] as const).filter((t) => t !== 'jade' || hasJade).map((t) => (
            <button key={t} onClick={() => (t === 'jade' && power !== 'live' ? say('JADE is dark. Unit locked out.') : t === 'jade' ? doAction(actionById.jade) : setTab(t))} className={`rounded-md py-2 ${tab === t ? 'bg-slate-600 text-white' : 'text-slate-400'}`}>
              {{ tools: 'Tools', log: `Readings${log.length ? ` (${log.length})` : ''}`, jade: 'JADE', ladder: 'Ladder' }[t]}
            </button>
          ))}
        </div>
      </div>

      {nextGuided && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <b>Next step:</b> {actionById[nextGuided.action]?.label}
        </div>
      )}

      {tab === 'tools' && (
        <div className="space-y-2">
          {GROUPS.map((g) => {
            const acts = actionDefs.filter((a) => a.group === g.id && a.id !== 'jade' && (g.id !== 'jade' || hasJade) && (g.id !== 'economizer' || sc.dispatch.economizer !== 'none'));
            if (!acts.length) return null;
            const open = openGroup === g.id;
            return (
              <div key={g.id} className="overflow-hidden rounded-xl bg-slate-800">
                <button onClick={() => setOpenGroup(open ? null : g.id)} className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold text-slate-100">
                  {g.label}<span className="text-slate-500">{open ? '−' : '+'}</span>
                </button>
                {open && (
                  <div className="space-y-1 px-2 pb-2">
                    {acts.map((a) => (
                      <button key={a.id} onClick={() => doAction(a)} className="flex w-full items-center justify-between rounded-lg bg-slate-900/60 px-3 py-3 text-left text-sm text-slate-200 active:bg-slate-700">
                        <span>{a.label}{log.some((l) => l.action === a.id) && <span className="ml-1 text-emerald-400">✓</span>}</span>
                        <span className="ml-2 shrink-0 text-xs text-slate-500">{a.minutes}m{a.power === 'off' ? ' · 🔒' : a.power === 'on' ? ' · ⚡' : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'log' && (
        <div className="space-y-2">
          {der.length > 0 && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
              {der.map((d) => (
                <div key={d.label}><div className="text-[11px] text-sky-300">{d.label}</div><div className="font-mono font-bold text-white">{d.value}</div></div>
              ))}
            </div>
          )}
          {log.length === 0 && <p className="py-8 text-center text-slate-500">No readings yet. Open Tools.</p>}
          {log.map((l, i) => (
            <div key={i} className="rounded-xl bg-slate-800 p-3">
              <div className="mb-2 flex justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">{actionById[l.action]?.label}</span>
                <span>{clockAt(sc.dispatch.timeOfDay, l.minute)}</span>
              </div>
              {l.note && <p className="text-sm text-slate-300">{l.note}</p>}
              <div className="space-y-3">
                {l.readings.map((k) => (
                  <div key={k}>
                    <div className="mb-1 text-[11px] text-slate-400">{readingDefs[k].label}</div>
                    <ReadingDisplay def={readingDefs[k]} value={all[k]} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {log.length > 0 && (
            <p className="text-center text-[11px] text-slate-500">
              Reference readings are representative values, not OEM charging-chart data <SourceTag s={{ verified: false }} />
            </p>
          )}
        </div>
      )}

      {tab === 'jade' && hasJade && (
        <JadeSim
          values={jadeValues}
          alarms={sc.jade?.alarms ?? []}
          onAction={(k) => {
            setMinutes((m) => m + 2);
            setTaken((t) => ({ ...t, txt_jade_checkout: all.txt_jade_checkout }));
            setLog((l) => [{ action: 'jade-checkout', minute: minutes + 2, readings: ['txt_jade_checkout'], note: `Ran ${k}.` }, ...l]);
            return k.startsWith('DAMPER') ? 'SEE READINGS' : 'Y OUT ENERGIZED';
          }}
        />
      )}

      {tab === 'ladder' && <Ladder points={points} measured={ladderMeasured} onTap={tapPoint} />}

      {toast && (
        <div className={`fixed inset-x-4 bottom-24 z-30 mx-auto max-w-md rounded-xl p-3 text-sm font-semibold shadow-xl ${toast.bad ? 'bg-rose-600 text-white' : 'bg-slate-700 text-slate-100'}`}>{toast.text}</div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-800 bg-slate-950/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-md gap-2">
          <button
            disabled={hintsLeft <= 0 || hintsUsed >= sc.hints.length}
            onClick={() => {
              say(`💡 ${sc.hints[hintsUsed]}`);
              setHintsUsed((h) => h + 1);
            }}
            className="rounded-xl bg-slate-800 px-4 py-4 text-sm font-semibold text-slate-200 disabled:opacity-30"
          >
            💡{sc.difficulty !== 'beginner' && hintsLeft > 0 ? ` ${Math.min(hintsLeft, sc.hints.length - hintsUsed)}` : ''}
          </button>
          <button onClick={() => setPhase('diagnose')} className="flex-1 rounded-xl bg-amber-500 py-4 font-bold text-slate-900 active:bg-amber-400">Make the call →</button>
        </div>
      </div>
    </div>
  );
}
