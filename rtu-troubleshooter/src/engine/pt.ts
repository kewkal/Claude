import table from '../content/pt/r410a.json';

type Row = { tempF: number; bubblePsig: number; dewPsig: number };
const rows = table.rows as Row[];

function interp(x: number, xs: number[], ys: number[]): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1;
  while (xs[i] < x) i++;
  const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
  return ys[i - 1] + t * (ys[i] - ys[i - 1]);
}

const temps = rows.map((r) => r.tempF);
const dew = rows.map((r) => r.dewPsig);
const bubble = rows.map((r) => r.bubblePsig);

/** Saturated vapor temp (°F) at a suction gauge pressure. Use for superheat. */
export const dewTempF = (psig: number) => interp(psig, dew, temps);
/** Saturated liquid temp (°F) at a liquid gauge pressure. Use for subcooling. */
export const bubbleTempF = (psig: number) => interp(psig, bubble, temps);
export const dewPsig = (tempF: number) => interp(tempF, temps, dew);
export const bubblePsig = (tempF: number) => interp(tempF, temps, bubble);

export const superheat = (suctionPsig: number, suctionLineF: number) => suctionLineF - dewTempF(suctionPsig);
export const subcool = (liquidPsig: number, liquidLineF: number) => bubbleTempF(liquidPsig) - liquidLineF;

export const ptSource = table.source;
