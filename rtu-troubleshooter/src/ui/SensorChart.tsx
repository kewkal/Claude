import { useState } from 'react';
import { ntcChart, tempAt } from '../engine/ntc';
import { SourceTag } from './Tags';

const rows = ntcChart.rows as { tempF: number; ohms: number }[];

/**
 * Resistance-vs-temperature lookup for the 20k NTC sensor. Highlights the two chart rows a reading
 * falls between. `showConversion` adds the computed temperature (beginner help); otherwise the
 * player reads the chart like they would in the field.
 */
export function SensorChart({ ohms, showConversion = false, defaultOpen = false }: { ohms?: number | 'OL'; showConversion?: boolean; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const n = typeof ohms === 'number' ? ohms : undefined;
  // Rows bracketing the reading (chart runs high ohms at cold temps to low ohms at hot temps).
  const hi = n === undefined ? -1 : rows.findIndex((r) => r.ohms <= n);
  const bracket = hi > 0 ? [hi - 1, hi] : hi === 0 ? [0] : [];
  // Show a window around the reading so the table stays short on a phone; full table otherwise.
  const start = bracket.length ? Math.max(0, bracket[0] - 4) : rows.findIndex((r) => r.tempF === 30);
  const end = bracket.length ? Math.min(rows.length, bracket[bracket.length - 1] + 5) : rows.findIndex((r) => r.tempF === 105) + 1;
  const [full, setFull] = useState(false);
  const shown = full ? rows : rows.slice(start, end);

  return (
    <div className="mt-2 rounded-lg border border-slate-700 bg-slate-900/60">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold text-sky-300">
        <span>📋 Sensor chart: 20k NTC (C7250A)</span>
        <span className="text-slate-500">{open ? '−' : '+'}</span>
      </button>
      {showConversion && n !== undefined && (
        <div className="px-3 pb-2 text-sm text-emerald-300">
          {n.toLocaleString()} Ω ≈ <b>{tempAt(n).toFixed(1)}°F</b> on the chart. Compare it to your probe reading.
        </div>
      )}
      {showConversion && ohms === 'OL' && <div className="px-3 pb-2 text-sm text-rose-300">OL = open circuit. No temperature on the chart reads infinite ohms.</div>}
      {open && (
        <div className="px-3 pb-3">
          <p className="mb-2 text-[11px] leading-snug text-slate-400">
            Find your ohm reading in the right column and read the temperature on the left. Resistance drops as temperature rises. A healthy sensor reads within about 2°F of a thermometer held at the sensor.
          </p>
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 font-normal">°F</th>
                <th className="py-1 text-right font-normal">Ohms</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const hit = bracket.includes(rows.indexOf(r));
                return (
                  <tr key={r.tempF} className={hit ? 'bg-amber-400/20 text-amber-200' : 'text-slate-300'}>
                    <td className="py-0.5 pl-1">{r.tempF}</td>
                    <td className="py-0.5 pr-1 text-right">{r.ohms.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-2 flex items-center justify-between gap-2">
            <button onClick={() => setFull(!full)} className="text-[11px] text-sky-300 underline">{full ? 'Show fewer rows' : 'Show full chart (-40 to 150°F)'}</button>
            <SourceTag s={{ verified: false, note: ntcChart.note }} />
          </div>
          {n !== undefined && n < rows[rows.length - 1].ohms && (
            <p className="mt-1 text-[11px] text-rose-300">{n.toLocaleString()} Ω is below the lowest value on the chart ({rows[rows.length - 1].ohms.toLocaleString()} Ω at {rows[rows.length - 1].tempF}°F). No real air temperature reads that low.</p>
          )}
          {n !== undefined && n > rows[0].ohms && (
            <p className="mt-1 text-[11px] text-rose-300">{n.toLocaleString()} Ω is above the highest value on the chart ({rows[0].ohms.toLocaleString()} Ω at {rows[0].tempF}°F).</p>
          )}
          {bracket.length === 2 && !showConversion && (
            <p className="mt-1 text-[11px] text-slate-500">Your reading falls between the highlighted rows.</p>
          )}
        </div>
      )}
    </div>
  );
}
