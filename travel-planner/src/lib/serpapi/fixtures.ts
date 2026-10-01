import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SerpParams } from "./cache-key";

// Maps a request to a saved JSON response in fixtures/serpapi/. Used by tests and DATA_MODE=fixtures.
export function fixtureName(engine: string, params: SerpParams): string {
  if (engine === "google_flights") {
    if (params.booking_token) return "google_flights_booking";
    if (params.departure_token) return "google_flights_return";
    return "google_flights";
  }
  if (engine === "google_maps") {
    if (params.type === "place") return "google_maps_place";
    const q = String(params.q ?? "").toLowerCase();
    if (/restaurant|food|eat/.test(q)) return "google_maps_food";
    if (/museum|galler|culture/.test(q)) return "google_maps_culture";
    if (/bar|nightlife|club/.test(q)) return "google_maps_nightlife";
    if (/park|hik|outdoor|beach/.test(q)) return "google_maps_outdoors";
    if (/tour|experience/.test(q)) return "google_maps_tours";
    if (/viewpoint|scenic|photo/.test(q)) return "google_maps_photo";
    return "google_maps_sights";
  }
  if (engine === "tripadvisor") return params.ssrc === "r" ? "tripadvisor_food" : "tripadvisor";
  return engine;
}

export async function loadFixture(engine: string, params: SerpParams): Promise<unknown> {
  const dir = path.join(process.cwd(), "fixtures", "serpapi");
  const names = [fixtureName(engine, params), engine];
  for (const name of names) {
    try {
      return JSON.parse(await readFile(path.join(dir, `${name}.json`), "utf8"));
    } catch {
      // try next
    }
  }
  throw new Error(`No fixture for ${engine} (looked for ${names.join(", ")})`);
}
