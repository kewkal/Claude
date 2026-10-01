import { readJson, withApi } from "@/lib/api";
import { hotelReviews } from "@/lib/hotels/service";

export const POST = withApi(async (req) => {
  const { propertyToken } = await readJson<{ propertyToken: string }>(req);
  return hotelReviews(propertyToken);
});
