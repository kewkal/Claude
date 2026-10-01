import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { bookingOptions } from "@/lib/flights/service";
import type { FlightSearchInput } from "@/lib/flights/types";

export const POST = withApi(async (req) => {
  const { input, bookingToken } = await readJson<{ input: FlightSearchInput; bookingToken: string }>(req);
  if (!bookingToken) throw badInput("bookingToken is required.");
  return bookingOptions(input, bookingToken);
});
