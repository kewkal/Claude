"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/client/api";
import { loadSession, saveSession, useSettings } from "@/lib/client/useSettings";
import { fmtTimestamp } from "@/lib/format";
import type { Pin } from "@/lib/pins-shared";
import { CATEGORIES, isVerified, type PlaceCategory, type PlaceItem, type Video } from "@/lib/places/types";
import { PlaceCard, PlaceDetailsSheet, YouTubeEmbed } from "@/components/PlaceCard";
import { todayPlus } from "@/components/inputs";
import { CardSkeletons, EmptyState, ErrorState } from "@/components/ui";

interface ExploreResult {
  category: PlaceCategory;
  items: PlaceItem[];
  fetchedAt: string;
  searchesUsed: number;
}

interface Form {
  destination: string;
  startDate: string;
  endDate: string;
  tripadvisor: boolean;
}

type SortKey = "rating" | "reviews" | "verified";

export default function ExplorePage() {
  const settings = useSettings();
  const [form, setForm] = useState<Form>({ destination: "", startDate: todayPlus(30), endDate: todayPlus(35), tripadvisor: true });
  const [active, setActive] = useState<string | null>(null); // destination currently explored
  const [cat, setCat] = useState<PlaceCategory>("sights");
  const [results, setResults] = useState<Partial<Record<PlaceCategory, ExploreResult>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [open, setOpen] = useState<PlaceItem | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [sort, setSort] = useState<SortKey>("verified");
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  useEffect(() => {
    // Restore after mount (sessionStorage isn't available during SSR).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(loadSession("tp:explore:form", form));
    api<{ pins: Pin[] }>("/api/pins")
      .then((r) => setPins(r.pins))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(category: PlaceCategory, destination = active, fresh = false) {
    if (!destination) return;
    setCat(category);
    if (!fresh && results[category]) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api<ExploreResult>("/api/places/explore", {
        method: "POST",
        json: { destination, category, options: { startDate: form.startDate, endDate: form.endDate, tripadvisor: form.tripadvisor } },
      });
      setResults((prev) => ({ ...prev, [category]: r }));
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLoading(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    saveSession("tp:explore:form", form);
    setResults({});
    setVideos(null);
    setActive(form.destination.trim());
    load(cat, form.destination.trim(), true);
  }

  async function loadVideos() {
    if (!active) return;
    try {
      const r = await api<{ videos: Video[] }>("/api/places/videos", { method: "POST", json: { destination: active } });
      setVideos(r.videos);
    } catch (e) {
      setError(e as ApiError);
    }
  }

  async function togglePin(item: PlaceItem) {
    if (!item.gps) return;
    const isPinned = pins.some((p) => p.id === item.id);
    try {
      const r = isPinned
        ? await api<{ pins: Pin[] }>(`/api/pins?id=${encodeURIComponent(item.id)}`, { method: "DELETE" })
        : await api<{ pins: Pin[] }>("/api/pins", { method: "POST", json: { id: item.id, name: item.name, lat: item.gps.lat, lng: item.gps.lng, category: item.category, destination: active } });
      setPins(r.pins);
    } catch (e) {
      setError(e as ApiError);
    }
  }

  const current = results[cat];
  const threshold = settings.verifiedReviewThreshold;
  const items = useMemo(() => {
    let list = current?.items ?? [];
    if (verifiedOnly) list = list.filter((i) => isVerified(i, threshold));
    const best = (i: PlaceItem) => Math.max(0, ...i.sources.map((s) => s.rating ?? 0));
    const most = (i: PlaceItem) => Math.max(0, ...i.sources.map((s) => s.reviews ?? 0));
    const sorted = [...list];
    if (sort === "rating") sorted.sort((a, b) => best(b) - best(a));
    else if (sort === "reviews") sorted.sort((a, b) => most(b) - most(a));
    else sorted.sort((a, b) => Number(isVerified(b, threshold)) - Number(isVerified(a, threshold)) || best(b) - best(a));
    return sorted;
  }, [current, verifiedOnly, sort, threshold]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">Explore</h1>

      <form onSubmit={submit} className="card space-y-3 p-4">
        <div>
          <label className="label" htmlFor="edest">
            Destination
          </label>
          <input id="edest" className="input" placeholder="e.g. Lisbon, Portugal" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} required />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="es">
              From (for events)
            </label>
            <input id="es" type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="ee">
              To
            </label>
            <input id="ee" type="date" className="input" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.tripadvisor} onChange={(e) => setForm({ ...form, tripadvisor: e.target.checked })} />
          Add Tripadvisor ratings (+1 search per destination, cached 7 days)
        </label>
        <button className="btn w-full">Explore</button>
        <p className="text-center text-xs text-muted">Each category is 1–2 searches the first time, then free for 7 days (events: 24 hrs).</p>
      </form>

      {active && (
        <>
          <div className="scroll-x -mx-4 flex gap-2 px-4" role="tablist" aria-label="Categories">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={cat === c.id}
                type="button"
                onClick={() => load(c.id)}
                className={`chip shrink-0 border px-3 py-1.5 text-sm ${cat === c.id ? "border-accent bg-accent text-accent-contrast" : "border-border bg-surface text-text"}`}
              >
                {c.label}
                {results[c.id] ? ` (${results[c.id]!.items.length})` : ""}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
              Verified only ({threshold}+ reviews on a source)
            </label>
            <select aria-label="Sort" className="input w-auto min-h-0 py-1 text-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="verified">Verified first</option>
              <option value="rating">Highest rated</option>
              <option value="reviews">Most reviewed</option>
            </select>
          </div>

          {error && <ErrorState message={error.message} code={error.code} />}
          {loading && <CardSkeletons count={4} height="h-28" />}

          {current && !loading && (
            <section className="space-y-3">
              <p className="text-xs text-muted">
                {current.searchesUsed ? `${current.searchesUsed} search${current.searchesUsed > 1 ? "es" : ""} used · ` : "from cache · "}
                fetched {fmtTimestamp(current.fetchedAt)}
              </p>
              {items.length === 0 ? (
                <EmptyState title={cat === "events" ? "No events found for these dates." : "Nothing found for this category."}>
                  {cat === "events" ? "Google Events lists what's announced so far; try again closer to your trip." : "Try a broader destination name."}
                </EmptyState>
              ) : (
                items.map((i) => (
                  <PlaceCard key={i.id} item={i} threshold={threshold} onOpen={() => setOpen(i)} pinned={pins.some((p) => p.id === i.id)} onPin={() => togglePin(i)} />
                ))
              )}
            </section>
          )}

          <section className="card space-y-3 p-4">
            <h2 className="font-bold">Videos about {active}</h2>
            {videos ? (
              videos.length ? (
                videos.map((v) => <YouTubeEmbed key={v.id} v={v} />)
              ) : (
                <p className="text-sm text-muted">No videos found.</p>
              )
            ) : (
              <button type="button" className="btn btn-ghost w-full" onClick={loadVideos}>
                Load destination videos (1 search)
              </button>
            )}
          </section>
        </>
      )}

      {open && active && <PlaceDetailsSheet item={open} destination={active} threshold={threshold} onClose={() => setOpen(null)} />}
    </div>
  );
}
