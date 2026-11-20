import { beforeAll, describe, expect, it, vi } from "vitest";
import { computeCosts } from "@/lib/planner/budget";
import { buildDataset } from "@/lib/planner/dataset";
import { generatePlan } from "@/lib/planner/generate";
import { createTrip, editTrip } from "@/lib/planner/trips";
import type { Dataset, PlanInput } from "@/lib/planner/types";
import { mentions, parseHotelOffers, parseMoney, parseTripadvisorPrice, priceLines, verifyWebsitePrice } from "@/lib/prices/extract";
import { validatePicks } from "@/lib/prices/picks";
import { planPriceCheck, runPriceCheck } from "@/lib/prices/service";
import type { TipSource } from "@/lib/savings/types";
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

describe("price parsing and verification (pure)", () => {
  it("reads money in many currencies, upper end of ranges", () => {
    expect(parseMoney("€10–15")).toEqual({ currency: "EUR", amount: 15 });
    expect(parseMoney("Adults $29.50")).toEqual({ currency: "USD", amount: 29.5 });
    expect(parseMoney("MX$350")).toEqual({ currency: "MXN", amount: 350 });
    expect(parseMoney("£1,200")).toEqual({ currency: "GBP", amount: 1200 });
    expect(parseMoney("Free")).toBeNull();
  });

  it("lists hotel offers per booking site, cheapest first, deduped", () => {
    const offers = parseHotelOffers({
      featured_prices: [{ source: "Booking.com", total_rate: { extracted_lowest: 300 }, rate_per_night: { extracted_lowest: 60 } }],
      prices: [
        { source: "Booking.com", total_rate: { extracted_lowest: 330 } },
        { source: "Expedia", total_rate: { extracted_lowest: 320 } },
        { source: "Empty" },
      ],
    });
    expect(offers.map((o) => [o.seller, o.totalUsd])).toEqual([
      ["Booking.com", 300],
      ["Expedia", 320],
    ]);
  });

  it("takes Tripadvisor's lowest listed price", () => {
    expect(parseTripadvisorPrice({ place_result: { price: "$18.00", extracted_price: 18, price_options: [{ price: "$32.00", extracted_price: 32 }] } })).toMatchObject({ amount: 18, currency: "USD" });
    expect(parseTripadvisorPrice({ place_result: { name: "No price" } })).toBeNull();
  });

  it("only accepts a website price whose quote is really on the page and shows that number", () => {
    const md = "## Tickets\n\nAdults: €10\n\nSeniors: €5\n";
    expect(verifyWebsitePrice({ quote: "Adults: €10", amount: 10, free: false }, md)).toEqual({ currency: "EUR", amount: 10 });
    expect(verifyWebsitePrice({ quote: "Adults: €12", amount: 12, free: false }, md)).toBeNull(); // not on the page
    expect(verifyWebsitePrice({ quote: "Adults: €10", amount: 25, free: false }, md)).toBeNull(); // number not in quote
    expect(verifyWebsitePrice({ quote: "Seniors: €5", amount: null, free: true }, md)).toBeNull(); // doesn't say free
    expect(priceLines("Hours 9-5\nAdults: €10\nWelcome!")).toBe("Adults: €10");
  });

  it("keeps community picks only when a cited source names them; 2+ sites = cross-checked", () => {
    const sources: TipSource[] = [
      { id: "S1", kind: "reddit", title: "r/travel", url: "https://reddit.com/a", domain: "reddit.com", snippet: "Do the Castle Viewpoint early." },
      { id: "S2", kind: "web", title: "TA forum", url: "https://tripadvisor.com/x", domain: "tripadvisor.com", snippet: "The castle viewpoint is a must." },
    ];
    const picks = validatePicks(
      [
        { name: "Castle Viewpoint", ref: "P3", why: "Go early.", sourceIds: ["S1", "S2"] },
        { name: "Invented Place", ref: null, why: "x", sourceIds: ["S1"] },
        { name: "Castle Viewpoint", ref: "P9", why: "dup", sourceIds: ["S1"] },
      ],
      sources,
      [{ ref: "P3", name: "Sample Castle Viewpoint" }],
    );
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ ref: "P3", crossChecked: true, domains: ["reddit.com", "tripadvisor.com"] });
    expect(mentions("the Sample Tile Museum, underrated", "Sample Tile Museum")).toBe(true);
  });
});

describe("Get real prices (fixtures)", () => {
  let ds: Dataset;
  beforeAll(async () => {
    ds = await buildDataset(input, "Lisbon", S.valueOfTimeUsdPerHour);
  });
  // The test DB resets before every test, so each test makes its own trip.
  const newTrip = async () => createTrip(input, ds, await generatePlan(input, ds, S));

  it("plans the check without spending anything", async () => {
    const plan = await planPriceCheck(await newTrip());
    expect(plan.hotels.length).toBeGreaterThan(0);
    expect(plan.tripadvisor.map((t) => t.name)).toContain("Sample Hidden Garden");
    expect(plan.websites.map((w) => w.name)).toEqual(expect.arrayContaining(["Sample Tower by the River"]));
    expect(plan.convert.map((c) => c.display)).toContain("€15");
    expect(plan.picksQueries).toBe(2);
  });

  it("finds prices, verifies them, and updates the budget", async () => {
    const trip = await newTrip();
    const before = trip.plan.versions.balanced.costs;
    const t = await runPriceCheck(trip);
    const pc = t.dataset.priceCheck!;
    const by = (name: string) => pc.activities.find((a) => a.name === name);

    expect(by("Sample Hidden Garden")).toMatchObject({ usd: 18, source: "tripadvisor" });
    expect(by("Sample Castle Viewpoint")).toMatchObject({ source: "listed", usd: 16.2, fx: { currency: "EUR", amount: 15 } });
    expect(by("Sample Tower by the River")).toMatchObject({ source: "website", usd: 10.8, quote: "Adults: €10" });
    expect(pc.notFound.find((n) => n.name === "Sample Modern Art Center")?.reason).toMatch(/doesn't list a price/);

    expect(pc.hotels[0].offers[0]).toMatchObject({ seller: "Booking.com", totalUsd: 300 });
    expect(pc.picks.map((p) => p.name)).toEqual(expect.arrayContaining(["Sample Castle Viewpoint", "Sample Hidden Courtyard"]));
    expect(pc.picks.find((p) => p.name === "Sample Castle Viewpoint")).toMatchObject({ crossChecked: true, ref: "P3" });
    expect(pc.picks.some((p) => p.name.startsWith("Made Up"))).toBe(false);

    const after = t.plan.versions.balanced.costs;
    const act = (c: typeof after) => c.lines.find((l) => l.key === "activities")!.amount;
    expect(act(after)).toBeGreaterThan(act(before));
    expect(after.lines.find((l) => l.key === "activities")!.note).toMatch(/from the price check/);
    expect(after.unpricedItems.length).toBeLessThan(before.unpricedItems.length);

    // Cheapest booking site is used when it beats Google's headline.
    const v = t.plan.versions.splurge;
    const h = t.dataset.hotels!.options.find((o) => o.ref === v.hotelRef)!;
    const lodging = computeCosts(v, t.dataset, input, S).lines.find((l) => l.key === "lodging")!;
    expect(h.totalRate!).toBeGreaterThan(300);
    expect(lodging.amount).toBe(300);
    expect(lodging.note).toMatch(/cheapest of \d booking sites is Booking\.com/);

    // A price the check found can't be overwritten by hand.
    await expect(editTrip(t.id, { op: "set_price", ref: "P5", usd: 1 })).rejects.toThrow(/price check/);
  });
});
