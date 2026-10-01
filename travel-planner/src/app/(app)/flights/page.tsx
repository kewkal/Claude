"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { loadSession, saveSession, useSettings } from "@/lib/client/useSettings";
import { fmtDayShort, fmtTimestamp, fmtUsd } from "@/lib/format";
import { DEFAULT_FLIGHT_FILTERS, emptyHint, filterFlights, sortFlights, VALUE_FORMULA, type FlightFilters, type FlightSort } from "@/lib/flights/sort";
import type { BookingOption, Cabin, FlightOption, FlightSearchInput, FlightSearchResult, TripType } from "@/lib/flights/types";
import { FlightCard, PriceInsightBar } from "@/components/FlightCard";
import { HourRange, todayPlus, TravelersInput } from "@/components/inputs";
import { CardSkeletons, EmptyState, ErrorState, InfoTip, Segmented, Sheet } from "@/components/ui";

interface FlexDay {
  departDate: string;
  returnDate?: string;
  cheapestTotal: number | null;
  priceLevel: string | null;
  error?: string;
}

const DEFAULT_INPUT: FlightSearchInput = {
  tripType: "round_trip",
  origin: "IAH",
  destination: "",
  departDate: todayPlus(30),
  returnDate: todayPlus(35),
  travelers: { adults: 1, children: 0, infantsInSeat: 0, infantsOnLap: 0 },
  cabin: "economy",
  stops: "any",
  bags: 0,
  legs: [
    { from: "IAH", to: "", date: todayPlus(30) },
    { from: "", to: "", date: todayPlus(35) },
  ],
};

