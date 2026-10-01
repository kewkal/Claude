import "server-only";
import { getDb } from "@/lib/db";
import { DEFAULT_SETTINGS, type AppSettings } from "@/lib/settings-shared";

export { DEFAULT_SETTINGS, type AppSettings };

const KEY = "app_settings";

export async function getSettings(): Promise<AppSettings> {
  const stored = await getDb().getSetting<Partial<AppSettings>>(KEY);
  return mergeSettings(stored ?? {});
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = mergeSettings({ ...(await getSettings()), ...patch });
  await getDb().setSetting(KEY, next);
  return next;
}

function mergeSettings(s: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    mealCostByPriceLevel: { ...DEFAULT_SETTINGS.mealCostByPriceLevel, ...(s.mealCostByPriceLevel ?? {}) },
  };
}
