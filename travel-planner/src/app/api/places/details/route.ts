import { readJson, withApi } from "@/lib/api";
import { placeDetails, type DetailPart } from "@/lib/places/service";
import type { PlaceItem } from "@/lib/places/types";

const ALLOWED: DetailPart[] = ["googleReviews", "tripadvisorReviews", "photos", "videos", "popularTimes"];

export const POST = withApi(async (req) => {
  const { item, destination, parts } = await readJson<{ item: PlaceItem; destination: string; parts: DetailPart[] }>(req);
  return placeDetails(item, destination ?? "", (parts ?? []).filter((p) => ALLOWED.includes(p)));
});
