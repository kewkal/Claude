import { beforeAll, describe, expect, it, vi } from "vitest";
import { airportsForCity, milesFrom, withNearbyAirports } from "@/lib/airports";
import { buildFlightParams, searchFlights } from "@/lib/flights/service";
import { buildDataset, estimateSearches } from "@/lib/planner/dataset";
import { generatePlan } from "@/lib/planner/generate";
import { createTrip } from "@/lib/planner/trips";
import type { Dataset, PlanInput } from "@/lib/planner/types";
import { computeDataTips } from "@/lib/savings/data";
import { generateSavingsTips, tipQueries } from "@/lib/savings/service";
import { sourceKind, type TipSource } from "@/lib/savings/types";
import { buildSources, keepVerifiedAmounts, validateWebTips } from "@/lib/savings/verify";
import { DEFAULT_SETTINGS } from "@/lib/settings-shared";

const S = DEFAULT_SETTINGS;
const input: PlanInput = {
  origin: "IAH",
  destinations: ["Lisbon"],
  dateMode: "fixed",
  startDate: "2026-11-12",
  endDate: "2026-11-17",
  travelers: { adults: 2, children: 0, infantsInSeat: 0, infantsOnLap: 0 },
  childAges: [],
  rooms: 1,
  cabin: "economy",
  budgetUsd: 6000,
  styles: ["cultural", "foodie", "cinematic"],
  pace: "balanced",
};
vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));

describe("nearby airports (catches low-cost carriers at secondary airports)", () => {
  it("adds airports within 100 miles, closest first, in one search", () => {
    const bwi = withNearbyAirports("BWI").split(",");
    expect(bwi[0]).toBe("BWI");
    expect(bwi).toContain("ILG"); // Avelo's Wilmington, DE base (nonstops to San Juan)
    expect(bwi).toContain("DCA");
    expect(bwi.length).toBeLessThanOrEqual(6);
    expect(milesFrom("BWI", "ILG")).toBeGreaterThan(50);
    expect(milesFrom("BWI", "ILG")).toBeLessThan(80);
  });

  it("leaves Google place ids, unknown codes, and far-away airports alone", () => {
    expect(withNearbyAirports("/m/0fw4v")).toBe("/m/0fw4v");
    expect(withNearbyAirports("LIS")).toBe("LIS");
    expect(withNearbyAirports("SJU")).toBe("SJU");
    expect(withNearbyAirports("HNL").split(",")).not.toContain("OGG"); // ~100+ mi over water, still filtered by distance
  });

  it("resolves state names to their airports", () => {
    expect(airportsForCity("Maryland")).toBe("BWI,HGR");
    expect(airportsForCity("Delaware")).toBe("ILG");
    expect(airportsForCity("Washington, DC")).toBe("DCA,IAD");
  });

  it("flight searches send all nearby airports as one departure_id", async () => {
    const r = await searchFlights({ tripType: "round_trip", origin: "Baltimore", destination: "SJU", departDate: "2026-12-10", returnDate: "2026-12-15", travelers: input.travelers, cabin: "economy", nearbyOrigin: true });
    expect(r.options.length).toBeGreaterThan(0);
    const p = buildFlightParams({ tripType: "round_trip", origin: withNearbyAirports("BWI"), destination: "SJU", departDate: "2026-12-10", returnDate: "2026-12-15", travelers: input.travelers, cabin: "economy" });
    expect(String(p.departure_id)).toMatch(/^BWI,.*ILG/);
  });

  it("planner uses nearby airports by default without extra searches", async () => {
    const withNearby = await estimateSearches({ ...input, origin: "BWI" });
    const without = await estimateSearches({ ...input, origin: "BWI", nearbyOrigin: false });
    expect(withNearby.perDestination[0].total).toBe(without.perDestination[0].total);
  });
});

