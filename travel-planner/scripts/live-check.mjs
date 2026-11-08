#!/usr/bin/env node
// One approved live SerpApi call to confirm real response shapes match our normalizers.
// Uses exactly 1 search from your quota. Saves the raw JSON to fixtures/live/ (gitignored) so it
// can be promoted to a test fixture.
//
//   SERPAPI_API_KEY=... node scripts/live-check.mjs --yes [engine]
//   engines: flights (default) | hotels | maps | events | youtube | tripadvisor
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (!args.includes("--yes")) {
  console.error("This uses 1 SerpApi search. Re-run with --yes to confirm.");
  process.exit(2);
}
const key = process.env.SERPAPI_API_KEY;
if (!key) {
  console.error("Set SERPAPI_API_KEY in your shell first.");
  process.exit(2);
}

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const which = args.find((a) => !a.startsWith("--")) ?? "flights";
const REQUESTS = {
  flights: { engine: "google_flights", departure_id: "IAH", arrival_id: "LIS", outbound_date: inDays(45), return_date: inDays(50), adults: 2, type: 1, currency: "USD", hl: "en", gl: "us" },
  hotels: { engine: "google_hotels", q: "Lisbon, Portugal", check_in_date: inDays(45), check_out_date: inDays(50), adults: 2, currency: "USD", hl: "en", gl: "us" },
  maps: { engine: "google_maps", q: "top sights in Lisbon, Portugal", type: "search", hl: "en", gl: "us" },
  events: { engine: "google_events", q: "events in Lisbon", hl: "en", gl: "us" },
  youtube: { engine: "youtube", search_query: "Lisbon travel guide", hl: "en", gl: "us" },
  tripadvisor: { engine: "tripadvisor", q: "Lisbon", ssrc: "A", hl: "en" },
};
const params = REQUESTS[which];
if (!params) {
  console.error(`Unknown engine "${which}". Use one of: ${Object.keys(REQUESTS).join(", ")}`);
  process.exit(2);
}

const res = await fetch(`https://serpapi.com/search.json?${new URLSearchParams({ ...params, api_key: key })}`);
const data = await res.json();
const dir = path.join(process.cwd(), "fixtures", "live");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${params.engine}-${new Date().toISOString().slice(0, 10)}.json`);
writeFileSync(file, JSON.stringify(data, null, 1));
console.log(`HTTP ${res.status} · saved ${path.relative(process.cwd(), file)}`);
if (data.error) console.log(`SerpApi error: ${data.error}`);

const keys = (o) => (o && typeof o === "object" ? Object.keys(o).join(", ") : String(o));
if (which === "flights") {
  const f = data.best_flights?.[0] ?? data.other_flights?.[0];
  console.log("top-level keys:", keys(data));
  console.log("first option keys:", keys(f));
  console.log("first segment keys:", keys(f?.flights?.[0]));
  console.log(`price for 2 adults: ${f?.price} — compare with ${data.search_metadata?.google_flights_url}`);
  console.log("  If Google Flights shows the same number as the TOTAL for 2 travelers, our per-person split is right.");
  console.log("price_insights:", JSON.stringify(data.price_insights ?? null)?.slice(0, 200));
} else if (which === "hotels") {
  const p = data.properties?.[0];
  console.log("property keys:", keys(p));
  console.log("rate_per_night:", JSON.stringify(p?.rate_per_night), "total_rate:", JSON.stringify(p?.total_rate));
} else if (which === "maps") {
  console.log("local_results[0] keys:", keys(data.local_results?.[0]));
  console.log("price field sample:", data.local_results?.map((r) => r.price).filter(Boolean).slice(0, 5));
} else if (which === "events") {
  console.log("events_results[0]:", JSON.stringify(data.events_results?.[0])?.slice(0, 400));
} else if (which === "youtube") {
  console.log("video_results[0] keys:", keys(data.video_results?.[0]));
} else {
  console.log("locations[0]:", JSON.stringify(data.locations?.[0])?.slice(0, 400));
}
