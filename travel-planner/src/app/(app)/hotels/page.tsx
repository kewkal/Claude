"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { loadSession, saveSession } from "@/lib/client/useSettings";
import { fmtCount, fmtMiles, fmtTimestamp, fmtUsd } from "@/lib/format";
import { estimateTravel } from "@/lib/geo";
import { TIER_RULE } from "@/lib/hotels/normalize";
import type { HotelOption, HotelSearchInput, HotelSearchResult, HotelTier, Photo, Review } from "@/lib/hotels/types";
import type { Pin } from "@/lib/pins-shared";
import { Gallery, ReviewList, TravelTime } from "@/components/media";
import { MapView, mapsLink } from "@/components/MapView";
import { Stepper, todayPlus } from "@/components/inputs";
import { Badge, CardSkeletons, EmptyState, ErrorState, InfoTip, Rating, Sheet } from "@/components/ui";


const DEFAULT_INPUT: HotelSearchInput = {
  destination: "",
  checkIn: todayPlus(30),
  checkOut: todayPlus(35),
  adults: 2,
  children: 0,
  childAges: [],
  rooms: 1,
  sort: "relevance",
};

const tierTone = (t: HotelTier) => (t === "Budget" ? "ok" : t === "Luxury" ? "ai" : "neutral");

interface ClientFilters {
  minRating: number;
  maxNightly: number | null;
  tiers: Record<HotelTier, boolean>;
  amenities: string[];
}

