"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { loadSession, saveSession, useSettings } from "@/lib/client/useSettings";
import { fmtDate, fmtUsd } from "@/lib/format";
import type { ComparisonRow } from "@/lib/planner/compare";
import { TRIP_STYLES, type Pace, type PlanInput, type TripStyle } from "@/lib/planner/types";
import { Stepper, todayPlus, TravelersInput } from "@/components/inputs";
import { ErrorState, Segmented } from "@/components/ui";

const DEFAULT: PlanInput = {
  origin: "IAH",
  destinations: [""],
  dateMode: "fixed",
  startDate: todayPlus(45),
  endDate: todayPlus(50),
  windowStart: todayPlus(45),
  windowEnd: todayPlus(75),
  days: 6,
  travelers: { adults: 2, children: 0, infantsInSeat: 0, infantsOnLap: 0 },
  childAges: [],
  rooms: 1,
  cabin: "economy",
  budgetUsd: 5000,
  styles: ["cultural", "foodie"],
  pace: "balanced",
};

interface Estimate {
  perDestination: { destination: string; total: number; uncached: number }[];
  flexDates: number;
}

const STEPS = ["Fetching flights, hotels, places, events, weather…", "Allocating your budget…", "Claude is drafting Lean, Balanced and Splurge…", "Checking every item against the fetched data…"];

