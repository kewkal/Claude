import { readJson, withApi } from "@/lib/api";
import { setSharing } from "@/lib/planner/trips";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withApi<Ctx>(async (req, { params }) => {
  const { on } = await readJson<{ on: boolean }>(req);
  const t = await setSharing((await params).id, !!on);
  return { shareToken: t.share_token };
});