export default function HotelsPage() {
  const [input, setInput] = useState<HotelSearchInput>(DEFAULT_INPUT);
  const [result, setResult] = useState<HotelSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [more, setMore] = useState(false);
  const [pins, setPins] = useState<Pin[]>([]);
  const [open, setOpen] = useState<HotelOption | null>(null);
  const [cf, setCf] = useState<ClientFilters>({ minRating: 0, maxNightly: null, tiers: { Budget: true, Mid: true, Luxury: true }, amenities: [] });

  useEffect(() => {
    // Restore last search after mount (sessionStorage isn't available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInput(loadSession("tp:hotels:input", DEFAULT_INPUT));
    api<{ pins: Pin[] }>("/api/pins")
      .then((r) => setPins(r.pins))
      .catch(() => undefined);
  }, []);

  const allAmenities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of result?.hotels ?? []) for (const a of h.amenities) counts.set(a, (counts.get(a) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([a]) => a);
  }, [result]);

  const visible = useMemo(
    () =>
      (result?.hotels ?? []).filter(
        (h) =>
          cf.tiers[h.tier] &&
          (cf.minRating === 0 || (h.rating ?? 0) >= cf.minRating) &&
          (cf.maxNightly === null || (h.ratePerNight !== null && h.ratePerNight <= cf.maxNightly)) &&
          cf.amenities.every((a) => h.amenities.includes(a)),
      ),
    [result, cf],
  );

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    saveSession("tp:hotels:input", input);
    setLoading(true);
    setError(null);
    try {
      setResult(await api<HotelSearchResult>("/api/hotels/search", { method: "POST", json: { input } }));
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setLoading(false);
    }
  }

  const relevantPins = pins.filter((p) => !p.destination || !input.destination || p.destination.toLowerCase().includes(input.destination.toLowerCase().split(",")[0]));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Hotels</h1>

      <form onSubmit={search} className="card space-y-3 p-4">
        <div>
          <label className="label" htmlFor="hdest">
            Destination
          </label>
          <input id="hdest" className="input" placeholder="e.g. Lisbon, Portugal" value={input.destination} onChange={(e) => setInput({ ...input, destination: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="ci">
              Check-in
            </label>
            <input id="ci" type="date" className="input" value={input.checkIn} onChange={(e) => setInput({ ...input, checkIn: e.target.value })} required />
          </div>
          <div>
            <label className="label" htmlFor="co">
              Check-out
            </label>
            <input id="co" type="date" className="input" min={input.checkIn} value={input.checkOut} onChange={(e) => setInput({ ...input, checkOut: e.target.value })} required />
          </div>
        </div>
        <div className="rounded-xl border border-border p-3">
          <Stepper label="Adults" value={input.adults} min={1} max={12} onChange={(n) => setInput({ ...input, adults: n })} />
          <Stepper
            label="Children"
            value={input.children}
            min={0}
            max={8}
            onChange={(n) => setInput({ ...input, children: n, childAges: (input.childAges ?? []).slice(0, n).concat(Array(Math.max(0, n - (input.childAges?.length ?? 0))).fill(8)) })}
          />
          {input.children > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Ages:</span>
              {(input.childAges ?? []).map((age, i) => (
                <select
                  key={i}
                  aria-label={`Child ${i + 1} age`}
                  className="input w-20"
                  value={age}
                  onChange={(e) => setInput({ ...input, childAges: input.childAges!.map((a, j) => (j === i ? Number(e.target.value) : a)) })}
                >
                  {Array.from({ length: 18 }).map((_, a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          )}
          <Stepper label="Rooms" value={input.rooms} min={1} max={8} onChange={(n) => setInput({ ...input, rooms: n })} />
        </div>

        <button type="button" className="text-sm font-semibold text-accent" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? "− Fewer search options" : "+ More search options (each change is a new search)"}
        </button>
        {more && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="minp">
                  Min $/night
                </label>
                <input id="minp" className="input" type="number" min={0} value={input.minPrice ?? ""} onChange={(e) => setInput({ ...input, minPrice: e.target.value ? Number(e.target.value) : undefined })} />
              </div>
              <div>
                <label className="label" htmlFor="maxp">
                  Max $/night
                </label>
                <input id="maxp" className="input" type="number" min={0} value={input.maxPrice ?? ""} onChange={(e) => setInput({ ...input, maxPrice: e.target.value ? Number(e.target.value) : undefined })} />
              </div>
            </div>
            <fieldset>
              <legend className="label">Star class</legend>
              <div className="flex gap-3 text-sm">
                {[2, 3, 4, 5].map((c) => (
                  <label key={c} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={input.hotelClasses?.includes(c) ?? false}
                      onChange={(e) =>
                        setInput({ ...input, hotelClasses: e.target.checked ? [...(input.hotelClasses ?? []), c] : (input.hotelClasses ?? []).filter((x) => x !== c) })
                      }
                    />
                    {c}★
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label" htmlFor="minr">
                  Guest rating
                </label>
                <select id="minr" className="input" value={input.minRating ?? ""} onChange={(e) => setInput({ ...input, minRating: e.target.value ? (Number(e.target.value) as 3.5 | 4 | 4.5) : undefined })}>
                  <option value="">Any</option>
                  <option value="3.5">3.5+</option>
                  <option value="4">4.0+</option>
                  <option value="4.5">4.5+</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="hsort">
                  Sort
                </label>
                <select id="hsort" className="input" value={input.sort} onChange={(e) => setInput({ ...input, sort: e.target.value as HotelSearchInput["sort"] })}>
                  <option value="relevance">Relevance</option>
                  <option value="lowest_price">Lowest price</option>
                  <option value="highest_rating">Highest rating</option>
                  <option value="most_reviewed">Most reviewed</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!input.vacationRentals} onChange={(e) => setInput({ ...input, vacationRentals: e.target.checked })} />
              Vacation rentals instead of hotels
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!input.freeCancellation} onChange={(e) => setInput({ ...input, freeCancellation: e.target.checked })} />
              Free cancellation only
            </label>
          </div>
        )}
        <button className="btn w-full" disabled={loading}>
          {loading ? "Searching…" : "Search hotels"}
        </button>
        <p className="text-center text-xs text-muted">1 SerpApi search (free if cached in the last 6 hrs)</p>
      </form>

      {error && <ErrorState message={error.message} code={error.code} />}
      {loading && <CardSkeletons count={4} height="h-40" />}

      {result && !loading && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">
              {visible.length} of {result.hotels.length} stays · {result.nights} night{result.nights > 1 ? "s" : ""}
            </h2>
            <span className="text-xs text-muted">
              {result.cached ? "cached · " : ""}fetched {fmtTimestamp(result.fetchedAt)}
            </span>
          </div>

          <details className="card p-3">
            <summary className="cursor-pointer text-sm font-semibold">Filter these results (free)</summary>
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                {(["Budget", "Mid", "Luxury"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-1">
                    <input type="checkbox" checked={cf.tiers[t]} onChange={(e) => setCf({ ...cf, tiers: { ...cf.tiers, [t]: e.target.checked } })} />
                    {t}
                  </label>
                ))}
                <InfoTip label="How tiers are assigned">{TIER_RULE}</InfoTip>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" htmlFor="cfr">
                    Min guest rating
                  </label>
                  <select id="cfr" className="input" value={cf.minRating} onChange={(e) => setCf({ ...cf, minRating: Number(e.target.value) })}>
                    <option value={0}>Any</option>
                    <option value={3.5}>3.5+</option>
                    <option value={4}>4.0+</option>
                    <option value={4.5}>4.5+</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="cfp">
                    Max $/night
                  </label>
                  <input id="cfp" className="input" type="number" value={cf.maxNightly ?? ""} onChange={(e) => setCf({ ...cf, maxNightly: e.target.value ? Number(e.target.value) : null })} />
                </div>
              </div>
              {allAmenities.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {allAmenities.map((a) => {
                    const on = cf.amenities.includes(a);
                    return (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCf({ ...cf, amenities: on ? cf.amenities.filter((x) => x !== a) : [...cf.amenities, a] })}
                        className={`chip border ${on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}
                      >
                        {a}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </details>

          {relevantPins.length > 0 ? (
            <p className="text-xs text-muted">Distances are to your {relevantPins.length} pinned place{relevantPins.length > 1 ? "s" : ""} (estimated).</p>
          ) : (
            <p className="text-xs text-muted">Pin places in Explore to see each hotel&apos;s distance to them.</p>
          )}

          {result.empty ? (
            <EmptyState title="Google Hotels returned nothing for this search.">Try other dates or loosen the search options.</EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState title="No stays match these filters." />
          ) : (
            visible.map((h) => <HotelCard key={h.id} h={h} nights={result.nights} rooms={result.rooms} pins={relevantPins} onOpen={() => setOpen(h)} />)
          )}

          {result.googleHotelsUrl && (
            <a href={result.googleHotelsUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost w-full">
              Open this search on Google Hotels ↗
            </a>
          )}
        </section>
      )}

      {open && result && <HotelDetails h={open} nights={result.nights} rooms={result.rooms} pins={relevantPins} googleHotelsUrl={result.googleHotelsUrl} onClose={() => setOpen(null)} />}
    </div>
  );
}

function avgPinDistance(h: HotelOption, pins: Pin[]): { miles: number; minutes: number } | null {
  if (!h.gps || !pins.length) return null;
  const ests = pins.map((p) => estimateTravel(h.gps!, p));
  return { miles: ests.reduce((s, e) => s + e.miles, 0) / ests.length, minutes: Math.round(ests.reduce((s, e) => s + e.minutes, 0) / ests.length) };
}

function PriceBlock({ h, nights, rooms }: { h: HotelOption; nights: number; rooms: number }) {
  const total = h.totalRate !== null ? h.totalRate * rooms : h.ratePerNight !== null ? h.ratePerNight * nights * rooms : null;
  return (
    <div className="text-right">
      <p className="text-xl font-extrabold">{fmtUsd(h.ratePerNight)}</p>
      <p className="text-xs text-muted">per night{rooms > 1 ? ", per room" : ""}</p>
      <p className="text-sm font-semibold">{fmtUsd(total)} total</p>
      <p className="text-[0.7rem] text-muted">
        {h.totalRate !== null ? "incl. taxes & fees" : "nightly × nights"}
        {rooms > 1 ? ` × ${rooms} rooms (calculated)` : ""}
      </p>
    </div>
  );
}

function HotelCard({ h, nights, rooms, pins, onOpen }: { h: HotelOption; nights: number; rooms: number; pins: Pin[]; onOpen: () => void }) {
  const dist = avgPinDistance(h, pins);
  return (
    <article className="card overflow-hidden">
      <button type="button" onClick={onOpen} className="block w-full text-left">
        {h.images[0] && <img src={h.images[0].thumb} alt={h.name} loading="lazy" referrerPolicy="no-referrer" className="h-40 w-full object-cover" />}
        <div className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={tierTone(h.tier)} title={h.tierReason}>
                {h.tier}
              </Badge>
              {h.hotelClass !== null && <Badge>{h.hotelClass}★</Badge>}
              {h.type === "vacation_rental" && <Badge tone="accent">Rental</Badge>}
              {h.freeCancellation && <Badge tone="ok">Free cancellation</Badge>}
              {h.sponsored && <Badge tone="warn">Sponsored</Badge>}
            </div>
            <h3 className="mt-1 font-bold leading-tight">{h.name}</h3>
            <Rating rating={h.rating} reviews={h.reviews} source="Google" />
            {dist && (
              <p className="mt-1 text-xs text-muted">
                Avg to your pins: {fmtMiles(dist.miles)} · ~{dist.minutes} min (est.)
              </p>
            )}
          </div>
          <PriceBlock h={h} nights={nights} rooms={rooms} />
        </div>
      </button>
    </article>
  );
}

function HotelDetails({
  h,
  nights,
  rooms,
  pins,
  googleHotelsUrl,
  onClose,
}: {
  h: HotelOption;
  nights: number;
  rooms: number;
  pins: Pin[];
  googleHotelsUrl: string | null;
  onClose: () => void;
}) {
  const [reviews, setReviews] = useState<{ reviews: Review[]; fetchedAt: string } | null>(null);
  const [revErr, setRevErr] = useState<ApiError | null>(null);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (!h.propertyToken) return;
    api<{ reviews: Review[]; fetchedAt: string }>("/api/hotels/reviews", { method: "POST", json: { propertyToken: h.propertyToken } })
      .then(setReviews)
      .catch((e) => setRevErr(e as ApiError));
  }, [h.propertyToken]);

  async function morePhotos() {
    if (!h.propertyToken) return;
    setPhotoBusy(true);
    try {
      const r = await api<{ photos: Photo[] }>("/api/hotels/photos", { method: "POST", json: { propertyToken: h.propertyToken } });
      setPhotos(r.photos);
    } catch (e) {
      setRevErr(e as ApiError);
    } finally {
      setPhotoBusy(false);
    }
  }

  const gallery = photos ?? h.images;
  const bookUrl = h.link ?? googleHotelsUrl;

  return (
    <Sheet open onClose={onClose} title={h.name}>
      <div className="space-y-4">
        <Gallery photos={gallery} alt={h.name} />
        {!photos && h.propertyToken && (
          <button type="button" className="btn btn-ghost w-full" onClick={morePhotos} disabled={photoBusy}>
            {photoBusy ? "Loading…" : "More photos (1 search)"}
          </button>
        )}

        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={tierTone(h.tier)} title={h.tierReason}>
                {h.tier}
              </Badge>
              {h.hotelClass !== null && <Badge>{h.hotelClass}★</Badge>}
              {h.freeCancellation && <Badge tone="ok">Free cancellation</Badge>}
            </div>
            <div className="mt-1">
              <Rating rating={h.rating} reviews={h.reviews} source="Google" />
            </div>
            {h.locationRating !== null && <p className="text-xs text-muted">Location score {h.locationRating}/5 (Google)</p>}
            <p className="mt-1 text-xs text-muted">
              Check-in {h.checkInTime ?? "—"} · Check-out {h.checkOutTime ?? "—"}
            </p>
          </div>
          <PriceBlock h={h} nights={nights} rooms={rooms} />
        </div>
        {h.ratePerNightBeforeTaxes !== null && (
          <p className="text-xs text-muted">
            {fmtUsd(h.ratePerNightBeforeTaxes)}/night before taxes & fees · {nights} nights{rooms > 1 ? ` · ${rooms} rooms` : ""}
          </p>
        )}

        {bookUrl && (
          <a href={bookUrl} target="_blank" rel="noopener noreferrer" className="btn w-full">
            {h.link ? "Book / view property site ↗" : "View on Google Hotels ↗"}
          </a>
        )}

        {h.gps && (
          <section>
            <h3 className="mb-2 font-bold">Location</h3>
            <MapView
              markers={[
                { ...h.gps, label: h.name, badge: "H", tone: "hotel" },
                ...pins.map((p, i) => ({ lat: p.lat, lng: p.lng, label: p.name, badge: String(i + 1), tone: "pin" as const })),
              ]}
            />
            <a href={mapsLink(h.gps.lat, h.gps.lng)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-accent">
              Open in Google Maps ↗
            </a>
            {pins.length > 0 && (
              <ul className="mt-2 space-y-1">
                {pins.map((p, i) => (
                  <li key={p.id}>
                    <TravelTime from={h.gps!} to={p} label={`${i + 1}. ${p.name}`} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {h.amenities.length > 0 && (
          <section>
            <h3 className="mb-1 font-bold">Amenities</h3>
            <p className="text-sm text-muted">{h.amenities.join(" · ")}</p>
          </section>
        )}
        {h.nearbyPlaces.length > 0 && (
          <section>
            <h3 className="mb-1 font-bold">Nearby (Google)</h3>
            <ul className="text-sm text-muted">
              {h.nearbyPlaces.slice(0, 5).map((n, i) => (
                <li key={i}>
                  {n.name}
                  {n.transport.length ? ` — ${n.transport.join(", ")}` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3 className="mb-2 font-bold">Top reviews</h3>
          {revErr && <ErrorState message={revErr.message} code={revErr.code} />}
          {!reviews && !revErr && h.propertyToken && <CardSkeletons count={2} height="h-16" />}
          {!h.propertyToken && <p className="text-sm text-muted">Reviews unavailable for this listing.</p>}
          {reviews && <ReviewList reviews={reviews.reviews.slice(0, 8)} fetchedAt={reviews.fetchedAt} />}
          <p className="mt-1 text-[0.7rem] text-muted">Rating summary: {h.rating ?? "—"} from {fmtCount(h.reviews)} Google reviews.</p>
        </section>
      </div>
    </Sheet>
  );
}
