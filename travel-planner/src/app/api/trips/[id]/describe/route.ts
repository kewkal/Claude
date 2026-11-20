import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { describeDays } from "@/lib/planner/generate";
import { getTrip, saveVersion } from "@/lib/planner/trips";
import { VERSION_KEYS, type VersionKey } from "@/lib/planner/types";
import { getSettings } from "@/lib/settings";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

// Write "how each day will feel" for one version (one Claude call). Used for older trips and after edits.
export const POST = withApi<Ctx>(async (req, { params }) => {
  const { version } = await readJson<{ version: VersionKey }>(req);
  if (!VERSION_KEYS.includes(version)) throw badInput("Unknown version.");
  const trip = await getTrip((await params).id);
  const v = await describeDays(trip.plan, version, trip.inputs, trip.dataset, await getSettings());
  return { trip: await saveVersion(trip, v) };
});
