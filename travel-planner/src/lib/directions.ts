import "server-only";
import { badInput } from "@/lib/errors";
import { isLatLng, type LatLng } from "@/lib/geo";
import { serpSearch } from "@/lib/serpapi/client";

export interface LiveDirections {
  miles: number | null;
  minutes: number | null;
  mode: string;
  summary: string | null;
  fetchedAt: string;
  googleMapsUrl: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>;

function parseMinutes(r: Raw): number | null {
  if (typeof r.duration === "number") return Math.round(r.duration / 60); // seconds
  const s = String(r.formatted_duration ?? "");
  const h = /(\d+)\s*h/.exec(s);
  const m = /(\d+)\s*min/.exec(s);
  if (!h && !m) return null;
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

function parseMiles(r: Raw): number | null {
  if (typeof r.distance === "number") return Math.round((r.distance / 1609.344) * 10) / 10; // meters
  const s = String(r.formatted_distance ?? "");
  const mi = /([\d.]+)\s*mi/.exec(s);
  if (mi) return Number(mi[1]);
  const km = /([\d.]+)\s*km/.exec(s);
  if (km) return Math.round((Number(km[1]) / 1.609344) * 10) / 10;
  const ft = /([\d,]+)\s*ft/.exec(s);
  if (ft) return Math.round((Number(ft[1].replace(/,/g, "")) / 5280) * 100) / 100;
  return null;
}

export function normalizeDirections(data: Raw): Omit<LiveDirections, "fetchedAt" | "googleMapsUrl"> {
  const list: Raw[] = Array.isArray(data.directions) ? data.directions : [];
  const best = list[0];
  if (!best) return { miles: null, minutes: null, mode: "unknown", summary: null };
  return {
    miles: parseMiles(best),
    minutes: parseMinutes(best),
    mode: String(best.travel_mode ?? "best").toLowerCase(),
    summary: typeof best.via === "string" ? `via ${best.via}` : null,
  };
}

const fmt = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** One Google Maps Directions search (cached 7 days). */
export async function liveDirections(from: LatLng, to: LatLng): Promise<LiveDirections> {
  if (!isLatLng(from) || !isLatLng(to)) throw badInput("Both points need coordinates.");
  const res = await serpSearch("google_maps_directions", { start_coords: fmt(from), end_coords: fmt(to), hl: "en", gl: "us" });
  return {
    ...normalizeDirections(res.data),
    fetchedAt: res.fetchedAt,
    googleMapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${fmt(from)}&destination=${fmt(to)}`,
  };
}
