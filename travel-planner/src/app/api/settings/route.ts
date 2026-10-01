import { readJson, withApi } from "@/lib/api";
import { badInput } from "@/lib/errors";
import { getSettings, updateSettings, type AppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => ({ settings: await getSettings() }));

export const PUT = withApi(async (req) => {
  const body = await readJson<Partial<AppSettings>>(req);
  const patch: Partial<AppSettings> = {};
  const posNum = (v: unknown, name: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw badInput(`${name} must be a non-negative number.`);
    return n;
  };
  if (body.verifiedReviewThreshold !== undefined) patch.verifiedReviewThreshold = Math.round(posNum(body.verifiedReviewThreshold, "Verified threshold"));
  if (body.valueOfTimeUsdPerHour !== undefined) patch.valueOfTimeUsdPerHour = posNum(body.valueOfTimeUsdPerHour, "Value of time");
  if (body.localTransportUsdPerDay !== undefined) patch.localTransportUsdPerDay = posNum(body.localTransportUsdPerDay, "Local transport");
  if (body.mealCostByPriceLevel) {
    const m = body.mealCostByPriceLevel;
    patch.mealCostByPriceLevel = { 1: posNum(m[1], "$ meal"), 2: posNum(m[2], "$$ meal"), 3: posNum(m[3], "$$$ meal"), 4: posNum(m[4], "$$$$ meal") };
  }
  if (body.defaultOrigin !== undefined) {
    if (body.defaultOrigin !== "IAH" && body.defaultOrigin !== "HOU") throw badInput("Default origin must be IAH or HOU.");
    patch.defaultOrigin = body.defaultOrigin;
  }
  for (const k of ["serpOverrideUntil", "claudeOverrideUntil"] as const) {
    if (body[k] !== undefined) {
      const v = body[k];
      if (v !== null && Number.isNaN(Date.parse(v))) throw badInput(`${k} must be an ISO date or null.`);
      patch[k] = v;
    }
  }
  return { settings: await updateSettings(patch) };
});
