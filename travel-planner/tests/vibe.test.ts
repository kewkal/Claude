import { beforeAll, describe, expect, it, vi } from "vitest";
import { dayTickets } from "@/lib/planner/budget";
import { buildDataset } from "@/lib/planner/dataset";
import { describeDays, generatePlan } from "@/lib/planner/generate";
import { vibeLabel } from "@/lib/planner/styles";
import { createTrip, editTrip } from "@/lib/planner/trips";
import type { Dataset, PlanDay, PlanInput } from "@/lib/planner/types";
import { dayVibe } from "@/lib/planner/vibe";
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

const day = (refs: [string, "morning" | "afternoon" | "evening"][]): PlanDay => ({
  date: "2026-11-13",
  blocks: (["morning", "afternoon", "evening"] as const).map((slot) => ({ slot, items: refs.filter(([, s]) => s === slot).map(([ref]) => ({ ref })) })),
});

describe("day vibe (computed from the day's stops, not AI)", () => {
  let ds: Dataset;
  beforeAll(async () => {
    ds = await buildDataset(input, "Lisbon", S.valueOfTimeUsdPerHour);
  });
  const ref = (name: string) => ds.places.find((p) => p.name === name)!.ref;

  it("labels a viewpoint day cinematic and a food day foodie", () => {
    const views = day([
      [ref("Sample Miradouro North"), "morning"],
      [ref("Sample Miradouro West"), "afternoon"],
      [ref("Sample Riverfront Pier"), "evening"],
    ]);
    expect(dayVibe(views, ds, input.styles)[0]).toBe("cinematic");
    const food = day([
      [ref("Sample Market Hall"), "morning"],
      [ref("Sample Pastry Shop"), "morning"],
      [ref("Sample Tasca"), "afternoon"],
      [ref("Sample Seafood House"), "evening"],
    ]);
    expect(dayVibe(food, ds, input.styles)).toEqual(["foodie"]);
    expect(vibeLabel(["adventure", "cinematic"])).toBe("Adventure + Cinematic day");
  });

  it("prefers your own trip styles and gives an empty day no label", () => {
    const museums = day([
      [ref("Sample Tile Museum"), "morning"],
      [ref("Sample Fado Museum"), "afternoon"],
      [ref("Sample Miradouro North"), "evening"],
    ]);
    expect(dayVibe(museums, ds, ["cultural", "cinematic"])).toEqual(["cultural", "cinematic"]);
    expect(dayVibe(day([]), ds, input.styles)).toEqual([]);
  });

  it("sums a day's tickets × travelers using listed, found, then your prices", () => {
    const d = day([
      [ref("Sample Monastery"), "morning"], // $12 listed
      [ref("Sample Tiny Chapel"), "afternoon"], // no price
      [ref("Sample Tasca"), "evening"], // food: covered by the food estimate
    ]);
    expect(dayTickets(d, ds, input)).toEqual({ usd: 24, priced: 1, unpriced: 1 });
    const withMine = { ...ds, userPrices: { [ref("Sample Tiny Chapel")]: 5 } };
    expect(dayTickets(d, withMine, input)).toEqual({ usd: 34, priced: 2, unpriced: 0 });
  });

  it("every generated day gets a vibe and a story; prices/ratings are stripped from the story", async () => {
    const plan = await generatePlan(input, ds, S);
    const d1 = plan.versions.balanced.days[1];
    expect(d1.vibe?.length).toBeGreaterThan(0);
    expect(d1.story).toMatch(/^You'll start slow/);
    expect(d1.story).not.toMatch(/\$50|4\.8|Costs/); // the whole sentence with a price is dropped
    expect(d1.storyRefs).toEqual(d1.blocks.flatMap((b) => b.items.map((i) => i.ref)));
  });

  it("edits recompute the vibe and mark the story out of date; describe rewrites it", async () => {
    const trip = await createTrip(input, ds, await generatePlan(input, ds, S));
    const d = trip.plan.versions.balanced.days[1];
    const first = d.blocks.flatMap((b) => b.items)[0];
    const t = await editTrip(trip.id, { op: "remove_item", version: "balanced", date: d.date, ref: first.ref });
    const after = t.plan.versions.balanced.days[1];
    expect(after.storyRefs).not.toEqual(after.blocks.flatMap((b) => b.items.map((i) => i.ref)));
    expect(after.vibe).toBeDefined();

    const v = await describeDays(t.plan, "balanced", input, ds, S);
    const fresh = v.days[1];
    expect(fresh.story).toMatch(/fixture description/);
    expect(fresh.storyRefs).toEqual(fresh.blocks.flatMap((b) => b.items.map((i) => i.ref)));
  });
});
