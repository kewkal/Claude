"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { fmtTimestamp } from "@/lib/format";
import type { Photo, Review } from "@/lib/hotels/types";
import { isVerified, PRICE_NOT_LISTED, SOURCE_LABEL, type PlaceItem, type PopularTimes, type Video } from "@/lib/places/types";
import { Gallery, ReviewList } from "./media";
import { MapView, mapsLink } from "./MapView";
import { Badge, CardSkeletons, ErrorState, FetchedAt, Rating, Sheet, SourceLink, VerifiedBadge } from "./ui";

export function priceLabel(item: PlaceItem): string {
  return item.price.display ?? PRICE_NOT_LISTED;
}

export function SourceRatings({ item }: { item: PlaceItem }) {
  const rated = item.sources.filter((s) => s.rating !== null);
  if (!rated.length) return <span className="text-xs text-muted">No ratings from sources</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {rated.map((s) => (
        <Rating key={s.source} rating={s.rating} reviews={s.reviews} source={SOURCE_LABEL[s.source]} />
      ))}
    </div>
  );
}

export function PlaceCard({
  item,
  threshold,
  onOpen,
  pinned,
  onPin,
}: {
  item: PlaceItem;
  threshold: number;
  onOpen: () => void;
  pinned?: boolean;
  onPin?: () => void;
}) {
  return (
    <article className="card flex gap-3 p-3">
      {item.thumbnail ? (
        <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="h-24 w-24 shrink-0 rounded-lg bg-surface-2" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="text-left">
          <h3 className="font-bold leading-tight">{item.name}</h3>
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {isVerified(item, threshold) && <VerifiedBadge threshold={threshold} />}
          <Badge>{item.types[0] ?? item.category}</Badge>
          <Badge tone={item.price.display ? "neutral" : "warn"}>{priceLabel(item)}</Badge>
        </div>
        <div className="mt-1">
          <SourceRatings item={item} />
        </div>
        {item.event ? (
          <p className="mt-1 text-sm">
            {item.event.when}
            {!item.event.startDate && <span className="ml-1 text-xs text-warn">(check date)</span>}
          </p>
        ) : (
          item.hours && <p className="mt-1 text-xs text-muted">{item.hours}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={onOpen} className="text-sm font-semibold text-accent">
            Details
          </button>
          {onPin && item.gps && (
            <button type="button" onClick={onPin} className={`text-sm font-semibold ${pinned ? "text-ok" : "text-muted"}`} aria-pressed={pinned}>
              {pinned ? "★ Pinned" : "☆ Pin"}
            </button>
          )}
          <FetchedAt iso={item.fetchedAt} />
        </div>
      </div>
    </article>
  );
}

interface Details {
  googleReviews?: Review[];
  tripadvisorReviews?: Review[];
  photos?: Photo[];
  videos?: Video[];
  popularTimes?: PopularTimes | null;
  fetchedAt: Record<string, string>;
  errors: Record<string, string>;
}

export function YouTubeEmbed({ v }: { v: Video }) {
  const [play, setPlay] = useState(false);
  return (
    <figure className="space-y-1">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        {play ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1`}
            title={v.title}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <button type="button" onClick={() => setPlay(true)} className="absolute inset-0" aria-label={`Play ${v.title}`}>
            <img src={v.thumbnail ?? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`} alt="" loading="lazy" className="h-full w-full object-cover opacity-90" />
            <span className="absolute inset-0 m-auto flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-2xl text-white">▶</span>
          </button>
        )}
      </div>
      <figcaption className="text-xs">
        <a href={v.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
          {v.title}
        </a>
        <span className="text-muted">
          {" "}
          · {v.channel}
          {v.published ? ` · ${v.published}` : ""}
          {v.length ? ` · ${v.length}` : ""}
        </span>
      </figcaption>
    </figure>
  );
}

function PopularTimesChart({ pt }: { pt: PopularTimes }) {
  const days = Object.keys(pt.days);
  const [day, setDay] = useState(days[0]);
  const data = pt.days[day] ?? [];
  const max = Math.max(1, ...data.map((d) => d.busyness));
  return (
    <div>
      <div className="scroll-x mb-2 flex gap-1">
        {days.map((d) => (
          <button key={d} type="button" onClick={() => setDay(d)} className={`chip border ${d === day ? "border-accent bg-accent-soft text-accent" : "border-border text-muted"}`}>
            {d.slice(0, 3)}
          </button>
        ))}
      </div>
      <div className="flex h-24 items-end gap-0.5" role="img" aria-label={`Popular times on ${day}`}>
        {data.map((d) => (
          <div key={d.time} className="flex flex-1 flex-col items-center gap-1" title={`${d.time}: ${d.busyness}% busy`}>
            <div className="w-full rounded-t bg-accent" style={{ height: `${(d.busyness / max) * 80}px`, opacity: d.busyness ? 1 : 0.2, minHeight: 2 }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[0.65rem] text-muted">
        <span>{data[0]?.time}</span>
        <span>{data[data.length - 1]?.time}</span>
      </div>
      <p className="mt-1 text-[0.7rem] text-muted">Google Maps popular times (relative busyness).</p>
    </div>
  );
}

export function PlaceDetailsSheet({ item, destination, threshold, onClose }: { item: PlaceItem; destination: string; threshold: number; onClose: () => void }) {
  const [d, setD] = useState<Details | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [ptBusy, setPtBusy] = useState(false);

  useEffect(() => {
    const parts = ["googleReviews", "tripadvisorReviews", "photos", "videos"];
    api<Details>("/api/places/details", { method: "POST", json: { item, destination, parts } })
      .then(setD)
      .catch((e) => setErr(e as ApiError));
  }, [item, destination]);

  async function loadPopularTimes() {
    setPtBusy(true);
    try {
      const r = await api<Details>("/api/places/details", { method: "POST", json: { item, destination, parts: ["popularTimes"] } });
      setD((prev) => ({ ...(prev ?? { fetchedAt: {}, errors: {} }), popularTimes: r.popularTimes ?? null, errors: { ...(prev?.errors ?? {}), ...r.errors } }));
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setPtBusy(false);
    }
  }

  const reviews = [...(d?.googleReviews ?? []), ...(d?.tripadvisorReviews ?? [])];
  const photos = d?.photos?.length ? d.photos : item.thumbnail ? [{ thumb: item.thumbnail, full: item.thumbnail }] : [];

  return (
    <Sheet open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {!d && !err && <CardSkeletons count={1} height="h-32" />}
        {err && <ErrorState message={err.message} code={err.code} />}
        {d && <Gallery photos={photos} alt={item.name} />}

        <div className="flex flex-wrap items-center gap-1.5">
          {isVerified(item, threshold) && <VerifiedBadge threshold={threshold} />}
          <Badge>{item.types[0] ?? item.category}</Badge>
          <Badge tone={item.price.display ? "neutral" : "warn"}>
            {priceLabel(item)}
            {item.price.source ? ` · ${SOURCE_LABEL[item.price.source]}` : ""}
          </Badge>
        </div>

        <section>
          <h3 className="mb-1 font-bold">Ratings by source</h3>
          <SourceRatings item={item} />
          <div className="mt-1 flex flex-wrap gap-3">
            {item.sources.map((s) => (
              <SourceLink key={s.source} href={s.url}>
                {SOURCE_LABEL[s.source]}
              </SourceLink>
            ))}
            {item.website && <SourceLink href={item.website}>Website</SourceLink>}
          </div>
          <p className="mt-1 text-[0.7rem] text-muted">
            {item.sources.map((s) => `${SOURCE_LABEL[s.source]} fetched ${fmtTimestamp(s.fetchedAt)}`).join(" · ")}
          </p>
        </section>

        {item.event && (
          <section>
            <h3 className="mb-1 font-bold">When</h3>
            <p className="text-sm">{item.event.when}</p>
            {item.event.venue && <p className="text-sm text-muted">{item.event.venue}</p>}
            {item.event.tickets.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-3">
                {item.event.tickets.map((t, i) => (
                  <SourceLink key={i} href={t.link}>
                    Tickets: {t.source}
                  </SourceLink>
                ))}
              </div>
            )}
          </section>
        )}

        {(item.hours || item.weeklyHours) && !item.event && (
          <section>
            <h3 className="mb-1 font-bold">Hours</h3>
            {item.hours && <p className="text-sm">{item.hours}</p>}
            {item.weeklyHours && (
              <table className="mt-1 text-sm">
                <tbody>
                  {Object.entries(item.weeklyHours).map(([day, h]) => (
                    <tr key={day}>
                      <td className="pr-3 capitalize text-muted">{day}</td>
                      <td>{h}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {item.description && (
          <section>
            <h3 className="mb-1 font-bold">About</h3>
            <p className="text-sm">{item.description}</p>
            <p className="text-[0.7rem] text-muted">From {item.sources[0] ? SOURCE_LABEL[item.sources[0].source] : "source"}</p>
          </section>
        )}

        {item.address && (
          <section>
            <h3 className="mb-1 font-bold">Address</h3>
            <p className="text-sm">{item.address}</p>
            {item.gps && (
              <>
                <div className="mt-2">
                  <MapView markers={[{ ...item.gps, label: item.name, badge: "•" }]} height={200} />
                </div>
                <a href={mapsLink(item.gps.lat, item.gps.lng)} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-semibold text-accent">
                  Open in Google Maps ↗
                </a>
              </>
            )}
          </section>
        )}

        {item.googlePlaceId && (
          <section>
            <h3 className="mb-1 font-bold">Crowds</h3>
            {d?.popularTimes ? (
              <PopularTimesChart pt={d.popularTimes} />
            ) : d?.popularTimes === null ? (
              <p className="text-sm text-muted">Google has no popular-times data for this place.</p>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={loadPopularTimes} disabled={ptBusy}>
                {ptBusy ? "Loading…" : "Show popular times (1 search)"}
              </button>
            )}
          </section>
        )}

        {d && (
          <section>
            <h3 className="mb-2 font-bold">Videos</h3>
            {d.errors.videos ? (
              <p className="text-sm text-danger">{d.errors.videos}</p>
            ) : d.videos?.length ? (
              <div className="space-y-3">
                {d.videos.map((v) => (
                  <YouTubeEmbed key={v.id} v={v} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">No videos found.</p>
            )}
          </section>
        )}

        {d && (
          <section>
            <h3 className="mb-2 font-bold">Reviews</h3>
            {(d.errors.googleReviews || d.errors.tripadvisorReviews) && (
              <p className="mb-1 text-sm text-danger">{d.errors.googleReviews ?? d.errors.tripadvisorReviews}</p>
            )}
            <ReviewList reviews={reviews} fetchedAt={d.fetchedAt.googleReviews ?? d.fetchedAt.tripadvisorReviews} />
          </section>
        )}
        <p className="text-[0.7rem] text-muted">Opening an item uses up to 4 SerpApi searches (reviews ×2, photos, videos), each cached for 7 days.</p>
      </div>
    </Sheet>
  );
}
