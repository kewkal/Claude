import { withApi } from "@/lib/api";
import { listTrips } from "@/lib/planner/trips";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => ({ trips: await listTrips() }));
