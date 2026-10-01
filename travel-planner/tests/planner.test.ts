import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings-shared";
import { chooseFlight, chooseHotel, computeCosts, foodEstimate } from "@/lib/planner/budget";
import { compareDestinations } from "@/lib/planner/compare";
import { buildDataset, categoriesFor, estimateSearches, flexCandidates } from "@/lib/planner/dataset";
import { generatePlan, regenerateDay } from "@/lib/planner/generate";
import { datasetForPrompt, fixtureItinerary, systemPrompt } from "@/lib/planner/prompt";
import { createTrip, editTrip, getSharedTrip, getTrip, setSharing } from "@/lib/planner/trips";
import type { Dataset, PlanInput } from "@/lib/planner/types";
import { cleanNote, refsInDays, validateItinerary, validateSingleDay } from "@/lib/planner/validate";
import { normalizeHistory } from "@/lib/weather";

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
const S = DEFAULT_SETTINGS;
// Forecast window covers the fixture dates.
vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));

let ds: Dataset;
beforeAll(async () => {
  ds = await buildDataset(input, "Lisbon", S.valueOfTimeUsdPerHour);
});

describe("dataset", () => {
  it("fetches flights, hotels, places by style, events, and weather with short refs", () => {
    expect(categoriesFor(input.styles)).toEqual(["sights", "food", "culture", "photo", "events"]);
    expect(ds.dates).toEqual(["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"]);
    expect(ds.flights!.options[0].ref).toBe("F1");
    expect(ds.hotels!.options.every((h) => /^H\d+$/.test(h.ref))).toBe(true);
    expect(ds.places.filter((p) => p.category === "events").map((p) => p.ref)).toEqual(["E1", "E2"]);
    expect(ds.weather[2]).toMatchObject({ kind: "forecast", precipChance: 85, sunset: "17:24" });
    expect(ds.errors).toEqual([]);
    expect(ds.center).not.toBeNull();
  });

  it("only puts dataset items in the prompt", () => {
    const text = datasetForPrompt(ds);
    for (const p of ds.places) expect(text).toContain(`${p.ref} | ${p.name}`);
    expect(text).toContain("price not listed");
    expect(systemPrompt(ds)).toContain("Never invent a place");
  });
});

describe("budget", () => {
  it("picks flights and hotels per version", () => {
    expect(chooseFlight(ds, "lean", 25)!.priceTotal).toBe(998);
    expect(chooseFlight(ds, "splurge", 25)!.flags.some((f) => f.kind === "self_transfer")).toBe(false);
    expect(chooseHotel(ds, "splurge")!.tier).toBe("Luxury");
    const lean = chooseHotel(ds, "lean")!;
    expect(lean.rating! >= 4).toBe(true);
  });

  it("labels each cost line sourced/estimate/calculated and shows overage", () => {
    const f = chooseFlight(ds, "balanced", 25)!;
    const h = chooseHotel(ds, "balanced")!;
    const c = computeCosts({ key: "balanced", flightRef: f.ref, hotelRef: h.ref, days: [] }, ds, input, S);
    const by = Object.fromEntries(c.lines.map((l) => [l.key, l]));
    expect(by.flights).toMatchObject({ amount: f.priceTotal, basis: "sourced" });
    expect(by.lodging).toMatchObject({ amount: h.totalRate, basis: "sourced" });
    expect(by.food.basis).toBe("estimate");
    expect(by.transport).toMatchObject({ basis: "estimate", amount: 35 * 6 });
    expect(by.buffer).toMatchObject({ amount: 600, basis: "calculated" });
    expect(c.total).toBe(Math.round(c.lines.reduce((s, l) => s + l.amount, 0)));
    const tight = computeCosts({ key: "balanced", flightRef: f.ref, hotelRef: h.ref, days: [] }, ds, { ...input, budgetUsd: 1000 }, S);
    expect(tight.overBudget).toBe(true);
    expect(tight.remaining).toBeLessThan(0);
  });

  it("food estimate follows the settings table", () => {
    expect(foodEstimate("balanced", input, 6, S).amount).toBe((15 + 15 + 30) * 2 * 6);
  });
});

