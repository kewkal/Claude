"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  /** Short text inside the pin (e.g. "1", "H"). */
  badge?: string;
  tone?: "accent" | "hotel" | "pin" | "muted";
}

const TONE: Record<NonNullable<MapMarker["tone"]>, string> = {
  accent: "#0b6bcb",
  hotel: "#6b3fc4",
  pin: "#157f3b",
  muted: "#5b6475",
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** OpenStreetMap tiles via Leaflet (no API key). Location data itself comes from SerpApi. */
export function MapView({ markers, height = 260, route = false }: { markers: MapMarker[]; height?: number; route?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const key = JSON.stringify(markers);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      if (!map.current) {
        map.current = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map.current);
      }
      const m = map.current;
      m.eachLayer((layer) => {
        if (!(layer instanceof L.TileLayer)) m.removeLayer(layer);
      });
      const pts = markers.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      for (const p of pts) {
        const color = TONE[p.tone ?? "accent"];
        const icon = L.divIcon({
          className: "",
          html: `<div style="background:${color};color:#fff;border:2px solid #fff;border-radius:999px;min-width:26px;height:26px;padding:0 6px;display:flex;align-items:center;justify-content:center;font:700 12px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.35)">${esc(p.badge ?? "•")}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        L.marker([p.lat, p.lng], { icon, title: p.label }).bindPopup(esc(p.label)).addTo(m);
      }
      if (route && pts.length > 1) {
        L.polyline(
          pts.map((p) => [p.lat, p.lng] as [number, number]),
          { color: TONE.accent, weight: 3, opacity: 0.6, dashArray: "6 6" },
        ).addTo(m);
      }
      if (pts.length === 1) m.setView([pts[0].lat, pts[0].lng], 14);
      else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30] });
      else m.setView([20, 0], 2);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, route]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  return <div ref={el} style={{ height }} className="z-0 w-full overflow-hidden rounded-xl border border-border" role="img" aria-label={`Map with ${markers.length} locations`} />;
}

export function mapsLink(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
