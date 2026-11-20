import { withApi } from "@/lib/api";
import { getTrip } from "@/lib/planner/trips";
import { planPriceCheck, runPriceCheck } from "@/lib/prices/service";

type Ctx = { params: Promise<{ id: string }> };
export const maxDuration = 300;

// What "Get real prices" would check and what it costs (nothing is fetched).
export const GET = withApi<Ctx>(async (_req, { params }) => {
  const trip = await getTrip((await params).id);
  const { requests: _requests, ...plan } = await planPriceCheck(trip);
  void _requests;
  return { plan };
});

// Hotel prices by booking site, Tripadvisor + official-site ticket prices, currency conversion,
// and Reddit/Tripadvisor-forum picks. Stored on the trip; every version's costs are recomputed.
export const POST = withApi<Ctx>(async (_req, { params }) => {
  const trip = await getTrip((await params).id);
  return { trip: await runPriceCheck(trip) };
});