describe("money-saving tips", () => {
  let ds: Dataset;
  beforeAll(async () => {
    ds = await buildDataset(input, "Lisbon", S.valueOfTimeUsdPerHour);
  });

  it("computes tips from the trip's own data with real savings amounts", async () => {
    const plan = await generatePlan(input, ds, S);
    const tips = computeDataTips(ds, plan.versions.splurge, input);
    const ids = tips.map((t) => t.id);
    expect(ids).toContain("price-level");
    expect(tips.find((t) => t.id.startsWith("cheapest-flight"))!.saveUsd).toBeGreaterThan(0);
    expect(tips.some((t) => t.category === "hotels")).toBe(true);
    expect(tips.find((t) => t.id === "cheap-eats")!.text).toContain("Sample Pastry Shop");
    expect(tips.find((t) => t.id === "markets")!.text).toContain("Sample Market Hall");
    expect(tips.find((t) => t.id === "free-things")!.text).toContain("Sample Miradouro North");
    expect(tips.every((t) => t.text.length > 20)).toBe(true);
  });

  const sources: TipSource[] = [
    { id: "S1", kind: "reddit", title: "r/travel", url: "https://reddit.com/a", domain: "reddit.com", snippet: "Market lunch is about $12 a plate." },
    { id: "S2", kind: "forum", title: "FlyerTalk", url: "https://flyertalk.com/b", domain: "flyertalk.com", snippet: "Eat lunch at the market for $12." },
    { id: "S3", kind: "reddit", title: "r/solotravel", url: "https://reddit.com/c", domain: "reddit.com", snippet: "Airport bus is $2.75." },
  ];

  it("only marks a tip cross-checked when 2+ different websites back it", () => {
    const tips = validateWebTips(
      [
        { category: "food", text: "Eat lunch at the market, about $12 a plate.", sourceIds: ["S1", "S2"] },
        { category: "getting_around", text: "Take the airport bus for $2.75 instead of a taxi.", sourceIds: ["S3", "S1"] }, // both reddit.com
        { category: "hotels", text: "Invented tip citing nothing real.", sourceIds: ["S9"] },
        { category: "food", text: "Uncited tip with no sources at all.", sourceIds: [] },
      ],
      sources,
    );
    expect(tips).toHaveLength(2);
    expect(tips[0]).toMatchObject({ category: "food", crossChecked: true, domains: ["reddit.com", "flyertalk.com"] });
    expect(tips[1]).toMatchObject({ crossChecked: false, domains: ["reddit.com"] });
  });

  it("drops dollar amounts that no cited source states", () => {
    expect(keepVerifiedAmounts("Bus is $2.75, taxi is $45.", [sources[2]])).toBe("Bus is $2.75, taxi is.");
    expect(keepVerifiedAmounts("Lunch costs $12.", [sources[0]])).toBe("Lunch costs $12.");
  });

  it("builds sources from Google (incl. forum results) and YouTube, skipping empty snippets", () => {
    const g = { organic_results: [{ title: "A", link: "https://www.reddit.com/r/x", snippet: "tip" }, { title: "B", link: "https://example.org", snippet: "" }], discussions_and_forums: [{ title: "C", link: "https://www.flyertalk.com/t", extensions: ["forum tip"] }] };
    const yt = { video_results: [{ title: "V", link: "https://www.youtube.com/watch?v=aaaaaaaaaaa", description: "video tip" }] };
    const s = buildSources([g], yt);
    expect(s.map((x) => [x.id, x.kind, x.domain])).toEqual([
      ["S1", "forum", "flyertalk.com"],
      ["S2", "reddit", "reddit.com"],
      ["S3", "video", "youtube.com"],
    ]);
    expect(sourceKind("old.reddit.com")).toBe("reddit");
  });

  it("uses 3 searches normally and 2 with Search Saver", () => {
    expect(tipQueries("Lisbon", false)).toHaveLength(3);
    expect(tipQueries("Lisbon", true)).toHaveLength(2);
    expect(tipQueries("Lisbon", false)[0].params.q).toContain("site:reddit.com");
  });

  it("fetches, verifies, and saves web tips on the trip (fixtures)", async () => {
    const plan = await generatePlan(input, ds, S);
    const trip = await createTrip(input, ds, plan);
    const t = await generateSavingsTips(trip);
    const web = t.plan.savings!.web;
    expect(web.length).toBe(2); // the tip citing a missing source is dropped
    const food = web.find((w) => w.category === "food")!;
    expect(food.crossChecked).toBe(true); // reddit + flyertalk
    expect(food.text).toContain("$12");
    const bus = web.find((w) => w.category === "getting_around")!;
    expect(bus.crossChecked).toBe(false);
    expect(bus.text).toContain("$2.75");
    expect(bus.text).toContain("$99"); // both amounts appear in the cited snippet
    expect(t.plan.savings!.sources.some((s) => s.url === "https://example.org/no-snippet")).toBe(false);
  });
});