export default function FlightsPage() {
  const settings = useSettings();
  const [input, setInput] = useState<FlightSearchInput>(DEFAULT_INPUT);
  const [searched, setSearched] = useState<FlightSearchInput | null>(null);
  const [legs, setLegs] = useState<{ result: FlightSearchResult; chosen?: FlightOption }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [sort, setSort] = useState<FlightSort>("value");
  const [filters, setFilters] = useState<FlightFilters>(DEFAULT_FLIGHT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [flex, setFlex] = useState<FlexDay[] | null>(null);
  const [flexBusy, setFlexBusy] = useState(false);
  const [booking, setBooking] = useState<{ option: FlightOption; loading: boolean; data?: { options: BookingOption[]; googleFlightsUrl: string | null; fetchedAt: string }; error?: ApiError } | null>(null);

  useEffect(() => {
    // Restore the last search after mount (sessionStorage isn't available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(loadSession("tp:flights:input", { ...DEFAULT_INPUT, origin: settings.defaultOrigin }));
  }, [settings.defaultOrigin]);

  const current = legs[legs.length - 1];
  const visible = useMemo(() => {
    if (!current) return [];
    return sortFlights(filterFlights(current.result.options, filters), sort, settings.valueOfTimeUsdPerHour);
  }, [current, filters, sort, settings.valueOfTimeUsdPerHour]);

  const totalLegs = searched?.tripType === "round_trip" ? 2 : searched?.tripType === "multi_city" ? searched.legs?.length ?? 1 : 1;

  async function search(e?: React.FormEvent, override?: Partial<FlightSearchInput>) {
    e?.preventDefault();
    const next = { ...input, ...override };
    setInput(next);
    saveSession("tp:flights:input", next);
    setLoading(true);
    setError(null);
    setLegs([]);
    if (!override) setFlex(null);
    try {
      const result = await api<FlightSearchResult>("/api/flights/search", { method: "POST", json: { input: next } });
      setSearched(next);
      setLegs([{ result }]);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }

  async function chooseLeg(o: FlightOption) {
    if (!searched || !o.departureToken) return;
    setLegs((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, chosen: o } : l)));
    setLoading(true);
    setError(null);
    try {
      const result = await api<FlightSearchResult>("/api/flights/next", { method: "POST", json: { input: searched, departureToken: o.departureToken } });
      setLegs((ls) => [...ls, { result }]);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }

  async function openBooking(o: FlightOption) {
    if (!searched || !o.bookingToken) return;
    setBooking({ option: o, loading: true });
    try {
      const data = await api<{ options: BookingOption[]; googleFlightsUrl: string | null; fetchedAt: string }>("/api/flights/booking", {
        method: "POST",
        json: { input: searched, bookingToken: o.bookingToken },
      });
      setBooking({ option: o, loading: false, data });
    } catch (err) {
      setBooking({ option: o, loading: false, error: err as ApiError });
    }
  }

  async function runFlex() {
    if (!searched) return;
    setFlexBusy(true);
    try {
      const cost = await api<{ total: number; uncached: number }>("/api/flights/flex", { method: "POST", json: { input: searched, dryRun: true } });
      if (cost.uncached > 0 && !window.confirm(`Checking ±3 days uses ${cost.uncached} SerpApi search${cost.uncached > 1 ? "es" : ""} (${cost.total - cost.uncached} cached). Continue?`)) {
        return;
      }
      const r = await api<{ days: FlexDay[] }>("/api/flights/flex", { method: "POST", json: { input: searched } });
      setFlex(r.days);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setFlexBusy(false);
    }
  }

  function backToLeg(i: number) {
    setLegs((ls) => ls.slice(0, i + 1).map((l, j) => (j === i ? { result: l.result } : l)));
  }

  const isLastLeg = legs.length >= totalLegs;
  const hint = current && visible.length === 0 ? emptyHint(current.result.options, filters) : null;
  const cheapestFlex = flex ? Math.min(...flex.map((d) => d.cheapestTotal ?? Infinity)) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Flights</h1>

      <form onSubmit={search} className="card space-y-3 p-4">
        <Segmented<TripType>
          ariaLabel="Trip type"
          value={input.tripType}
          onChange={(v) => setInput({ ...input, tripType: v })}
          options={[
            { value: "round_trip", label: "Round trip" },
            { value: "one_way", label: "One way" },
            { value: "multi_city", label: "Multi-city" },
          ]}
        />

        {input.tripType !== "multi_city" ? (
          <>
            <div>
              <span className="label">From</span>
              <div className="flex gap-2">
                {(["IAH", "HOU"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setInput({ ...input, origin: code })}
                    className={`btn flex-1 ${input.origin === code ? "" : "btn-ghost"}`}
                    aria-pressed={input.origin === code}
                  >
                    {code}
                  </button>
                ))}
                <input
                  aria-label="Other origin"
                  className="input flex-[2]"
                  placeholder="Other"
                  value={input.origin === "IAH" || input.origin === "HOU" ? "" : input.origin}
                  onChange={(e) => setInput({ ...input, origin: e.target.value || settings.defaultOrigin })}
                />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="dest">
                To (airport code or city)
              </label>
              <input id="dest" className="input" placeholder="e.g. LIS or Lisbon" value={input.destination} onChange={(e) => setInput({ ...input, destination: e.target.value })} required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="dep">
                  Depart
                </label>
                <input id="dep" type="date" className="input" value={input.departDate} onChange={(e) => setInput({ ...input, departDate: e.target.value })} required />
              </div>
              {input.tripType === "round_trip" && (
                <div>
                  <label className="label" htmlFor="ret">
                    Return
                  </label>
                  <input id="ret" type="date" className="input" value={input.returnDate ?? ""} min={input.departDate} onChange={(e) => setInput({ ...input, returnDate: e.target.value })} required />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            {(input.legs ?? []).map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1.3fr] gap-2">
                <input aria-label={`Leg ${i + 1} from`} className="input" placeholder="From" value={l.from} onChange={(e) => setInput({ ...input, legs: input.legs!.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} required />
                <input aria-label={`Leg ${i + 1} to`} className="input" placeholder="To" value={l.to} onChange={(e) => setInput({ ...input, legs: input.legs!.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} required />
                <input aria-label={`Leg ${i + 1} date`} type="date" className="input" value={l.date} onChange={(e) => setInput({ ...input, legs: input.legs!.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} required />
              </div>
            ))}
            <div className="flex gap-2">
              {(input.legs?.length ?? 0) < 5 && (
                <button type="button" className="btn btn-ghost flex-1" onClick={() => setInput({ ...input, legs: [...(input.legs ?? []), { from: input.legs?.at(-1)?.to ?? "", to: "", date: input.legs?.at(-1)?.date ?? todayPlus(40) }] })}>
                  + Add leg
                </button>
              )}
              {(input.legs?.length ?? 0) > 2 && (
                <button type="button" className="btn btn-ghost flex-1" onClick={() => setInput({ ...input, legs: input.legs!.slice(0, -1) })}>
                  Remove leg
                </button>
              )}
            </div>
          </div>
        )}

        <TravelersInput value={input.travelers} onChange={(t) => setInput({ ...input, travelers: t })} />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="cabin">
              Cabin
            </label>
            <select id="cabin" className="input" value={input.cabin} onChange={(e) => setInput({ ...input, cabin: e.target.value as Cabin })}>
              <option value="economy">Economy</option>
              <option value="premium_economy">Premium economy</option>
              <option value="business">Business</option>
              <option value="first">First</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bags">
              Carry-on bags
            </label>
            <select id="bags" className="input" value={input.bags ?? 0} onChange={(e) => setInput({ ...input, bags: Number(e.target.value) })}>
              <option value={0}>Any fare</option>
              <option value={1}>1 included</option>
              <option value={2}>2 included</option>
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!input.excludeBasic} onChange={(e) => setInput({ ...input, excludeBasic: e.target.checked })} />
          Hide basic economy (US domestic economy only)
        </label>

        <button className="btn w-full" disabled={loading}>
          {loading && !legs.length ? "Searching…" : "Search flights"}
        </button>
        <p className="text-center text-xs text-muted">1 SerpApi search (free if cached in the last 30 min)</p>
      </form>

      {error && <ErrorState message={error.message} code={error.code} />}

      {legs.length > 1 && (
        <div className="space-y-2">
          {legs.slice(0, -1).map((l, i) =>
            l.chosen ? (
              <div key={i}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-semibold">{totalLegs === 2 ? (i === 0 ? "Outbound" : "Return") : `Leg ${i + 1}`} selected</span>
                  <button type="button" className="text-sm font-semibold text-accent" onClick={() => backToLeg(i)}>
                    Change
                  </button>
                </div>
                <FlightCard o={l.chosen} paying={l.result.travelersPaying} compact />
              </div>
            ) : null,
          )}
        </div>
      )}

      {loading && <CardSkeletons count={4} />}

      {current && !loading && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">
              {totalLegs === 2 ? (legs.length === 1 ? "Outbound flights" : "Return flights") : totalLegs > 2 ? `Leg ${legs.length} of ${totalLegs}` : "Flights"}
            </h2>
            <span className="text-xs text-muted">
              {current.result.cached ? "cached · " : ""}fetched {fmtTimestamp(current.result.fetchedAt)}
            </span>
          </div>

          {legs.length === 1 && <PriceInsightBar pi={current.result.priceInsights} />}
          {legs.length > 1 && <p className="text-xs text-muted">Prices shown are the full round-trip/itinerary total with this combination.</p>}

          {legs.length === 1 && searched?.tripType !== "multi_city" && (
            <div className="card p-3">
              {!flex ? (
                <button type="button" className="btn btn-ghost w-full" onClick={runFlex} disabled={flexBusy}>
                  {flexBusy ? "Checking dates…" : "Check ±3 days (same trip length)"}
                </button>
              ) : (
                <div>
                  <p className="mb-2 text-sm font-semibold">Cheapest by departure date</p>
                  <div className="scroll-x -mx-1 flex gap-2 px-1">
                    {flex.map((d) => (
                      <button
                        key={d.departDate}
                        type="button"
                        onClick={() => search(undefined, { departDate: d.departDate, returnDate: d.returnDate })}
                        className={`shrink-0 rounded-xl border px-3 py-2 text-left text-sm ${d.departDate === searched?.departDate ? "border-accent bg-accent-soft" : "border-border"}`}
                      >
                        <span className="block font-semibold">{fmtDayShort(d.departDate)}</span>
                        <span className={`block ${d.cheapestTotal === cheapestFlex ? "font-bold text-ok" : ""}`}>{d.error ? "—" : fmtUsd(d.cheapestTotal)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Segmented<FlightSort>
                ariaLabel="Sort"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "cheapest", label: "Cheapest" },
                  { value: "fastest", label: "Fastest" },
                  { value: "value", label: "Best value" },
                ]}
              />
            </div>
            <InfoTip label="Best value formula">
              {VALUE_FORMULA} Current value of time: {fmtUsd(settings.valueOfTimeUsdPerHour)}/hr.
            </InfoTip>
          </div>

          <button type="button" className="btn btn-ghost w-full" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
            {showFilters ? "Hide filters" : "Filters"}
          </button>
          {showFilters && <FiltersPanel filters={filters} onChange={setFilters} />}

          {current.result.empty ? (
            <EmptyState title="Google Flights returned no flights for this search.">Try different dates or a nearby airport.</EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState title={hint ?? "No flights match these filters."}>
              <button type="button" className="btn btn-ghost mt-2" onClick={() => setFilters({ ...filters, stops: { nonstop: true, one: true, twoPlus: filters.stops.twoPlus }, maxPriceTotal: null })}>
                Loosen filters
              </button>
            </EmptyState>
          ) : (
            <>
              <p className="text-sm text-muted">
                {visible.length} of {current.result.options.length} options
              </p>
              {visible.map((o) => (
                <FlightCard
                  key={o.id}
                  o={o}
                  paying={current.result.travelersPaying}
                  onSelect={!isLastLeg && o.departureToken ? () => chooseLeg(o) : undefined}
                  selectLabel={totalLegs === 2 ? "Select & see returns (1 search)" : "Select & see next leg (1 search)"}
                  onBook={o.bookingToken ? () => openBooking(o) : undefined}
                />
              ))}
            </>
          )}
          {current.result.googleFlightsUrl && (
            <a href={current.result.googleFlightsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost w-full">
              Open this search on Google Flights ↗
            </a>
          )}
        </section>
      )}

      <Sheet open={!!booking} onClose={() => setBooking(null)} title="Booking options">
        {booking?.loading && <CardSkeletons count={2} height="h-16" />}
        {booking?.error && <ErrorState message={booking.error.message} code={booking.error.code} />}
        {booking?.data && (
          <div className="space-y-3">
            {booking.data.options.length === 0 && <p className="text-sm text-muted">Google didn&apos;t return sellers for this itinerary.</p>}
            {booking.data.options.map((b, i) => (
              <div key={i} className="card flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-semibold">{b.seller}</p>
                  {b.optionTitle && <p className="text-xs text-muted">{b.optionTitle}</p>}
                  {b.extensions.length > 0 && <p className="text-xs text-muted">{b.extensions.join(" · ")}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-bold">{fmtUsd(b.price)}</p>
                  {b.bookingRequest && <BookingButton req={b.bookingRequest} />}
                </div>
              </div>
            ))}
            {booking.data.googleFlightsUrl && (
              <a href={booking.data.googleFlightsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost w-full">
                Open on Google Flights ↗
              </a>
            )}
            <p className="text-xs text-muted">Fetched {fmtTimestamp(booking.data.fetchedAt)} from Google Flights via SerpApi. Prices can change at checkout.</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}

/** Google's booking redirect is a POST; submit it in a new tab. */
function BookingButton({ req }: { req: { url: string; postData?: string } }) {
  const fields = req.postData ? [...new URLSearchParams(req.postData).entries()] : [];
  if (!fields.length) {
    return (
      <a href={req.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-accent">
        Book ↗
      </a>
    );
  }
  return (
    <form method="POST" action={req.url} target="_blank">
      {fields.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button className="text-sm font-semibold text-accent">Book ↗</button>
    </form>
  );
}

function FiltersPanel({ filters, onChange }: { filters: FlightFilters; onChange: (f: FlightFilters) => void }) {
  const f = filters;
  return (
    <div className="card space-y-4 p-4">
      <fieldset>
        <legend className="label">Stops</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {(
            [
              ["nonstop", "Nonstop"],
              ["one", "1 stop"],
              ["twoPlus", "2+ stops"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.stops[k]} onChange={(e) => onChange({ ...f, stops: { ...f.stops, [k]: e.target.checked } })} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <span className="label">Airline type</span>
        <Segmented
          ariaLabel="Airline type"
          value={f.carrier}
          onChange={(v) => onChange({ ...f, carrier: v })}
          options={[
            { value: "any", label: "Any" },
            { value: "budget", label: "Budget" },
            { value: "full_service", label: "Full-service" },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="maxp">
            Max total price ($)
          </label>
          <input id="maxp" className="input" type="number" min={0} value={f.maxPriceTotal ?? ""} onChange={(e) => onChange({ ...f, maxPriceTotal: e.target.value ? Number(e.target.value) : null })} />
        </div>
        <div>
          <label className="label" htmlFor="maxl">
            Max layover (hrs)
          </label>
          <input id="maxl" className="input" type="number" min={0} step={0.5} value={f.maxLayoverMin !== null ? f.maxLayoverMin / 60 : ""} onChange={(e) => onChange({ ...f, maxLayoverMin: e.target.value ? Number(e.target.value) * 60 : null })} />
        </div>
      </div>
      <HourRange label="Departure time" value={f.departWindow} onChange={(v) => onChange({ ...f, departWindow: v })} />
      <HourRange label="Arrival time" value={f.arriveWindow} onChange={(v) => onChange({ ...f, arriveWindow: v })} />
      <button type="button" className="btn btn-ghost w-full" onClick={() => onChange(DEFAULT_FLIGHT_FILTERS)}>
        Reset filters
      </button>
    </div>
  );
}
