import { readJson, withApi } from "@/lib/api";
import { estimateSearches } from "@/lib/planner/dataset";
import type { PlanInput } from "@/lib/planner/types";

export const POST = withApi(async (req) => {
  const { input } = await readJson<{ input: PlanInput }>(req);
  return estimateSearches(input);
});
