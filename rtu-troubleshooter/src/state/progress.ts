import { useSyncExternalStore } from 'react';

export interface CallResult {
  scenarioId: string;
  at: number;
  xp: number;
  correctRoot: boolean;
  callback: boolean;
  minutes: number;
  safetyPenalties: number;
}

export interface Progress {
  xp: number;
  truckBudget: number;
  callbacks: number;
  calls: CallResult[];
  lab: { attempts: number; correct: number; streak: number; bestStreak: number };
  jobs: Record<string, { bestScore: number; perfect: boolean }>;
  missedConcepts: Record<string, number>;
}

const KEY = 'rtu-troubleshooter:v1';
const fresh = (): Progress => ({
  xp: 0,
  truckBudget: 5000,
  callbacks: 0,
  calls: [],
  lab: { attempts: 0, correct: 0, streak: 0, bestStreak: 0 },
  jobs: {},
  missedConcepts: {},
});

function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...fresh(), ...JSON.parse(raw) } : fresh();
  } catch {
    return fresh();
  }
}

let state = load();
const listeners = new Set<() => void>();

export function update(fn: (p: Progress) => Progress) {
  state = fn(state);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function resetProgress() {
  update(() => fresh());
}

export function useProgress(): Progress {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  );
}

export const RANKS = [
  { name: 'Apprentice', xp: 0 },
  { name: 'Helper', xp: 500 },
  { name: 'Service Tech', xp: 1500 },
  { name: 'Lead Tech', xp: 3500 },
  { name: 'Senior Tech', xp: 7000 },
  { name: 'Master Tech', xp: 12000 },
];

export function rankFor(xp: number) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const next = RANKS[i + 1];
  return { rank: RANKS[i].name, next: next?.name, toNext: next ? next.xp - xp : 0, pct: next ? (xp - RANKS[i].xp) / (next.xp - RANKS[i].xp) : 1 };
}
