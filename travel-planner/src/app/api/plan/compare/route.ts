import { readJson, withApi } from "@/lib/api";
import { compareDestinations } from "@/lib/planner/compare";
import { validatePlanInput } from "@/lib/planner/dataset";
import type { PlanInput } from "@/lib/planner/types";
import { getSettings } from "@/lib/settings";

export const maxDuration = 300;

export const POST = withApi(async (req) => {
  const { input } = await readJson<{ input: PlanInput }>(req);
  validatePlanInput(input);
  return { rows: await compareDestinations(input, await getSettings()) };
});
