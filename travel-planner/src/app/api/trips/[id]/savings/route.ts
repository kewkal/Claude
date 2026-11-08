import { withApi } from "@/lib/api";
import { getTrip } from "@/lib/planner/trips";
import { generateSavingsTips } from "@/lib/savings/service";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 120;

// Reddit + forums/blogs (Google) + YouTube searches, cached 30 days, then one Claude call; cross-checked server-side.
export const POST = withApi<Ctx>(async (_req, { params }) => {
  const trip = await getTrip((await params).id);
  return { trip: await generateSavingsTips(trip) };
});
