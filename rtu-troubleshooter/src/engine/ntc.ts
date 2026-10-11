import chart from '../content/honeywell/c7250a-chart.json';

const rows = chart.rows as { tempF: number; ohms: number }[];

/** Expected C7250A resistance at a temperature (log-linear between chart points). */
export function ohmsAt(tempF: number): number {
  const i = Math.max(1, rows.findIndex((r) => r.tempF >= tempF));
  const a = rows[i - 1];
  const b = rows[Math.min(i, rows.length - 1)];
  if (a.tempF === b.tempF) return a.ohms;
  const t = (tempF - a.tempF) / (b.tempF - a.tempF);
  return Math.round(Math.exp(Math.log(a.ohms) + t * (Math.log(b.ohms) - Math.log(a.ohms))));
}

/** Temperature a resistance implies, by inverse lookup. */
export function tempAt(ohms: number): number {
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    if (ohms <= a.ohms && ohms >= b.ohms) {
      const t = (Math.log(a.ohms) - Math.log(ohms)) / (Math.log(a.ohms) - Math.log(b.ohms));
      return a.tempF + t * (b.tempF - a.tempF);
    }
  }
  return ohms > rows[0].ohms ? rows[0].tempF : rows[rows.length - 1].tempF;
}

export const ntcChart = chart;
