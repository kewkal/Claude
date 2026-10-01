import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { destinationVideos } from "@/lib/places/service";

export const POST = withApi(async (req) => {
  const { destination } = await readJson<{ destination: string }>(req);
  if (!destination?.trim()) throw badInput("Destination is required.");
  return destinationVideos(destination);
});
