import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { regenerateDay } from "@/lib/planner/generate";
import { getTrip, saveVersion } from "@/lib/planner/trips";
import { VERSION_KEYS, type VersionKey } from "@/lib/planner/types";
import { getSettings } from "@/lib/settings";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

export const POST = withApi<Ctx>(async (req, { params }) => {
  const { version, date } = await readJson<{ version: VersionKey; date: string }>(req);
  if (!VERSION_KEYS.includes(version)) throw badInput("Unknown version.");
  const trip = await getTrip((await params).id);
  if (!trip.dataset.dates.includes(date)) throw badInput("That date isn't part of this trip.");
  const v = await regenerateDay(trip.plan, version, date, trip.inputs, trip.dataset, await getSettings());
  return { trip: await saveVersion(trip, v) };
});