describe("validator (grounding)", () => {
  const raw = () => fixtureItinerary(ds, "balanced", "balanced");

  it("strips refs that aren't in the fetched data, duplicates, and events on the wrong date", () => {
    const tampered = structuredClone(raw());
    const jazz = ds.places.find((p) => p.name === "Sample Jazz Night")!;
    tampered.days[0].evening.push({ ref: jazz.ref, note: "wrong day" }); // jazz is 11/14
    tampered.days[0].morning.push({ ref: "H1", note: "hotel is not an activity" });
    tampered.days[0].morning.push({ ref: "Eiffel Tower", note: "made up" });
    const v = validateItinerary(tampered, ds);
    const reasons = v.removed.map((r) => `${r.ref}:${r.reason}`);
    expect(reasons.some((r) => r.startsWith("P999:Not in the fetched data"))).toBe(true);
    expect(reasons.some((r) => r.includes("Duplicate"))).toBe(true);
    expect(reasons.some((r) => r.startsWith(`${jazz.ref}:`) && r.includes("2026-11-14"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("H1:"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("EIFFEL TOWER:"))).toBe(true);
    const refs = refsInDays(v.days);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.every((r) => ds.places.some((p) => p.ref === r))).toBe(true);
    expect(v.days.map((d) => d.date)).toEqual(ds.dates);
  });

  it("removes prices and star ratings from AI notes", () => {
    expect(cleanNote("Tickets are $25–35, rated 4.6 stars. Go at 9 AM.")).toBe("Tickets are rated. Go at 9 AM.");
    expect(cleanNote("Costs US$12 per person")).toBe("Costs per person");
    expect(cleanNote(42)).toBeUndefined();
  });

  it("handles garbage output without crashing", () => {
    const v = validateItinerary({ summary: "x", tips: [], days: [] } as never, ds);
    expect(v.days).toHaveLength(ds.dates.length);
    expect(validateItinerary(null, ds).days.every((d) => d.blocks.every((b) => b.items.length === 0))).toBe(true);
  });

  it("validates a single regenerated day against refs used elsewhere", () => {
    const used = new Set([ds.places[0].ref]);
    const r = validateSingleDay({ day: { date: "2026-11-13", theme: "t", tip: "t", morning: [{ ref: ds.places[0].ref, note: "" }], afternoon: [], evening: [] } }, "2026-11-13", ds, used);
    expect(r.removed[0].reason).toContain("Duplicate");
  });
});

describe("plan generation (fixture Claude) + trips", () => {
  it("generates three grounded versions with costs and travel estimates", async () => {
    const plan = await generatePlan(input, ds, S);
    for (const k of ["lean", "balanced", "splurge"] as const) {
      const v = plan.versions[k];
      expect(v.days).toHaveLength(6);
      expect(v.removed.some((r) => r.ref === "P999")).toBe(true);
      expect(refsInDays(v.days).every((r) => ds.places.some((p) => p.ref === r))).toBe(true);
      expect(v.costs.lines).toHaveLength(6);
      const firstItem = v.days[0].blocks.flatMap((b) => b.items)[0];
      expect(firstItem.travel?.fromRef).toBe(v.hotelRef);
    }
    expect(plan.versions.lean.costs.total).toBeLessThan(plan.versions.splurge.costs.total);
  });

  it("saves, edits (with validation), shares, and regenerates a day", async () => {
    const plan = await generatePlan(input, ds, S);
    const trip = await createTrip(input, ds, plan);
    expect(trip.name).toBe("Lisbon · 11/12/2026–11/17/2026");

    const day2 = trip.plan.versions.balanced.days[1];
    const ref = day2.blocks.flatMap((b) => b.items)[0].ref;
    let t = await editTrip(trip.id, { op: "remove_item", version: "balanced", date: day2.date, ref });
    expect(refsInDays(t.plan.versions.balanced.days)).not.toContain(ref);
    t = await editTrip(trip.id, { op: "add_item", version: "balanced", date: day2.date, slot: "evening", ref });
    expect(t.plan.versions.balanced.days[1].blocks[2].items.at(-1)!.ref).toBe(ref);
    await expect(editTrip(trip.id, { op: "add_item", version: "balanced", date: day2.date, slot: "evening", ref: "P999" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(editTrip(trip.id, { op: "add_item", version: "balanced", date: day2.date, slot: "evening", ref })).rejects.toMatchObject({ code: "BAD_INPUT" });
    const h = ds.hotels!.options.at(-1)!.ref;
    t = await editTrip(trip.id, { op: "set_hotel", version: "balanced", ref: h });
    expect(t.plan.versions.balanced.hotelRef).toBe(h);
    t = await editTrip(trip.id, { op: "rename", name: "Lisbon fall" });
    expect(t.name).toBe("Lisbon fall");

    const shared = await setSharing(trip.id, true);
    expect(shared.share_token).toMatch(/^[\w-]{20,}$/);
    expect((await getSharedTrip(shared.share_token!))!.id).toBe(trip.id);
    await setSharing(trip.id, false);
    expect(await getSharedTrip(shared.share_token!)).toBeNull();

    const fresh = await getTrip(trip.id);
    const v = await regenerateDay(fresh.plan, "balanced", "2026-11-15", input, ds, S);
    expect(v.days.find((d) => d.date === "2026-11-15")!.theme).toBe("Fixture regenerated day");
    const others = fresh.plan.versions.balanced.days.filter((d) => d.date !== "2026-11-15");
    expect(v.days.filter((d) => d.date !== "2026-11-15")).toEqual(others.map((d) => expect.objectContaining({ date: d.date, blocks: expect.anything() })));
    const refs = refsInDays(v.days);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("compare + estimates + flexible dates", () => {
  it("compares destinations without Claude", async () => {
    const rows = await compareDestinations({ ...input, destinations: ["Lisbon", "Porto"] }, S);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ok: true, cheapestFlight: 998, events: 2 });
    expect(rows[0].fixedCosts.lean.total).toBeLessThan(rows[0].fixedCosts.splurge.total);
  });

  it("estimates searches (dedupes shared Tripadvisor requests)", async () => {
    const e = await estimateSearches(input);
    // autocomplete + flights + hotels + 4 maps + 2 tripadvisor + events
    expect(e.perDestination[0].total).toBe(10);
  });

  it("spreads flexible departure candidates across the window", () => {
    const c = flexCandidates({ ...input, dateMode: "flexible", windowStart: "2026-12-01", windowEnd: "2026-12-31", days: 7 });
    expect(c[0]).toBe("2026-12-01");
    expect(c.at(-1)).toBe("2026-12-25");
    expect(c.length).toBe(7);
  });
});

describe("weather history", () => {
  it("averages past years and reports rain frequency", () => {
    const y = (hi: number, p: number) => ({ daily: { time: ["2025-11-14"], temperature_2m_max: [hi], temperature_2m_min: [50], precipitation_sum: [p], sunset: ["2025-11-14T17:25"] } });
    const [w] = normalizeHistory([y(60, 0), y(64, 0.2)], ["2026-11-14"]);
    expect(w).toMatchObject({ kind: "historical", highF: 62, precipChance: 50, sunset: "17:25" });
  });
});
