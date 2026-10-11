import { useState } from 'react';
import { componentById, components, unitById } from '../content';
import type { UnitId } from '../engine/types';
import { Pill, SourceTag, SV } from '../ui/Tags';

export function LibraryList({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {components.map((c) => (
        <button key={c.id} onClick={() => onOpen(c.id)} className="w-full rounded-xl bg-slate-800 p-4 text-left active:bg-slate-700">
          <div className="font-semibold text-slate-100">{c.name}</div>
          <div className="mt-1 flex gap-1.5"><Pill>{c.domain}</Pill><Pill tone="violet">{c.failureModes.length} failure modes</Pill></div>
        </button>
      ))}
      <p className="pt-2 text-center text-xs text-slate-500">6 of the full library. The rest fills in after play-test.</p>
    </div>
  );
}

export function ComponentDetail({ id }: { id: string }) {
  const c = componentById[id];
  const unitIds = Object.keys(c.perUnit) as UnitId[];
  const [u, setU] = useState<UnitId>(unitIds[0]);
  const per = c.perUnit[u]!;
  const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-widest text-amber-400">{children}</h3>;
  return (
    <div className="pb-8 text-sm leading-relaxed text-slate-200">
      <h2 className="text-xl font-bold text-white">{c.name}</h2>
      <p className="mt-2">{c.function}</p>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-800 p-1 text-xs font-semibold">
        {unitIds.map((x) => (
          <button key={x} onClick={() => setU(x)} className={`rounded-md py-2 ${u === x ? 'bg-slate-600 text-white' : 'text-slate-400'}`}>{unitById[x].shortName}</button>
        ))}
      </div>
      <div className="mt-2 space-y-1.5 rounded-lg bg-slate-800/60 p-3 text-xs">
        <div><b>Status:</b> <SV s={per.availability} /></div>
        <div><b>Designation:</b> <SV s={per.designation} /></div>
        <div><b>Where:</b> <SV s={per.location} /></div>
        <div><b>Part #:</b> <SV s={per.partNumber} /></div>
        <div><b>Sequence role:</b> {per.sequenceRole}</div>
      </div>
      <H>Failure modes</H>
      <div className="space-y-2">
        {c.failureModes.map((f) => (
          <div key={f.id} className="rounded-lg bg-slate-800 p-3">
            <div className="font-semibold text-white">{f.name}</div>
            <div className="text-xs text-slate-300">{f.goodVsBad}</div>
            <div className="mt-1 text-xs text-slate-400">Symptoms: {f.symptoms}</div>
          </div>
        ))}
      </div>
      <H>How to test</H>
      <p className="text-xs text-slate-400">{c.test.meter}</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5">{c.test.procedure.map((s) => <li key={s}>{s}</li>)}</ol>
      <H>Pass / fail</H>
      {Object.entries(c.thresholds).map(([k, s]) => (
        <div key={k} className="text-xs">{k}: <span className="font-mono">{Array.isArray(s.value) ? s.value.join(' – ') : String(s.value)}</span> <SourceTag s={s} />{s.note && <div className="text-slate-500">{s.note}</div>}</div>
      ))}
      <H>Symptoms</H>
      <p><b>Customer:</b> {c.symptoms.customer}</p>
      <p><b>Tech:</b> {c.symptoms.tech}</p>
      <H>Confused with</H>
      <ul className="list-disc space-y-1 pl-5">{c.confusedWith.map((s) => <li key={s}>{s}</li>)}</ul>
      <H>Safety</H>
      <ul className="list-disc space-y-1 pl-5 text-rose-200">{c.test.safety.map((s) => <li key={s}>{s}</li>)}</ul>
    </div>
  );
}
