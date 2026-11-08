import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { nextLegFlights } from "@/lib/flights/service";
import type { FlightSearchInput } from "@/lib/flights/types";

export const POST = withApi(async (req) => {
  const { input, departureToken } = await readJson<{ input: FlightSearchInput; departureToken: string }>(req);
  if (!departureToken) throw badInput("departureToken is required.");
  return nextLegFlights(input, departureToken);
});
