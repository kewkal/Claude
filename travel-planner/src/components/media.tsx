"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { estimateTravel, TRAVEL_ESTIMATE_NOTE, type LatLng } from "@/lib/geo";
import { fmtMiles, fmtTimestamp } from "@/lib/format";
import type { Photo, Review } from "@/lib/hotels/types";
import { InfoTip } from "./ui";

export function Gallery({ photos, alt }: { photos: Photo[]; alt: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!photos.length) return <p className="text-sm text-muted">No photos returned by the source.</p>;
  return (
    <>
      <div className="scroll-x -mx-1 flex snap-x gap-2 px-1">
        {photos.map((p, i) => (
          <button key={p.thumb + i} type="button" className="shrink-0 snap-start" onClick={() => setOpen(i)} aria-label={`Open photo ${i + 1}`}>
            <img src={p.thumb} alt={p.caption ?? `${alt} photo ${i + 1}`} loading="lazy" referrerPolicy="no-referrer" className="h-32 w-44 rounded-lg object-cover" />
          </button>
        ))}
      </div>
      {open !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-2" onClick={() => setOpen(null)} role="dialog" aria-label="Photo viewer">
          <img src={photos[open].full} alt={photos[open].caption ?? alt} referrerPolicy="no-referrer" className="max-h-[85dvh] max-w-full rounded-lg object-contain" />
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
            <button type="button" className="btn btn-ghost bg-black/60 text-white" onClick={(e) => (e.stopPropagation(), setOpen((open - 1 + photos.length) % photos.length))}>
              ‹ Prev
            </button>
            <button type="button" className="btn btn-ghost bg-black/60 text-white" onClick={(e) => (e.stopPropagation(), setOpen((open + 1) % photos.length))}>
              Next ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function ReviewList({ reviews, fetchedAt }: { reviews: Review[]; fetchedAt?: string }) {
  if (!reviews.length) return <p className="text-sm text-muted">No reviews returned by the source.</p>;
  return (
    <div className="space-y-2">
      {reviews.map((r, i) => (
        <blockquote key={i} className="rounded-lg bg-surface-2 p-3 text-sm">
          <div className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {r.rating !== null && (
              <span className="font-semibold text-text">
                ★ {r.rating}
                {r.bestRating && r.bestRating !== 5 ? `/${r.bestRating}` : ""}
              </span>
            )}
            <span>{r.author}</span>
            <span>· {r.source}</span>
            {r.date && <span>· {r.date}</span>}
            {r.link && (
              <a href={r.link} target="_blank" rel="noopener noreferrer" className="text-accent">
                source ↗
              </a>
            )}
          </div>
          <p>{r.text}</p>
        </blockquote>
      ))}
      {fetchedAt && <p className="text-[0.7rem] text-muted">Reviews fetched {fmtTimestamp(fetchedAt)}. Dates are as the source shows them.</p>}
    </div>
  );
}

interface Live {
  miles: number | null;
  minutes: number | null;
  mode: string;
  googleMapsUrl: string;
}

/** Shows the free estimate; one tap fetches live Google Maps directions (1 search, cached 7 days). */
export function TravelTime({ from, to, label }: { from: LatLng; to: LatLng; label?: string }) {
  const est = estimateTravel(from, to);
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function fetchLive() {
    setBusy(true);
    setErr(null);
    try {
      setLive(await api<Live>("/api/directions", { method: "POST", json: { from, to } }));
    } catch (e) {
      setErr((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-sm">
      {label && <span className="font-medium">{label}:</span>}
      {live ? (
        <span>
          {live.minutes ?? "?"} min {live.mode} · {fmtMiles(live.miles)}{" "}
          <a href={live.googleMapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-accent">
            Google Maps ↗
          </a>
        </span>
      ) : (
        <span className="text-muted">
          ~{est.minutes} min {est.mode} · {fmtMiles(est.miles)} (est.)
          <InfoTip label="How travel time is estimated">{TRAVEL_ESTIMATE_NOTE}</InfoTip>
        </span>
      )}
      {!live && (
        <button type="button" onClick={fetchLive} disabled={busy} className="text-xs font-semibold text-accent">
          {busy ? "…" : "Live time"}
        </button>
      )}
      {err && <span className="text-xs text-danger">{err}</span>}
    </span>
  );
}
