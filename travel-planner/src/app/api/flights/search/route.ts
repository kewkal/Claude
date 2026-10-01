import { readJson, withApi } from "@/lib/api";
import { searchFlights } from "@/lib/flights/service";
import type { FlightSearchInput } from "@/lib/flights/types";

export const POST = withApi(async (req) => {
  const { input } = await readJson<{ input: FlightSearchInput }>(req);
  return searchFlights(input);
});