export default function PlanPage() {
  const router = useRouter();
  const settings = useSettings();
  const [input, setInput] = useState<PlanInput>(DEFAULT);
  const [error, setError] = useState<ApiError | null>(null);
  const [phase, setPhase] = useState<"form" | "estimating" | "comparing" | "compared" | "generating">("form");
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Restore after mount (sessionStorage isn't available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(loadSession("tp:plan:input", { ...DEFAULT, origin: settings.defaultOrigin }));
  }, [settings.defaultOrigin]);

  useEffect(() => {
    if (phase !== "generating" && phase !== "comparing") return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 9000);
    return () => clearInterval(t);
  }, [phase]);

  const dests = input.destinations.map((d) => d.trim()).filter(Boolean);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = { ...input, destinations: dests };
    saveSession("tp:plan:input", clean);
    setError(null);
    setPhase("estimating");
    try {
      const est = await api<Estimate>("/api/plan/estimate", { method: "POST", json: { input: clean } });
      const searches = est.perDestination.reduce((s, d) => s + d.uncached, 0) + est.flexDates * dests.length;
      const msg =
        dests.length > 1
          ? `Comparing ${dests.length} destinations uses about ${searches} SerpApi searches (cached data is free). No Claude calls until you pick one. Continue?`
          : `This plan uses about ${searches} SerpApi search${searches === 1 ? "" : "es"}${est.flexDates ? ` (incl. ${est.flexDates} for flexible dates)` : ""} plus 3 Claude calls (≈ $0.20–0.50). Continue?`;
      if (!window.confirm(msg)) {
        setPhase("form");
        return;
      }
      if (dests.length > 1) {
        setPhase("comparing");
        setStep(0);
        const r = await api<{ rows: ComparisonRow[] }>("/api/plan/compare", { method: "POST", json: { input: clean } });
        setRows(r.rows);
        setPhase("compared");
      } else {
        await generate(dests[0]);
      }
    } catch (err) {
      setError(err as ApiError);
      setPhase(rows ? "compared" : "form");
    }
  }

  async function generate(destination: string, dates?: { startDate: string; endDate: string }) {
    setPhase("generating");
    setStep(0);
    setError(null);
    try {
      const r = await api<{ id: string }>("/api/plan/generate", {
        method: "POST",
        json: { input: { ...input, destinations: dests }, destination, dates },
      });
      router.push(`/trips/${r.id}`);
    } catch (err) {
      setError(err as ApiError);
      setPhase(rows ? "compared" : "form");
    }
  }

  const toggleStyle = (s: TripStyle) => setInput({ ...input, styles: input.styles.includes(s) ? input.styles.filter((x) => x !== s) : [...input.styles, s] });
  const working = phase === "estimating" || phase === "comparing" || phase === "generating";

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Plan a trip</h1>
      {error && <ErrorState message={error.message} code={error.code} />}

      {(phase === "generating" || phase === "comparing") && (
        <div className="card space-y-3 p-5" aria-live="polite">
          <p className="font-bold">{phase === "comparing" ? "Comparing destinations…" : "Building your trip…"}</p>
          <ol className="space-y-1 text-sm">
            {(phase === "comparing" ? STEPS.slice(0, 2) : STEPS).map((s, i) => (
              <li key={s} className={i < step ? "text-ok" : i === step ? "font-semibold" : "text-muted"}>
                {i < step ? "✓" : i === step ? "…" : "·"} {s}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">This usually takes 1–2 minutes. Keep this tab open.</p>
          <div className="skeleton h-2 w-full" />
        </div>
      )}

      {phase === "compared" && rows && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Compare destinations</h2>
          <p className="text-xs text-muted">Fixed costs = flight + lodging + food & transport estimates + 10% buffer, before activities. Pick one to build the full plan (3 Claude calls).</p>
          <div className="scroll-x">
            <table className="card w-full min-w-[560px] text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="p-2">Destination</th>
                  <th className="p-2">Lean / Bal. / Splurge (fixed)</th>
                  <th className="p-2">Cheapest flight</th>
                  <th className="p-2">Hotel median</th>
                  <th className="p-2">Weather</th>
                  <th className="p-2">Verified places · events</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.destination} className="align-top">
                    <td className="p-2 font-semibold">
                      {r.destination}
                      <span className="block text-xs font-normal text-muted">
                        {fmtDate(r.startDate)}–{fmtDate(r.endDate)}
                      </span>
                    </td>
                    {r.ok ? (
                      <>
                        <td className="p-2 tabular-nums">
                          {(["lean", "balanced", "splurge"] as const).map((k) => (
                            <span key={k} className={`block ${r.fixedCosts[k].remaining < 0 ? "text-danger" : ""}`}>
                              {fmtUsd(r.fixedCosts[k].total)}
                            </span>
                          ))}
                        </td>
                        <td className="p-2">
                          {fmtUsd(r.cheapestFlight)}
                          {r.flightStops !== null && <span className="block text-xs text-muted">{r.flightStops === 0 ? "nonstop" : `${r.flightStops} stop`}</span>}
                        </td>
                        <td className="p-2">{fmtUsd(r.medianHotelNightly)}/night</td>
                        <td className="p-2">
                          {r.avgHighF !== null ? `${r.avgHighF}°F avg high` : "—"}
                          <span className="block text-xs text-muted">
                            {r.rainyDays} rainy day{r.rainyDays === 1 ? "" : "s"} · {r.weatherSource}
                          </span>
                        </td>
                        <td className="p-2">
                          {r.verifiedPlaces} · {r.events}
                        </td>
                        <td className="p-2">
                          <button type="button" className="btn" onClick={() => generate(r.destination, { startDate: r.startDate, endDate: r.endDate })}>
                            Plan this
                          </button>
                        </td>
                      </>
                    ) : (
                      <td className="p-2 text-danger" colSpan={6}>
                        {r.error}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="btn btn-ghost w-full" onClick={() => setPhase("form")}>
            Edit inputs
          </button>
        </section>
      )}

      {(phase === "form" || phase === "estimating") && (
        <form onSubmit={submit} className="card space-y-4 p-4">
          <div>
            <span className="label">From</span>
            <div className="flex gap-2">
              {(["IAH", "HOU"] as const).map((c) => (
                <button key={c} type="button" aria-pressed={input.origin === c} onClick={() => setInput({ ...input, origin: c })} className={`btn flex-1 ${input.origin === c ? "" : "btn-ghost"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="label">Destination{input.destinations.length > 1 ? "s to compare" : ""}</span>
            {input.destinations.map((d, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input"
                  aria-label={`Destination ${i + 1}`}
                  placeholder={i === 0 ? "e.g. Lisbon, Portugal" : "Another option"}
                  value={d}
                  onChange={(e) => setInput({ ...input, destinations: input.destinations.map((x, j) => (j === i ? e.target.value : x)) })}
                  required={i === 0}
                />
                {i > 0 && (
                  <button type="button" className="btn btn-ghost px-3" aria-label="Remove destination" onClick={() => setInput({ ...input, destinations: input.destinations.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {input.destinations.length < 3 && (
              <button type="button" className="text-sm font-semibold text-accent" onClick={() => setInput({ ...input, destinations: [...input.destinations, ""] })}>
                + Compare another destination
              </button>
            )}
          </div>

          <Segmented
            ariaLabel="Dates"
            value={input.dateMode}
            onChange={(v) => setInput({ ...input, dateMode: v })}
            options={[
              { value: "fixed", label: "Fixed dates" },
              { value: "flexible", label: "Flexible window" },
            ]}
          />
          {input.dateMode === "fixed" ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="pstart">
                  Depart
                </label>
                <input id="pstart" type="date" className="input" value={input.startDate} onChange={(e) => setInput({ ...input, startDate: e.target.value })} required />
              </div>
              <div>
                <label className="label" htmlFor="pend">
                  Return
                </label>
                <input id="pend" type="date" className="input" min={input.startDate} value={input.endDate} onChange={(e) => setInput({ ...input, endDate: e.target.value })} required />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="ws">
                    Earliest departure
                  </label>
                  <input id="ws" type="date" className="input" value={input.windowStart} onChange={(e) => setInput({ ...input, windowStart: e.target.value })} required />
                </div>
                <div>
                  <label className="label" htmlFor="we">
                    Latest return
                  </label>
                  <input id="we" type="date" className="input" min={input.windowStart} value={input.windowEnd} onChange={(e) => setInput({ ...input, windowEnd: e.target.value })} required />
                </div>
              </div>
              <Stepper label="Trip length (days)" value={input.days ?? 6} min={2} max={21} onChange={(n) => setInput({ ...input, days: n })} />
              <p className="text-xs text-muted">Checks up to 7 departure dates across the window (1 search each) and picks the cheapest.</p>
            </div>
          )}

          <TravelersInput value={input.travelers} onChange={(t) => setInput({ ...input, travelers: t, childAges: input.childAges.slice(0, t.children).concat(Array(Math.max(0, t.children - input.childAges.length)).fill(8)) })} />
          {input.travelers.children > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Child ages (hotels price by age):</span>
              {input.childAges.map((a, i) => (
                <select key={i} aria-label={`Child ${i + 1} age`} className="input w-20" value={a} onChange={(e) => setInput({ ...input, childAges: input.childAges.map((x, j) => (j === i ? Number(e.target.value) : x)) })}>
                  {Array.from({ length: 18 }).map((_, n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="budget">
                Total budget ($)
              </label>
              <input id="budget" className="input" type="number" min={100} step={50} value={input.budgetUsd} onChange={(e) => setInput({ ...input, budgetUsd: Number(e.target.value) })} required />
            </div>
            <div>
              <label className="label" htmlFor="pcabin">
                Cabin
              </label>
              <select id="pcabin" className="input" value={input.cabin} onChange={(e) => setInput({ ...input, cabin: e.target.value as PlanInput["cabin"] })}>
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium economy</option>
                <option value="business">Business</option>
                <option value="first">First</option>
              </select>
            </div>
          </div>
          <Stepper label="Hotel rooms" value={input.rooms} min={1} max={6} onChange={(n) => setInput({ ...input, rooms: n })} />

          <fieldset>
            <legend className="label">Trip style</legend>
            <div className="flex flex-wrap gap-2">
              {TRIP_STYLES.map((s) => {
                const on = input.styles.includes(s);
                return (
                  <button key={s} type="button" aria-pressed={on} onClick={() => toggleStyle(s)} className={`chip border px-3 py-1.5 text-sm capitalize ${on ? "border-accent bg-accent text-accent-contrast" : "border-border text-text"}`}>
                    {s}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div>
            <span className="label">Pace</span>
            <Segmented<Pace>
              ariaLabel="Pace"
              value={input.pace}
              onChange={(p) => setInput({ ...input, pace: p })}
              options={[
                { value: "chill", label: "Chill" },
                { value: "balanced", label: "Balanced" },
                { value: "packed", label: "Packed" },
              ]}
            />
          </div>

          <button className="btn w-full" disabled={working}>
            {phase === "estimating" ? "Checking cost…" : dests.length > 1 ? "Compare destinations" : "Build my trip"}
          </button>
          <p className="text-center text-xs text-muted">You&apos;ll see the search count before anything is spent.</p>
        </form>
      )}
    </div>
  );
}
