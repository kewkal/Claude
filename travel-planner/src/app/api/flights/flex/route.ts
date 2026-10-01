import { readJson, withApi } from "@/lib/api";
import { flexCost, flexSearch } from "@/lib/flights/service";
import type { FlightSearchInput } from "@/lib/flights/types";

export const maxDuration = 120;

export const POST = withApi(async (req) => {
  const { input, dryRun } = await readJson<{ input: FlightSearchInput; dryRun?: boolean }>(req);
  if (dryRun) return flexCost(input, 3);
  return { days: await flexSearch(input, 3) };
});
