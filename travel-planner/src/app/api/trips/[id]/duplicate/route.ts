import { withApi } from "@/lib/api";
import { duplicateTrip } from "@/lib/planner/trips";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi<Ctx>(async (_req, { params }) => {
  const t = await duplicateTrip((await params).id);
  return { id: t.id };
});
