import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { explore, type ExploreOptions } from "@/lib/places/service";
import { CATEGORIES, type PlaceCategory } from "@/lib/places/types";

export const POST = withApi(async (req) => {
  const { destination, category, options } = await readJson<{ destination: string; category: PlaceCategory; options?: ExploreOptions }>(req);
  if (!CATEGORIES.some((c) => c.id === category)) throw badInput("Unknown category.");
  return explore(destination, category, options);
});
