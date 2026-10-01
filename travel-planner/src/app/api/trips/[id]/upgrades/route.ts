import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { getTrip } from "@/lib/planner/trips";
import { VERSION_KEYS, type VersionKey } from "@/lib/planner/types";
import { generateUpgrades } from "@/lib/upgrades/service";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

export const POST = withApi<Ctx>(async (req, { params }) => {
  const { version, ai } = await readJson<{ version: VersionKey; ai?: boolean }>(req);
  if (!VERSION_KEYS.includes(version)) throw badInput("Unknown version.");
  const trip = await getTrip((await params).id);
  return { trip: await generateUpgrades(trip, version, !!ai) };
});
