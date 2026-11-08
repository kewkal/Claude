import { readJson, withApi } from "@/lib/api";
import { searchHotels } from "@/lib/hotels/service";
import type { HotelSearchInput } from "@/lib/hotels/types";

export const POST = withApi(async (req) => {
  const { input } = await readJson<{ input: HotelSearchInput }>(req);
  return searchHotels(input);
});
