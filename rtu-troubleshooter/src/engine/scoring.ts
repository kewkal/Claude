import type { ActionDef, Choice, Difficulty, Scenario } from './types';

export const BASE_XP: Record<Difficulty, number> = { beginner: 100, medium: 200, advanced: 350, master: 500 };
export const HINTS_ALLOWED: Record<Difficulty, number> = { beginner: 99, medium: 2, advanced: 1, master: 0 };
export const SAFETY_PENALTY = 50;

export interface Penalty { id: string; title: string; why: string }

export interface CallScore {
  lines: { label: string; xp: number; note?: string }[];
  xp: number;
  partsLost: number;
  callback: boolean;
  correctRoot: boolean;
  wasted: string[];
}

export function scoreCall(opts: {
  sc: Scenario;
  diag: Choice;
  repair: Choice;
  actionsTaken: string[];
  minutes: number;
  hintsUsed: number;
  penalties: Penalty[];
  actionById: Record<string, ActionDef>;
}): CallScore {
  const { sc, diag, repair, actionsTaken, minutes, hintsUsed, penalties, actionById } = opts;
  const base = BASE_XP[sc.difficulty];
  const lines: CallScore['lines'] = [];
  let partsLost = 0;
  let callback = false;

  if (diag.correct) lines.push({ label: 'Correct root cause', xp: base });
  else {
    lines.push({ label: 'Wrong root cause', xp: 0, note: diag.feedback });
    callback = true;
  }

  if (repair.correct && diag.correct) lines.push({ label: 'Right repair', xp: Math.round(base * 0.5) });
  else if (repair.correct) lines.push({ label: 'Right repair, but for the wrong reason', xp: Math.round(base * 0.2) });
  else if (repair.symptomOnly) {
    lines.push({ label: 'Fixed the symptom, missed the root', xp: Math.round(base * 0.2), note: 'Callback flagged' });
    callback = true;
  } else if (repair.unneededPart) {
    lines.push({ label: 'Fixed it, but replaced a part it didn\'t need', xp: Math.round(base * 0.2), note: 'Callback flagged' });
    callback = true;
  } else {
    lines.push({ label: 'Wrong repair', xp: 0, note: repair.feedback });
    callback = true;
  }
  if (!repair.correct && repair.partsCost) {
    partsLost = repair.partsCost;
    lines.push({ label: `Truck budget: −$${repair.partsCost.toLocaleString()} parts`, xp: 0 });
  }

  const ideal = new Set(sc.idealPath.map((p) => p.action));
  const idealMinutes = sc.idealPath.reduce((m, p) => m + (actionById[p.action]?.minutes ?? 0), 0);
  const wasted = actionsTaken.filter((a, i) => actionById[a]?.group !== 'safety' && (!ideal.has(a) || actionsTaken.indexOf(a) !== i));
  if (diag.correct) {
    const t = minutes <= idealMinutes * 1.25 ? 0.25 : minutes <= idealMinutes * 2 ? 0.1 : 0;
    if (t) lines.push({ label: `Time bonus (${minutes} min vs ${idealMinutes} ideal)`, xp: Math.round(base * t) });
    const r = Math.max(0, 0.25 - wasted.length * 0.05);
    if (r) lines.push({ label: `Efficiency bonus (${wasted.length} extra readings)`, xp: Math.round(base * r) });
  }
  if (sc.difficulty !== 'beginner' && hintsUsed) lines.push({ label: `Hints used ×${hintsUsed}`, xp: -Math.round(base * 0.1 * hintsUsed) });
  for (const p of penalties) lines.push({ label: `SAFETY: ${p.title}`, xp: -SAFETY_PENALTY, note: p.why });

  const xp = Math.max(0, lines.reduce((s, l) => s + l.xp, 0));
  return { lines, xp, partsLost, callback, correctRoot: !!diag.correct, wasted };
}

/** Stable shuffle so the right answer isn't always first. */
export function stableShuffle<T extends { id: string }>(arr: T[], seed: string): T[] {
  const h = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  return [...arr].sort((a, b) => h(seed + a.id) - h(seed + b.id));
}

export function clockAt(start: string, minutes: number): string {
  const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(start);
  if (!m) return `+${minutes} min`;
  let total = ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]) + minutes;
  total %= 24 * 60;
  const h = Math.floor(total / 60);
  return `${((h + 11) % 12) + 1}:${String(total % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
