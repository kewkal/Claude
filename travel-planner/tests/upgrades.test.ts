import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings-shared";
import { buildDataset } from "@/lib/planner/dataset";
import { generatePlan, recomputeVersion } from "@/lib/planner/generate";
import { createTrip, editTrip } from "@/lib/planner/trips";
import type { Dataset, PlanInput, PlanVersion, TripPlan } from "@/lib/planner/types";
import { computeUpgrades, nearestNeighbor, rankScore, routeMinutes } from "@/lib/upgrades/engine";
import { generateUpgrades, validateAiSuggestions } from "@/lib/upgrades/service";

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
  styles: ["cinematic", "adventure", "foodie"],
  pace: "balanced",
};
vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));

let ds: Dataset;
let plan: TripPlan;
beforeAll(async () => {
  ds = await buildDataset(input, "Lisbon", S.valueOfTimeUsdPerHour);
  plan = await generatePlan(input, ds, S);
});

const byName = (n: string) => ds.places.find((p) => p.name === n)!;
const emptyDays = () => ds.dates.map((date) => ({ date, blocks: (["morning", "afternoon", "evening"] as const).map((slot) => ({ slot, items: [] as { ref: string }[] })) }));

function versionWith(days: PlanVersion["days"], over: Partial<PlanVersion> = {}): PlanVersion {
  return recomputeVersion({ ...plan.versions.lean, days, ...over }, ds, input, S);
}

describe("upgrade engine", () => {
  it("ranks by benefit per dollar", () => {
    expect(rankScore({ impact: 4, costDeltaUsd: 0 })).toBe(4);
    expect(rankScore({ impact: 4, costDeltaUsd: 100 })).toBe(2);
    expect(rankScore({ impact: 3, costDeltaUsd: -200 })).toBe(3);
  });

  it("prices faster flights per hour saved and flags risky connections", () => {
    const v = plan.versions.lean; // cheapest = Spirit/TAP self-transfer, 18.6 hrs
    const ups = computeUpgrades(ds, v, input, S);
    const faster = ups.find((u) => u.id.startsWith("flight-faster"))!;
    expect(faster.metric).toMatch(/\/hour saved/);
    expect(faster.costDeltaUsd).toBeGreaterThan(0);
    expect(faster.action).toMatchObject({ op: "set_flight" });
    const safer = ups.find((u) => u.id.startsWith("flight-safer") || u.id === "flight-risky-flag");
    expect(safer).toBeTruthy();
    // sorted by rank score
    const scores = ups.map(rankScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("suggests sunset timing for photo spots from Open-Meteo sunset data", () => {
    const days = emptyDays();
    days[2].blocks[0].items.push({ ref: byName("Sample Miradouro North").ref });
    const ups = computeUpgrades(ds, versionWith(days), input, S);
    const s = ups.find((u) => u.id === `sunset-${byName("Sample Miradouro North").ref}`)!;
    expect(s.why).toContain("5:24 PM");
    expect(s.action).toMatchObject({ op: "move_item", toSlot: "evening" });
  });

  it("swaps an outdoor day out of the rain", () => {
    const days = emptyDays();
    days[2].blocks[0].items.push({ ref: byName("Sample Hilltop Park").ref }); // 11/14, 85% rain
    days[4].blocks[0].items.push({ ref: byName("Sample Arch Square").ref }); // 11/16, 10% rain
    const ups = computeUpgrades(ds, versionWith(days), input, S);
    const swap = ups.find((u) => u.id.startsWith("rain-"))!;
    expect(swap.action).toEqual({ op: "swap_days", a: "2026-11-14", b: "2026-11-16" });
  });

  it("offers events on your dates that aren't in the plan", () => {
    const ups = computeUpgrades(ds, versionWith(emptyDays()), input, S);
    const ev = ups.filter((u) => u.id.startsWith("event-"));
    expect(ev.map((u) => u.title)).toEqual(["Add Sample Jazz Night on 11/14/2026", "Add Sample Food Festival on 11/15/2026"]);
    expect(ev[0].costDeltaUsd).toBeNull();
    expect(ev[0].why).toContain("Price not listed");
  });

  it("reorders a zig-zag day with nearest-neighbor routing", () => {
    const days = emptyDays();
    // Belém (west) → Alfama (east) → Belém → Alfama
    for (const n of ["Sample Tower by the River", "Sample Castle Viewpoint", "Sample Monastery", "Sample Arch Square"]) days[1].blocks[0].items.push({ ref: byName(n).ref });
    const ups = computeUpgrades(ds, versionWith(days), input, S);
    const r = ups.find((u) => u.id === "reorder-2026-11-13")!;
    expect(r).toBeTruthy();
    expect(r.action).toMatchObject({ op: "reorder_day", date: "2026-11-13" });
    const pts = [{ gps: { lat: 0, lng: 0 } }, { gps: { lat: 0, lng: 1 } }, { gps: { lat: 0, lng: 0.1 } }];
    expect(nearestNeighbor({ lat: 0, lng: 0 }, pts).map((p) => p.gps.lng)).toEqual([0, 0.1, 1]);
    expect(routeMinutes(undefined, [])).toBe(0);
  });

  it("labels advice that isn't tied to fetched data as general", () => {
    const ups = computeUpgrades(ds, plan.versions.lean, input, S);
    expect(ups.find((u) => u.id === "cabin-premium")!.basis).toBe("general");
  });
});

describe("AI upgrade suggestions are validated", () => {
  it("drops invented refs and labels unreferenced ideas as general advice", () => {
    const out = validateAiSuggestions(
      {
        suggestions: [
          { group: "experience", title: "Real", why: "ok", refs: [ds.places[0].ref], impact: 3 },
          { group: "comfort", title: "Fake", why: "invented", refs: ["P999"], impact: 5 },
          { group: "logistics", title: "Advice", why: "Costs $40 total", refs: [], impact: 9 },
        ],
      },
      ds,
    );
    expect(out.map((u) => [u.title, u.basis])).toEqual([
      ["Real", "grounded"],
      ["Advice", "general"],
    ]);
    expect(out[1].impact).toBe(5);
    expect(out[1].why).toBe("Costs total");
    expect(out.every((u) => u.ai && u.costDeltaUsd === null)).toBe(true);
  });

  it("generates, saves, and applies an upgrade end to end", async () => {
    const trip = await createTrip(input, ds, plan);
    const t = await generateUpgrades(trip, "lean", true);
    expect(t.upgrades!.version).toBe("lean");
    expect(t.upgrades!.items.some((u) => u.ai && u.basis === "general")).toBe(true);
    expect(t.upgrades!.items.some((u) => u.title.includes("invented"))).toBe(false);
    const flightUp = t.upgrades!.items.find((u) => u.action?.op === "set_flight")!;
    const applied = await editTrip(t.id, { ...flightUp.action!, version: "lean" } as never);
    expect(applied.plan.versions.lean.flightRef).toBe((flightUp.action as { ref: string }).ref);
  });
});
