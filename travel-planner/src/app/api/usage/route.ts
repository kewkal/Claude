import { withApi } from "@/lib/api";
import { getDb } from "@/lib/db";
import { getUsageSummary, syncSerpAccount, syncSerpAccountIfStale } from "@/lib/usage";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  await syncSerpAccountIfStale();
  const [summary, recent] = await Promise.all([getUsageSummary(), getDb().recentUsage(25)]);
  return { summary, recent, dbKind: getDb().kind };
});

// Refresh SerpApi's own usage count (free call, doesn't use quota).
export const POST = withApi(async () => {
  await syncSerpAccount();
  return { summary: await getUsageSummary() };
});
