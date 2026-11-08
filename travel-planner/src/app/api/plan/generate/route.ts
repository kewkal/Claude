import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { buildDataset } from "@/lib/planner/dataset";
import { generatePlan } from "@/lib/planner/generate";
import { createTrip } from "@/lib/planner/trips";
import type { PlanInput } from "@/lib/planner/types";
import { getSettings } from "@/lib/settings";
import { assertClaudeBudget } from "@/lib/usage";

// Dataset fetch (~10 searches, parallel) + 3 Claude calls (parallel).
export const maxDuration = 300;

export const POST = withApi(async (req) => {
  const { input, destination, dates } = await readJson<{ input: PlanInput; destination?: string; dates?: { startDate: string; endDate: string } }>(req);
  const dest = (destination ?? input.destinations?.[0] ?? "").trim();
  if (!dest) throw badInput("Pick a destination.");
  // Fail fast before spending SerpApi searches if Claude can't run.
  await assertClaudeBudget();
  const settings = await getSettings();
  const ds = await buildDataset(input, dest, settings.valueOfTimeUsdPerHour, dates);
  if (!ds.places.length) throw badInput(`No activities were found for ${dest}. ${ds.errors.join(" ")}`);
  const plan = await generatePlan(input, ds, settings);
  const trip = await createTrip(input, ds, plan);
  return { id: trip.id };
});
