export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_MI = 3958.8;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

// Travel-time ESTIMATE used until live Google Maps Directions are fetched for a leg.
// Straight-line distance × road factor, then walking (≤ 1 mi) or city driving speed plus overhead.
export const TRAVEL_ESTIMATE = {
  roadFactor: 1.3,
  walkMaxMiles: 1,
  walkMph: 3,
  driveMph: 18,
  driveOverheadMin: 8,
};

export const TRAVEL_ESTIMATE_NOTE =
  "Estimate: straight-line distance × 1.3, walking at 3 mph up to 1 mile, otherwise driving at 18 mph city average + 8 min for pickup/parking. Tap 'Live times' for Google Maps directions.";

export interface TravelEstimate {
  miles: number;
  minutes: number;
  mode: "walk" | "drive";
  estimated: true;
}

export function estimateTravel(a: LatLng, b: LatLng): TravelEstimate {
  const miles = haversineMiles(a, b) * TRAVEL_ESTIMATE.roadFactor;
  if (miles <= TRAVEL_ESTIMATE.walkMaxMiles) {
    return { miles, minutes: Math.max(1, Math.round((miles / TRAVEL_ESTIMATE.walkMph) * 60)), mode: "walk", estimated: true };
  }
  return { miles, minutes: Math.round((miles / TRAVEL_ESTIMATE.driveMph) * 60 + TRAVEL_ESTIMATE.driveOverheadMin), mode: "drive", estimated: true };
}

export function centroid(points: LatLng[]): LatLng | null {
  if (!points.length) return null;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}

export function isLatLng(v: unknown): v is LatLng {
  const p = v as LatLng;
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}
