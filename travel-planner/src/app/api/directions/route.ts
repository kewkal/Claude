import { readJson, withApi } from "@/lib/api";
import { liveDirections } from "@/lib/directions";
import type { LatLng } from "@/lib/geo";

export const POST = withApi(async (req) => {
  const { from, to } = await readJson<{ from: LatLng; to: LatLng }>(req);
  return liveDirections(from, to);
});
