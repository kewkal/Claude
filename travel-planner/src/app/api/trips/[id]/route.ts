import { readJson, withApi } from "@/lib/api";
import { deleteTrip, editTrip, getTrip, type TripEdit } from "@/lib/planner/trips";

type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export const GET = withApi<Ctx>(async (_req, { params }) => ({ trip: await getTrip((await params).id) }));

export const PATCH = withApi<Ctx>(async (req, { params }) => {
  const edit = await readJson<TripEdit>(req);
  return { trip: await editTrip((await params).id, edit) };
});

export const DELETE = withApi<Ctx>(async (_req, { params }) => {
  await deleteTrip((await params).id);
  return { ok: true };
});
