import type { Sourced } from '../engine/types';

export function SourceTag({ s }: { s?: Pick<Sourced<unknown>, 'verified' | 'basis' | 'source' | 'note'> }) {
  if (!s) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {!s.verified && (
        <span title={s.note ?? 'Not yet sourced from /docs'} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
          ⚠ generic value
        </span>
      )}
      {s.basis === 'rule-of-thumb' && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-sky-300">rule of thumb</span>}
      {s.verified && s.source && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">{s.source}</span>}
    </span>
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
